/**
 * A graph's lines as geometry to draw, in value space. Pure: no DOM.
 *
 * `prepareGraph` reads and compiles a spec once (it is cheap to keep while
 * only the view or a slider moves); `sampleGraphGeometry` turns it into
 * strokes, filled polygons, region masks and dots for one view and size;
 * `canvas/graph-painter.ts` draws that. Every step is bounded: a curve by
 * its call budget (`sampleCurve`), an implicit plot by its cell count, a
 * parametric curve by its depth and budget, so a frame's cost has a ceiling
 * however wild the expressions (Joost: sliders and implicit plots must not
 * make the pop-up or the page janky).
 *
 * Implicit curves use marching squares on a grid of `cell` px (finer when
 * still, coarser while a finger moves); points of interest are found from
 * the sampled curves and refined with the calculator's Brent solver and a
 * golden-section search.
 */

import type { AngleMode } from "./calculator";
import { derivative, integrate, solveIn } from "./calculus";
import { type GraphRange, type GraphSpec, type Polyline, sampleCurve } from "./graph";
import {
  type CompiledLine,
  type GraphLine,
  type GraphSlider,
  compileLine,
  normalizeGraphSpec,
  sliderVars,
  syncSliders,
} from "./graph-lines";

/** Desmos' order of colours, for lines without one of their own. */
export const LINE_COLORS = ["#2d70b3", "#c74440", "#388c46", "#6042a6", "#e07400", "#1a1a1a"];
export const DEFAULT_LINE_WIDTH = 2.5;

/** An implicit region's coverage, one byte (0–255) per grid cell, row by row from the top. */
export interface RegionMask {
  cols: number;
  rows: number;
  alpha: Uint8Array;
}

export interface LineGeometry {
  id: string;
  color: string;
  dashed: boolean;
  width: number;
  /** The curve itself (a region's edge too). */
  strokes: Polyline[];
  /** A region's edge is dashed when its inequality is strict. */
  edgeDashed?: boolean;
  /** Closed polygons to fill, lightly (regions). */
  fills: Polyline[];
  /** An implicit region, cell by cell over the whole frame. */
  mask?: RegionMask;
  /** Points: x, y pairs. */
  dots: number[];
  /** The derivative, drawn dashed. */
  derivative?: Polyline[];
  /** The tangent at a point. */
  tangent?: { stroke: Polyline; x: number; y: number; slope: number };
  /** ∫ from a to b, shaded, with its value (null when it does not converge). */
  area?: { fills: Polyline[]; value: number | null; from: number; to: number };
}

/** A line read, compiled and coloured. */
export interface PreparedLine {
  line: GraphLine;
  compiled: CompiledLine;
  color: string;
}

export interface PreparedGraph {
  angle: AngleMode;
  lines: PreparedLine[];
  /** One per letter the lines use, values as stored. */
  sliders: GraphSlider[];
}

/** Read and compile every line of `spec`; the sliders follow the letters they use. */
export function prepareGraph(
  spec: GraphSpec,
  palette: readonly string[] = LINE_COLORS,
): PreparedGraph {
  const normal = normalizeGraphSpec(spec);
  const angle = spec.angle ?? "rad";
  const lines = normal.lines.map((line, i) => ({
    line,
    compiled: compileLine(line.text, angle),
    color: line.color ?? palette[i % palette.length],
  }));
  const sliders = syncSliders(
    normal.sliders,
    lines.map((p) => p.compiled),
  );
  return { angle, lines, sliders };
}

// --- Sampling ------------------------------------------------------------------

export interface SampleOptions {
  /** Implicit grid cell, px (default 6; larger is cheaper). */
  cell?: number;
  /** Slider values to use instead of the stored ones (a slider being dragged). */
  vars?: Map<string, number>;
}

const MAX_CELLS = 40_000;
const PARAM_BUDGET = 20_000;
const PARAM_DEPTH = 10;

/** `f` of one named variable, the others from `vars`, NaN outside the domain. */
function along(
  fn: (vars: Map<string, number>) => number,
  name: string,
  vars: Map<string, number>,
  domain?: (vars: Map<string, number>) => number,
): (v: number) => number {
  return (v) => {
    vars.set(name, v);
    if (domain && domain(vars) !== 1) return NaN;
    return fn(vars);
  };
}

/** Each line's geometry for `range` drawn at `widthPx` × `heightPx`. Hidden lines give empty geometry. */
export function sampleGraphGeometry(
  prepared: PreparedGraph,
  range: GraphRange,
  widthPx: number,
  heightPx: number,
  options: SampleOptions = {},
): LineGeometry[] {
  const w = Math.max(1, widthPx);
  const h = Math.max(1, heightPx);
  const base = options.vars ?? sliderVars(prepared.sliders);
  return prepared.lines.map(({ line, compiled, color }) => {
    const geometry: LineGeometry = {
      id: line.id,
      color,
      dashed: line.style === "dashed",
      width: line.width ?? DEFAULT_LINE_WIDTH,
      strokes: [],
      fills: [],
      dots: [],
    };
    if (line.hidden) return geometry;
    const vars = new Map(base);
    try {
      sampleLine(geometry, compiled, line, range, w, h, vars, options.cell ?? 6, prepared.angle);
    } catch {
      // A line that cannot be sampled is left out, never the graph.
    }
    return geometry;
  });
}

function sampleLine(
  geometry: LineGeometry,
  { plot, domain }: CompiledLine,
  line: GraphLine,
  range: GraphRange,
  w: number,
  h: number,
  vars: Map<string, number>,
  cell: number,
  angle: AngleMode,
): void {
  const xSpan = range.xMax - range.xMin;
  const ySpan = range.yMax - range.yMin;
  switch (plot.kind) {
    case "function": {
      const f = along(plot.f, "x", vars, domain);
      geometry.strokes = sampleCurve(f, range, w, h);
      overlays(geometry, f, line, range, w, h);
      return;
    }
    case "region": {
      const f = along(plot.f, "x", vars, domain);
      geometry.strokes = sampleCurve(f, range, w, h);
      geometry.edgeDashed = plot.strict;
      const edge = plot.below ? range.yMin - ySpan : range.yMax + ySpan;
      geometry.fills = geometry.strokes.map((poly) => [
        ...poly,
        poly[poly.length - 2],
        edge,
        poly[0],
        edge,
      ]);
      return;
    }
    case "sideways": {
      const g = along(plot.g, "y", vars, domain);
      const swapped = { xMin: range.yMin, xMax: range.yMax, yMin: range.xMin, yMax: range.xMax };
      geometry.strokes = sampleCurve(g, swapped, h, w).map(swapPairs);
      return;
    }
    case "vertical":
    case "vregion": {
      const c = plot.c(vars);
      if (!Number.isFinite(c)) return;
      const lo = range.yMin - ySpan;
      const hi = range.yMax + ySpan;
      geometry.strokes = [[c, lo, c, hi]];
      if (plot.kind === "vregion") {
        geometry.edgeDashed = plot.strict;
        const far = plot.left ? range.xMin - xSpan : range.xMax + xSpan;
        geometry.fills = [[c, lo, c, hi, far, hi, far, lo]];
      }
      return;
    }
    case "implicit":
      implicit(geometry, plot.F, plot.rel, domain, range, w, h, vars, cell);
      return;
    case "parametric": {
      const X = along(plot.X, "t", vars, domain);
      const Y = (t: number): number => {
        vars.set("t", t);
        return plot.Y(vars);
      };
      geometry.strokes = sampleParametric(X, Y, plot.from, plot.to, range, w, h);
      return;
    }
    case "polar": {
      const R = along(plot.R, "theta", vars, domain);
      const rad = (th: number): number => (angle === "deg" ? (th * Math.PI) / 180 : th);
      geometry.strokes = sampleParametric(
        (th) => R(th) * Math.cos(rad(th)),
        (th) => R(th) * Math.sin(rad(th)),
        plot.from,
        plot.to,
        range,
        w,
        h,
      );
      return;
    }
    case "points":
      for (const [X, Y] of plot.points) {
        const x = X(vars);
        const y = Y(vars);
        if (Number.isFinite(x) && Number.isFinite(y)) geometry.dots.push(x, y);
      }
      return;
    default:
      return;
  }
}

function swapPairs(poly: Polyline): Polyline {
  const out: number[] = new Array<number>(poly.length);
  for (let i = 0; i + 1 < poly.length; i += 2) {
    out[i] = poly[i + 1];
    out[i + 1] = poly[i];
  }
  return out;
}

/** Derivative, tangent and area of a function of x, as the line asks. */
function overlays(
  geometry: LineGeometry,
  f: (x: number) => number,
  line: GraphLine,
  range: GraphRange,
  w: number,
  h: number,
): void {
  const ySpan = range.yMax - range.yMin;
  if (line.derivative) {
    const d = (x: number): number => {
      const s = 1e-5 * Math.max(1, Math.abs(x));
      return (f(x + s) - f(x - s)) / (2 * s);
    };
    geometry.derivative = sampleCurve(d, range, w, h);
  }
  if (line.tangentAt !== undefined) {
    const x0 = line.tangentAt;
    const y0 = f(x0);
    const slope = derivative(f, x0);
    if (Number.isFinite(y0) && slope.ok) {
      const xSpan = range.xMax - range.xMin;
      const a = range.xMin - xSpan;
      const b = range.xMax + xSpan;
      const clamp = (y: number): number =>
        Math.max(range.yMin - 4 * ySpan, Math.min(range.yMax + 4 * ySpan, y));
      geometry.tangent = {
        stroke: [a, clamp(y0 + slope.value * (a - x0)), b, clamp(y0 + slope.value * (b - x0))],
        x: x0,
        y: y0,
        slope: slope.value,
      };
    }
  }
  if (line.area) {
    const [from, to] = line.area[0] <= line.area[1] ? line.area : [line.area[1], line.area[0]];
    const width = Math.max(16, (w * (to - from)) / (range.xMax - range.xMin));
    const pieces = to > from ? sampleCurve(f, { ...range, xMin: from, xMax: to }, width, h) : [];
    // sampleCurve reaches a step past each end; keep the shading inside [from, to].
    const fills = pieces
      .map((poly) => clipX(poly, from, to))
      .filter((poly) => poly.length >= 4)
      .map((poly) => [...poly, poly[poly.length - 2], 0, poly[0], 0]);
    const value = integrate(f, from, to);
    geometry.area = { fills, value: value.ok ? value.value : null, from, to };
  }
}

/** The part of a polyline with from ≤ x ≤ to, ends interpolated onto the bounds. */
function clipX(poly: Polyline, from: number, to: number): Polyline {
  const out: number[] = [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    const x = poly[i];
    const y = poly[i + 1];
    if (x >= from && x <= to) {
      if (out.length === 0 && i > 0 && poly[i - 2] < from) {
        const t = (from - poly[i - 2]) / (x - poly[i - 2]);
        out.push(from, poly[i - 1] + t * (y - poly[i - 1]));
      }
      out.push(x, y);
    } else if (x > to && out.length > 0) {
      const px = poly[i - 2];
      const t = (to - px) / (x - px);
      out.push(to, poly[i - 1] + t * (y - poly[i - 1]));
      break;
    }
  }
  return out;
}

/**
 * A curve (X(t), Y(t)) for t in [from, to]: a first pass of 200 steps,
 * halved where a piece bends by more than half a pixel or spans more than
 * 24 px, broken where it leaves its domain or jumps.
 */
export function sampleParametric(
  X: (t: number) => number,
  Y: (t: number) => number,
  from: number,
  to: number,
  range: GraphRange,
  w: number,
  h: number,
): Polyline[] {
  const kx = w / (range.xMax - range.xMin);
  const ky = h / (range.yMax - range.yMin);
  const lines: Polyline[] = [];
  let line: number[] = [];
  let calls = 0;
  const at = (t: number): [number, number] => {
    calls++;
    const x = X(t);
    const y = Y(t);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : [NaN, NaN];
  };
  const breakLine = (): void => {
    if (line.length >= 4) lines.push(line);
    line = [];
  };
  const xPad = range.xMax - range.xMin;
  const yPad = range.yMax - range.yMin;
  const offSameSide = (...ps: Array<[number, number]>): boolean =>
    ps.every((p) => p[0] < range.xMin - xPad) ||
    ps.every((p) => p[0] > range.xMax + xPad) ||
    ps.every((p) => p[1] < range.yMin - yPad) ||
    ps.every((p) => p[1] > range.yMax + yPad);
  const piece = (
    t0: number,
    p0: [number, number],
    t1: number,
    p1: [number, number],
    depth: number,
  ): void => {
    const ok0 = !Number.isNaN(p0[0]);
    const ok1 = !Number.isNaN(p1[0]);
    const tm = (t0 + t1) / 2;
    const pm = at(tm);
    const bottom = depth >= PARAM_DEPTH || calls > PARAM_BUDGET;
    if (ok0 && ok1 && !Number.isNaN(pm[0])) {
      // Far off the same side of the view: nothing there to refine.
      if (offSameSide(p0, p1, pm)) {
        if (line.length === 0) line.push(p0[0], p0[1]);
        line.push(p1[0], p1[1]);
        return;
      }
      const dx = (p1[0] - p0[0]) * kx;
      const dy = (p1[1] - p0[1]) * ky;
      const chord = Math.hypot(dx, dy);
      // Distance of the midpoint from the chord, in px.
      const mx = (pm[0] - p0[0]) * kx;
      const my = (pm[1] - p0[1]) * ky;
      const bend = chord > 0 ? Math.abs(mx * dy - my * dx) / chord : Math.hypot(mx, my);
      if ((bend <= 0.5 && chord <= 24) || bottom) {
        if (bottom && chord > 2 * (w + h)) breakLine();
        if (line.length === 0) line.push(p0[0], p0[1]);
        line.push(p1[0], p1[1]);
        return;
      }
    } else if (bottom) {
      breakLine();
      if (ok1) line.push(p1[0], p1[1]);
      return;
    }
    piece(t0, p0, tm, pm, depth + 1);
    piece(tm, pm, t1, p1, depth + 1);
  };
  if (!(to > from) || !Number.isFinite(from) || !Number.isFinite(to)) return [];
  const steps = 200;
  let t0 = from;
  let p0 = at(t0);
  for (let i = 1; i <= steps; i++) {
    const t1 = from + ((to - from) * i) / steps;
    const p1 = at(t1);
    piece(t0, p0, t1, p1, 0);
    t0 = t1;
    p0 = p1;
  }
  breakLine();
  return lines;
}

/**
 * An implicit curve F(x, y) = 0 by marching squares, or a region where
 * F(x, y) holds `rel` 0 (its cells' coverage plus its edge). Cells where F
 * changes sign through a pole (much larger at the centre than at the
 * corners) draw no edge.
 */
function implicit(
  geometry: LineGeometry,
  F: (vars: Map<string, number>) => number,
  rel: string,
  domain: ((vars: Map<string, number>) => number) | undefined,
  range: GraphRange,
  w: number,
  h: number,
  vars: Map<string, number>,
  cellPx: number,
): void {
  let cell = Math.max(2, cellPx);
  while ((w / cell) * (h / cell) > MAX_CELLS) cell *= 1.5;
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const dx = (range.xMax - range.xMin) / cols;
  const dy = (range.yMax - range.yMin) / rows;
  const at = (x: number, y: number): number => {
    vars.set("x", x);
    vars.set("y", y);
    if (domain && domain(vars) !== 1) return NaN;
    const v = F(vars);
    return Number.isFinite(v) ? v : NaN;
  };
  const stride = cols + 1;
  const values = new Float64Array(stride * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    const y = range.yMax - j * dy;
    for (let i = 0; i <= cols; i++) values[j * stride + i] = at(range.xMin + i * dx, y);
  }
  const holds = (v: number): boolean => {
    switch (rel) {
      case "<":
        return v < 0;
      case "<=":
        return v <= 0;
      case ">":
        return v > 0;
      case ">=":
        return v >= 0;
      default:
        return false;
    }
  };
  const region = rel !== "=";
  if (region) {
    const alpha = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const corners = [
          values[j * stride + i],
          values[j * stride + i + 1],
          values[(j + 1) * stride + i],
          values[(j + 1) * stride + i + 1],
        ];
        let inside = 0;
        for (const v of corners) if (!Number.isNaN(v) && holds(v)) inside++;
        alpha[j * cols + i] = Math.round((inside / 4) * 255);
      }
    }
    geometry.mask = { cols, rows, alpha };
    geometry.edgeDashed = rel === "<" || rel === ">";
  }
  const segments: Polyline[] = [];
  const cross = (
    x0: number,
    y0: number,
    v0: number,
    x1: number,
    y1: number,
    v1: number,
  ): [number, number] => {
    const t = v0 / (v0 - v1);
    return [x0 + t * (x1 - x0), y0 + t * (y1 - y0)];
  };
  // Rows from their index, so two cells sharing an edge compute it alike (and their segments join).
  const yRow = (j: number): number => range.yMax - j * dy;
  const xCol = (i: number): number => range.xMin + i * dx;
  for (let j = 0; j < rows; j++) {
    const yTop = yRow(j);
    const yBot = yRow(j + 1);
    for (let i = 0; i < cols; i++) {
      const tl = values[j * stride + i];
      const tr = values[j * stride + i + 1];
      const bl = values[(j + 1) * stride + i];
      const br = values[(j + 1) * stride + i + 1];
      if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(bl) || Number.isNaN(br)) continue;
      const index = (tl > 0 ? 8 : 0) | (tr > 0 ? 4 : 0) | (br > 0 ? 2 : 0) | (bl > 0 ? 1 : 0);
      if (index === 0 || index === 15) continue;
      const xL = xCol(i);
      const xR = xCol(i + 1);
      const centre = at(xL + dx / 2, yTop - dy / 2);
      const largest = Math.max(Math.abs(tl), Math.abs(tr), Math.abs(bl), Math.abs(br));
      if (!Number.isFinite(centre) || Math.abs(centre) > 4 * largest + 1e-12) continue;
      const top = (): [number, number] => cross(xL, yTop, tl, xR, yTop, tr);
      const right = (): [number, number] => cross(xR, yTop, tr, xR, yBot, br);
      const bottom = (): [number, number] => cross(xL, yBot, bl, xR, yBot, br);
      const left = (): [number, number] => cross(xL, yTop, tl, xL, yBot, bl);
      const seg = (a: [number, number], b: [number, number]): void => {
        // A curve through a grid node exactly makes a zero-length piece there: nothing to draw.
        if (a[0] !== b[0] || a[1] !== b[1]) segments.push([a[0], a[1], b[0], b[1]]);
      };
      switch (index) {
        case 1:
        case 14:
          seg(left(), bottom());
          break;
        case 2:
        case 13:
          seg(bottom(), right());
          break;
        case 3:
        case 12:
          seg(left(), right());
          break;
        case 4:
        case 11:
          seg(top(), right());
          break;
        case 6:
        case 9:
          seg(top(), bottom());
          break;
        case 7:
        case 8:
          seg(left(), top());
          break;
        case 5:
        case 10: {
          // A saddle: the centre's sign decides which corners join.
          const joined = centre > 0 === (index === 5);
          if (joined) {
            seg(left(), top());
            seg(bottom(), right());
          } else {
            seg(left(), bottom());
            seg(top(), right());
          }
          break;
        }
      }
    }
  }
  geometry.strokes = joinSegments(segments);
}

/** Segments that share end points, joined into longer polylines (fewer subpaths, round joins). */
function joinSegments(segments: Polyline[]): Polyline[] {
  if (segments.length === 0) return [];
  const key = (x: number, y: number): string => `${x.toPrecision(10)},${y.toPrecision(10)}`;
  const byEnd = new Map<string, number[]>();
  segments.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const list = byEnd.get(k);
      if (list) list.push(i);
      else byEnd.set(k, [i]);
    }
  });
  const used = new Uint8Array(segments.length);
  const out: Polyline[] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const line = [...segments[start]];
    // Grow forwards from the tail, then backwards from the head.
    for (const forwards of [true, false]) {
      for (;;) {
        const x = forwards ? line[line.length - 2] : line[0];
        const y = forwards ? line[line.length - 1] : line[1];
        const next = (byEnd.get(key(x, y)) ?? []).find((i) => !used[i]);
        if (next === undefined) break;
        used[next] = 1;
        const s = segments[next];
        const sameStart = key(s[0], s[1]) === key(x, y);
        const [nx, ny] = sameStart ? [s[2], s[3]] : [s[0], s[1]];
        if (forwards) line.push(nx, ny);
        else line.unshift(nx, ny);
      }
    }
    out.push(line);
  }
  return out;
}

// --- Points of interest ------------------------------------------------------------

export type PoiKind = "root" | "max" | "min" | "intercept" | "intersection";

export interface Poi {
  x: number;
  y: number;
  kind: PoiKind;
  /** The line ids it lies on. */
  lines: string[];
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** The x of f's maximum (or minimum) in [a, b], by golden-section search. */
function extremum(f: (x: number) => number, a: number, b: number, max: boolean): number {
  const g = (x: number): number => (max ? -f(x) : f(x));
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  for (let i = 0; i < 60; i++) {
    if (g(c) < g(d)) b = d;
    else a = c;
    c = b - GOLDEN * (b - a);
    d = a + GOLDEN * (b - a);
  }
  return (a + b) / 2;
}

const MAX_POIS = 60;

/**
 * Roots, maxima, minima and the y-intercept of each visible function of x,
 * and where two of them cross: the grey dots a tap reads. Found from the
 * curves as sampled for this view, so only what is in view; at most
 * {@link MAX_POIS}.
 */
export function pointsOfInterest(
  prepared: PreparedGraph,
  range: GraphRange,
  geometry: readonly LineGeometry[],
  options: SampleOptions = {},
): Poi[] {
  const base = options.vars ?? sliderVars(prepared.sliders);
  const pois: Poi[] = [];
  const xSpan = range.xMax - range.xMin;
  const ySpan = range.yMax - range.yMin;
  const inView = (x: number, y: number): boolean =>
    x >= range.xMin && x <= range.xMax && y >= range.yMin && y <= range.yMax;
  const add = (p: Poi): void => {
    if (pois.length >= MAX_POIS || !inView(p.x, p.y)) return;
    const near = pois.find(
      (q) => Math.abs(q.x - p.x) < 1e-6 * xSpan && Math.abs(q.y - p.y) < 1e-6 * ySpan,
    );
    if (near) {
      for (const id of p.lines) if (!near.lines.includes(id)) near.lines.push(id);
      return;
    }
    pois.push(p);
  };
  const functions: Array<{ id: string; f: (x: number) => number }> = [];
  prepared.lines.forEach(({ line, compiled }, index) => {
    if (line.hidden || compiled.plot.kind !== "function") return;
    const f = along(compiled.plot.f, "x", new Map(base), compiled.domain);
    functions.push({ id: line.id, f });
    for (const poly of geometry[index]?.strokes ?? []) {
      for (let i = 0; i + 3 < poly.length; i += 2) {
        const xa = poly[i];
        const ya = poly[i + 1];
        const xb = poly[i + 2];
        const yb = poly[i + 3];
        if (ya === 0) add({ x: xa, y: 0, kind: "root", lines: [line.id] });
        else if (ya * yb < 0) {
          const r = solveIn(f, xa, xb);
          if (r.ok) add({ x: r.value, y: 0, kind: "root", lines: [line.id] });
        }
        if (i + 5 < poly.length) {
          const yc = poly[i + 5];
          const rising = yb - ya;
          const falling = yc - yb;
          if (rising * falling < 0) {
            const max = rising > 0;
            const x = extremum(f, xa, poly[i + 4], max);
            const y = f(x);
            if (Number.isFinite(y)) add({ x, y, kind: max ? "max" : "min", lines: [line.id] });
          }
        }
      }
    }
  });
  // The y-intercepts last: a root or an extremum on the axis keeps its own name.
  for (const { id, f } of functions) {
    const y0 = f(0);
    if (Number.isFinite(y0)) add({ x: 0, y: y0, kind: "intercept", lines: [id] });
  }
  // Where two functions cross.
  const steps = 400;
  for (let i = 0; i < functions.length; i++) {
    for (let j = i + 1; j < functions.length; j++) {
      const { f: fa, id: ia } = functions[i];
      const { f: fb, id: ib } = functions[j];
      const g = (x: number): number => fa(x) - fb(x);
      let x0 = range.xMin;
      let g0 = g(x0);
      for (let k = 1; k <= steps; k++) {
        const x1 = range.xMin + (xSpan * k) / steps;
        const g1 = g(x1);
        if (Number.isFinite(g0) && Number.isFinite(g1) && g0 * g1 <= 0) {
          const r = solveIn(g, x0, x1);
          if (r.ok) {
            const y = fa(r.value);
            if (Number.isFinite(y)) add({ x: r.value, y, kind: "intersection", lines: [ia, ib] });
          }
        }
        x0 = x1;
        g0 = g1;
      }
    }
  }
  return pois;
}

/** The y of a function line at x (for a trace or a pin), NaN when it is not one or not defined there. */
export function valueOfLine(
  prepared: PreparedGraph,
  id: string,
  x: number,
  vars?: Map<string, number>,
): number {
  const entry = prepared.lines.find((p) => p.line.id === id);
  if (!entry || entry.compiled.plot.kind !== "function") return NaN;
  const f = along(
    entry.compiled.plot.f,
    "x",
    new Map(vars ?? sliderVars(prepared.sliders)),
    entry.compiled.domain,
  );
  return f(x);
}

/** A few rows of x and f(x) around the middle of the view, at a round step. */
export function tableOfValues(
  prepared: PreparedGraph,
  id: string,
  range: GraphRange,
  rows = 7,
): Array<{ x: number; y: number }> {
  const span = range.xMax - range.xMin;
  const raw = span / 10;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const mid = Math.round((range.xMin + span / 2) / step) * step;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < rows; i++) {
    const x = Number((mid + (i - Math.floor(rows / 2)) * step).toPrecision(12));
    out.push({ x, y: valueOfLine(prepared, id, x) });
  }
  return out;
}
