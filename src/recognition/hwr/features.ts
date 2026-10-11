/**
 * The recogniser's input: one line of ink as (dx, dy, dt, new-stroke) frames.
 * A port of `prepare_v2`, `strokes_to_timed`, `normalize` and `features_v2`
 * in research/handwriting-rig/htr.py, with the normalisation the shipped
 * models were trained with (skew off, slant off, core-height scaling):
 *
 * 1. Writing order: by `t0` when every stroke has one, else left to right.
 * 2. Time: FineNotes keeps one start time per stroke and none per point, so
 *    the pen moves at a constant 5.3 line heights per second inside a stroke;
 *    between strokes the stored `t0` gap counts when both have one.
 * 3. Size: the line is scaled so its core (x-height) zone spans 0.4 units,
 *    read off the middle 60 % of its ink heights; the baseline sits at 0.
 * 4. Frames: each stroke resampled to 20 points per unit of its length,
 *    evenly in time, then differences.
 *
 * Every step follows numpy's arithmetic (numeric.ts), so the frames match
 * the Python reference to float32 precision (tests/recognition/hwr-*.test.ts).
 *
 * PURE: no DOM, no Obsidian.
 */

import {
  fitLine,
  interp,
  linspace,
  median,
  npMean,
  npSum,
  percentileSorted,
  sorted,
} from "./numeric";

/** One stroke as FineNotes stores it: page space, y down. */
export interface InkStroke {
  /** x, y, pressure, x, y, pressure, … */
  readonly pts: ArrayLike<number>;
  /** Milliseconds from the page's first pen-down; absent when unknown. */
  readonly t0?: number | null;
}

/** Path length per unit (Carbune et al. 2020). */
export const POINTS_PER_UNIT_LENGTH = 20;
/** Pen speed in line heights per second, measured on BRUSH (htr.py). */
export const HEIGHTS_PER_SECOND = 5.3;
/** The core zone spans this many units after normalisation. */
export const CORE_UNITS = 0.4;
/** Channels per frame: dx, dy, dt, new-stroke. */
export const FEATURE_CHANNELS = 4;

/** A stroke with a time per point: x, y (y up) and t in seconds. */
interface TimedStroke {
  x: Float64Array;
  y: Float64Array;
  t: Float64Array;
}

/** One line ready for the network. */
export interface LineFeatures<S extends InkStroke = InkStroke> {
  /** `frames` × 4, row-major. */
  features: Float32Array;
  frames: number;
  /** For each frame, the index in `strokes` it was resampled from. */
  frameStroke: Int32Array;
  /** The line's strokes in writing order. */
  strokes: S[];
}

function minX(s: InkStroke): number {
  let m = Infinity;
  for (let i = 0; i < s.pts.length; i += 3) if (s.pts[i] < m) m = s.pts[i];
  return m;
}

/** Writing order: by `t0` when every stroke has one, else by left edge (both stable). */
export function writingOrder<S extends InkStroke>(strokes: readonly S[]): S[] {
  if (strokes.every((s) => s.t0 != null)) {
    return [...strokes].sort((a, b) => (a.t0 as number) - (b.t0 as number));
  }
  return [...strokes].sort((a, b) => minX(a) - minX(b));
}

/**
 * `strokes_to_timed`: within a stroke, arc length / `speed`; between strokes,
 * the stored `t0` difference when both have one and it grows, else the jump
 * distance / speed + 0.15 s.
 */
function timeStrokes(
  xy: { x: Float64Array; y: Float64Array }[],
  t0s: readonly (number | null | undefined)[],
  speed: number,
): TimedStroke[] {
  const timed: TimedStroke[] = [];
  let tEnd = 0;
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < xy.length; i++) {
    const { x, y } = xy[i];
    let tStart: number;
    if (i === 0) {
      tStart = 0;
    } else {
      const a = t0s[i - 1];
      const b = t0s[i];
      if (a != null && b != null && b > a) {
        tStart = Math.max(tEnd + 0.01, timed[i - 1].t[0] + (b - a) / 1000);
      } else {
        const dx = x[0] - prevX;
        const dy = y[0] - prevY;
        tStart = tEnd + Math.sqrt(dx * dx + dy * dy) / speed + 0.15;
      }
    }
    const t = new Float64Array(x.length);
    let cum = 0;
    t[0] = tStart;
    for (let k = 1; k < x.length; k++) {
      const dx = x[k] - x[k - 1];
      const dy = y[k] - y[k - 1];
      cum += Math.sqrt(dx * dx + dy * dy);
      t[k] = tStart + cum / speed;
    }
    timed.push({ x, y, t });
    tEnd = t[t.length - 1];
    prevX = x[x.length - 1];
    prevY = y[y.length - 1];
  }
  return timed;
}

/** `_extrema(strokes, "min")`: local minima of y along each stroke, as x and y lists. */
function localMinima(strokes: readonly TimedStroke[]): { x: number[]; y: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of strokes) {
    const n = s.y.length;
    if (n < 3) {
      let k = 0;
      for (let i = 1; i < n; i++) if (s.y[i] < s.y[k]) k = i;
      xs.push(s.x[k]);
      ys.push(s.y[k]);
      continue;
    }
    for (let i = 1; i < n - 1; i++) {
      if (s.y[i] <= s.y[i - 1] && s.y[i] <= s.y[i + 1]) {
        xs.push(s.x[i]);
        ys.push(s.y[i]);
      }
    }
  }
  return { x: xs, y: ys };
}

function ptp(a: ArrayLike<number>): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  return hi - lo;
}

/**
 * `_robust_line`: slope and intercept of a line through the points, refitted
 * twice after dropping points more than 1.5 MADs off it (descenders, dots).
 */
export function robustLine(xs: readonly number[], ys: readonly number[]): [number, number] {
  const n = xs.length;
  if (n < 2 || ptp(xs) <= 0) return [0, n ? median(ys) : 0];
  let keep = new Array<boolean>(n).fill(true);
  let a = 0;
  let b = median(ys);
  for (let iter = 0; iter < 3; iter++) {
    const kx: number[] = [];
    const ky: number[] = [];
    for (let i = 0; i < n; i++) {
      if (keep[i]) {
        kx.push(xs[i]);
        ky.push(ys[i]);
      }
    }
    if (kx.length < 2 || ptp(kx) <= 0) break;
    [a, b] = fitLine(kx, ky);
    const r = xs.map((x, i) => ys[i] - (a * x + b));
    const kept = r.filter((_, i) => keep[i]);
    const mid = median(kept);
    const mad = median(kept.map((v) => Math.abs(v - mid))) + 1e-9;
    keep = r.map((v) => Math.abs(v - mid) <= 1.5 * 1.4826 * mad);
  }
  return [a, b];
}

/** The normalisation's intermediate values, for tests against the reference. */
export interface NormalizeInfo {
  /** Ink height of the line (y up), at least 1e-6. */
  full: number;
  /** The baseline, in centred coordinates. */
  base: number;
  /** The core (x-height) estimate, in page px. */
  core: number;
  /** Page px to units. */
  scale: number;
}

/**
 * `normalize` with skew and slant off: centre, put the baseline at 0, scale
 * the core zone to `CORE_UNITS`, and start x at 0.
 */
function normalizeCore(strokes: readonly TimedStroke[]): {
  strokes: TimedStroke[];
  info: NormalizeInfo;
} {
  let count = 0;
  for (const s of strokes) count += s.x.length;
  const allX = new Float64Array(count);
  const allY = new Float64Array(count);
  let o = 0;
  for (const s of strokes) {
    allX.set(s.x, o);
    allY.set(s.y, o);
    o += s.x.length;
  }
  const full = Math.max(ptp(allY), 1e-6);
  // Levelling is off: the reference rotates by 0, which leaves the centred
  // points exactly as they are.
  const cx = npMean(allX);
  const cy = npMean(allY);
  const centred = strokes.map((s) => ({
    x: s.x.map((v) => v - cx),
    y: s.y.map((v) => v - cy),
    t: s.t,
  }));
  const mins = localMinima(centred);
  let base: number;
  if (mins.x.length >= 2) {
    base = robustLine(mins.x, mins.y)[1];
  } else {
    base = Infinity;
    for (const s of centred) for (const v of s.y) base = Math.min(base, v);
  }
  // The core from the ink's height distribution, resampled evenly by arc
  // length so slow, dense pen movement does not weigh more.
  const step = full / 60;
  const ys: number[] = [];
  for (const s of centred) {
    const n = s.x.length;
    const arc = new Float64Array(n);
    for (let k = 1; k < n; k++) {
      const dx = s.x[k] - s.x[k - 1];
      const dy = s.y[k] - s.y[k - 1];
      arc[k] = arc[k - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    const length = arc[n - 1];
    if (length > 0) {
      const m = Math.max(Math.trunc(length / step), 1);
      for (const v of interp(linspace(0, length, m + 1), arc, s.y)) ys.push(v);
    } else {
      ys.push(s.y[0]);
    }
  }
  const sortedYs = sorted(ys);
  let core = (percentileSorted(sortedYs, 80) - percentileSorted(sortedYs, 20)) / 0.6;
  if (!(0.2 * full <= core && core <= 0.9 * full)) core = 0.45 * full;
  const scale = CORE_UNITS / Math.max(core, 1e-6);
  let x0 = Infinity;
  for (const s of centred) for (const v of s.x) x0 = Math.min(x0, v);
  const out = centred.map((s) => ({
    x: s.x.map((v) => (v - x0) * scale),
    y: s.y.map((v) => (v - base) * scale),
    t: s.t,
  }));
  return { strokes: out, info: { full, base, core, scale } };
}

/**
 * `features_v2` on normalised strokes: each stroke resampled to 20 points
 * per unit of length (at least 2), evenly in time; a one-point stroke stays
 * one frame. Frames are (dx, dy, dt, new-stroke), the first frame (0, 0, 0, 1).
 */
function frameFeatures(strokes: readonly TimedStroke[]): {
  features: Float32Array;
  frameStroke: Int32Array;
} {
  const xs: Float64Array[] = [];
  const ys: Float64Array[] = [];
  const ts: Float64Array[] = [];
  let total = 0;
  for (const s of strokes) {
    const n0 = s.x.length;
    if (n0 === 1) {
      xs.push(s.x);
      ys.push(s.y);
      ts.push(s.t);
      total += 1;
      continue;
    }
    const seg = new Float64Array(n0 - 1);
    for (let k = 0; k < n0 - 1; k++) {
      const dx = s.x[k + 1] - s.x[k];
      const dy = s.y[k + 1] - s.y[k];
      seg[k] = Math.sqrt(dx * dx + dy * dy);
    }
    const length = npSum(seg);
    const n = Math.max(Math.ceil(length * POINTS_PER_UNIT_LENGTH), 2);
    let tmin = Infinity;
    let tmax = -Infinity;
    for (const v of s.t) {
      if (v < tmin) tmin = v;
      if (v > tmax) tmax = v;
    }
    const span = Math.max(1e-9, tmax - tmin);
    const tn = s.t.map((v) => (v - tmin) / span);
    const grid = linspace(0, 1, n);
    xs.push(interp(grid, tn, s.x));
    ys.push(interp(grid, tn, s.y));
    ts.push(interp(grid, tn, s.t));
    total += n;
  }
  const features = new Float32Array(total * 4);
  const frameStroke = new Int32Array(total);
  let f = 0;
  let px = 0;
  let py = 0;
  let pt = 0;
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k];
    const y = ys[k];
    const t = ts[k];
    for (let i = 0; i < x.length; i++, f++) {
      if (f > 0) {
        features[f * 4] = x[i] - px;
        features[f * 4 + 1] = y[i] - py;
        features[f * 4 + 2] = t[i] - pt;
        features[f * 4 + 3] = i === 0 ? 1 : 0;
      } else {
        features[3] = 1;
      }
      frameStroke[f] = k;
      px = x[i];
      py = y[i];
      pt = t[i];
    }
  }
  return { features, frameStroke };
}

/**
 * `prepare_v2`: one line of FineNotes strokes as network frames. Strokes
 * without points are left out.
 */
export function lineFeatures<S extends InkStroke>(
  input: readonly S[],
  heightsPerSecond = HEIGHTS_PER_SECOND,
): LineFeatures<S> & { norm: NormalizeInfo } {
  const strokes = writingOrder(input.filter((s) => s.pts.length >= 3));
  if (strokes.length === 0) throw new Error("a line needs at least one stroke with points");
  const xy = strokes.map((s) => {
    const n = Math.floor(s.pts.length / 3);
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = s.pts[i * 3];
      y[i] = -s.pts[i * 3 + 1];
    }
    return { x, y };
  });
  let lo = Infinity;
  let hi = -Infinity;
  for (const { y } of xy) {
    for (const v of y) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const speed = heightsPerSecond * Math.max(hi - lo, 1);
  const timed = timeStrokes(
    xy,
    strokes.map((s) => s.t0),
    speed,
  );
  const { strokes: norm, info } = normalizeCore(timed);
  const { features, frameStroke } = frameFeatures(norm);
  return { features, frames: frameStroke.length, frameStroke, strokes, norm: info };
}
