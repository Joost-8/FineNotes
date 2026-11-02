/**
 * A page's margin: room to write beside its PDF or paper. The page grows to
 * the left, the right or both by plain paper, and its own PDF or paper keeps
 * its size and place in a frame ({@link Backdrop.frame}), so it is not
 * stretched or re-fitted to the wider page. A margin on the left moves
 * everything on the page right by as much, so ink stays on the words it was
 * written over.
 *
 * Widths are a share of the frame's width (what the page was before), so
 * one share means the same on every page of a slide deck.
 *
 * A margin never cuts ink off: it is never narrower than what is written in
 * it ({@link marginFloor}).
 *
 * PURE: no DOM.
 */

import type { Command } from "./commands";
import type { Backdrop, InkDocument, Page, PageGeometry } from "./document";
import { POINT_STRIDE, pdfFrameOf } from "./document";
import { TranslateElements } from "./selection-commands";

/** A page's margin on each side, page px. */
export interface PageMargin {
  left: number;
  right: number;
}

export type MarginSide = "none" | "left" | "right" | "both";

/** The margin slider's range and start, in % of the frame's width. */
export const MARGIN_MIN_PERCENT = 10;
export const MARGIN_MAX_PERCENT = 60;
export const MARGIN_DEFAULT_PERCENT = 33;

const NO_MARGIN: PageMargin = { left: 0, right: 0 };

/** The width of the page's own PDF or paper: the page before any margin. */
export function frameWidth(page: Page): number {
  return pdfFrameOf(page.backdrop, page.geometry).width;
}

/** How much margin `page` has now on each side, page px. */
export function marginOf(page: Page): PageMargin {
  const frame = page.backdrop.frame;
  if (!frame) return NO_MARGIN;
  return {
    left: Math.max(0, frame.x),
    right: Math.max(0, page.geometry.width - frame.x - frame.width),
  };
}

/** Which sides have a margin. */
export function marginSideOf(margin: PageMargin): MarginSide {
  if (margin.left > 0 && margin.right > 0) return "both";
  if (margin.left > 0) return "left";
  if (margin.right > 0) return "right";
  return "none";
}

/** A margin as a share of `page`'s frame, %, rounded: the wider side when both differ. */
export function marginPercentOf(page: Page): number {
  const { left, right } = marginOf(page);
  const width = frameWidth(page);
  if (!(width > 0)) return 0;
  return Math.round((Math.max(left, right) / width) * 100);
}

/** The margin `side` at `percent` of `page`'s frame, page px. */
export function marginFor(page: Page, side: MarginSide, percent: number): PageMargin {
  const px = Math.round((frameWidth(page) * percent) / 100);
  return {
    left: side === "left" || side === "both" ? px : 0,
    right: side === "right" || side === "both" ? px : 0,
  };
}

/**
 * The narrowest margin that keeps everything on `page` on it: how far its
 * ink, pictures, text boxes, tables and graphs reach past the frame on each
 * side, page px, rounded up. Zero on a side nothing reaches into.
 */
export function marginFloor(page: Page): PageMargin {
  const frame = pdfFrameOf(page.backdrop, page.geometry);
  const edges = contentEdges(page);
  if (!edges) return NO_MARGIN;
  return {
    left: Math.max(0, Math.ceil(frame.x - edges.minX)),
    right: Math.max(0, Math.ceil(edges.maxX - (frame.x + frame.width))),
  };
}

/** The leftmost and rightmost x anything on the page covers, or null for an empty page. */
function contentEdges(page: Page): { minX: number; maxX: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  const take = (a: number, b: number): void => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    minX = Math.min(minX, a);
    maxX = Math.max(maxX, b);
  };
  for (const stroke of page.strokes) {
    const reach = stroke.size / 2;
    const pts = stroke.pts;
    const usable = pts.length - (pts.length % POINT_STRIDE);
    for (let i = 0; i < usable; i += POINT_STRIDE) take(pts[i] - reach, pts[i] + reach);
  }
  for (const image of page.images) {
    const turn = ((image.rotation ?? 0) * Math.PI) / 180;
    const half = (image.w * Math.abs(Math.cos(turn)) + image.h * Math.abs(Math.sin(turn))) / 2;
    const cx = image.x + image.w / 2;
    take(cx - half, cx + half);
  }
  for (const box of page.textBoxes) take(box.x, box.x + box.w);
  for (const table of page.tables ?? []) {
    take(table.x, table.x + table.cols.reduce((sum, col) => sum + col, 0));
  }
  for (const graph of page.graphs ?? []) take(graph.x, graph.x + graph.w);
  return Number.isFinite(minX) ? { minX, maxX } : null;
}

/** The margin asked for, never narrower than {@link marginFloor}. */
export function keepContent(page: Page, margin: PageMargin): PageMargin {
  const floor = marginFloor(page);
  return { left: Math.max(margin.left, floor.left), right: Math.max(margin.right, floor.right) };
}

/** The page as it was before any margin: what a new page after it takes. */
export function unmarginedGeometry(page: Page): PageGeometry {
  const frame = page.backdrop.frame;
  if (!frame) return page.geometry;
  return { ...page.geometry, width: frame.width };
}

/** A backdrop without the frame a margin keeps it in: for a new page made from it. */
export function withoutFrame<T extends Backdrop>(backdrop: T): T {
  if (!backdrop.frame) return backdrop;
  const { frame: _frame, ...rest } = backdrop;
  return rest as T;
}

/**
 * Give each page the margin asked for, as one step: one undo takes every
 * page back. The margin is kept at least as wide as what is written in it.
 */
export class SetPageMargin implements Command {
  readonly label = "Margin";
  /** A wider page re-fits the view: stay on the page being read. */
  readonly keepsReading = true;
  private done: Array<{
    page: Page;
    geometry: PageGeometry;
    backdrop: Backdrop;
    comments: number[];
    sections: number[];
    moved: TranslateElements | null;
  }> = [];

  constructor(private readonly targets: ReadonlyArray<{ page: Page; margin: PageMargin }>) {}

  /** The page's id when the step changes one page, so undo shows it. */
  get pageId(): string | undefined {
    return this.targets.length === 1 ? this.targets[0].page.id : undefined;
  }

  apply(doc: InkDocument): void {
    this.done = [];
    for (const { page, margin } of this.targets) {
      // By identity, like the other page commands: ids can repeat within a file.
      if (!doc.pages.includes(page)) continue;
      const next = keepContent(page, margin);
      const old = marginOf(page);
      if (next.left === old.left && next.right === old.right) continue;
      const record = {
        page,
        geometry: page.geometry,
        backdrop: page.backdrop,
        comments: (page.comments ?? []).map((comment) => comment.x),
        sections: (page.sections ?? []).map((section) => section.x),
        moved: null as TranslateElements | null,
      };
      const frame = pdfFrameOf(page.backdrop, page.geometry);
      const width = frame.width;
      const fullHeight = frame.y === 0 && frame.height === page.geometry.height;
      if (next.left === 0 && next.right === 0 && fullHeight) {
        page.backdrop = withoutFrame(page.backdrop);
      } else {
        page.backdrop = { ...page.backdrop, frame: { ...frame, x: next.left } };
      }
      page.geometry = { ...page.geometry, width: next.left + width + next.right };
      const dx = next.left - old.left;
      if (dx !== 0) {
        record.moved = new TranslateElements(
          page.id,
          {
            strokes: [...page.strokes],
            images: [...page.images],
            textBoxes: [...page.textBoxes],
            tables: [...(page.tables ?? [])],
            graphs: [...(page.graphs ?? [])],
          },
          dx,
          0,
        );
        record.moved.apply(doc);
        for (const comment of page.comments ?? []) comment.x += dx;
        for (const section of page.sections ?? []) section.x += dx;
      }
      this.done.push(record);
    }
  }

  invert(doc: InkDocument): void {
    for (let i = this.done.length - 1; i >= 0; i--) {
      const record = this.done[i];
      const { page } = record;
      if (!doc.pages.includes(page)) continue;
      record.moved?.invert(doc);
      (page.comments ?? []).forEach((comment, at) => {
        comment.x = record.comments[at] ?? comment.x;
      });
      (page.sections ?? []).forEach((section, at) => {
        section.x = record.sections[at] ?? section.x;
      });
      page.geometry = record.geometry;
      page.backdrop = record.backdrop;
    }
    this.done = [];
  }

  /** Whether the last apply changed anything: nothing to keep as a step if not. */
  get changedAny(): boolean {
    return this.done.length > 0;
  }
}
