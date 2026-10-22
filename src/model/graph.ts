/**
 * Graphs of y = f(x): what to draw, apart from any canvas. Pure.
 *
 * A {@link GraphSpec} is the whole graph as a plain object (its expressions
 * and the range in view), so it can be stored, synced and drawn again
 * anywhere: the calculator's pop-up draws it now, a graph on a notebook page
 * later. {@link sampleGraph} turns it into polylines in value space, and
 * `canvas/graph-painter.ts` draws those; neither knows about the DOM.
 *
 * Sampling is adaptive: a piece of curve is halved until it is straight to
 * within half a pixel at the resolution it will be drawn, and a curve is
 * broken, never joined by a vertical line, where it jumps (a step, an
 * asymptote) or leaves its domain.
 */

import { type AngleMode, compileFunction } from "./calculator";
import type { GraphLine, GraphSlider } from "./graph-lines";

export interface GraphRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * A whole graph: what is plotted and what is in view, as one plain object
 * to store and draw anywhere. Version 2 adds `lines` (each line's text and
 * look, `model/graph-lines.ts`), `sliders` and the view switches; fields a
 * version does not know are kept. `expressions` mirrors the lines' text for
 * readers of version 1.
 */
export interface GraphSpec extends GraphRange {
  expressions: string[];
  /** Angles of trig functions; radians when absent. */
  angle?: AngleMode;
  version?: number;
  lines?: GraphLine[];
  sliders?: GraphSlider[];
  /** Grid lines (default on). */
  grid?: boolean;
  /** Axis numbers (default on). */
  labels?: boolean;
  /** x and y at the same scale. */
  square?: boolean;
  /** x ticks at multiples of π. */
  piTicks?: boolean;
  /** Points pinned on function lines, kept with their labels; named A, B, … as GeoGebra names points. */
  pins?: GraphPin[];
  [key: string]: unknown;
}

/** A point pinned on a function line: it follows the line (a slider moves it too). */
export interface GraphPin {
  line: string;
  x: number;
  /** A, B, …; pins from before names were given have none. */
  name?: string;
}

/** The first capital letter no pin uses yet; null when all 26 are taken. */
export function nextPinName(pins: readonly GraphPin[]): string | null {
  const used = new Set(pins.map((p) => p.name));
  for (let i = 0; i < 26; i++) {
    const name = String.fromCharCode(65 + i);
    if (!used.has(name)) return name;
  }
  return null;
}

/** A run of curve in value space, flat: [x0, y0, x1, y1, …]. */
export type Polyline = number[];

export type RealFn = (x: number) => number;

/** Wider or narrower than this and a zoom stops: floats run out of digits, or of range. */
export const MIN_SPAN = 1e-9;
export const MAX_SPAN = 1e9;

const TOLERANCE_PX = 0.5;
/** A piece taller than this is halved whatever its shape, so bends inside it are seen. */
const STEEP_PX = 40;
const MAX_DEPTH = 14;
/** Most function calls per curve per sampling. */
const BUDGET = 25_000;

/**
 * The default view: x from −10 to 10, y to the same scale, centred on 0.
 * In degrees x runs from −360° to 360° (TI's trig window), so a sine looks
 * like one; y then keeps the radian scale's height.
 */
export function defaultRange(
  widthPx: number,
  heightPx: number,
  angle: AngleMode = "rad",
): GraphRange {
  const half = 10 * (heightPx / Math.max(1, widthPx));
  const x = angle === "deg" ? 360 : 10;
  return { xMin: -x, xMax: x, yMin: -half, yMax: half };
}

/** Compile each expression; a broken one is null with its error, the others still draw. */
export function compileGraph(spec: Pick<GraphSpec, "expressions" | "angle">): {
  fns: Array<RealFn | null>;
  errors: Array<string | null>;
} {
  const fns: Array<RealFn | null> = [];
  const errors: Array<string | null> = [];
  for (const expression of spec.expressions) {
    const compiled = compileFunction(expression, { angle: spec.angle ?? "rad" });
    fns.push(compiled.ok ? compiled.fn : null);
    errors.push(compiled.ok ? null : compiled.error);
  }
  return { fns, errors };
}

/**
 * The curve of `fn` over `range`, as polylines in value space, drawn at
 * `widthPx` × `heightPx`. Points far off the top or bottom are pulled in to
 * a few view heights away, so a painter never strokes a coordinate of 1e300.
 */
export function sampleCurve(
  fn: RealFn,
  range: GraphRange,
  widthPx: number,
  heightPx: number,
): Polyline[] {
  const w = Math.max(1, widthPx);
  const h = Math.max(1, heightPx);
  const { xMin, xMax, yMin, yMax } = range;
  const pxPerX = w / (xMax - xMin);
  const pxPerY = h / (yMax - yMin);
  const ySpan = yMax - yMin;
  const lowCap = yMin - 4 * ySpan;
  const highCap = yMax + 4 * ySpan;
  const lines: Polyline[] = [];
  let line: Polyline = [];
  let calls = 0;
  const f = (x: number): number => {
    calls++;
    const y = fn(x);
    return Number.isFinite(y) ? y : NaN;
  };
  const clampY = (y: number): number => Math.min(highCap, Math.max(lowCap, y));
  const breakLine = (): void => {
    if (line.length >= 4) lines.push(line);
    line = [];
  };
  const point = (x: number, y: number): void => {
    line.push(x, clampY(y));
  };
  const offscreenTogether = (y0: number, y1: number, ym: number): boolean =>
    (y0 > highCap && y1 > highCap && ym > highCap) || (y0 < lowCap && y1 < lowCap && ym < lowCap);

  /** The piece from (x0, y0) to (x1, y1); (x0, y0) is already on `line` when finite. */
  const piece = (x0: number, y0: number, x1: number, y1: number, depth: number): void => {
    const xm = (x0 + x1) / 2;
    const ym = f(xm);
    const finite0 = !Number.isNaN(y0);
    const finite1 = !Number.isNaN(y1);
    const finiteM = !Number.isNaN(ym);
    const bottom = depth >= MAX_DEPTH || calls > BUDGET;
    if (finite0 && finite1 && finiteM) {
      const bend = Math.abs(ym - (y0 + y1) / 2) * pxPerY;
      const rise = Math.abs(y1 - y0) * pxPerY;
      const flatEnough = bend <= TOLERANCE_PX && rise <= STEEP_PX;
      if (flatEnough || offscreenTogether(y0, y1, ym)) {
        point(x1, y1);
        return;
      }
      if (bottom) {
        // A piece this narrow that still rises by pixels is a jump: break there.
        if (rise > 2 && (x1 - x0) * pxPerX < 0.05) breakLine();
        point(x1, y1);
        return;
      }
    } else if (bottom) {
      // The edge of the domain, found as closely as the depth allows.
      breakLine();
      if (finite1) point(x1, y1);
      return;
    }
    piece(x0, y0, xm, ym, depth + 1);
    piece(xm, ym, x1, y1, depth + 1);
  };

  // A first pass every 4 px, one step past each edge so the curve leaves the frame.
  const steps = Math.max(8, Math.ceil(w / 4));
  const dx = (xMax - xMin) / steps;
  let x0 = xMin - dx;
  let y0 = f(x0);
  if (!Number.isNaN(y0)) point(x0, y0);
  for (let i = 0; i <= steps + 1; i++) {
    const x1 = xMin + i * dx;
    const y1 = f(x1);
    piece(x0, y0, x1, y1, 0);
    x0 = x1;
    y0 = y1;
  }
  breakLine();
  return lines;
}

/** Every expression of `spec`, sampled for a frame `widthPx` × `heightPx`. */
export function sampleGraph(
  spec: GraphSpec,
  widthPx: number,
  heightPx: number,
): { curves: Polyline[][]; errors: Array<string | null> } {
  const { fns, errors } = compileGraph(spec);
  const curves = fns.map((fn) => (fn ? sampleCurve(fn, spec, widthPx, heightPx) : []));
  return { curves, errors };
}

// --- Axes ---------------------------------------------------------------------

/** Ticks 1, 2 or 5 × 10ⁿ apart, at least `minGapPx` apart on screen. */
export function niceTicks(
  min: number,
  max: number,
  pixels: number,
  minGapPx: number,
): { step: number; values: number[] } {
  const span = max - min;
  if (!(span > 0) || !(pixels > 0)) return { step: 1, values: [] };
  const raw = (span * minGapPx) / pixels;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const values: number[] = [];
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step);
  for (let i = first; i <= last && values.length < 1000; i++) {
    const v = i * step;
    values.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { step, values };
}

/**
 * The step of the faint grid between major lines: a fifth of a step of 1 or
 * 5 × 10ⁿ, a quarter of 2 × 10ⁿ, so minor lines land on round numbers.
 */
export function minorStep(step: number): number {
  const mantissa = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
  return Math.abs(mantissa - 2) < 1e-6 ? step / 4 : step / 5;
}

/** A tick's label: as many decimals as the step needs, an exponent when the numbers are huge or tiny. */
export function formatTick(value: number, step: number): string {
  if (value === 0) return "0";
  const magnitude = Math.max(Math.abs(value), step);
  if (magnitude >= 1e6 || step < 1e-4) {
    const digits = Math.max(0, Math.round(Math.log10(Math.abs(value) / step)));
    return value.toExponential(Math.min(6, digits)).replace("e+", "e");
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return value.toFixed(decimals).replace("-", "−");
}

// --- View ---------------------------------------------------------------------

/** Value-space point under screen point (px, py) of a frame `w` × `h`. */
export function toValue(
  range: GraphRange,
  w: number,
  h: number,
  px: number,
  py: number,
): {
  x: number;
  y: number;
} {
  return {
    x: range.xMin + (px / w) * (range.xMax - range.xMin),
    y: range.yMax - (py / h) * (range.yMax - range.yMin),
  };
}

/** Screen point of value-space (x, y). */
export function toScreen(
  range: GraphRange,
  w: number,
  h: number,
  x: number,
  y: number,
): {
  px: number;
  py: number;
} {
  return {
    px: ((x - range.xMin) / (range.xMax - range.xMin)) * w,
    py: ((range.yMax - y) / (range.yMax - range.yMin)) * h,
  };
}

/** The view moved with a finger by (dxPx, dyPx). */
export function panRange(
  range: GraphRange,
  w: number,
  h: number,
  dxPx: number,
  dyPx: number,
): GraphRange {
  const dx = (dxPx / w) * (range.xMax - range.xMin);
  const dy = (dyPx / h) * (range.yMax - range.yMin);
  return {
    xMin: range.xMin - dx,
    xMax: range.xMax - dx,
    yMin: range.yMin + dy,
    yMax: range.yMax + dy,
  };
}

/**
 * The view zoomed by `factor` (> 1 closer) about screen point (px, py),
 * which stays under the finger. Each axis stops at {@link MIN_SPAN} and
 * {@link MAX_SPAN}.
 */
export function zoomRange(
  range: GraphRange,
  w: number,
  h: number,
  factor: number,
  px: number,
  py: number,
): GraphRange {
  if (!(factor > 0) || !Number.isFinite(factor)) return range;
  const at = toValue(range, w, h, px, py);
  const scaleAxis = (lo: number, hi: number, centre: number): [number, number] => {
    const span = hi - lo;
    const next = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span / factor));
    const k = next / span;
    return [centre - (centre - lo) * k, centre + (hi - centre) * k];
  };
  const [xMin, xMax] = scaleAxis(range.xMin, range.xMax, at.x);
  const [yMin, yMax] = scaleAxis(range.yMin, range.yMax, at.y);
  return { xMin, xMax, yMin, yMax };
}

/**
 * The y range that shows the curves over the current x range: the middle
 * 96 % of their values with a margin, so one asymptote does not flatten
 * everything else. Unchanged when nothing is finite.
 */
export function fitRange(fns: ReadonlyArray<RealFn | null>, range: GraphRange): GraphRange {
  const ys: number[] = [];
  const n = 240;
  for (const fn of fns) {
    if (!fn) continue;
    for (let i = 0; i <= n; i++) {
      const y = fn(range.xMin + ((range.xMax - range.xMin) * i) / n);
      if (Number.isFinite(y)) ys.push(y);
    }
  }
  if (ys.length === 0) return range;
  ys.sort((a, b) => a - b);
  const lo = ys[Math.floor(ys.length * 0.02)];
  const hi = ys[Math.min(ys.length - 1, Math.ceil(ys.length * 0.98) - 1)];
  let span = hi - lo;
  if (!(span > MIN_SPAN)) span = Math.max(1, Math.abs(lo));
  const mid = (lo + hi) / 2;
  const half = Math.min(MAX_SPAN / 2, (span / 2) * 1.15);
  return { xMin: range.xMin, xMax: range.xMax, yMin: mid - half, yMax: mid + half };
}

/**
 * The curve nearest screen point (px, py), within `maxPx` vertically, and
 * its point at that x: what a tap on a curve traces. Null when no curve
 * passes close by.
 */
export function traceAt(
  fns: ReadonlyArray<RealFn | null>,
  range: GraphRange,
  w: number,
  h: number,
  px: number,
  py: number,
  maxPx = 24,
): { index: number; x: number; y: number } | null {
  const { x } = toValue(range, w, h, px, py);
  let best: { index: number; x: number; y: number } | null = null;
  let bestPx = maxPx;
  fns.forEach((fn, index) => {
    if (!fn) return;
    const y = fn(x);
    if (!Number.isFinite(y)) return;
    const distance = Math.abs(toScreen(range, w, h, x, y).py - py);
    if (distance <= bestPx) {
      bestPx = distance;
      best = { index, x, y };
    }
  });
  return best;
}
