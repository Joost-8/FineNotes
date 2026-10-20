/**
 * Bézier-curve input for Grape 2 (research/handwriting-rig/htr.py, "curves",
 * BEZIER-INPUT-2026-10-19.md): one line's point frames (`lineFeatures`) cut
 * into cubic curves that fit the points in (x, y, time) within a tolerance,
 * one network frame per curve.
 *
 * A port of `curves_from_features`, `fit_stroke` and `fit_cubic`, in
 * float64 and in the reference's order of operations. numpy's `@` runs on
 * BLAS, whose summation order is the library's own, so the fitted control
 * points can differ from the reference in their last bits; the golden test
 * (tests/recognition/hwr-curves.test.ts) states the tolerance.
 *
 * PURE: no DOM, no Obsidian.
 */

import { npSum } from "./numeric";

/** Values per curve: end displacement (2), first control arm (2), second arm (2), time γ1..3, pen-up. */
export const CURVE_RAW = 10;

/** Newton refinements of the curve parameters per fit (`_FIT_ITERS`). */
const FIT_ITERS = 4;

/** What a model expects as input, from its file's header (bundle.ts). */
export interface CurveInput {
  kind: "curves";
  /** Largest distance from a point to its curve, in normalised units (core = 0.4). */
  tol: number;
  /** Only "raw" (the rows as they are) is ported. */
  encoding: "raw";
}

type Vec = [number, number, number];

/** One cubic through q's first and last points: P1, P2 and the largest point-to-curve distance. */
function fitCubic(q: Float64Array, a: number, b: number): { p1: Vec; p2: Vec; err: number } {
  const n = b - a + 1;
  const p0: Vec = [q[a * 3], q[a * 3 + 1], q[a * 3 + 2]];
  const p3: Vec = [q[b * 3], q[b * 3 + 1], q[b * 3 + 2]];
  const lineP1: Vec = [0, 0, 0];
  const lineP2: Vec = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    lineP1[c] = p0[c] + (p3[c] - p0[c]) / 3;
    lineP2[c] = p3[c] - (p3[c] - p0[c]) / 3;
  }
  if (n <= 2) return { p1: lineP1, p2: lineP2, err: 0 };
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const o = (a + i) * 3;
    const dx = q[o] - q[o - 3];
    const dy = q[o + 1] - q[o - 2];
    const dt = q[o + 2] - q[o - 1];
    s[i] = s[i - 1] + Math.sqrt(dx * dx + dy * dy + dt * dt);
  }
  const total = s[n - 1];
  if (total <= 0) return { p1: [...p0], p2: [...p3], err: 0 };
  for (let i = 0; i < n; i++) s[i] /= total;
  let p1: Vec = lineP1;
  let p2: Vec = lineP2;
  for (let it = 0; it < FIT_ITERS; it++) {
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    const r1: Vec = [0, 0, 0];
    const r2: Vec = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const si = s[i];
      const u = 1 - si;
      const b0 = u * u * u;
      const b1 = 3 * u * u * si;
      const b2 = 3 * u * si * si;
      const b3 = si * si * si;
      a11 += b1 * b1;
      a12 += b1 * b2;
      a22 += b2 * b2;
      const o = (a + i) * 3;
      for (let c = 0; c < 3; c++) {
        const r = q[o + c] - b0 * p0[c] - b3 * p3[c];
        r1[c] += b1 * r;
        r2[c] += b2 * r;
      }
    }
    const det = a11 * a22 - a12 * a12;
    if (det < 1e-10) {
      p1 = lineP1;
      p2 = lineP2;
      break;
    }
    p1 = [0, 0, 0];
    p2 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      p1[c] = (a22 * r1[c] - a12 * r2[c]) / det;
      p2[c] = (a11 * r2[c] - a12 * r1[c]) / det;
    }
    for (let i = 0; i < n; i++) {
      const si = s[i];
      const u = 1 - si;
      const b0 = u * u * u;
      const b1 = 3 * u * u * si;
      const b2 = 3 * u * si * si;
      const b3 = si * si * si;
      const k1 = 3 * (u * u);
      const k2 = 6 * (u * si);
      const k3 = 3 * (si * si);
      const o = (a + i) * 3;
      let num = 0;
      let dd = 0;
      let dx2 = 0;
      for (let c = 0; c < 3; c++) {
        const diff = b0 * p0[c] + b1 * p1[c] + b2 * p2[c] + b3 * p3[c] - q[o + c];
        const d1 = k1 * (p1[c] - p0[c]) + k2 * (p2[c] - p1[c]) + k3 * (p3[c] - p2[c]);
        const d2 = 6 * u * (p2[c] - 2 * p1[c] + p0[c]) + 6 * si * (p3[c] - 2 * p2[c] + p1[c]);
        num += diff * d1;
        dd += d1 * d1;
        dx2 += diff * d2;
      }
      const den = dd + dx2;
      const step = Math.abs(den) > 1e-12 ? num / den : 0;
      s[i] = Math.min(Math.max(si - step, 0), 1);
    }
    s[0] = 0;
    s[n - 1] = 1;
  }
  let err = 0;
  for (let i = 0; i < n; i++) {
    const si = s[i];
    const u = 1 - si;
    const b0 = u * u * u;
    const b1 = 3 * u * u * si;
    const b2 = 3 * u * si * si;
    const b3 = si * si * si;
    const o = (a + i) * 3;
    let sq = 0;
    for (let c = 0; c < 3; c++) {
      const d = b0 * p0[c] + b1 * p1[c] + b2 * p2[c] + b3 * p3[c] - q[o + c];
      sq += d * d;
    }
    const e = Math.sqrt(sq);
    // NaN wins numpy's max, as it does here.
    if (e > err || Number.isNaN(e)) err = e;
  }
  return { p1, p2, err };
}

/**
 * One stroke's points `q[from..to)` as few cubics as a greedy pass allows:
 * each runs from where the last ended to the furthest point it still fits
 * within `tol` (found by doubling, then bisection). Calls `emit` per curve
 * with the index of its first and last point and its inner control points.
 */
function fitStroke(
  q: Float64Array,
  from: number,
  to: number,
  tol: number,
  emit: (a: number, b: number, p1: Vec, p2: Vec) => void,
): void {
  const last = to - 1;
  if (to - from === 1) {
    const p: Vec = [q[from * 3], q[from * 3 + 1], q[from * 3 + 2]];
    emit(from, from, p, p);
    return;
  }
  let a = from;
  while (a < last) {
    let good = a + 1;
    let best: [Vec, Vec] = [
      [0, 1, 2].map((c) => q[a * 3 + c] + (q[good * 3 + c] - q[a * 3 + c]) / 3) as Vec,
      [0, 1, 2].map((c) => q[good * 3 + c] - (q[good * 3 + c] - q[a * 3 + c]) / 3) as Vec,
    ];
    let bad = -1;
    let step = 4;
    while (good < last) {
      const b = Math.min(a + step, last);
      const fit = fitCubic(q, a, b);
      if (fit.err <= tol) {
        good = b;
        best = [fit.p1, fit.p2];
        step *= 2;
      } else {
        bad = b;
        break;
      }
    }
    if (bad >= 0) {
      while (bad - good > 1) {
        const mid = Math.floor((good + bad) / 2);
        const fit = fitCubic(q, a, mid);
        if (fit.err <= tol) {
          good = mid;
          best = [fit.p1, fit.p2];
        } else {
          bad = mid;
        }
      }
    }
    emit(a, good, best[0], best[1]);
    a = good;
  }
}

/** One line's curves: `frames × channels` float32 (zero past CURVE_RAW), and each curve's stroke. */
export interface LineCurves {
  features: Float32Array;
  frames: number;
  curveStroke: Int32Array;
}

/**
 * `curves_from_features` followed by the "raw" encoding: the point frames
 * (`frames × 4`: dx, dy, dt, new stroke) summed back into points, time
 * scaled so the line lasts as long as its pen-down ink, each stroke fitted,
 * strokes joined by straight pen-up curves. `channels` (≥ CURVE_RAW) pads
 * each row with zeros, for a network whose inputs are padded to a multiple
 * of four (the SIMD kernels need it).
 */
export function curvesFromFeatures(
  f: Float32Array,
  frames: number,
  tol: number,
  channels = CURVE_RAW,
): LineCurves {
  if (channels < CURVE_RAW) throw new Error(`a curve needs ${CURVE_RAW} channels`);
  const x = new Float64Array(frames);
  const y = new Float64Array(frames);
  const t = new Float64Array(frames);
  const stroke = new Int32Array(frames);
  let cx = 0;
  let cy = 0;
  let ct = 0;
  let ns = 0;
  for (let i = 0; i < frames; i++) {
    cx += f[i * 4];
    cy += f[i * 4 + 1];
    ct += f[i * 4 + 2];
    if (f[i * 4 + 3] > 0.5) ns++;
    x[i] = cx;
    y[i] = cy;
    t[i] = ct;
    stroke[i] = Math.max(ns - 1, 0);
  }
  const starts = [0];
  for (let i = 1; i < frames; i++) if (stroke[i] !== stroke[i - 1]) starts.push(i);
  starts.push(frames);
  let ink = 0;
  for (let k = 0; k + 1 < starts.length; k++) {
    const a = starts[k];
    const b = starts[k + 1];
    const seg = new Float64Array(Math.max(b - a - 1, 0));
    for (let i = a + 1; i < b; i++) {
      // np.hypot is sqrt(x² + y²) here (numeric.ts); Math.hypot rounds differently.
      const dx = x[i] - x[i - 1];
      const dy = y[i] - y[i - 1];
      seg[i - a - 1] = Math.sqrt(dx * dx + dy * dy);
    }
    ink += npSum(seg);
  }
  const dur = t[frames - 1] - t[0];
  const k = dur > 0 && ink > 0 ? ink / dur : 1;
  const q = new Float64Array(frames * 3);
  for (let i = 0; i < frames; i++) {
    q[i * 3] = x[i];
    q[i * 3 + 1] = y[i];
    q[i * 3 + 2] = (t[i] - t[0]) * k;
  }
  const rows: number[] = [];
  const src: number[] = [];
  let prev = -1;
  for (let s = 0; s + 1 < starts.length; s++) {
    const a = starts[s];
    const b = starts[s + 1];
    if (prev >= 0) {
      const d0 = q[a * 3] - q[prev * 3];
      const d1 = q[a * 3 + 1] - q[prev * 3 + 1];
      const d2 = q[a * 3 + 2] - q[prev * 3 + 2];
      rows.push(d0, d1, d0 / 3, d1 / 3, -d0 / 3, -d1 / 3, d2, 0, 0, 1);
      src.push(stroke[a]);
    }
    fitStroke(q, a, b, tol, (i, j, p1, p2) => {
      const t0 = q[i * 3 + 2];
      const t3 = q[j * 3 + 2];
      const t1 = p1[2];
      const t2 = p2[2];
      rows.push(
        q[j * 3] - q[i * 3],
        q[j * 3 + 1] - q[i * 3 + 1],
        p1[0] - q[i * 3],
        p1[1] - q[i * 3 + 1],
        p2[0] - q[j * 3],
        p2[1] - q[j * 3 + 1],
        3 * (t1 - t0),
        3 * (t2 - 2 * t1 + t0),
        t3 - 3 * t2 + 3 * t1 - t0,
        0,
      );
      src.push(stroke[a]);
    });
    prev = b - 1;
  }
  const n = src.length;
  const features = new Float32Array(n * channels);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < CURVE_RAW; c++) features[r * channels + c] = rows[r * CURVE_RAW + c];
  }
  return { features, frames: n, curveStroke: Int32Array.from(src) };
}

/**
 * A line's network input: its point frames as they are when the model
 * reads points (`input` absent), else its curves, padded to the network's
 * `inputs` channels.
 */
export function networkInput(
  input: CurveInput | undefined,
  inputs: number,
  features: Float32Array,
  frames: number,
): { features: Float32Array; frames: number } {
  if (!input) return { features, frames };
  return curvesFromFeatures(features, frames, input.tol, inputs);
}
