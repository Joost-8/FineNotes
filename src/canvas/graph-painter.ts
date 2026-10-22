/**
 * Draws a sampled graph into a canvas: grid, axes, tick labels, then each
 * line's regions, curves, overlays and points, then points of interest,
 * pins and a traced point. Canvas only, no DOM and no Obsidian, so the
 * calculator's pop-up and a page tile can both use it.
 *
 * Two ways in: {@link paintGraph} takes plain polylines per expression
 * (version 1 graphs), {@link paintGraphGeometry} the full
 * `LineGeometry` of `model/graph-sample.ts` (regions, implicit masks,
 * dashes, widths, the derivative, tangents, areas, points).
 *
 * Everything is placed in `frame`, in the context's current units; `unit`
 * is how many of those make one CSS pixel, and scales every line width,
 * gap and font. Colours must be resolved strings: a canvas does not read
 * `var(--…)` (CLAUDE.md, "CSS variables do not work in any canvas string
 * property").
 */

import {
  type GraphRange,
  type GraphSpec,
  type Polyline,
  formatTick,
  minorStep,
  niceTicks,
  toScreen,
} from "../model/graph";
import {
  type LineGeometry,
  type Poi,
  type PreparedGraph,
  type RegionMask,
  prepareGraph,
  sampleGraphGeometry,
  valueOfLine,
} from "../model/graph-sample";

export interface GraphColors {
  /** Filled under everything; left transparent when absent. */
  background?: string;
  grid: string;
  axis: string;
  label: string;
  /** One per expression, used in turn (version 1 graphs, and a trace by index). */
  curves: readonly string[];
  /** Points of interest (grey dots); the label colour when absent. */
  poi?: string;
}

export interface GraphTrace {
  x: number;
  y: number;
  label: string;
  /** The traced line's colour, or its index into `colors.curves`. */
  color?: string;
  curve?: number;
}

export interface GraphPaintOptions {
  colors: GraphColors;
  /** Grid lines at the ticks (default on). */
  grid?: boolean;
  /** Numbers along the axes (default on). */
  labels?: boolean;
  /** x ticks at multiples of π, labelled π/2, π, 3π/2 … */
  piTicks?: boolean;
  /** Context units per CSS pixel (default 1). */
  unit?: number;
  /** A font family for the labels (a real name, not a variable). */
  fontFamily?: string;
  /** A traced point, with its label. */
  trace?: GraphTrace;
  /** Rings: roots, extrema, intercepts, intersections (the selected line's only, in the calculator). */
  pois?: readonly Poi[];
  /** Pinned points, each with its colour and label; a named one shows only its name. */
  pins?: ReadonlyArray<{ x: number; y: number; color: string; label: string; name?: string }>;
  /** The selected line's id: drawn heavier, with a soft halo in its colour. */
  selected?: string;
  /** Faint lines between the grid's major lines (default on, with the grid). */
  minorGrid?: boolean;
  /** How to make an offscreen canvas for an implicit region; none: the region is drawn in rectangles. */
  makeCanvas?: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement | null;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

type At = (x: number, y: number) => { px: number; py: number };

/** How strongly a region (`y < …`, an implicit inequality) is shaded: light, so overlaps still read. */
const REGION_ALPHA = 0.15;
/** The selected line is this much heavier, CSS px. */
const SELECTED_EXTRA_PX = 1;

/** Draw `curves` (one list of polylines per expression) over `range` into `frame`. */
export function paintGraph(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  range: GraphRange,
  curves: ReadonlyArray<readonly Polyline[]>,
  options: GraphPaintOptions,
): void {
  const geometry: LineGeometry[] = curves.map((strokes, i) => ({
    id: `${i}`,
    color: options.colors.curves[i % options.colors.curves.length],
    dashed: false,
    width: 2.25,
    strokes: [...strokes],
    fills: [],
    dots: [],
  }));
  paintGraphGeometry(ctx, frame, range, geometry, options);
}

/** Draw each line's geometry over `range` into `frame`, with axes, labels and marks. */
export function paintGraphGeometry(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  range: GraphRange,
  geometry: readonly LineGeometry[],
  options: GraphPaintOptions,
): void {
  const { colors } = options;
  const u = options.unit ?? 1;
  const { x: fx, y: fy, w, h } = frame;
  if (!(w > 0) || !(h > 0)) return;
  const at: At = (x, y) => {
    const p = toScreen(range, w, h, x, y);
    return { px: fx + p.px, py: fy + p.py };
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(fx, fy, w, h);
  ctx.clip();
  if (colors.background) {
    ctx.fillStyle = colors.background;
    ctx.fillRect(fx, fy, w, h);
  }

  const xTicks = options.piTicks
    ? piTicks(range, w / u)
    : niceTicks(range.xMin, range.xMax, w / u, 64);
  const yTicks = niceTicks(range.yMin, range.yMax, h / u, 48);
  if (options.grid !== false) {
    const lines = (xs: readonly number[], ys: readonly number[]): void => {
      ctx.beginPath();
      for (const x of xs) {
        const { px } = at(x, 0);
        ctx.moveTo(Math.round(px) + 0.5 * u, fy);
        ctx.lineTo(Math.round(px) + 0.5 * u, fy + h);
      }
      for (const y of ys) {
        const { py } = at(0, y);
        ctx.moveTo(fx, Math.round(py) + 0.5 * u);
        ctx.lineTo(fx + w, Math.round(py) + 0.5 * u);
      }
      ctx.stroke();
    };
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = u;
    if (options.minorGrid !== false) {
      // GeoGebra's faint lines between the major ones, while they are far enough apart to read.
      const minorX = minorValues(range.xMin, range.xMax, xTicks.step, options.piTicks === true);
      const minorY = minorValues(range.yMin, range.yMax, yTicks.step, false);
      ctx.globalAlpha = MINOR_ALPHA;
      lines(
        (minorX.step / (range.xMax - range.xMin)) * w >= MINOR_MIN_PX * u ? minorX.values : [],
        (minorY.step / (range.yMax - range.yMin)) * h >= MINOR_MIN_PX * u ? minorY.values : [],
      );
      ctx.globalAlpha = 1;
    }
    lines(xTicks.values, yTicks.values);
  }

  // Axes, where they are in view.
  const origin = at(0, 0);
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  if (range.yMin <= 0 && range.yMax >= 0) {
    ctx.moveTo(fx, origin.py);
    ctx.lineTo(fx + w, origin.py);
  }
  if (range.xMin <= 0 && range.xMax >= 0) {
    ctx.moveTo(origin.px, fy);
    ctx.lineTo(origin.px, fy + h);
  }
  ctx.stroke();

  if (options.labels !== false) {
    paintLabels(ctx, frame, range, xTicks, yTicks, origin, options);
  }

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Shading first, under every curve.
  for (const g of geometry) {
    if (g.mask) paintMask(ctx, frame, g.mask, g.color, options);
    if (g.fills.length > 0) fillPolys(ctx, at, g.fills, g.color, REGION_ALPHA);
    if (g.area && g.area.fills.length > 0) fillPolys(ctx, at, g.area.fills, g.color, 0.3);
  }
  // The selected line last, over the others, heavier and with a halo.
  const selected = geometry.find((g) => g.id === options.selected);
  for (const g of geometry) if (g !== selected) paintLine(ctx, at, g, u);
  if (selected) {
    paintHalo(ctx, at, selected, u);
    paintLine(ctx, at, { ...selected, width: selected.width + SELECTED_EXTRA_PX }, u);
  }
  for (const g of geometry) if (g.area) paintAreaLabel(ctx, frame, at, g, options);

  if (options.pois) paintPois(ctx, at, options.pois, selected?.color, options);
  for (const pin of options.pins ?? []) {
    if (pin.name) paintNamedPin(ctx, frame, at, { ...pin, name: pin.name }, options);
    else paintMarker(ctx, frame, at, { ...pin, curve: undefined }, options);
  }
  if (options.trace) paintMarker(ctx, frame, at, options.trace, options);
  ctx.restore();
}

/** Minor lines closer than this (CSS px) are left out: they would read as a tint. */
const MINOR_MIN_PX = 8;
/** Minor lines in the grid's colour at this strength: there, but under the major lines. */
const MINOR_ALPHA = 0.32;

/** Where the minor grid lines fall between major lines `step` apart (a π step is halved). */
export function minorValues(
  min: number,
  max: number,
  step: number,
  pi: boolean,
): { step: number; values: number[] } {
  const minor = pi ? step / 2 : minorStep(step);
  const values: number[] = [];
  if (!(minor > 0) || !(max > min)) return { step: minor, values };
  for (let k = Math.ceil(min / minor); k * minor <= max && values.length < 1000; k++) {
    const v = k * minor;
    // The major lines are drawn on their own.
    const ratio = v / step;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-6) values.push(v);
  }
  return { step: minor, values };
}

/** x ticks at multiples (or fractions) of π, labelled in π. */
function piTicks(range: GraphRange, pixels: number): { step: number; values: number[]; pi: true } {
  const inPi = niceTicks(range.xMin / Math.PI, range.xMax / Math.PI, pixels, 64);
  // Steps of ½, ¼ … π read better than 0.2π: snap a decimal step to a power-of-two fraction.
  let step = inPi.step;
  if (step < 1) step = 2 ** Math.round(Math.log2(step));
  const values: number[] = [];
  for (
    let k = Math.ceil(range.xMin / Math.PI / step);
    k * step * Math.PI <= range.xMax && values.length < 1000;
    k++
  ) {
    values.push(k * step * Math.PI);
  }
  return { step: step * Math.PI, values, pi: true };
}

/** A multiple of π as text: π, −2π, π/2, 3π/4. */
export function formatPi(value: number): string {
  const k = value / Math.PI;
  if (Math.abs(k) < 1e-9) return "0";
  for (const d of [1, 2, 3, 4, 6, 8, 12, 16]) {
    const n = Math.round(k * d);
    if (Math.abs(n / d - k) < 1e-9) {
      const sign = n < 0 ? "−" : "";
      const top = Math.abs(n) === 1 ? "π" : `${Math.abs(n)}π`;
      return d === 1 ? `${sign}${top}` : `${sign}${top}/${d}`;
    }
  }
  return `${formatTick(k, 0.01)}π`;
}

function trace(ctx: CanvasRenderingContext2D, at: At, polys: readonly Polyline[]): void {
  for (const poly of polys) {
    for (let i = 0; i + 1 < poly.length; i += 2) {
      const p = at(poly[i], poly[i + 1]);
      if (i === 0) ctx.moveTo(p.px, p.py);
      else ctx.lineTo(p.px, p.py);
    }
  }
}

function fillPolys(
  ctx: CanvasRenderingContext2D,
  at: At,
  polys: readonly Polyline[],
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const poly of polys) {
    trace(ctx, at, [poly]);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

function paintLine(ctx: CanvasRenderingContext2D, at: At, g: LineGeometry, u: number): void {
  ctx.strokeStyle = g.color;
  ctx.lineWidth = g.width * u;
  if (g.strokes.length > 0) {
    ctx.setLineDash(g.dashed || g.edgeDashed ? [7 * u, 5 * u] : []);
    ctx.beginPath();
    trace(ctx, at, g.strokes);
    ctx.stroke();
  }
  if (g.derivative && g.derivative.length > 0) {
    ctx.setLineDash([3 * u, 4 * u]);
    ctx.lineWidth = Math.max(1, g.width * 0.75) * u;
    ctx.beginPath();
    trace(ctx, at, g.derivative);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (g.tangent) {
    ctx.lineWidth = 1.25 * u;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    trace(ctx, at, [g.tangent.stroke]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const p = at(g.tangent.x, g.tangent.y);
    ctx.fillStyle = g.color;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 4 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  if (g.dots.length > 0) {
    ctx.fillStyle = g.color;
    ctx.beginPath();
    for (let i = 0; i + 1 < g.dots.length; i += 2) {
      const p = at(g.dots[i], g.dots[i + 1]);
      ctx.moveTo(p.px + 4.5 * u, p.py);
      ctx.arc(p.px, p.py, 4.5 * u, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

/**
 * An implicit region's cells, lightly: one pixel a cell in a small canvas,
 * drawn up to the frame with smoothing so its edge is soft, not stepped
 * (and adjacent cells leave no seams, as separate rectangles would under
 * anti-aliasing). Without a canvas, row runs of cells as rectangles.
 */
function paintMask(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  mask: RegionMask,
  color: string,
  options: GraphPaintOptions,
): void {
  const make =
    options.makeCanvas ??
    ((cw: number, ch: number) =>
      typeof OffscreenCanvas === "function" ? new OffscreenCanvas(cw, ch) : null);
  const canvas = make(mask.cols, mask.rows);
  const cellW = frame.w / mask.cols;
  const cellH = frame.h / mask.rows;
  ctx.save();
  ctx.globalAlpha = REGION_ALPHA;
  ctx.fillStyle = color;
  const small = canvas?.getContext("2d") as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (canvas && small) {
    const image = small.createImageData(mask.cols, mask.rows);
    const [r, g, b] = rgbOf(color);
    for (let i = 0; i < mask.alpha.length; i++) {
      image.data[4 * i] = r;
      image.data[4 * i + 1] = g;
      image.data[4 * i + 2] = b;
      image.data[4 * i + 3] = mask.alpha[i];
    }
    small.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, frame.x, frame.y, frame.w, frame.h);
  } else {
    ctx.beginPath();
    for (let j = 0; j < mask.rows; j++) {
      let start = -1;
      for (let i = 0; i <= mask.cols; i++) {
        const on = i < mask.cols && mask.alpha[j * mask.cols + i] >= 128;
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          ctx.rect(frame.x + start * cellW, frame.y + j * cellH, (i - start) * cellW, cellH);
          start = -1;
        }
      }
    }
    ctx.fill();
  }
  ctx.restore();
}

/** `#rrggbb` (or `#rgb`) as numbers; black for anything else. */
function rgbOf(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color)?.[1];
  if (!hex) return [0, 0, 0];
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** "∫ = 9" over the shaded area, or "∫ diverges". */
function paintAreaLabel(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  at: At,
  g: LineGeometry,
  options: GraphPaintOptions,
): void {
  const area = g.area!;
  const u = options.unit ?? 1;
  const mid = at((area.from + area.to) / 2, 0);
  const text =
    area.value === null ? "∫ does not converge" : `∫ = ${Number(area.value.toPrecision(6))}`;
  ctx.font = `600 ${12 * u}px ${options.fontFamily ?? "sans-serif"}`;
  ctx.fillStyle = g.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const y = Math.min(frame.y + frame.h - 4 * u, Math.max(frame.y + 16 * u, mid.py - 6 * u));
  ctx.fillText(text, mid.px, y);
}

/** A line under the selected one, wide and faint in its own colour. */
function paintHalo(ctx: CanvasRenderingContext2D, at: At, g: LineGeometry, u: number): void {
  if (g.strokes.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = g.color;
  ctx.lineWidth = (g.width + 7) * u;
  ctx.setLineDash([]);
  ctx.beginPath();
  trace(ctx, at, g.strokes);
  ctx.stroke();
  ctx.restore();
}

/** Points of interest as hollow rings, in the selected line's colour when there is one. */
function paintPois(
  ctx: CanvasRenderingContext2D,
  at: At,
  pois: readonly Poi[],
  color: string | undefined,
  options: GraphPaintOptions,
): void {
  const u = options.unit ?? 1;
  ctx.fillStyle = options.colors.background ?? "#ffffff";
  ctx.strokeStyle = color ?? options.colors.poi ?? options.colors.label;
  ctx.lineWidth = 2 * u;
  for (const poi of pois) {
    const p = at(poi.x, poi.y);
    ctx.beginPath();
    ctx.arc(p.px, p.py, 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** A pin with a name: a dot in its line's colour and the name beside it, as GeoGebra labels points. */
function paintNamedPin(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  at: At,
  pin: { x: number; y: number; color: string; name: string },
  options: GraphPaintOptions,
): void {
  const u = options.unit ?? 1;
  const p = at(pin.x, pin.y);
  const background = options.colors.background ?? "#ffffff";
  ctx.fillStyle = pin.color;
  ctx.strokeStyle = background;
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.arc(p.px, p.py, 5 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = `600 ${13 * u}px ${options.fontFamily ?? "sans-serif"}`;
  const width = ctx.measureText(pin.name).width;
  // Up and to the right, kept inside the frame.
  const x = Math.min(frame.x + frame.w - width - 3 * u, p.px + 8 * u);
  const y = Math.max(frame.y + 14 * u, p.py - 8 * u);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 3 * u;
  ctx.lineJoin = "round";
  ctx.strokeText(pin.name, x, y);
  ctx.fillText(pin.name, x, y);
}

function paintLabels(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  range: GraphRange,
  xTicks: { step: number; values: number[]; pi?: true },
  yTicks: { step: number; values: number[] },
  origin: { px: number; py: number },
  options: GraphPaintOptions,
): void {
  const u = options.unit ?? 1;
  const { x: fx, y: fy, w, h } = frame;
  const size = 11 * u;
  const pad = 4 * u;
  ctx.font = `${size}px ${options.fontFamily ?? "sans-serif"}`;
  ctx.fillStyle = options.colors.label;
  // Along the x axis, or along the frame's edge when the axis is out of view.
  const labelY = Math.min(fy + h - size - pad, Math.max(fy + pad, origin.py + pad));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const x of xTicks.values) {
    if (Math.abs(x) < xTicks.step * 1e-9) continue;
    const px = fx + ((x - range.xMin) / (range.xMax - range.xMin)) * w;
    const label = xTicks.pi ? formatPi(x) : formatTick(x, xTicks.step);
    // A label the frame's edge would cut is left out, not clipped.
    const half = ctx.measureText(label).width / 2;
    if (px - half < fx + pad / 2 || px + half > fx + w - pad / 2) continue;
    haloText(ctx, label, px, labelY, options);
  }
  const rightOfAxis = origin.px + pad;
  const labelX = Math.min(fx + w - pad, Math.max(fx + pad, rightOfAxis));
  ctx.textAlign = labelX === fx + w - pad ? "right" : "left";
  ctx.textBaseline = "middle";
  for (const y of yTicks.values) {
    if (y === 0) continue;
    const py = fy + ((range.yMax - y) / (range.yMax - range.yMin)) * h;
    if (py - size / 2 < fy + pad / 2 || py + size / 2 > fy + h - pad / 2) continue;
    haloText(ctx, formatTick(y, yTicks.step), labelX, py, options);
  }
}

/** Text with a rim of the background round it, so a grid line or a curve under it never cuts it. */
function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: GraphPaintOptions,
): void {
  const background = options.colors.background;
  if (background) {
    ctx.save();
    ctx.strokeStyle = background;
    ctx.lineWidth = 3 * (options.unit ?? 1);
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
}

/** A traced or pinned point: a dot in its line's colour, with a label above it (below near the top). */
function paintMarker(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  at: At,
  mark: GraphTrace,
  options: GraphPaintOptions,
): void {
  const u = options.unit ?? 1;
  const curves = options.colors.curves;
  const colour =
    mark.color ??
    (curves.length > 0 ? curves[(mark.curve ?? 0) % curves.length] : options.colors.label);
  const p = at(mark.x, mark.y);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(p.px, p.py, 5 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = options.colors.background ?? "#ffffff";
  ctx.stroke();

  const size = 12 * u;
  ctx.font = `600 ${size}px ${options.fontFamily ?? "sans-serif"}`;
  const width = ctx.measureText(mark.label).width + 12 * u;
  const height = size + 10 * u;
  let left = p.px - width / 2;
  let top = p.py - height - 10 * u;
  if (top < frame.y + 2 * u) top = p.py + 10 * u;
  left = Math.min(frame.x + frame.w - width - 2 * u, Math.max(frame.x + 2 * u, left));
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 6 * u);
  ctx.fill();
  ctx.fillStyle = options.colors.background ?? "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(mark.label, left + width / 2, top + height / 2);
}

// --- A whole spec in one call (a graph on a page) -------------------------------

/** Compiled specs, by their text: compiling is cheap but not free, and a page redraws often. */
const preparedBySpec = new Map<string, PreparedGraph>();
const MAX_PREPARED = 64;

/** `spec` read and compiled, from the cache when its lines, sliders and angle are unchanged. */
export function preparedOf(spec: GraphSpec, palette?: readonly string[]): PreparedGraph {
  const key = JSON.stringify([
    spec.lines ?? spec.expressions,
    spec.sliders ?? [],
    spec.angle ?? "rad",
    palette ?? null,
  ]);
  let prepared = preparedBySpec.get(key);
  if (!prepared) {
    prepared = prepareGraph(spec, palette);
    if (preparedBySpec.size >= MAX_PREPARED) preparedBySpec.clear();
    preparedBySpec.set(key, prepared);
  }
  return prepared;
}

export interface SpecPaintOptions extends Omit<GraphPaintOptions, "pins"> {
  /** Device px per frame unit: the sampling resolution (default `unit`). */
  resolution?: number;
  /** Line colours by position, for lines without their own. */
  palette?: readonly string[];
  /** Implicit grid cell in CSS px (default 6). */
  cell?: number;
}

/**
 * Draw a whole {@link GraphSpec} (version 1 or 2) into `frame`: compile it
 * (cached), sample every line at the resolution it is drawn at, and paint
 * it, pins included. What a graph on a page calls, so it shows everything
 * the calculator's graph does.
 */
export function renderGraphSpec(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  spec: GraphSpec,
  options: SpecPaintOptions,
): LineGeometry[] {
  if (!(frame.w > 0) || !(frame.h > 0)) return [];
  const prepared = preparedOf(spec, options.palette);
  const scale = (options.resolution ?? options.unit ?? 1) / (options.unit ?? 1);
  const geometry = sampleGraphGeometry(prepared, spec, frame.w * scale, frame.h * scale, {
    cell: (options.cell ?? 6) * scale,
  });
  const pins = (spec.pins ?? []).flatMap((pin) => {
    const entry = prepared.lines.find((p) => p.line.id === pin.line);
    const y = valueOfLine(prepared, pin.line, pin.x);
    if (!entry || !Number.isFinite(y)) return [];
    const label = pointLabel(pin.x, y);
    return [{ x: pin.x, y, color: entry.color, label, ...(pin.name ? { name: pin.name } : {}) }];
  });
  paintGraphGeometry(ctx, frame, spec, geometry, {
    ...options,
    grid: options.grid ?? spec.grid !== false,
    labels: options.labels ?? spec.labels !== false,
    piTicks: options.piTicks ?? spec.piTicks === true,
    pins,
  });
  return geometry;
}

/** "(x, y)" with five significant digits each, no float noise. */
export function pointLabel(x: number, y: number): string {
  const short = (v: number): string => {
    if (v === 0) return "0";
    const t =
      Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4 ? v.toExponential(3) : `${Number(v.toPrecision(5))}`;
    return t.replace("-", "−");
  };
  return `(${short(x)}, ${short(y)})`;
}
