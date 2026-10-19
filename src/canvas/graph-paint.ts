/**
 * Painting a graph element (`model/graph-element`) in page space with the
 * calculator's own graph code: its spec compiled (`preparedOf`), sampled
 * into geometry (`sampleGraphGeometry`: curves, regions, implicit masks,
 * points, derivatives, tangents, areas) and painted (`paintGraphGeometry`),
 * pins included, so a graph on a page shows everything the pop-up's does.
 * The one function the tiles, the lasso's drag draft, the thumbnails, the
 * PDF export, the AI's page render and Explore's live canvas all draw a
 * graph with, so they agree.
 *
 * Sampling is the expensive part, so each graph keeps its sampled geometry,
 * keyed by what it depends on (`graphContentKey`: the whole spec, colours,
 * size, options) and by the resolution it was sampled for (`sampleCount`:
 * device px across, a power of two). A tile, a thumbnail and a printed page
 * at the same resolution share one sampling; moving a graph reuses it; any
 * edit makes a new key, and so a new sampling (ledger: a cache fingerprint
 * must change under every command that changes what is drawn).
 */

import type { GraphElement } from "../model/document";
import { graphContentKey } from "../model/graph-element";
import type { GraphRange } from "../model/graph";
import { sliderVars } from "../model/graph-lines";
import {
  type LineGeometry,
  type PreparedGraph,
  sampleGraphGeometry,
  valueOfLine,
} from "../model/graph-sample";
import {
  type GraphColors,
  type GraphTrace,
  paintGraphGeometry,
  pointLabel,
  preparedOf,
} from "./graph-painter";
import { shownColor } from "./backdrop";
import { sampleCount } from "./graph-geometry";

/** A graph's view as the calculator's maths takes it. */
export function rangeOf(graph: Pick<GraphElement, "spec">): GraphRange {
  const { xMin, xMax, yMin, yMax } = graph.spec;
  return { xMin, xMax, yMin, yMax };
}

/** The graph's spec compiled by the calculator (cached there), its lines in the graph's colours. */
export function preparedGraph(graph: GraphElement): PreparedGraph {
  return preparedOf(graph.spec, graph.colors);
}

/** The implicit-curve grid cell, CSS px: the calculator's own default for a still graph. */
const IMPLICIT_CELL = 6;
/** The cell while a graph moves under the fingers (Explore): a quarter of the grid's work. */
const MOVING_CELL = 12;

/** A graph's sampled geometry at one resolution. */
interface Sampled {
  key: string;
  resolution: number;
  cell: number;
  geometry: LineGeometry[];
}

/** At most this many samplings are kept per graph (on screen, its thumbnail, a print). */
const KEPT_PER_GRAPH = 3;

const sampledByGraph = new WeakMap<GraphElement, Sampled[]>();

/** How many samplings have been made since the page opened: the harness reads this. */
export const graphStats = { samplings: 0, sampleMs: 0 };

/** The graph's geometry sampled `resolution` device px across, now if no cached one fits. */
function sampledGeometry(graph: GraphElement, resolution: number, cell: number): LineGeometry[] {
  const key = graphContentKey(graph);
  const list = sampledByGraph.get(graph) ?? [];
  const hit = list.find(
    (entry) => entry.key === key && entry.resolution === resolution && entry.cell === cell,
  );
  if (hit) return hit.geometry;
  const start = performance.now();
  // Device px per page px this sampling stands for, so the implicit grid's
  // cell is the same size on the page at every resolution.
  const scale = resolution / graph.w;
  let geometry: LineGeometry[] = [];
  try {
    geometry = sampleGraphGeometry(
      preparedGraph(graph),
      rangeOf(graph),
      resolution,
      graph.h * scale,
      { cell: cell * scale },
    );
  } catch {
    // A spec that cannot be sampled draws no curves, never no page.
  }
  graphStats.samplings++;
  graphStats.sampleMs += performance.now() - start;
  const fresh = list.filter((entry) => entry.key === key);
  fresh.push({ key, resolution, cell, geometry });
  sampledByGraph.set(graph, fresh.slice(-KEPT_PER_GRAPH));
  return geometry;
}

/** What a graph is painted with besides its own fields. */
export interface GraphPaintOptions {
  /** Device px per page px: sets the sampling resolution and keeps hairlines visible. */
  level: number;
  /** A night page: colours as `./night` shows them. */
  night: boolean;
  /** The card's fill, the paper's colour, so ruled lines do not run through the plot. */
  paper: string;
  /** A traced point, as the calculator's painter draws one (Explore). */
  trace?: GraphTrace;
  /** The graph is moving under the fingers: implicit curves on a coarser grid until it stops. */
  moving?: boolean;
}

/** The pop-up's light colours (its fallbacks), fixed: a page is paper, not the app's theme. */
const GRID_COLOR = "#e0e0e0";
const AXIS_COLOR = "#888888";
const LABEL_COLOR = "#999999";
const EDGE_COLOR = "#d0d3d8";
/** A real family for the numbers: canvas fonts take no CSS variables. */
const LABEL_FONT = '-apple-system, "Segoe UI", Roboto, sans-serif';

/** The colours a graph's frame is drawn in on a page, the night mapping applied if it applies. */
export function graphColors(graph: GraphElement, night: boolean, paper: string): GraphColors {
  return {
    background: paper,
    grid: shownColor(GRID_COLOR, night),
    axis: shownColor(AXIS_COLOR, night),
    label: shownColor(LABEL_COLOR, night),
    curves: graph.colors.map((color) => shownColor(color, night)),
    poi: shownColor(LABEL_COLOR, night),
  };
}

/**
 * Paint `graph` in page space into `ctx`: the calculator's plot (card in the
 * paper's colour, grid, axes, numbers, every line the spec holds, its pins;
 * one page px stands for one of its CSS px) in the graph's frame, then a
 * hairline edge round the card.
 */
export function paintGraph(
  ctx: CanvasRenderingContext2D,
  graph: GraphElement,
  options: GraphPaintOptions,
): void {
  if (!(graph.w > 0) || !(graph.h > 0)) return;
  const { night } = options;
  const level = options.level > 0 && Number.isFinite(options.level) ? options.level : 1;
  const cell = options.moving ? MOVING_CELL : IMPLICIT_CELL;
  const sampled = sampledGeometry(graph, sampleCount(graph.w, level), cell);
  // A night page shows each line's colour as `./night` maps it; the cached geometry stays as sampled.
  const geometry = night
    ? sampled.map((line) => ({ ...line, color: shownColor(line.color, true) }))
    : sampled;
  const spec = graph.spec;
  const frame = { x: graph.x, y: graph.y, w: graph.w, h: graph.h };
  paintGraphGeometry(ctx, frame, rangeOf(graph), geometry, {
    colors: graphColors(graph, night, options.paper),
    grid: graph.grid !== false && spec.grid !== false,
    labels: graph.labels !== false && spec.labels !== false,
    piTicks: spec.piTicks === true,
    unit: 1,
    fontFamily: LABEL_FONT,
    pins: pinsOf(graph, night),
    ...(options.trace ? { trace: options.trace } : {}),
  });
  ctx.save();
  ctx.strokeStyle = shownColor(EDGE_COLOR, night);
  ctx.lineWidth = Math.max(0.5, 1 / level);
  ctx.strokeRect(graph.x, graph.y, graph.w, graph.h);
  ctx.restore();
}

/** The spec's pinned points, where their lines are defined, with their labels. */
function pinsOf(
  graph: GraphElement,
  night: boolean,
): Array<{ x: number; y: number; color: string; label: string }> {
  const pins = graph.spec.pins;
  if (!Array.isArray(pins) || pins.length === 0) return [];
  const prepared = preparedGraph(graph);
  return pins.flatMap((pin) => {
    const entry = prepared.lines.find((p) => p.line.id === pin.line);
    const y = valueOfLine(prepared, pin.line, pin.x);
    if (!entry || !Number.isFinite(y)) return [];
    return [{ x: pin.x, y, color: shownColor(entry.color, night), label: pointLabel(pin.x, y) }];
  });
}

/**
 * The function line nearest frame point (px, py) of `graph` (page px), at
 * that x, within `reach` page px of it: what a tap or the Pencil traces in
 * Explore. Null when no function line passes close by.
 */
export function traceNear(
  graph: GraphElement,
  px: number,
  py: number,
  reach: number,
): { line: string; x: number; y: number; color: string } | null {
  const prepared = preparedGraph(graph);
  const range = rangeOf(graph);
  const x = range.xMin + ((range.xMax - range.xMin) * px) / graph.w;
  const vars = sliderVars(prepared.sliders);
  let best: { line: string; x: number; y: number; color: string } | null = null;
  let bestPx = reach;
  for (const entry of prepared.lines) {
    if (entry.line.hidden) continue;
    const y = valueOfLine(prepared, entry.line.id, x, vars);
    if (!Number.isFinite(y)) continue;
    const fy = ((range.yMax - y) / (range.yMax - range.yMin)) * graph.h;
    const d = Math.abs(fy - py);
    if (d <= bestPx) {
      bestPx = d;
      best = { line: entry.line.id, x, y, color: entry.color };
    }
  }
  return best;
}

/** The value of line `id` of `graph` at `x`: NaN where it has none, or it is not a function of x. */
export function lineValue(graph: GraphElement, id: string, x: number): number {
  return valueOfLine(preparedGraph(graph), id, x);
}
