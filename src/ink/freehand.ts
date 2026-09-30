/**
 * How ink looks. Handwriting is drawn by perfect-freehand, which turns a
 * stroke's pressure points into the outline of a line whose width follows
 * the pen; the outline becomes SVG path data. A clean shape skips the
 * outline and is stroked along its centreline (`inkPath`).
 *
 * Pure: path strings and numbers only. The renderer builds the `Path2D`.
 */

import { type StrokeOptions, getStroke } from "perfect-freehand";
import { POINT_STRIDE } from "../model/document";

/** The perfect-freehand options the plugin sets; the rest stay at the library's defaults. */
export type FreehandOptions = Required<
  Pick<StrokeOptions, "size" | "thinning" | "smoothing" | "streamline" | "simulatePressure">
>;

/**
 * The pen at nib width `size`. These numbers are how every note has always
 * been drawn — changing one redraws every stroke ever written. With
 * pressure, thinning 0.6 lets a light touch draw a thinner line. Without,
 * thinning 0 keeps one width, and pressure simulated from speed then has
 * nothing to change.
 */
export function penOptions(size: number, pressure: boolean): FreehandOptions {
  const thinning = pressure ? 0.6 : 0;
  return { size, thinning, smoothing: 0.5, streamline: 0.5, simulatePressure: !pressure };
}

/**
 * The flat `[x, y, p, …]` buffer as the `[x, y, pressure]` points
 * perfect-freehand takes. A partial point at the end is left out.
 */
export function toInputPoints(pts: readonly number[]): number[][] {
  const whole = pts.length - (pts.length % POINT_STRIDE);
  const points: number[][] = [];
  for (let i = 0; i < whole; i += POINT_STRIDE) points.push(pts.slice(i, i + POINT_STRIDE));
  return points;
}

/**
 * The outline perfect-freehand draws round a handwritten stroke, as
 * `[x, y]` pairs. `finished` is false while the pen is still down, which
 * leaves the stroke's end open instead of rounding it off. Clean shapes are
 * not outlined: see {@link inkPath}.
 */
export function strokeOutline(
  pts: readonly number[],
  pen: FreehandOptions,
  finished = true,
): number[][] {
  // Only the options the plugin sets reach the library, whatever else `pen` carries.
  const { size, thinning, smoothing, streamline, simulatePressure } = pen;
  const options = { size, thinning, smoothing, streamline, simulatePressure, last: finished };
  return getStroke(toInputPoints(pts), options);
}

/**
 * How one stroke is painted: handwriting as a filled variable-width outline,
 * a clean shape as its centreline stroked `stroke` wide with round joins.
 * `d` is SVG path data for `new Path2D(d)`.
 */
export interface InkPath {
  d: string;
  /** Line width to stroke `d` at, for a shape; `null` to fill it. */
  stroke: number | null;
}

/**
 * The path to paint a stroke with. A shape (`shape`) is drawn as a plain
 * stroke of its centreline: its pressure is constant, so perfect-freehand's
 * outline was the same width and added only its corner handling — a notch
 * or a bevel at every sharp corner, sub-pixel at fit zoom and plain to see
 * at 5x (Joost's recording, 2026-09-24). Handwriting keeps the outline,
 * except a dot (see {@link isDot}), which is its centreline stroked as wide
 * as the line would be. `null` when there is nothing to draw.
 */
export function inkPath(
  pts: number[],
  pen: FreehandOptions,
  finished = true,
  shape = false,
): InkPath | null {
  if (pts.length < POINT_STRIDE) return null;
  if (shape || isDot(pts)) {
    const d = centrelinePath(pts);
    return d ? { d, stroke: shape ? pen.size : 2 * lineRadius(pts, pen) } : null;
  }
  const d = outlineToSvgPath(strokeOutline(pts, pen, finished));
  return d ? { d, stroke: null } : null;
}

/**
 * A handwritten stroke whose path is shorter than this (page px) is a dot.
 * perfect-freehand draws a stroke that short as a round blob that ignores
 * pressure, up to twice as wide as the same pen's line at a light touch and
 * more for a thin nib: every i-dot, full stop and apostrophe, and the first
 * frame of every stroke on the wet layer (Joost's recording against
 * GoodNotes, 2026-09-30). Measured over nibs 1-24 and sample spacings
 * 0.28-2.5 px, the blob lasts up to 3.0 px whatever the nib; past that the
 * outline is the line's own width.
 */
export const DOT_LENGTH = 3.2;

/** Whether a handwritten stroke is a dot (see {@link DOT_LENGTH}). */
export function isDot(pts: readonly number[]): boolean {
  let length = 0;
  for (let i = POINT_STRIDE; i + 1 < pts.length; i += POINT_STRIDE) {
    length += Math.hypot(pts[i] - pts[i - POINT_STRIDE], pts[i + 1] - pts[i + 1 - POINT_STRIDE]);
    if (length >= DOT_LENGTH) return false;
  }
  return true;
}

/**
 * Half the width perfect-freehand gives a line at the stroke's mean
 * pressure: its `getStrokeRadius` with the default linear easing. Without
 * thinning (pressure off) that is half the nib, whatever the pressure.
 */
export function lineRadius(pts: readonly number[], pen: FreehandOptions): number {
  let sum = 0;
  let count = 0;
  for (let i = 2; i < pts.length; i += POINT_STRIDE) {
    const p = pts[i];
    if (Number.isFinite(p)) {
      sum += Math.min(1, Math.max(0, p));
      count++;
    }
  }
  const pressure = count > 0 ? sum / count : 0.5;
  return pen.size * (0.5 - pen.thinning * (0.5 - pressure));
}

/**
 * A polyline as SVG path data, closed with `Z` when it ends where it began
 * (so a rectangle's first corner is joined, not capped twice).
 */
export function centrelinePath(pts: number[]): string {
  const n = Math.floor(pts.length / POINT_STRIDE);
  if (n === 0) return "";
  const parts = [`M ${pts[0].toFixed(2)} ${pts[1].toFixed(2)}`];
  for (let i = 1; i < n; i++) {
    parts.push(`L ${pts[i * 3].toFixed(2)} ${pts[i * 3 + 1].toFixed(2)}`);
  }
  // A lone point still draws, as a round dot.
  if (n === 1) parts.push(`L ${pts[0].toFixed(2)} ${pts[1].toFixed(2)}`);
  const closed =
    n > 2 &&
    Math.abs(pts[0] - pts[(n - 1) * 3]) < 1e-6 &&
    Math.abs(pts[1] - pts[(n - 1) * 3 + 1]) < 1e-6;
  if (closed) parts.push("Z");
  return parts.join(" ");
}

/**
 * SVG path data for an outline polygon: a closed chain of quadratic curves,
 * each bending at one outline point and ending halfway to the next.
 *
 * This is `getSvgPathFromStroke` from perfect-freehand's README (MIT,
 * Steve Ruiz), in the form its 1.0 releases gave, with the two changes the
 * plugin has always made: numbers are written with two decimals, and an
 * outline of fewer than two points has no path.
 */
export function outlineToSvgPath(polygon: number[][]): string {
  if (polygon.length < 2) return "";
  const f = (n: number): string => n.toFixed(2);
  const [x, y] = polygon[0];
  const d = polygon.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(f(x0), f(y0), f((x0 + x1) / 2), f((y0 + y1) / 2));
      return acc;
    },
    ["M", f(x), f(y), "Q"],
  );
  d.push("Z");
  return d.join(" ");
}
