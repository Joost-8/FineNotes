/**
 * Where each stroke of an open notebook is, for the tools that find strokes
 * by position — the eraser, a tap, the lasso, Scribble to erase — and for
 * the commits that follow them, which find strokes by id.
 *
 * Stroke coordinates are page-local, so every page has a grid of its own.
 * An id resolves to its stroke and to the page holding it: a grid hit then
 * costs one lookup, and an erase that spans pages removes each stroke from
 * the page it is really on.
 *
 * The index caches the document, it does not own it. Whoever changes a
 * page's strokes either reports the change (`add`, `remove`, `clearPage`)
 * or has the index read those pages again (`refreshPages`), or all of them
 * (`rebuild`).
 *
 * Pure: no DOM, no Obsidian.
 */

import { SpatialIndex } from "../canvas/spatial-index";
import type { Bounds, Page, Stroke } from "../model/document";

interface Placed {
  stroke: Stroke;
  pageId: string;
}

export class StrokeIndex {
  private readonly grids = new Map<string, SpatialIndex>();
  private readonly placed = new Map<string, Placed>();

  /** Drop everything known and read `pages` afresh. */
  rebuild(pages: readonly Page[]): void {
    this.grids.clear();
    this.placed.clear();
    for (const page of pages) {
      for (const stroke of page.strokes) this.add(page.id, stroke);
    }
  }

  /**
   * Read again only the pages whose id is in `pageIds`, from `pages`, after
   * an edit known to change no other page; a page no longer in `pages` is
   * dropped. Reading every page took ~1 s an erase in a notebook of 1,000
   * pages of notes (research/SCALE.md).
   */
  refreshPages(pages: readonly Page[], pageIds: Iterable<string>): void {
    const wanted = new Set(pageIds);
    if (wanted.size === 0) return;
    for (const id of wanted) this.grids.delete(id);
    for (const [id, where] of this.placed) {
      if (wanted.has(where.pageId)) this.placed.delete(id);
    }
    for (const page of pages) {
      if (!wanted.has(page.id)) continue;
      for (const stroke of page.strokes) this.add(page.id, stroke);
    }
  }

  /** `stroke` was added to page `pageId`. */
  add(pageId: string, stroke: Stroke): void {
    let grid = this.grids.get(pageId);
    if (!grid) {
      grid = new SpatialIndex();
      this.grids.set(pageId, grid);
    }
    grid.insert(stroke);
    this.placed.set(stroke.id, { stroke, pageId });
  }

  /**
   * Stroke `id` was taken off a page: `pageId`, or else the page the index
   * last saw it on. Ids are unique per notebook only by convention, so a
   * caller that knows the page says which.
   */
  remove(id: string, pageId: string | undefined = this.placed.get(id)?.pageId): void {
    if (pageId) this.grids.get(pageId)?.remove(id);
    this.placed.delete(id);
  }

  /** Page `pageId` lost all its strokes at once. */
  clearPage(pageId: string): void {
    this.grids.get(pageId)?.clear();
    for (const [id, where] of this.placed) {
      if (where.pageId === pageId) this.placed.delete(id);
    }
  }

  get(id: string): Stroke | undefined {
    return this.placed.get(id)?.stroke;
  }

  /** The id of the page stroke `id` is on, if the index knows it. */
  pageOf(id: string): string | undefined {
    return this.placed.get(id)?.pageId;
  }

  /**
   * Ids of the strokes on page `pageId` that may pass within `radius` of
   * (x, y) — a broad phase by bounds; an exact hit test decides.
   */
  near(pageId: string, x: number, y: number, radius: number): Set<string> {
    return this.grids.get(pageId)?.queryPoint(x, y, radius) ?? new Set();
  }

  /**
   * Call `visit` with each stroke on page `pageId` that may pass within
   * `radius` of (x, y), possibly more than once — a broad phase that builds
   * nothing, for a query on every pointer move (snapping to shapes).
   */
  forEachNear(
    pageId: string,
    x: number,
    y: number,
    radius: number,
    visit: (stroke: Stroke) => void,
  ): void {
    const grid = this.grids.get(pageId);
    if (!grid) return;
    this.visiting = visit;
    grid.forEachNear(x, y, radius, this.visitId);
    this.visiting = null;
  }

  private visiting: ((stroke: Stroke) => void) | null = null;
  private readonly visitId = (id: string): void => {
    const where = this.placed.get(id);
    if (where) this.visiting?.(where.stroke);
  };

  /** Ids of the strokes on page `pageId` whose bounds may meet `bounds` (a broad phase too). */
  within(pageId: string, bounds: Bounds): Set<string> {
    return this.grids.get(pageId)?.queryBounds(bounds) ?? new Set();
  }

  /**
   * `ids` sorted by the page each is on, pages in first-seen order. Ids the
   * index does not know, or knows on a page without an id, are left out.
   */
  byPage(ids: Iterable<string>): Map<string, Set<string>> {
    const pages = new Map<string, Set<string>>();
    for (const id of ids) {
      const pageId = this.pageOf(id);
      if (!pageId) continue;
      const onPage = pages.get(pageId) ?? new Set<string>();
      onPage.add(id);
      pages.set(pageId, onPage);
    }
    return pages;
  }
}
