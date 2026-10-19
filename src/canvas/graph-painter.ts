/**
 * Draws a sampled graph (`model/graph.ts`) into a canvas: grid, axes, tick
 * labels, curves and a traced point. Canvas only, no DOM and no Obsidian, so
 * the calculator's pop-up and a page tile can both use it.
 *
 * Everything is placed in `frame`, in the context's current units; `unit`
 * is how many of those make one CSS pixel, and scales every line width,
 * gap and font. Colours must be resolved strings: a canvas does not read
 * `var(--…)` (CLAUDE.md, "CSS variables do not work in any canvas string
 * property").
 */

import { type GraphRange, type Polyline, formatTick, niceTicks, toScreen } from "../model/graph";

export interface GraphColors {
  /** Filled under everything; left transparent when absent. */
  background?: string;
  grid: string;
  axis: string;
  label: string;
  /** One per expression, used in turn. */
  curves: readonly string[];
}

export interface GraphPaintOptions {
  colors: GraphColors;
  /** Grid lines at the ticks (default on). */
  grid?: boolean;
  /** Numbers along the axes (default on). */
  labels?: boolean;
  /** Context units per CSS pixel (default 1). */
  unit?: number;
  /** A font family for the labels (a real name, not a variable). */
  fontFamily?: string;
  /** A traced point, with its label. */
  trace?: { x: number; y: number; curve: number; label: string };
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Draw `curves` (one list of polylines per expression) over `range` into `frame`. */
export function paintGraph(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  range: GraphRange,
  curves: ReadonlyArray<readonly Polyline[]>,
  options: GraphPaintOptions,
): void {
  const { colors } = options;
  const u = options.unit ?? 1;
  const { x: fx, y: fy, w, h } = frame;
  if (!(w > 0) || !(h > 0)) return;
  const at = (x: number, y: number): { px: number; py: number } => {
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

  const xTicks = niceTicks(range.xMin, range.xMax, w / u, 64);
  const yTicks = niceTicks(range.yMin, range.yMax, h / u, 48);
  if (options.grid !== false) {
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = u;
    ctx.beginPath();
    for (const x of xTicks.values) {
      const { px } = at(x, 0);
      ctx.moveTo(Math.round(px) + 0.5 * u, fy);
      ctx.lineTo(Math.round(px) + 0.5 * u, fy + h);
    }
    for (const y of yTicks.values) {
      const { py } = at(0, y);
      ctx.moveTo(fx, Math.round(py) + 0.5 * u);
      ctx.lineTo(fx + w, Math.round(py) + 0.5 * u);
    }
    ctx.stroke();
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

  if (options.labels !== false) paintLabels(ctx, frame, range, xTicks, yTicks, origin, options);

  // Curves, after the grid so nothing is drawn over them but the trace.
  ctx.lineWidth = 2.25 * u;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  curves.forEach((lines, index) => {
    if (lines.length === 0) return;
    ctx.strokeStyle = colors.curves[index % colors.curves.length];
    ctx.beginPath();
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i += 2) {
        const p = at(line[i], line[i + 1]);
        if (i === 0) ctx.moveTo(p.px, p.py);
        else ctx.lineTo(p.px, p.py);
      }
    }
    ctx.stroke();
  });

  if (options.trace) paintTrace(ctx, frame, at, options);
  ctx.restore();
}

function paintLabels(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  range: GraphRange,
  xTicks: { step: number; values: number[] },
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
    if (x === 0) continue;
    const px = fx + ((x - range.xMin) / (range.xMax - range.xMin)) * w;
    const label = formatTick(x, xTicks.step);
    // A label the frame's edge would cut is left out, not clipped.
    const half = ctx.measureText(label).width / 2;
    if (px - half < fx + pad / 2 || px + half > fx + w - pad / 2) continue;
    ctx.fillText(label, px, labelY);
  }
  const rightOfAxis = origin.px + pad;
  const labelX = Math.min(fx + w - pad, Math.max(fx + pad, rightOfAxis));
  ctx.textAlign = labelX === fx + w - pad ? "right" : "left";
  ctx.textBaseline = "middle";
  for (const y of yTicks.values) {
    if (y === 0) continue;
    const py = fy + ((range.yMax - y) / (range.yMax - range.yMin)) * h;
    if (py - size / 2 < fy + pad / 2 || py + size / 2 > fy + h - pad / 2) continue;
    ctx.fillText(formatTick(y, yTicks.step), labelX, py);
  }
}

function paintTrace(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  at: (x: number, y: number) => { px: number; py: number },
  options: GraphPaintOptions,
): void {
  const trace = options.trace!;
  const u = options.unit ?? 1;
  const colour = options.colors.curves[trace.curve % options.colors.curves.length];
  const p = at(trace.x, trace.y);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(p.px, p.py, 5 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = options.colors.background ?? "#ffffff";
  ctx.stroke();

  const size = 12 * u;
  ctx.font = `600 ${size}px ${options.fontFamily ?? "sans-serif"}`;
  const width = ctx.measureText(trace.label).width + 12 * u;
  const height = size + 10 * u;
  // Above the point, flipped below or sideways to stay in the frame.
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
  ctx.fillText(trace.label, left + width / 2, top + height / 2);
}
