/**
 * Page stacking: the geometry that turns `doc.pages[]` into discrete sheets of
 * paper with a gap between them — top to bottom, or (a notebook's "Scroll
 * direction" setting, as in GoodNotes) left to right. Pure — no DOM, no
 * Obsidian.
 *
 * ## Three coordinate spaces, and why they are separate
 *
 * 1. **page space** — what is stored in `Stroke.pts`. Page-local: `(0,0)` is the
 *    page's top-left corner and the page is `geometry.width x geometry.height`
 *    page px, fixed forever.
 * 2. **layout space** — pages stacked vertically, each at its *intrinsic* size,
 *    separated by {@link PAGE_GAP} and centred on the widest page. Still fixed:
 *    nothing here depends on the window, the device or the zoom level.
 * 3. **screen space** — layout space multiplied by the view scale and offset by
 *    scroll. This is the only space that knows the viewport exists.
 *
 * The one-way street `page -> layout -> screen` is the whole reason pagination
 * fixes cross-device ink drift (see research/RESEARCH.md, "Sync and data loss":
 * a competitor's author calls the coordinate problem "not going to go away"
 * precisely because their ink coordinates are viewport-derived). **Never invert
 * it.** A screen measurement may be converted down to page space to record a
 * new stroke; a page coordinate must never be rewritten because the viewport
 * changed size.
 */

import {
  POINT_STRIDE,
  type Page,
  type PageGeometry,
  type ScrollDirection,
} from "../model/document";

export type { ScrollDirection };

/** Vertical gap between two stacked pages, in layout px. */
export const PAGE_GAP = 36;

/**
 * Horizontal breathing room either side of the widest page, as a fraction of
 * that page's width. The design brief asks for "generous margins either side -
 * the page is an object on a desk, not a region that fills the pane".
 */
export const PAGE_MARGIN_X_RATIO = 0.09;

/** Floor for the side margin, in layout px (tiny pages still get a gutter). */
export const PAGE_MARGIN_X = 24;

/** Space above the first page and below the last, in layout px. */
export const PAGE_MARGIN_Y = 24;

/** Where one page sits in layout space, plus its intrinsic size. */
export interface PageBox {
  /** Index into `doc.pages`. */
  index: number;
  id: string;
  /** Top-left of the page in layout space. */
  x: number;
  y: number;
  /** Intrinsic page size (page px). Layout space is 1:1 with page px. */
  width: number;
  height: number;
}

export interface DocumentLayout {
  boxes: PageBox[];
  /** Total layout-space width, including {@link PAGE_MARGIN_X} either side. */
  width: number;
  /** Total layout-space height, including {@link PAGE_MARGIN_Y} top and bottom. */
  height: number;
  direction: ScrollDirection;
  /**
   * The width the view fits to the pane: the whole column when pages run
   * down, one page and its side margins when they run across.
   */
  fitWidth: number;
}

export interface LayoutOptions {
  gap?: number;
  marginX?: number;
  marginY?: number;
  direction?: ScrollDirection;
}

/** A single page's box, used when laying out a document with no pages at all. */
function fallbackBox(geometry: PageGeometry, marginX: number, marginY: number): PageBox {
  return {
    index: 0,
    id: "",
    x: marginX,
    y: marginY,
    width: geometry.width,
    height: geometry.height,
  };
}

/**
 * Stack pages vertically, centred on the widest one — or with
 * `direction: "horizontal"`, side by side, centred on the tallest. Pure
 * function of the document: the same document lays out identically on every
 * device.
 */
export function layoutPages(pages: readonly Page[], options: LayoutOptions = {}): DocumentLayout {
  const gap = options.gap ?? PAGE_GAP;
  const marginX = options.marginX;
  const marginY = options.marginY ?? PAGE_MARGIN_Y;
  const direction = options.direction ?? "vertical";

  if (pages.length === 0) {
    const side = marginX ?? PAGE_MARGIN_X;
    const box = fallbackBox({ width: 0, height: 0 }, side, marginY);
    return {
      boxes: [],
      width: side * 2,
      height: marginY * 2 + box.height,
      direction,
      fitWidth: side * 2,
    };
  }

  let contentWidth = 0;
  for (const page of pages) contentWidth = Math.max(contentWidth, page.geometry.width);
  const side = marginX ?? Math.max(PAGE_MARGIN_X, contentWidth * PAGE_MARGIN_X_RATIO);
  if (direction === "horizontal") return layoutRow(pages, gap, side, marginY, contentWidth);

  const boxes: PageBox[] = [];
  let y = marginY;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const { width, height } = page.geometry;
    boxes.push({
      index,
      id: page.id,
      x: side + (contentWidth - width) / 2,
      y,
      width,
      height,
    });
    y += height + gap;
  }

  return {
    boxes,
    width: contentWidth + side * 2,
    height: y - gap + marginY,
    direction,
    fitWidth: contentWidth + side * 2,
  };
}

/** Pages side by side, each centred on the tallest, the same margins as a column. */
function layoutRow(
  pages: readonly Page[],
  gap: number,
  side: number,
  marginY: number,
  widest: number,
): DocumentLayout {
  let tallest = 0;
  for (const page of pages) tallest = Math.max(tallest, page.geometry.height);
  const boxes: PageBox[] = [];
  let x = side;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const { width, height } = page.geometry;
    boxes.push({ index, id: page.id, x, y: marginY + (tallest - height) / 2, width, height });
    x += width + gap;
  }
  return {
    boxes,
    width: x - gap + side,
    height: tallest + marginY * 2,
    direction: "horizontal",
    fitWidth: widest + side * 2,
  };
}

/** Scale that fits `layout.width` into `availableCssWidth`. Never below a hair above 0. */
export function fitScale(layoutWidth: number, availableCssWidth: number): number {
  if (!(layoutWidth > 0) || !(availableCssWidth > 0)) return 1;
  return availableCssWidth / layoutWidth;
}

/** The boxes whose vertical extent overlaps `[top, bottom]` in layout space. */
export function visibleBoxes(layout: DocumentLayout, top: number, bottom: number): PageBox[] {
  return layout.boxes.filter((b) => b.y + b.height >= top && b.y <= bottom);
}

/** The box containing the layout-space point, or `null` (gap / margin / miss). */
export function boxAtPoint(layout: DocumentLayout, x: number, y: number): PageBox | null {
  for (const b of layout.boxes) {
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return b;
  }
  return null;
}

/** Layout-space point -> page-local point, for the given page. */
export function toPageSpace(box: PageBox, x: number, y: number): { x: number; y: number } {
  return { x: x - box.x, y: y - box.y };
}

/** Page-local point -> layout-space point. */
export function toLayoutSpace(box: PageBox, x: number, y: number): { x: number; y: number } {
  return { x: x + box.x, y: y + box.y };
}

/**
 * How far ink strays past the edge of a `width x height` page, in page px:
 * 0 when every point of the flat `[x, y, p, …]` list lies on the page. Ink
 * out there is kept but never drawn — every paint clips to the sheet.
 * Non-finite coordinates are skipped, and a ragged tail is ignored.
 */
export function inkBeyondPage(pts: readonly number[], width: number, height: number): number {
  let beyond = 0;
  const usable = pts.length - (pts.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const x = pts[i];
    const y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    beyond = Math.max(beyond, -x, x - width, -y, y - height);
  }
  return beyond;
}

/**
 * Which page the reader is "on", for the "3 of 18" indicator: the page covering
 * the most of the visible band, biased to the first page when nothing overlaps
 * (scrolled into a gap above page one).
 */
export function currentPageIndex(layout: DocumentLayout, top: number, bottom: number): number {
  if (layout.boxes.length === 0) return 0;
  let best = 0;
  // -Infinity, not -1: past the last page every cover is negative, and a -1
  // seed meant nothing ever beat it, so the indicator snapped back to "1 of n"
  // on overscroll. The first-page bias above page one is preserved because
  // ties keep the earliest box.
  let bestCover = -Infinity;
  for (const b of layout.boxes) {
    const cover = Math.min(bottom, b.y + b.height) - Math.max(top, b.y);
    if (cover > bestCover) {
      bestCover = cover;
      best = b.index;
    }
  }
  return best;
}

/**
 * The page a row of pages is showing: the one covering most of the visible
 * horizontal band `[left, right]` (layout px). Ties keep the earliest page.
 */
export function currentPageIndexInRow(layout: DocumentLayout, left: number, right: number): number {
  if (layout.boxes.length === 0) return 0;
  let best = 0;
  let bestCover = -Infinity;
  for (const b of layout.boxes) {
    const cover = Math.min(right, b.x + b.width) - Math.max(left, b.x);
    if (cover > bestCover) {
      bestCover = cover;
      best = b.index;
    }
  }
  return best;
}

/**
 * The scroll x (screen px, as the scroller counts it) that centres page
 * `index` in a pane `paneWidth` wide, at `scale` screen px per layout px.
 * May be negative: the first page centred sits right of the content's left
 * edge, which is what {@link rowScrollInsets} makes room for.
 */
export function rowScrollXForPage(
  layout: DocumentLayout,
  index: number,
  scale: number,
  paneWidth: number,
): number {
  const box = layout.boxes[Math.max(0, Math.min(layout.boxes.length - 1, index))];
  if (!box) return 0;
  return (box.x + box.width / 2) * scale - paneWidth / 2;
}

/**
 * Extra scroll room before the first page and after the last, screen px, so
 * that either can sit centred in the pane (as GoodNotes shows every page of a
 * horizontal notebook). Zero once a page is wider than the pane.
 */
export function rowScrollInsets(
  layout: DocumentLayout,
  scale: number,
  paneWidth: number,
): { lead: number; trail: number } {
  const n = layout.boxes.length;
  if (n === 0) return { lead: 0, trail: 0 };
  const first = rowScrollXForPage(layout, 0, scale, paneWidth);
  const last = rowScrollXForPage(layout, n - 1, scale, paneWidth);
  const maxX = layout.width * scale - paneWidth;
  return { lead: Math.max(0, -first), trail: Math.max(0, last - maxX) };
}

/**
 * The gap between pages in a row (layout px) that gives every page a slot as
 * wide as the pane at `floorScale` (screen px per layout px at the zoom
 * floor): with any page centred, its neighbours sit just off screen, so only
 * the page being read shows until a swipe slides the next one in — as
 * GoodNotes shows a horizontal notebook (Joost, 2026-09-22). Never less than
 * {@link PAGE_GAP}. Derived from the pane, like every scale: nothing here is
 * stored, so a pane of another width lays the same pages out afresh.
 */
export function rowSlotGap(pages: readonly Page[], paneWidth: number, floorScale: number): number {
  if (pages.length === 0 || !(paneWidth > 0) || !(floorScale > 0)) return PAGE_GAP;
  let narrowest = Infinity;
  for (const page of pages) narrowest = Math.min(narrowest, page.geometry.width);
  // A neighbour's near edge is `width / 2 + gap` from the centred page's
  // centre; it must be past the pane's edge, `paneWidth / 2` screen px away,
  // with a margin so not even its shadow shows. The narrowest page needs most.
  const needed = paneWidth / (2 * floorScale) - narrowest / 2 + PAGE_GAP;
  return Math.max(PAGE_GAP, Math.ceil(needed));
}

/**
 * Up to this multiple of the zoom floor, a swipe across a row of pages turns
 * the page; zoomed in further, a swipe moves around the page being read and
 * never onto its neighbour. A little above the floor, so a pinch that lands a
 * hair past it does not lose page turning.
 */
export const ROW_PAGING_ZOOM = 1.1;

/** Whether a row of pages turns pages at `zoom`, given the zoom floor. */
export function rowTurnsPages(zoom: number, floor: number): boolean {
  return zoom <= floor * ROW_PAGING_ZOOM;
}

/** Screen px of desk a zoomed-in page can be pulled past its edge by, before it bounces. */
export const ROW_PAGE_EDGE_PX = 24;

/**
 * The scroll x range (screen px) that keeps a zoomed-in row on page `index`:
 * its left edge can come to the pane's left, its right edge to the pane's
 * right, each with {@link ROW_PAGE_EDGE_PX} of desk, and no further. A page
 * narrower than the pane stays centred.
 */
export function rowPageScrollRange(
  layout: DocumentLayout,
  index: number,
  scale: number,
  paneWidth: number,
): { min: number; max: number } {
  const box = layout.boxes[Math.max(0, Math.min(layout.boxes.length - 1, index))];
  if (!box) return { min: 0, max: 0 };
  const min = box.x * scale - ROW_PAGE_EDGE_PX;
  const max = (box.x + box.width) * scale - paneWidth + ROW_PAGE_EDGE_PX;
  if (max < min) {
    const centred = rowScrollXForPage(layout, index, scale, paneWidth);
    return { min: centred, max: centred };
  }
  return { min, max };
}

/** A release faster than this (px/ms) turns the page even if it moved less than half. */
export const PAGE_FLICK_SPEED = 0.3;

/**
 * Where a horizontal swipe settles: the page whose centred position is
 * nearest the release position, or — for a flick — the next page in the
 * direction of travel. Never more than one page from `fromIndex` (the page
 * the swipe started on), as paging on iOS works. `velocity` is the
 * scroller's, px/ms: positive means the content moves left, towards later
 * pages.
 */
export function pageSnapIndex(
  layout: DocumentLayout,
  position: number,
  velocity: number,
  fromIndex: number,
  scale: number,
  paneWidth: number,
): number {
  const n = layout.boxes.length;
  if (n === 0) return 0;
  const from = Math.max(0, Math.min(n - 1, fromIndex));
  let target = from;
  if (Math.abs(velocity) >= PAGE_FLICK_SPEED) {
    target = from + (velocity > 0 ? 1 : -1);
  } else {
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(rowScrollXForPage(layout, i, scale, paneWidth) - position);
      if (d < bestDist) {
        bestDist = d;
        target = i;
      }
    }
  }
  const oneAway = Math.max(from - 1, Math.min(from + 1, target));
  return Math.max(0, Math.min(n - 1, oneAway));
}

/** How far past the last page (screen px) a pull must stretch to add a page. */
export const PULL_ADD_PAGE_PX = 110;

/**
 * Progress of "pull past the end to add a page", 0..1, from how far the
 * content is stretched past its end (screen px; positive past the end).
 * 1 means letting go adds the page.
 */
export function pullAddProgress(overscroll: number, threshold = PULL_ADD_PAGE_PX): number {
  if (!(overscroll > 0) || !(threshold > 0)) return 0;
  return Math.min(1, overscroll / threshold);
}

/** Layout-space y that puts page `index`'s top edge at the top of the viewport. */
export function scrollTopForPage(layout: DocumentLayout, index: number): number {
  const box = layout.boxes[Math.max(0, Math.min(layout.boxes.length - 1, index))];
  if (!box) return 0;
  return Math.max(0, box.y - PAGE_MARGIN_Y);
}
