/**
 * Ink over the join of joined pages (discussion #51, `model/joined-pages.ts`).
 *
 * A gesture belongs to the page it starts on, and a stroke is stored in that
 * page's space. With the pages joined, the pen may run on over the join, and
 * the ink must show on the next page too. It is stored there as a copy: the
 * same points moved into that page's space, clipped to that page as every
 * stroke is. Each page shows exactly its own part, and the two parts are one
 * line, since both are traced from the same points at the same width; a
 * shape's fill, dashes and arrowheads continue in the same way. Nothing on a
 * page depends on the page beside it: set apart, moved or exported, each page
 * shows its own part.
 *
 * Pure: no DOM, no Obsidian.
 */

import { POINT_STRIDE } from "../model/document";
import type { DocumentLayout, PageBox } from "./page-layout";

/**
 * How far a stroke's ink may reach past its points, page px: half the
 * widest line a pen with pressure draws (1.6 of the nib), with room for
 * anti-aliasing; an arrowhead's sides reach `heads` further.
 */
export function inkReach(size: number, heads = 0): number {
  const nib = Number.isFinite(size) && size > 0 ? size : 1;
  return nib + 2 + (Number.isFinite(heads) && heads > 0 ? heads : 0);
}

/**
 * Whether ink along `pts` (flat `[x, y, p, …]` in page `from`'s space),
 * reaching `reach` past its points, touches page `to`'s sheet.
 */
export function inkReachesPage(
  pts: readonly number[],
  from: PageBox,
  to: PageBox,
  reach: number,
): boolean {
  // The sheet, grown by the reach, in `from`'s page space.
  const minX = to.x - from.x - reach;
  const minY = to.y - from.y - reach;
  const maxX = to.x - from.x + to.width + reach;
  const maxY = to.y - from.y + to.height + reach;
  const usable = pts.length - (pts.length % POINT_STRIDE);
  let px = Number.NaN;
  let py = Number.NaN;
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const x = pts[i];
    const y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
    if (Number.isFinite(px) && segmentCrossesBox(px, py, x, y, minX, minY, maxX, maxY)) return true;
    px = x;
    py = y;
  }
  return false;
}

/** Whether the segment from (x0, y0) to (x1, y1) passes through the box (Liang–Barsky). */
function segmentCrossesBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, x0 - minX],
    [dx, maxX - x0],
    [-dy, y0 - minY],
    [dy, maxY - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * The other pages a stroke drawn on page `from` reaches, in page order:
 * where it must also be stored for its ink to show there. A page the ink
 * only comes within `reach` of counts, so a line ending on the join leaves
 * no edge of its cap behind.
 */
export function pagesReached(
  layout: DocumentLayout,
  from: number,
  pts: readonly number[],
  reach: number,
): number[] {
  const origin = layout.boxes[from];
  if (!origin) return [];
  const reached: number[] = [];
  for (const box of layout.boxes) {
    if (box.index === from) continue;
    if (inkReachesPage(pts, origin, box, reach)) reached.push(box.index);
  }
  return reached;
}

/**
 * `pts` moved from page `from`'s space into page `to`'s: the same spot in
 * the layout. Pressure, and anything else after x and y, stays.
 */
export function movePagePts(pts: readonly number[], from: PageBox, to: PageBox): number[] {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const out = pts.slice();
  const usable = out.length - (out.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    out[i] += dx;
    out[i + 1] += dy;
  }
  return out;
}
