/**
 * Lines that snap level or upright (FineNotes discussion #51): a line drawn
 * nearly horizontal or vertical is meant to be horizontal or vertical, so it
 * is made exactly so. Used wherever a line is made — a
 * hold-to-snap line or arrow (and while the pen still holds it), the Shape
 * tool's line and arrow, and the highlighter's straightened line.
 *
 * Only ever applied to emitted geometry: the recogniser scores the ink it
 * was given, never the levelled line (ledger "Never score confidence against
 * beautified output").
 *
 * PURE: flat `[x, y, pressure, …]` in, the same out.
 */

/** Samples are `[x, y, pressure]` triples. */
const STRIDE = 3;

/**
 * How far a line's two ends may be off level (or off upright) and still be
 * levelled, px at fit-to-width zoom, where a page px is about a screen px:
 * callers pass `atFitZoom(LINE_LEVEL_RISE)`, and the recogniser works at
 * that size already (`recognizeAtZoom`). A first cut levelled anything
 * within 5°, which moved the end of a long line by 20 px or more and
 * ignored the zoom; Joost found it too eager (2026-10-28). A rise is what
 * the eye sees: 8 px is 1.5° over 300 px, 4.6° over 100 px.
 */
export const LINE_LEVEL_RISE = 8;

/** And never further off than this many degrees, however short the line. */
export const LINE_LEVEL_DEG = 4;

/** Where a levelled line turns about: its first point, or its middle. */
export type LevelPivot = "start" | "middle";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The turn, in radians, that brings the segment (`dx`, `dy`) onto the
 * nearest of level or upright, or 0 when its ends are more than `maxRise`
 * off it or it is more than `deg` off it (or it is already on one, or has
 * no direction).
 */
export function levelTurn(
  dx: number,
  dy: number,
  maxRise = LINE_LEVEL_RISE,
  deg = LINE_LEVEL_DEG,
): number {
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return 0;
  const angle = Math.atan2(dy, dx);
  const quarter = Math.PI / 2;
  const turn = Math.round(angle / quarter) * quarter - angle;
  if (Math.abs(turn) > (deg * Math.PI) / 180) return 0;
  return length * Math.abs(Math.sin(turn)) <= maxRise ? turn : 0;
}

/**
 * `pts` with its line levelled: the segment from its first point to its
 * second (a line's two ends; an arrow's tail and tip, contracts/api.md §2)
 * turned onto level or upright when its ends are within `maxRise` of it
 * ({@link levelTurn}), and every
 * other point turned rigidly with it, so an arrow's head stays on its
 * shaft. The two ends come out exactly level (or upright), not merely
 * rounded close to it. A fresh array when anything moved; `pts` itself when
 * nothing did, so a caller may compare identity. Pressures are kept.
 */
export function levelLine(pts: number[], pivot: LevelPivot, maxRise = LINE_LEVEL_RISE): number[] {
  if (pts.length < 2 * STRIDE) return pts;
  const ax = pts[0];
  const ay = pts[1];
  const bx = pts[STRIDE];
  const by = pts[STRIDE + 1];
  const turn = levelTurn(bx - ax, by - ay, maxRise);
  if (turn === 0) return pts;
  const cx = pivot === "start" ? ax : (ax + bx) / 2;
  const cy = pivot === "start" ? ay : (ay + by) / 2;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const out = pts.slice();
  const usable = out.length - (out.length % STRIDE);
  for (let i = 0; i < usable; i += STRIDE) {
    const dx = out[i] - cx;
    const dy = out[i + 1] - cy;
    out[i] = round2(cx + dx * cos - dy * sin);
    out[i + 1] = round2(cy + dx * sin + dy * cos);
  }
  // The ends exactly on one level (or one upright), whatever the rounding
  // did: a line one hundredth off level is not level. Every copy of an end
  // (an arrow repeats its tip) moves with it.
  const level = Math.abs(Math.cos(Math.atan2(by - ay, bx - ax) + turn)) > 0.5;
  const axis = level ? 1 : 0;
  const keep = round2(pivot === "start" ? out[axis] : (out[axis] + out[STRIDE + axis]) / 2);
  const ends = [out[0], out[1], out[STRIDE], out[STRIDE + 1]];
  for (let i = 0; i < usable; i += STRIDE) {
    const onEnd =
      (out[i] === ends[0] && out[i + 1] === ends[1]) ||
      (out[i] === ends[2] && out[i + 1] === ends[3]);
    if (onEnd) out[i + axis] = keep;
  }
  return out;
}
