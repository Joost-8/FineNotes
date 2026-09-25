/**
 * Does a point touch a stroke? The exact test behind the eraser, tap to
 * select and the circle lasso's hold; `spatial-index.ts` narrows the
 * candidates first. Pure: no DOM.
 */

import { type Stroke, POINT_STRIDE, strokeBounds } from "../model/document";

/**
 * The squared distance from (x, y) to the segment from (x0, y0) to
 * (x1, y1). Squared because every caller compares it with a squared
 * radius, and a square root per segment adds up along a long stroke.
 */
export function distToSegmentSq(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const length2 = vx * vx + vy * vy;
  // Where the nearest point lies along the segment, from 0 at its start to
  // 1 at its end; a segment of no length is just its point. NaN stays NaN,
  // so a point that is not a number is never near anything.
  const along =
    length2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - x0) * vx + (y - y0) * vy) / length2));
  const dx = x - (x0 + along * vx);
  const dy = y - (y0 + along * vy);
  return dx * dx + dy * dy;
}

/**
 * Whether (x, y) lies within `reach` of the stroke's line: the polyline
 * through its whole points, boundary included, or the point itself for a
 * stroke of exactly one point. A partial point left at the end of a ragged
 * array adds nothing.
 */
export function strokeHitByPoint(stroke: Stroke, x: number, y: number, reach: number): boolean {
  const box = strokeBounds(stroke);
  if (!box) return false;
  // Farther than `reach` from the box is farther than that from the ink.
  const outside =
    x < box.minX - reach || x > box.maxX + reach || y < box.minY - reach || y > box.maxY + reach;
  if (outside) return false;

  const pts = stroke.pts;
  const reach2 = reach * reach;
  const near = (a: number, b: number): boolean =>
    distToSegmentSq(x, y, pts[a], pts[a + 1], pts[b], pts[b + 1]) <= reach2;
  // One point is a segment of no length.
  if (pts.length === POINT_STRIDE) return near(0, 0);
  // Otherwise each segment runs from one whole point to the next one.
  let hit = false;
  for (let a = 0; !hit && a + 2 * POINT_STRIDE <= pts.length; a += POINT_STRIDE) {
    hit = near(a, a + POINT_STRIDE);
  }
  return hit;
}
