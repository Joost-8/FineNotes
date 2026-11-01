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
  type Bounds,
  POINT_STRIDE,
  type Page,
  type PageGeometry,
  type ScrollDirection,
} from "../model/document";

export type { ScrollDirection };

/** Vertical gap between two stacked pages, in layout px. */
export const PAGE_GAP = 36;

/**
 * The gap between pages with "Join pages" on (discussion #51): none, so
 * the pages run on as one sheet, down or across. Only the layout changes:
 * every page keeps its own box and its own page space.
 */
export const JOINED_PAGE_GAP = 0;

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
  /** Laid out joined ({@link LayoutOptions.joined}): ink may run on over a join. */
  joined?: boolean;
}

export interface LayoutOptions {
  gap?: number;
  /** "Join pages": {@link JOINED_PAGE_GAP} between pages, whatever `gap` says. */
  joined?: boolean;
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
  const gap = options.joined ? JOINED_PAGE_GAP : (options.gap ?? PAGE_GAP);
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
  if (direction === "horizontal") {
    const row = layoutRow(pages, gap, side, marginY, contentWidth);
    return options.joined ? { ...row, joined: true } : row;
  }

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
    ...(options.joined ? { joined: true } : {}),
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

/** Screen px between neighbouring pages of a row zoomed well in, as Goodnotes' thin strip. */
export const ROW_ZOOMED_GAP_PX = 20;

/**
 * The multiple of the zoom floor below which a row keeps its slot gap, so
 * no neighbouring page shows. Measured from Goodnotes (Joost's recording,
 * 2026-10-21): only empty desk beside the page up to about 1.7x the fit.
 */
export const ROW_GAP_OPEN_ZOOM = 1.7;

/**
 * The multiple of the zoom floor at which a row's gap has closed to
 * {@link ROW_ZOOMED_GAP_PX}. From {@link ROW_GAP_OPEN_ZOOM} to here the
 * neighbour slides in, and on zooming out it is gone as quickly: Goodnotes
 * does both within about 0.3x of zoom.
 */
export const ROW_GAP_CLOSED_ZOOM = 2;

/**
 * The gap (layout px) between a row's pages at `zoom`. From the floor up to
 * {@link ROW_GAP_OPEN_ZOOM} it is the slot gap that keeps the neighbours
 * just off screen (`rowSlotGap`). Zoomed further in, a slot gap
 * would grow with the zoom and push the next page a screen or more away;
 * instead the gap closes to a constant {@link ROW_ZOOMED_GAP_PX} on screen,
 * so the neighbouring page shows beside the one being read (FineNotes#34).
 * `scale` is screen px per layout px at `zoom`.
 */
export function rowGapAtZoom(slotGap: number, zoom: number, floor: number, scale: number): number {
  if (!(floor > 0) || !(scale > 0) || !Number.isFinite(zoom)) return slotGap;
  const closed = ROW_ZOOMED_GAP_PX / scale;
  // A slot narrower than the closed gap (a pane no wider than its page) has nothing to close.
  if (closed >= slotGap) return slotGap;
  const ratio = zoom / floor;
  if (ratio <= ROW_GAP_OPEN_ZOOM) return slotGap;
  if (ratio >= ROW_GAP_CLOSED_ZOOM) return closed;
  const t = (ratio - ROW_GAP_OPEN_ZOOM) / (ROW_GAP_CLOSED_ZOOM - ROW_GAP_OPEN_ZOOM);
  const eased = t * t * (3 - 2 * t);
  return slotGap + (closed - slotGap) * eased;
}

/**
 * Up to this multiple of the zoom floor, a swipe across a row of pages turns
 * the page; zoomed in further, a swipe moves around the page being read and
 * never onto its neighbour. A little above the floor, so a pinch that lands a
 * hair past it does not lose page turning.
 */
export const ROW_PAGING_ZOOM = 1.1;

/**
 * Screen px a zoomed-in page must be pulled past its edge (the
 * rubber-banded stretch: about 230 px of finger on an iPad) for letting go
 * to turn to the page beside it, as Goodnotes does (Joost's recording,
 * 2026-10-21). Less, and it springs back.
 */
export const ROW_EDGE_TURN_PX = 110;

/**
 * On letting go of a zoomed-in row held to its page: -1 to turn back, 1 to
 * turn on, 0 to spring back. `x` is the scroll position, stretched past the
 * page's range `minX`..`maxX` by the finger.
 */
export function rowEdgeTurn(x: number, minX: number, maxX: number): -1 | 0 | 1 {
  if (x - maxX >= ROW_EDGE_TURN_PX) return 1;
  if (minX - x >= ROW_EDGE_TURN_PX) return -1;
  return 0;
}

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
 * The same with pages running across: a longer, deliberate pull (about
 * 340 px of finger on an iPad), so a pan or a pinch near the last page's
 * edge never adds one (Joost, 2026-10-21: "do not make it that sensitive").
 */
export const ROW_PULL_ADD_PX = 150;

/** A pull must run along the pages at least this many times as far as across them. */
export const PULL_ADD_STRAIGHTNESS = 2;

/** What a finger gesture has done, for {@link pullAddAllowed}. */
export interface PullGesture {
  /** A second finger came down at some point: a pinch, never a pull. */
  pinched: boolean;
  /** Screen px the gesture has moved, along the pages and across them. */
  along: number;
  across: number;
}

/**
 * Whether a finger gesture may pull a new page in at all (show the ring,
 * add a page on release), as Goodnotes allows it, at any zoom: one finger
 * dragged deliberately along the pages, never a pinch (a pinch on the last
 * page stretches it too, and read as a pull).
 */
export function pullAddAllowed(g: PullGesture): boolean {
  if (g.pinched) return false;
  return Math.abs(g.along) >= PULL_ADD_STRAIGHTNESS * Math.abs(g.across);
}

/**
 * Progress of "pull past the end to add a page", 0..1, from how far the
 * content is stretched past its end (screen px; positive past the end).
 * 1 means letting go adds the page.
 */
export function pullAddProgress(overscroll: number, threshold = PULL_ADD_PAGE_PX): number {
  if (!(overscroll > 0) || !(threshold > 0)) return 0;
  return Math.min(1, overscroll / threshold);
}

/**
 * Wheel px (a mouse notch is about 100) a wheel or touchpad must keep
 * scrolling past the last page to add one: three notches, so a scroll that
 * merely reaches the end never does (FineNotes#111).
 */
export const WHEEL_PULL_ADD_PX = 300;

/** A wheel quiet this long has let go: a full pull adds its page, any pull starts over. */
export const WHEEL_PULL_PAUSE_MS = 250;

/** One wheel event counts at most this far, so a single big jump is never a pull. */
export const WHEEL_PULL_STEP_MAX_PX = 100;

/**
 * A wheel or touchpad pull past the last page (`wheelPullStep`): how far it
 * has pulled, when its last event came, and whether this burst of events may
 * pull at all.
 */
export interface WheelPull {
  total: number;
  lastT: number;
  armed: boolean;
}

export const WHEEL_PULL_REST: WheelPull = { total: 0, lastT: -Infinity, armed: false };

/** One wheel event, for {@link wheelPullStep}. */
export interface WheelPullEvent {
  t: number;
  /** Wheel px along the pages (positive towards the end) and across them. */
  along: number;
  across: number;
  /** The view already sat at the last page's end before this event. */
  atEnd: boolean;
}

/**
 * Fold one wheel event into a pull past the last page, the wheel's version
 * of the finger's pull (`pullAddAllowed`). Only a burst of events that began
 * at the end counts: a flick or a touchpad's momentum that runs into the end
 * started away from it, so it adds nothing however long it coasts on. Any
 * event that scrolls back, leaves the end, or runs across the pages ends the
 * pull for the rest of its burst; a pause starts a new burst.
 */
export function wheelPullStep(pull: WheelPull, e: WheelPullEvent): WheelPull {
  const fresh = e.t - pull.lastT >= WHEEL_PULL_PAUSE_MS;
  const armed = fresh ? e.atEnd : pull.armed;
  if (e.along === 0 && e.across === 0) return { ...pull, armed, lastT: e.t };
  const straight = Math.abs(e.along) >= PULL_ADD_STRAIGHTNESS * Math.abs(e.across);
  if (!armed || !e.atEnd || e.along < 0 || !straight) {
    return { total: 0, lastT: e.t, armed: false };
  }
  return {
    total: pull.total + Math.min(e.along, WHEEL_PULL_STEP_MAX_PX),
    lastT: e.t,
    armed: true,
  };
}

/** How far a wheel pull is to adding a page, 0..1; 1 means the pause adds it. */
export function wheelPullProgress(pull: WheelPull): number {
  return pull.armed ? pullAddProgress(pull.total, WHEEL_PULL_ADD_PX) : 0;
}

/** Layout-space y that puts page `index`'s top edge at the top of the viewport. */
export function scrollTopForPage(layout: DocumentLayout, index: number): number {
  const box = layout.boxes[Math.max(0, Math.min(layout.boxes.length - 1, index))];
  if (!box) return 0;
  return Math.max(0, box.y - PAGE_MARGIN_Y);
}

// --- Endless boards (FineNotes#46) ----------------------------------------------

/**
 * An endless board's layout: its one page at the origin, layout px equal to
 * page px, with no desk around it. A board has no width to fit; the view's
 * scale comes from the writing size (`WRITING_SCALE`) and the zoom.
 */
export function layoutBoard(page: Page): DocumentLayout {
  const { width, height } = page.geometry;
  return {
    boxes: [{ index: 0, id: page.id, x: 0, y: 0, width, height }],
    width,
    height,
    direction: "vertical",
    fitWidth: width,
  };
}

/** The middle of what is drawn on a board, or of the page when nothing is, page px. */
export function boardCentre(
  geometry: PageGeometry,
  drawn: Bounds | null,
): { x: number; y: number } {
  if (!drawn) return { x: geometry.width / 2, y: geometry.height / 2 };
  return { x: (drawn.minX + drawn.maxX) / 2, y: (drawn.minY + drawn.maxY) / 2 };
}

/**
 * The scroll range of a board, screen px as the scroller counts them (`x`
 * and `y` are the view's top-left corner times `scale`): free in both
 * directions until a screen of empty paper lies past the drawing, where the
 * rubber band starts — and never off the paper, which grows ahead of the
 * drawing (`model/board.ts`). With nothing drawn, a screen around the
 * page's middle. A page smaller than the pane sits centred in it.
 */
export function boardScrollRange(
  geometry: PageGeometry,
  drawn: Bounds | null,
  scale: number,
  paneWidth: number,
  paneHeight: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  const centre = boardCentre(geometry, drawn);
  const axis = (lo: number, hi: number, length: number, pane: number): [number, number] => {
    const screen = pane / s;
    if (length <= screen) {
      const centred = ((length - screen) / 2) * s;
      return [centred, centred];
    }
    const min = Math.max(0, lo - screen);
    const max = Math.min(length - screen, hi);
    // Ink off the paper on both sides of the view (it never is once the
    // board has grown): anywhere on the paper.
    return max < min ? [0, (length - screen) * s] : [min * s, max * s];
  };
  const [minX, maxX] = axis(
    drawn?.minX ?? centre.x,
    drawn?.maxX ?? centre.x,
    geometry.width,
    paneWidth,
  );
  const [minY, maxY] = axis(
    drawn?.minY ?? centre.y,
    drawn?.maxY ?? centre.y,
    geometry.height,
    paneHeight,
  );
  return { minX, maxX, minY, maxY };
}

/**
 * The scroll position (screen px) that puts the page point `at` in the
 * middle of the pane: where a board opens (the middle of its drawing) and
 * where a fit of the whole drawing lands.
 */
export function boardScrollToCentre(
  at: { x: number; y: number },
  scale: number,
  paneWidth: number,
  paneHeight: number,
): { x: number; y: number } {
  return { x: at.x * scale - paneWidth / 2, y: at.y * scale - paneHeight / 2 };
}
