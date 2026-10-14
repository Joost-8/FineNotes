/**
 * The geometry of dragging a page thumbnail to a new place: which gap
 * between thumbnails the pointer is over, where the drop bar is drawn, and
 * how fast the panel scrolls when the pointer nears its top or bottom edge.
 * The same rules serve the sidebar's two columns and the overview's grid.
 *
 * A **gap** is a place between thumbnails: gap `g` lies just before the
 * `g`th thumbnail shown, gap `n` after the last (page-order.ts).
 *
 * PURE: no DOM, no Obsidian. Lengths are CSS px on screen.
 */

/** A thumbnail's box on screen. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a drop would land, and the bar that shows it: a line from (x1, y1) to (x2, y2). */
export interface DropSlot {
  gap: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** How long a finger rests on a thumbnail before it lifts, ms. Under WebKit's own long press. */
export const HOLD_MS = 300;
/** How far a finger may drift during that hold before it counts as a scroll, CSS px. */
export const TOUCH_SLOP_PX = 10;
/** How far a mouse or the Pencil moves before a press becomes a drag, CSS px. */
export const POINTER_SLOP_PX = 5;
/** Height of the band at the panel's top and bottom that scrolls it during a drag, CSS px. */
export const EDGE_PX = 56;
/** Fastest edge scroll, CSS px per frame (at 60 Hz). */
export const EDGE_MAX_SPEED = 18;

/** Thumbnails grouped into the rows they are laid out in, as indexes into `boxes`. */
function rowsOf(boxes: readonly Box[]): number[][] {
  const rows: number[][] = [];
  let rowTop = -Infinity;
  boxes.forEach((box, i) => {
    // A grid aligns its rows at the top; a little slack for sub-pixel layout.
    if (rows.length === 0 || box.top > rowTop + 2) {
      rows.push([i]);
      rowTop = box.top;
    } else {
      rows[rows.length - 1].push(i);
    }
  });
  return rows;
}

/**
 * The gap the point (`x`, `y`) is over, among thumbnails laid out row by row
 * in `boxes` (reading order), and the drop bar for it: between two pages of
 * a row (or at a row's end) when the layout has columns, between two pages
 * when it is a single column. `null` when there is nothing to drop among.
 */
export function dropSlotAt(boxes: readonly Box[], x: number, y: number): DropSlot | null {
  if (boxes.length === 0) return null;
  const rows = rowsOf(boxes);
  const bottomOf = (row: number[]) => Math.max(...row.map((i) => boxes[i].bottom));
  const topOf = (row: number[]) => boxes[row[0]].top;
  // The row whose band holds y: each band runs to halfway to the next row.
  let r = rows.length - 1;
  for (let k = 0; k < rows.length - 1; k++) {
    if (y < (bottomOf(rows[k]) + topOf(rows[k + 1])) / 2) {
      r = k;
      break;
    }
  }
  const row = rows[r];
  if (rows.every((each) => each.length === 1)) {
    // One column: before the page whose upper half holds y.
    const i = row[0];
    const box = boxes[i];
    const gap = y < (box.top + box.bottom) / 2 ? i : i + 1;
    const space = rows.length > 1 ? (topOf(rows[1]) - bottomOf(rows[0])) / 2 : 8;
    const at =
      gap === 0
        ? boxes[0].top - space
        : gap === boxes.length
          ? boxes[gap - 1].bottom + space
          : (boxes[gap - 1].bottom + boxes[gap].top) / 2;
    return { gap, x1: box.left, y1: at, x2: box.right, y2: at };
  }
  const k = row.findIndex((i) => x < (boxes[i].left + boxes[i].right) / 2);
  const widest = rows.find((each) => each.length > 1) ?? row;
  const half = widest.length > 1 ? (boxes[widest[1]].left - boxes[widest[0]].right) / 2 : 8;
  let gap: number;
  let at: number;
  if (k < 0) {
    const last = row[row.length - 1];
    gap = last + 1;
    at = boxes[last].right + half;
  } else {
    gap = row[k];
    at = k > 0 ? (boxes[row[k - 1]].right + boxes[row[k]].left) / 2 : boxes[row[k]].left - half;
  }
  return { gap, x1: at, y1: topOf(row), x2: at, y2: bottomOf(row) };
}

/**
 * A gap among the thumbnails shown, as a gap in the whole page list, when
 * only some pages are shown (the Bookmarks filter): `shown` holds the real
 * index of each thumbnail shown, in order. Before a shown page is straight
 * before it; after the last shown page is straight after it.
 */
export function realGap(shown: readonly number[], gap: number): number {
  if (shown.length === 0) return 0;
  if (gap <= 0) return shown[0];
  if (gap >= shown.length) return shown[shown.length - 1] + 1;
  return shown[gap];
}

/**
 * How far to scroll the panel this frame for a pointer at `y`, with the
 * panel's visible part running from `top` to `bottom`: nothing outside the
 * edge bands, faster the deeper into one (and past it), up for the top.
 */
export function edgeScrollSpeed(y: number, top: number, bottom: number): number {
  const band = Math.min(EDGE_PX, Math.max(0, (bottom - top) / 3));
  if (band <= 0) return 0;
  const depth =
    y < top + band
      ? -(top + band - y) / band
      : y > bottom - band
        ? (y - (bottom - band)) / band
        : 0;
  const clamped = Math.max(-1, Math.min(1, depth));
  return Math.sign(clamped) * clamped * clamped * EDGE_MAX_SPEED;
}

/**
 * The pages a Shift-click selects: every page from the anchor to the one
 * clicked, both included, in page order.
 */
export function rangeOf(anchor: number, index: number): number[] {
  const from = Math.min(anchor, index);
  const to = Math.max(anchor, index);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
