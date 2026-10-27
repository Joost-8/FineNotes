/**
 * The highlighter's line snap, after GoodNotes: while the pen is down a
 * highlight follows the hand like any ink; when it lifts, a stroke drawn
 * along a line ({@link lineOfHighlight}) becomes that line, its two ends on
 * the best-fit line. Anything else stays as drawn.
 *
 * PURE: flat `[x, y, pressure, …]` in, the same out.
 */

import { levelLine } from "./level-line";

/** Samples are `[x, y, pressure]` triples. */
const STRIDE = 3;

/**
 * How far a highlight may stray from its best-fit line, as a fraction of its
 * length, and still be taken for a line. Measured on Joost's iPad recording
 * (2026-10-15): five highlights drawn as lines strayed 0.3–4.6 %.
 */
export const LINE_MAX_DEVIATION = 0.08;

/** The most a line's path may exceed its length: 1.25 allows the hand's wave, not a zigzag. */
export const LINE_MAX_DETOUR = 1.25;

/** The most a line may run backwards along itself, as a fraction of its length. */
const LINE_MAX_BACKTRACK = 0.1;

/**
 * A highlight drawn as a line, made one: when the samples of `pts` lie
 * along one straight line (within {@link LINE_MAX_DEVIATION} of its length,
 * a path no longer than {@link LINE_MAX_DETOUR} times it, never doubling
 * back) and it is at least `minLength` page px long, the two ends of that
 * line — where the first and last samples fall on the best-fit line, each
 * with its own pressure, levelled when it runs within a few degrees of level
 * or upright (`level-line.ts`). Otherwise `null`: a curve, a corner, a zigzag over
 * several lines of text, or a dab is kept as drawn.
 *
 * The best-fit line is the total least-squares one (the principal axis of
 * the samples), so a steep line fits as well as a level one.
 */
export function lineOfHighlight(pts: readonly number[], minLength: number): number[] | null {
  const count = Math.floor(pts.length / STRIDE);
  if (count < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < count; i++) {
    mx += pts[i * STRIDE];
    my += pts[i * STRIDE + 1];
  }
  mx /= count;
  my /= count;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < count; i++) {
    const x = pts[i * STRIDE] - mx;
    const y = pts[i * STRIDE + 1] - my;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  if (!Number.isFinite(sxx + sxy + syy)) return null;
  // The principal axis of the samples' spread.
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  // Point the axis from the first sample towards the last.
  const run =
    (pts[(count - 1) * STRIDE] - pts[0]) * dx + (pts[(count - 1) * STRIDE + 1] - pts[1]) * dy;
  if (run < 0) {
    dx = -dx;
    dy = -dy;
  }
  let lo = Infinity;
  let hi = -Infinity;
  let worst = 0;
  let path = 0;
  let back = 0;
  let previous = 0;
  for (let i = 0; i < count; i++) {
    const x = pts[i * STRIDE] - mx;
    const y = pts[i * STRIDE + 1] - my;
    const along = x * dx + y * dy;
    lo = Math.min(lo, along);
    hi = Math.max(hi, along);
    worst = Math.max(worst, Math.abs(-x * dy + y * dx));
    if (i > 0) {
      path += Math.hypot(
        pts[i * STRIDE] - pts[(i - 1) * STRIDE],
        pts[i * STRIDE + 1] - pts[(i - 1) * STRIDE + 1],
      );
      if (along < previous) back += previous - along;
    }
    previous = along;
  }
  const length = hi - lo;
  if (!(length >= Math.max(minLength, 1e-6))) return null;
  if (worst > LINE_MAX_DEVIATION * length) return null;
  if (path > LINE_MAX_DETOUR * length) return null;
  if (back > LINE_MAX_BACKTRACK * length) return null;
  const end = (i: number): number[] => {
    const along = (pts[i * STRIDE] - mx) * dx + (pts[i * STRIDE + 1] - my) * dy;
    return [mx + along * dx, my + along * dy, pts[i * STRIDE + 2]];
  };
  // Within a few degrees of level (a line of text) or upright, exactly so.
  return levelLine([...end(0), ...end(count - 1)], "middle");
}
