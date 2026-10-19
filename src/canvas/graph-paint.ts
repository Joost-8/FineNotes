/**
 * Painting a graph element (`model/graph-element`) in page space with the
 * calculator's own sampler (`model/graph`) and painter (`graph-painter`), so
 * a graph on a page looks as it did in the pop-up. The one function the
 * tiles, the lasso's drag draft, the thumbnails, the PDF export, the AI's
 * page render and Explore's live canvas all draw a graph with, so they agree.
 *
 * Sampling a curve is the expensive part, so each graph keeps its sampled
 * curves, keyed by what they depend on (`graphContentKey`: expressions,
 * ranges, size, options, angle) and by the resolution they were sampled for
 * (`sampleCount`: device px across, a power of two). A tile, a thumbnail and
 * a printed page at the same resolution share one sampling; moving a graph
 * reuses it; any edit makes a new key, and so a new sampling (ledger: a
 * cache fingerprint must change under every command that changes what is
 * drawn). Painting from cached curves is a few path strokes.
 */

import type { GraphElement } from "../model/document";
import { graphContentKey } from "../model/graph-element";
import {
  type GraphRange,
  type Polyline,
  type RealFn,
  compileGraph,
  sampleCurve,
} from "../model/graph";
import { type GraphColors, paintGraph as paintPlot } from "./graph-painter";
import { shownColor } from "./backdrop";
import { sampleCount } from "./graph-geometry";

/** A graph's view as the calculator's maths takes it. */
export function rangeOf(graph: Pick<GraphElement, "xRange" | "yRange">): GraphRange {
  return {
    xMin: graph.xRange[0],
    xMax: graph.xRange[1],
    yMin: graph.yRange[0],
    yMax: graph.yRange[1],
  };
}

/** Compiled expressions, by their text and angle mode: compiling is cheap but not free. */
const compiledByKey = new Map<string, Array<RealFn | null>>();
/** The most compilations kept: a notebook has a handful of graphs. */
const MAX_COMPILED = 64;

/** Each expression of `graph` as a function of x (null where it cannot be read). */
export function graphFunctions(graph: GraphElement): Array<RealFn | null> {
  const angle = graph.angle === "deg" ? "deg" : "rad";
  const expressions = graph.expressions.map((expression) => expression.text);
  const key = JSON.stringify([angle, expressions]);
  let fns = compiledByKey.get(key);
  if (!fns) {
    try {
      fns = compileGraph({ expressions, angle }).fns;
    } catch {
      fns = expressions.map(() => null);
    }
    if (compiledByKey.size >= MAX_COMPILED) compiledByKey.clear();
    compiledByKey.set(key, fns);
  }
  return fns;
}

/** A graph's sampled curves at one resolution. */
interface Sampled {
  key: string;
  resolution: number;
  curves: Polyline[][];
}

/** At most this many samplings are kept per graph (on screen, its thumbnail, a print). */
const KEPT_PER_GRAPH = 3;

const sampledByGraph = new WeakMap<GraphElement, Sampled[]>();

/** How many samplings have been made since the page opened: the harness reads this. */
export const graphStats = { samplings: 0, sampleMs: 0 };

/** The graph's curves sampled `resolution` device px across, now if no cached ones fit. */
function sampledCurves(graph: GraphElement, resolution: number): Polyline[][] {
  const key = graphContentKey(graph);
  const list = sampledByGraph.get(graph) ?? [];
  const hit = list.find((entry) => entry.key === key && entry.resolution === resolution);
  if (hit) return hit.curves;
  const start = performance.now();
  const range = rangeOf(graph);
  const heightPx = (resolution * graph.h) / graph.w;
  const curves = graphFunctions(graph).map((fn) => {
    if (!fn) return [];
    try {
      return sampleCurve(fn, range, resolution, heightPx);
    } catch {
      // A curve that cannot be sampled is left out, never the page.
      return [];
    }
  });
  graphStats.samplings++;
  graphStats.sampleMs += performance.now() - start;
  const fresh = list.filter((entry) => entry.key === key);
  fresh.push({ key, resolution, curves });
  sampledByGraph.set(graph, fresh.slice(-KEPT_PER_GRAPH));
  return curves;
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
  trace?: { x: number; y: number; curve: number; label: string };
}

/** The pop-up's light colours (its fallbacks), fixed: a page is paper, not the app's theme. */
const GRID_COLOR = "#e0e0e0";
const AXIS_COLOR = "#888888";
const LABEL_COLOR = "#999999";
const EDGE_COLOR = "#d0d3d8";
/** A real family for the numbers: canvas fonts take no CSS variables. */
const LABEL_FONT = '-apple-system, "Segoe UI", Roboto, sans-serif';

/** The colours `graph` is drawn in on a page: its own curves', and the night mapping if it applies. */
export function graphColors(graph: GraphElement, night: boolean, paper: string): GraphColors {
  return {
    background: paper,
    grid: shownColor(GRID_COLOR, night),
    axis: shownColor(AXIS_COLOR, night),
    label: shownColor(LABEL_COLOR, night),
    curves: graph.expressions.map((expression) => shownColor(expression.color, night)),
  };
}

/**
 * Paint `graph` in page space into `ctx`: the calculator's plot (card in the
 * paper's colour, grid, axes, numbers, curves; one page px stands for one of
 * its CSS px) in the graph's frame, then a hairline edge round the card.
 */
export function paintGraph(
  ctx: CanvasRenderingContext2D,
  graph: GraphElement,
  options: GraphPaintOptions,
): void {
  if (!(graph.w > 0) || !(graph.h > 0)) return;
  const level = options.level > 0 && Number.isFinite(options.level) ? options.level : 1;
  const curves = sampledCurves(graph, sampleCount(graph.w, level));
  paintPlot(ctx, { x: graph.x, y: graph.y, w: graph.w, h: graph.h }, rangeOf(graph), curves, {
    colors: graphColors(graph, options.night, options.paper),
    grid: graph.grid !== false,
    labels: graph.labels !== false,
    unit: 1,
    fontFamily: LABEL_FONT,
    ...(options.trace ? { trace: options.trace } : {}),
  });
  ctx.save();
  ctx.strokeStyle = shownColor(EDGE_COLOR, options.night);
  ctx.lineWidth = Math.max(0.5, 1 / level);
  ctx.strokeRect(graph.x, graph.y, graph.w, graph.h);
  ctx.restore();
}
