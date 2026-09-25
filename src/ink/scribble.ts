/**
 * Scribble to erase, GoodNotes 6's pen gesture: scribble over writing with
 * the pen and the writing is erased, the scribble with it.
 *
 * Pure: no DOM, no Obsidian.
 *
 * GoodNotes recognises the gesture with a trained model. This is geometry,
 * and every gate is there to refuse something a pen draws on purpose:
 *
 * - A scribble goes back and forth. Projected on its dominant direction (the
 *   axis its segments run along, sign ignored), it reverses at least
 *   {@link MIN_REVERSALS} times: a strike-through, a "W" or a "V" do not.
 * - Its turns are hairpins ({@link HAIRPIN_DEG}). Writing that goes up and
 *   down ("mmm", "nnn", "uuu") turns round over an arch at every other
 *   reversal, and a word circled a few times turns smoothly at its ends, so
 *   {@link HAIRPIN_SHARE} of the reversals must be hairpins.
 * - Its passes overlap: each one spans most of the scribble's width, once
 *   the drift of slanted passes moving across a word is taken out.
 * - It moves on rather than going round. Each pass steps aside from the
 *   last; a zigzag or a sawtooth keeps stepping the same way (and turns
 *   back at most where the scribble does), while a word circled two or
 *   three times — even in a loop thin enough that its ends read as
 *   hairpins — steps out and back every time ({@link MAX_LOOPING}). Loopy
 *   "coil" scribbles are refused with it: a scribble that fails leaves ink,
 *   which is the safe way to be wrong.
 *
 * What a scribble covers is the hull of every two passes that follow one
 * another: the band the pen swept between them. The caller erases a stroke
 * when most of its length lies there ({@link SCRIBBLE_COVERAGE}), and only
 * if something is covered at all; a scribble over empty paper is ink.
 */

import { type Bounds, type Stroke, POINT_STRIDE } from "../model/document";

/** Fewest reversals a scribble makes: five passes. */
export const MIN_REVERSALS = 4;
/** A reversal is a hairpin when the pen's heading turns at least this far, degrees. */
export const HAIRPIN_DEG = 135;
/** Share of the reversals that must be hairpins. */
export const HAIRPIN_SHARE = 0.75;
/**
 * A move back of this share of the scribble's extent is a reversal. Smaller
 * wobbles are tremor within a pass.
 */
export const REVERSAL_SHARE = 0.3;
/** The median whole pass spans at least this share of the scribble's extent. */
export const MIN_OVERLAP = 0.5;
/**
 * Looping, at most: see {@link ScribbleMeasure.looping}. Measured: Joost's
 * 15 real scribbles traced from an iPad recording 0.00-0.27; synthetic
 * zigzags, sawtooths and rubbing 0.00-0.06; loops circled round a word
 * (1:1 to 6:1) 0.81-0.95, coils 0.70-0.82, a spiral 0.93.
 */
export const MAX_LOOPING = 0.5;
/**
 * What each pair of steps adds to the total regardless, as a share of the
 * extent: rubbing to and fro along one line steps no way at all, and its
 * few tremor-sized steps must not count as going round.
 */
const LOOPING_FLOOR = 0.03;
/**
 * The window a hairpin is measured over, as a share of the shorter pass on
 * either side: long enough to see through tremor, short enough that the
 * legs of a zigzag read as legs.
 */
const HAIRPIN_WINDOW = 0.25;
/** Share of a stroke's length a scribble must cover to erase it. */
export const SCRIBBLE_COVERAGE = 0.5;
/** Most points the detector reads; a longer scribble is resampled coarser. */
const MAX_SAMPLES = 800;
/** Points along a stroke the coverage rule reads. */
const COVERAGE_SAMPLES = 48;

export interface ScribbleOptions {
  /**
   * The longer side of the smallest scribble, page px. The caller scales an
   * on-screen length, so a scribble is judged by how big it looks.
   */
  minSize: number;
}

/** What the detector measured, gates aside: for tests and the debug HUD. */
export interface ScribbleMeasure {
  /** Times the pen reversed along the scribble's direction. */
  reversals: number;
  /** How many of those turned the pen round (a hairpin, not an arch). */
  hairpins: number;
  /** Median whole pass's extent along the scribble's direction, over the whole extent. */
  overlap: number;
  /** Longer side of the bounds, page px. */
  size: number;
  /**
   * Near 0 when each pass steps aside the same way as the one before (a
   * zigzag, a sawtooth), near 1 when every step goes back the way the last
   * one came (loops). Each pair of steps counts by the smaller step, over
   * the scribble's extent. Was `winding`, which read a sawtooth as loops.
   */
  looping: number;
}

/** One pair of consecutive passes: its convex hull, flat `[x, y, …]`, counter-clockwise. */
interface Region {
  hull: number[];
  bounds: Bounds;
}

export interface Scribble {
  bounds: Bounds;
  regions: readonly Region[];
  measure: ScribbleMeasure;
}

/** Read the stroke as a scribble, or `null` when it is not one. */
export function detectScribble(pts: readonly number[], options: ScribbleOptions): Scribble | null {
  const read = readScribble(pts, options);
  if (!read) return null;
  const { measure, r, cuts } = read;
  if (measure.size < options.minSize) return null;
  if (measure.reversals < MIN_REVERSALS) return null;
  if (measure.hairpins < HAIRPIN_SHARE * measure.reversals) return null;
  if (measure.overlap < MIN_OVERLAP) return null;
  if (measure.looping > MAX_LOOPING) return null;
  // What it covers: the hull of every two passes that follow one another.
  const regions: Region[] = [];
  for (let k = 0; k + 2 < cuts.length; k++) {
    const hull = convexHull(r, cuts[k], cuts[k + 2]);
    regions.push({ hull, bounds: boundsOf(hull) });
  }
  return { bounds: read.bounds, regions, measure };
}

/** The detector's measurements without its verdict; `null` for a stroke too short to read. */
export function measureScribble(
  pts: readonly number[],
  options: ScribbleOptions,
): ScribbleMeasure | null {
  return readScribble(pts, options)?.measure ?? null;
}

/** The resampled stroke, where its passes meet, and what was measured on it. */
interface Reading {
  /** The stroke walked at a fixed spacing, flat `[x, y, …]`. */
  r: number[];
  /** Indices into `r`: the start, every reversal, the end. */
  cuts: number[];
  bounds: Bounds;
  measure: ScribbleMeasure;
}

function readScribble(pts: readonly number[], options: ScribbleOptions): Reading | null {
  const xy = polylineXY(pts);
  if (xy.length < 8) return null;
  let length = 0;
  for (let i = 2; i < xy.length; i += 2) {
    length += Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]);
  }
  const step = Math.max(options.minSize / 16, length / MAX_SAMPLES, 1e-3);
  const r = resampleXY(xy, step);
  const n = r.length / 2;
  if (n < 8) return null;
  const bounds = boundsOf(r);
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  // The dominant direction: the structure tensor of the segments, so a pass
  // one way and the next pass back count alike.
  let jxx = 0;
  let jxy = 0;
  let jyy = 0;
  for (let i = 1; i < n; i++) {
    const dx = r[2 * i] - r[2 * i - 2];
    const dy = r[2 * i + 1] - r[2 * i - 1];
    jxx += dx * dx;
    jxy += dx * dy;
    jyy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
  const ax = Math.cos(theta);
  const ay = Math.sin(theta);
  // Where each point is along the passes (s) and across them (t).
  const s = new Array<number>(n);
  const t = new Array<number>(n);
  let meanS = 0;
  let meanT = 0;
  for (let i = 0; i < n; i++) {
    s[i] = r[2 * i] * ax + r[2 * i + 1] * ay;
    t[i] = -r[2 * i] * ay + r[2 * i + 1] * ax;
    meanS += s[i] / n;
    meanT += t[i] / n;
  }
  // Slanted passes drift along their own direction as the scribble moves
  // across a word: at 60° to the line of writing, a scribble three passes
  // long spans 2.5 pass lengths along the passes. Take out the drift that
  // goes with moving across (least squares of s on t), so each pass is
  // measured against its neighbours, not against the drift (Joost's
  // recording, 2026-09-25: every refused scribble was refused for this).
  let cov = 0;
  let varT = 0;
  for (let i = 0; i < n; i++) {
    cov += (s[i] - meanS) * (t[i] - meanT);
    varT += (t[i] - meanT) ** 2;
  }
  const drift = varT > 0 ? cov / varT : 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    s[i] -= drift * (t[i] - meanT);
    lo = Math.min(lo, s[i]);
    hi = Math.max(hi, s[i]);
  }
  const extent = hi - lo;
  if (!(extent > 0)) return null;

  const turns = reversalsOf(s, REVERSAL_SHARE * extent);
  const cuts = [0, ...turns, n - 1];

  let hairpins = 0;
  for (let k = 0; k < turns.length; k++) {
    const apex = turns[k];
    const shorter = Math.min(cuts[k + 1] - cuts[k], cuts[k + 2] - cuts[k + 1]);
    const w = Math.max(2, Math.floor(HAIRPIN_WINDOW * shorter));
    const i0 = Math.max(0, apex - w);
    const i1 = Math.min(n - 1, apex + w);
    const bx = r[2 * apex] - r[2 * i0];
    const by = r[2 * apex + 1] - r[2 * i0 + 1];
    const cx = r[2 * i1] - r[2 * apex];
    const cy = r[2 * i1 + 1] - r[2 * apex + 1];
    const norms = Math.hypot(bx, by) * Math.hypot(cx, cy);
    if (!(norms > 0)) continue;
    const cos = Math.max(-1, Math.min(1, (bx * cx + by * cy) / norms));
    if ((Math.acos(cos) * 180) / Math.PI >= HAIRPIN_DEG) hairpins++;
  }

  // Whole passes only: the first and the last may stop anywhere.
  const spans: number[] = [];
  for (let k = 1; k + 1 < cuts.length - 1; k++) {
    spans.push(Math.abs(s[cuts[k + 1]] - s[cuts[k]]));
  }
  const overlap = spans.length > 0 ? median(spans) / extent : 0;

  // Where each pass lies across the scribble, and how each steps from the
  // last. A zigzag's passes step one way (a sawtooth's too, one step short
  // and one long); loops step out and back, every time. Not read off the
  // pen's heading, which has no side at a turn of exactly 180°.
  const side: number[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    let sum = 0;
    for (let i = cuts[k]; i <= cuts[k + 1]; i++) sum += t[i];
    side.push(sum / (cuts[k + 1] - cuts[k] + 1));
  }
  let back = 0;
  let pairs = LOOPING_FLOOR * Math.max(0, turns.length - 1);
  for (let k = 0; k + 1 < turns.length; k++) {
    const step = (side[k + 1] - side[k]) / extent;
    const next = (side[k + 2] - side[k + 1]) / extent;
    const weight = Math.min(Math.abs(step), Math.abs(next));
    pairs += weight;
    if (step * next < 0) back += weight;
  }
  const looping = pairs > 0 ? back / pairs : 0;

  return {
    r,
    cuts,
    bounds,
    measure: { reversals: turns.length, hairpins, overlap, size, looping },
  };
}

/**
 * Where a projected path turns back, with hysteresis: a move back of at
 * least `band` from the running extreme reverses it, at that extreme.
 */
function reversalsOf(s: readonly number[], band: number): number[] {
  const turns: number[] = [];
  let dir = 0;
  let ext = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < s.length; i++) {
    if (dir === 0) {
      if (s[i] > s[hi]) hi = i;
      if (s[i] < s[lo]) lo = i;
      if (s[hi] - s[lo] >= band) {
        // Heading toward whichever extreme came later.
        dir = hi > lo ? 1 : -1;
        ext = hi > lo ? hi : lo;
      }
      continue;
    }
    if (dir > 0) {
      if (s[i] >= s[ext]) ext = i;
      else if (s[ext] - s[i] >= band) {
        turns.push(ext);
        dir = -1;
        ext = i;
      }
    } else if (s[i] <= s[ext]) ext = i;
    else if (s[i] - s[ext] >= band) {
      turns.push(ext);
      dir = 1;
      ext = i;
    }
  }
  return turns;
}

/**
 * The share of a stroke's length (`[x, y, p, …]`) the scribble covers: read
 * at evenly spaced points, each covered when it lies in a region or within
 * `margin` of one. A stroke that never moves is all covered or none.
 */
export function scribbleCoverage(
  scribble: Scribble,
  pts: readonly number[],
  margin: number,
): number {
  const xy = polylineXY(pts);
  if (xy.length === 0) return 0;
  let length = 0;
  for (let i = 2; i < xy.length; i += 2) {
    length += Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]);
  }
  if (!(length > 0)) return covered(scribble, xy[0], xy[1], margin) ? 1 : 0;
  let inside = 0;
  let seg = 2;
  let walked = 0;
  let segLength = Math.hypot(xy[2] - xy[0], xy[3] - xy[1]);
  for (let k = 0; k < COVERAGE_SAMPLES; k++) {
    const target = ((k + 0.5) / COVERAGE_SAMPLES) * length;
    while (walked + segLength < target && seg + 2 < xy.length) {
      walked += segLength;
      seg += 2;
      segLength = Math.hypot(xy[seg] - xy[seg - 2], xy[seg + 1] - xy[seg - 1]);
    }
    const t = segLength > 0 ? Math.min(1, (target - walked) / segLength) : 0;
    const x = xy[seg - 2] + (xy[seg] - xy[seg - 2]) * t;
    const y = xy[seg - 1] + (xy[seg + 1] - xy[seg - 1]) * t;
    if (covered(scribble, x, y, margin)) inside++;
  }
  return inside / COVERAGE_SAMPLES;
}

/**
 * Whether a scribble may erase this stroke. Handwriting always; shapes,
 * tables and highlighter ink only with "Erase shapes and highlighter" on.
 */
export function scribbleMayErase(stroke: Pick<Stroke, "tool" | "shape">, all: boolean): boolean {
  if (all) return true;
  return stroke.tool === "pen" && stroke.shape === undefined;
}

function covered(scribble: Scribble, x: number, y: number, margin: number): boolean {
  for (const { hull, bounds } of scribble.regions) {
    if (
      x < bounds.minX - margin ||
      x > bounds.maxX + margin ||
      y < bounds.minY - margin ||
      y > bounds.maxY + margin
    ) {
      continue;
    }
    if (insideConvex(hull, x, y) || distanceToPolygon(hull, x, y) <= margin) return true;
  }
  return false;
}

/** `[x, y, p, …]` as `[x, y, …]`, without repeats; whole points only. */
function polylineXY(pts: readonly number[]): number[] {
  const usable = pts.length - (pts.length % POINT_STRIDE);
  const out: number[] = [];
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const x = pts[i];
    const y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const m = out.length;
    if (m > 0 && out[m - 2] === x && out[m - 1] === y) continue;
    out.push(x, y);
  }
  return out;
}

/** Walk a flat `[x, y, …]` polyline at a fixed spacing. */
function resampleXY(xy: readonly number[], step: number): number[] {
  const out = [xy[0], xy[1]];
  let carry = 0;
  for (let i = 2; i < xy.length; i += 2) {
    const ax = xy[i - 2];
    const ay = xy[i - 1];
    const seg = Math.hypot(xy[i] - ax, xy[i + 1] - ay);
    if (seg === 0) continue;
    let t = step - carry;
    while (t <= seg) {
      out.push(ax + ((xy[i] - ax) * t) / seg, ay + ((xy[i + 1] - ay) * t) / seg);
      t += step;
    }
    carry = (carry + seg) % step;
  }
  const lx = xy[xy.length - 2];
  const ly = xy[xy.length - 1];
  if (out[out.length - 2] !== lx || out[out.length - 1] !== ly) out.push(lx, ly);
  return out;
}

function boundsOf(xy: readonly number[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < xy.length; i += 2) {
    minX = Math.min(minX, xy[i]);
    maxX = Math.max(maxX, xy[i]);
    minY = Math.min(minY, xy[i + 1]);
    maxY = Math.max(maxY, xy[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Convex hull of points `from..to` (inclusive) of a flat polyline, counter-clockwise. */
function convexHull(xy: readonly number[], from: number, to: number): number[] {
  const pts: Array<[number, number]> = [];
  for (let i = from; i <= to; i++) pts.push([xy[2 * i], xy[2 * i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts.flat();
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper].flat();
}

/** Inside a counter-clockwise convex polygon (flat), edges included. Fewer than three vertices: never. */
function insideConvex(hull: readonly number[], x: number, y: number): boolean {
  const n = hull.length / 2;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = hull[2 * j] - hull[2 * i];
    const ey = hull[2 * j + 1] - hull[2 * i + 1];
    if (ex * (y - hull[2 * i + 1]) - ey * (x - hull[2 * i]) < 0) return false;
  }
  return true;
}

/** Distance from a point to a polygon's outline (or to a point or segment, when it is one). */
function distanceToPolygon(poly: readonly number[], x: number, y: number): number {
  const n = poly.length / 2;
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(poly[0] - x, poly[1] - y);
  let best = Infinity;
  const edges = n === 2 ? 1 : n;
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % n;
    best = Math.min(
      best,
      distanceToSegment(x, y, poly[2 * i], poly[2 * i + 1], poly[2 * j], poly[2 * j + 1]),
    );
  }
  return best;
}

function distanceToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}
