/**
 * The highlighter's straight runs, after GoodNotes: a highlight follows the
 * pen as straight lines that only bend where the pen really turned, so the
 * hand's wobble never shows in the band. Ramer-Douglas-Peucker over the
 * stroke's samples: a sample is kept only where the path strays more than
 * `tolerance` from the straight line between the kept ones around it. Its
 * own pressure goes with each kept sample.
 *
 * PURE: flat `[x, y, pressure, …]` in, the same out.
 */

/** Samples are `[x, y, pressure]` triples. */
const STRIDE = 3;

/**
 * The samples of `pts` a straight-run highlight keeps: always the first and
 * the last, and between them only the corners further than `tolerance`
 * (page px) from the straight line through their neighbours. A ragged tail
 * (not a whole sample) is dropped; a tolerance that is not a positive number
 * keeps every sample.
 */
export function straightenRuns(pts: readonly number[], tolerance: number): number[] {
  const count = Math.floor(pts.length / STRIDE);
  if (count <= 2 || !(tolerance > 0)) return pts.slice(0, count * STRIDE);
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  // Iterative, so a long stroke cannot run out of stack.
  const spans: Array<[number, number]> = [[0, count - 1]];
  while (spans.length > 0) {
    const [first, last] = spans.pop()!;
    if (last - first < 2) continue;
    const ax = pts[first * STRIDE];
    const ay = pts[first * STRIDE + 1];
    const dx = pts[last * STRIDE] - ax;
    const dy = pts[last * STRIDE + 1] - ay;
    const length = Math.hypot(dx, dy);
    let farthest = -1;
    let worst = tolerance;
    for (let i = first + 1; i < last; i++) {
      const px = pts[i * STRIDE] - ax;
      const py = pts[i * STRIDE + 1] - ay;
      // Distance to the chord, or to its start where the chord has no length.
      const distance = length > 0 ? Math.abs(px * dy - py * dx) / length : Math.hypot(px, py);
      if (distance > worst) {
        worst = distance;
        farthest = i;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    spans.push([first, farthest], [farthest, last]);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (keep[i]) out.push(pts[i * STRIDE], pts[i * STRIDE + 1], pts[i * STRIDE + 2]);
  }
  return out;
}
