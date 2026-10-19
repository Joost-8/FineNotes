/**
 * The geometry of a graph element's drawing: how many samples a curve gets
 * at a given resolution, where its grid lines and numbers go, and how a row
 * of sampled values becomes polylines in the frame, broken where the
 * function is undefined or leaps (an asymptote) rather than joined straight
 * across. What is drawn with it is `graph-paint.ts`.
 *
 * Pure: no DOM, no canvas.
 */

/** The fewest and most samples a curve gets across its frame. */
export const GRAPH_MIN_SAMPLES = 64;
export const GRAPH_MAX_SAMPLES = 4096;

/**
 * Samples for a curve `framePx` page px wide drawn at `level` device px per
 * page px: about one a device pixel, rounded up to a power of two so nearby
 * zoom levels share one sampling (and one cached path).
 */
export function sampleCount(framePx: number, level: number): number {
  const device = framePx * level;
  if (!(device > 0) || !Number.isFinite(device)) return GRAPH_MIN_SAMPLES;
  const pow = 2 ** Math.ceil(Math.log2(device));
  return Math.min(GRAPH_MAX_SAMPLES, Math.max(GRAPH_MIN_SAMPLES, pow));
}

/** The x values `count` samples are taken at, evenly from `lo` to `hi`, both ends included. */
export function sampleXs(range: readonly [number, number], count: number): Float64Array {
  const n = Math.max(2, Math.floor(count));
  const out = new Float64Array(n);
  const step = (range[1] - range[0]) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = range[0] + i * step;
  out[n - 1] = range[1];
  return out;
}

/** A step between grid lines that reads well: 1, 2 or 5 times a power of ten. */
export function niceStep(span: number, most: number): number {
  if (!(span > 0) || !Number.isFinite(span) || !(most >= 1)) return 1;
  const rough = span / most;
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const m of [1, 2, 5, 10]) {
    if (m * power >= rough) return m * power;
  }
  return 10 * power;
}

/** The multiples of `step` inside `range`, low to high, at most `most + 2`. */
export function ticks(range: readonly [number, number], step: number, most = 50): number[] {
  if (!(step > 0) || !Number.isFinite(step)) return [];
  const first = Math.ceil(range[0] / step);
  const last = Math.floor(range[1] / step);
  const out: number[] = [];
  for (let i = first; i <= last && out.length < most + 2; i++) {
    // `i * step` rather than adding: no drift, and 0 lands exactly on 0.
    out.push(i === 0 ? 0 : i * step);
  }
  return out;
}

/** The typographic minus, which lines up with the digits as a hyphen does not. */
const MINUS = String.fromCharCode(0x2212);

/** A tick's number as an axis shows it: as few digits as the step needs. */
export function tickLabel(value: number, step: number): string {
  if (value === 0) return "0";
  if (value < 0) return MINUS + tickLabel(-value, step);
  if (value >= 1e6 || value < 1e-4) {
    // Enough significant digits to tell this tick from the next, no more.
    const digits = Math.min(12, Math.max(1, Math.floor(Math.log10(value / step) + 1e-9) + 1));
    return Number(value.toPrecision(digits)).toExponential();
  }
  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
  return value.toFixed(decimals);
}

/** Where a value lies in the frame, frame px from its top-left. */
export interface FrameMap {
  xRange: readonly [number, number];
  yRange: readonly [number, number];
  w: number;
  h: number;
}

export function frameX(map: FrameMap, x: number): number {
  return ((x - map.xRange[0]) / (map.xRange[1] - map.xRange[0])) * map.w;
}

export function frameY(map: FrameMap, y: number): number {
  return ((map.yRange[1] - y) / (map.yRange[1] - map.yRange[0])) * map.h;
}

/**
 * A row of samples (`ys[i]` at `xs[i]`; NaN or ±Infinity where undefined) as
 * polylines in frame px, flat `[x0, y0, x1, y1, …]`. A run breaks at an
 * undefined sample, and between two samples that leap from far above the
 * frame to far below it, or back (tan at π/2, 1/x at 0), which a straight
 * line would join across the whole frame. Points far outside are clamped a
 * frame height beyond the edge, so lines that leave the frame still do so
 * at the right angle and canvas never sees a huge coordinate.
 */
export function curveRuns(xs: ArrayLike<number>, ys: ArrayLike<number>, map: FrameMap): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  let prevY = Number.NaN;
  const limit = map.h * 2;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (!Number.isFinite(y)) {
      if (run.length >= 4) runs.push(run);
      run = [];
      prevY = Number.NaN;
      continue;
    }
    const fy = frameY(map, y);
    if (run.length > 0 && leaps(prevY, fy, map.h)) {
      if (run.length >= 4) runs.push(run);
      run = [];
    }
    run.push(frameX(map, xs[i]), Math.max(-limit, Math.min(map.h + limit, fy)));
    prevY = fy;
  }
  if (run.length >= 4) runs.push(run);
  return runs;
}

/** Whether a step from frame y `a` to `b` crosses the frame from beyond one edge to beyond the other. */
function leaps(a: number, b: number, h: number): boolean {
  return (a < -h && b > 2 * h) || (b < -h && a > 2 * h);
}
