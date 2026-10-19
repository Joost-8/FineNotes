/**
 * Painting a graph element (`model/graph`) in page space: its card, grid,
 * axes and numbers, then each expression's curve. The one function the
 * tiles, the lasso's drag draft, the thumbnails, the PDF export, the AI's
 * page render and Explore's live canvas all draw a graph with, so they agree.
 *
 * Sampling a curve is the expensive part, so each graph keeps its sampled
 * paths, keyed by what they depend on (`graphContentKey`: expressions,
 * ranges, size, options) and by the resolution they were sampled for
 * (`sampleCount`: device px across, a power of two). A tile, a thumbnail and
 * a printed page at the same resolution share one sampling; moving a graph
 * reuses it; any edit makes a new key, and so a new sampling (ledger: a
 * cache fingerprint must change under every command that changes what is
 * drawn).
 *
 * The sampling itself is the calculator's (`setGraphEngine`, set once by the
 * plugin): curves come back as polylines in value space, already broken at
 * gaps and asymptotes, one list per expression. Until an engine is set a
 * graph draws its card and axes, and no curve.
 */

import type { GraphElement } from "../model/document";
import { graphContentKey } from "../model/graph-element";
import { shownColor } from "./backdrop";
import {
  type FrameMap,
  frameX,
  frameY,
  niceStep,
  sampleCount,
  sampleXs,
  tickLabel,
  ticks,
  valueRuns,
} from "./graph-geometry";

/** A graph's view, as the calculator's graph engine takes it. */
export interface GraphRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** A curve piece in value space, flat `[x0, y0, x1, y1, …]`. */
export type Polyline = number[];

/** What graphs are sampled with: the calculator's engine, or a stand-in. */
export interface GraphEngine {
  /**
   * Each expression's curve over `range`, as polylines in value space,
   * sampled to be drawn `widthPx` x `heightPx` device px. An expression that
   * cannot be read gives no polylines.
   */
  sample(
    expressions: readonly string[],
    range: GraphRange,
    widthPx: number,
    heightPx: number,
  ): Polyline[][];
  /** `expression` as a function of x (NaN where undefined), or null when it cannot be read. */
  compile(expression: string): ((x: number) => number) | null;
}

const NO_ENGINE: GraphEngine = {
  sample: (expressions) => expressions.map(() => []),
  compile: () => null,
};

let engine: GraphEngine = NO_ENGINE;

/** Sample every graph with `next` from now on; cached curves are dropped. */
export function setGraphEngine(next: GraphEngine): void {
  engine = next;
  compiled.clear();
  generation++;
}

/**
 * An engine from a compiler alone: evenly spaced samples, one a device
 * pixel, broken where a value is undefined or leaps across the view. For
 * the harness and the tests; the plugin uses the calculator's adaptive one.
 */
export function uniformEngine(compile: GraphEngine["compile"]): GraphEngine {
  return {
    compile,
    sample: (expressions, range, widthPx) => {
      const xs = sampleXs([range.xMin, range.xMax], Math.max(2, Math.ceil(widthPx)));
      return expressions.map((expression) => {
        const fn = compile(expression);
        if (!fn) return [];
        const ys = new Float64Array(xs.length);
        for (let i = 0; i < xs.length; i++) ys[i] = fn(xs[i]);
        return valueRuns(xs, ys, [range.yMin, range.yMax]);
      });
    },
  };
}

/** Bumped when the engine changes, so no curve sampled by the old one is drawn. */
let generation = 0;

/** Compiled expressions for trace and pin, by text. */
const compiled = new Map<string, ((x: number) => number) | null>();

/** A graph's sampled curves at one resolution, as paths in frame px. */
interface Sampled {
  key: string;
  resolution: number;
  generation: number;
  curves: Path2D[];
}

/** At most this many samplings are kept per graph (on screen, its thumbnail, a print). */
const KEPT_PER_GRAPH = 3;

const sampledByGraph = new WeakMap<GraphElement, Sampled[]>();

/** How many samplings have been made since the page opened: the harness reads this. */
export const graphStats = { samplings: 0, sampleMs: 0 };

/** The graph's curves sampled `resolution` device px across, now if no cached ones fit. */
function sampledCurves(graph: GraphElement, resolution: number): Path2D[] {
  const key = graphContentKey(graph);
  const list = sampledByGraph.get(graph) ?? [];
  const hit = list.find(
    (entry) =>
      entry.key === key && entry.resolution === resolution && entry.generation === generation,
  );
  if (hit) return hit.curves;
  const start = performance.now();
  const map: FrameMap = { xRange: graph.xRange, yRange: graph.yRange, w: graph.w, h: graph.h };
  const range: GraphRange = {
    xMin: graph.xRange[0],
    xMax: graph.xRange[1],
    yMin: graph.yRange[0],
    yMax: graph.yRange[1],
  };
  let sampled: Polyline[][] = [];
  try {
    sampled = engine.sample(
      graph.expressions.map((expression) => expression.text),
      range,
      resolution,
      (resolution * graph.h) / graph.w,
    );
  } catch {
    // An engine that throws draws no curves rather than no page.
  }
  // Far points are held a frame height past the edge, so lines still leave
  // at the right angle and canvas never sees a huge coordinate.
  const limit = graph.h * 2;
  const curves = graph.expressions.map((_, i) => {
    const path = new Path2D();
    for (const run of sampled[i] ?? []) {
      for (let j = 0; j + 1 < run.length; j += 2) {
        const x = frameX(map, run[j]);
        const y = Math.max(-limit, Math.min(graph.h + limit, frameY(map, run[j + 1])));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (j === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
    }
    return path;
  });
  graphStats.samplings++;
  graphStats.sampleMs += performance.now() - start;
  const fresh = list.filter((entry) => entry.key === key && entry.generation === generation);
  fresh.push({ key, resolution, generation, curves });
  sampledByGraph.set(graph, fresh.slice(-KEPT_PER_GRAPH));
  return curves;
}

/** What a graph is painted with besides its own fields. */
export interface GraphPaintOptions {
  /** Device px per page px: sets the sampling and keeps hairlines visible. */
  level: number;
  /** A night page: colours as `./night` shows them. */
  night: boolean;
  /** The card's fill, the paper's colour, so ruled lines do not run through the plot. */
  paper: string;
}

/** The grid's and axes' colours on the paper, before night mapping. */
const GRID_COLOR = "#d9dde3";
const AXIS_COLOR = "#5b6270";
const LABEL_COLOR = "#5b6270";
const FRAME_COLOR = "#c3c8d0";
/** The curve's width, page px. */
const CURVE_WIDTH = 2;
/** The numbers' size, page px. */
const LABEL_SIZE = 13;
/** Roughly how far apart grid lines are, page px. */
const GRID_SPACING = 40;

/**
 * Paint `graph` in page space into `ctx`: a card in the paper's colour,
 * the grid (unless off), the axes where they are in range, the numbers
 * (unless off), then each curve in its colour, all clipped to the frame.
 */
export function paintGraph(
  ctx: CanvasRenderingContext2D,
  graph: GraphElement,
  options: GraphPaintOptions,
): void {
  const { night } = options;
  const level = options.level > 0 && Number.isFinite(options.level) ? options.level : 1;
  const hair = Math.max(0.5, 1 / level);
  const map: FrameMap = { xRange: graph.xRange, yRange: graph.yRange, w: graph.w, h: graph.h };
  ctx.save();
  ctx.translate(graph.x, graph.y);
  ctx.beginPath();
  ctx.rect(0, 0, graph.w, graph.h);
  ctx.fillStyle = options.paper;
  ctx.fill();
  ctx.clip();

  const xStep = niceStep(graph.xRange[1] - graph.xRange[0], Math.max(1, graph.w / GRID_SPACING));
  const yStep = niceStep(graph.yRange[1] - graph.yRange[0], Math.max(1, graph.h / GRID_SPACING));
  const xTicks = ticks(graph.xRange, xStep);
  const yTicks = ticks(graph.yRange, yStep);
  if (graph.grid !== false) {
    const grid = new Path2D();
    for (const x of xTicks) {
      const fx = frameX(map, x);
      grid.moveTo(fx, 0);
      grid.lineTo(fx, graph.h);
    }
    for (const y of yTicks) {
      const fy = frameY(map, y);
      grid.moveTo(0, fy);
      grid.lineTo(graph.w, fy);
    }
    ctx.strokeStyle = shownColor(GRID_COLOR, night);
    ctx.lineWidth = hair;
    ctx.stroke(grid);
  }

  // The axes, where zero is in view; else along the edge zero is beyond.
  const ax = clamp(frameX(map, 0), 0, graph.w);
  const ay = clamp(frameY(map, 0), 0, graph.h);
  const axes = new Path2D();
  if (graph.xRange[0] <= 0 && graph.xRange[1] >= 0) {
    axes.moveTo(ax, 0);
    axes.lineTo(ax, graph.h);
  }
  if (graph.yRange[0] <= 0 && graph.yRange[1] >= 0) {
    axes.moveTo(0, ay);
    axes.lineTo(graph.w, ay);
  }
  ctx.strokeStyle = shownColor(AXIS_COLOR, night);
  ctx.lineWidth = Math.max(hair, 1);
  ctx.stroke(axes);

  if (graph.labels !== false) {
    ctx.fillStyle = shownColor(LABEL_COLOR, night);
    ctx.font = `${LABEL_SIZE}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    // Numbers sit beside the axis, kept inside the frame when it is off screen.
    const labelY = clamp(ay + 3, 2, graph.h - LABEL_SIZE - 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const x of xTicks) {
      if (x === 0) continue;
      const fx = frameX(map, x);
      if (fx < 8 || fx > graph.w - 8) continue;
      ctx.fillText(tickLabel(x, xStep), fx, labelY);
    }
    const right = ax < graph.w - 40;
    ctx.textAlign = right ? "left" : "right";
    ctx.textBaseline = "middle";
    const labelX = right ? clamp(ax + 3, 2, graph.w) : ax - 3;
    for (const y of yTicks) {
      if (y === 0) continue;
      const fy = frameY(map, y);
      if (fy < 8 || fy > graph.h - 8) continue;
      ctx.fillText(tickLabel(y, yStep), labelX, fy);
    }
  }

  const curves = sampledCurves(graph, sampleCount(graph.w, level));
  ctx.lineWidth = CURVE_WIDTH;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  curves.forEach((path, i) => {
    ctx.strokeStyle = shownColor(graph.expressions[i].color, night);
    ctx.stroke(path);
  });
  ctx.restore();

  // The card's edge, outside the clip so all of its width shows.
  ctx.save();
  ctx.strokeStyle = shownColor(FRAME_COLOR, night);
  ctx.lineWidth = hair;
  ctx.strokeRect(graph.x, graph.y, graph.w, graph.h);
  ctx.restore();
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** One value of `expression` at `x` with the current engine: NaN where it has none. */
export function sampleExpressionAt(expression: string, x: number): number {
  let fn = compiled.get(expression);
  if (fn === undefined) {
    try {
      fn = engine.compile(expression);
    } catch {
      fn = null;
    }
    compiled.set(expression, fn);
  }
  if (!fn) return Number.NaN;
  try {
    const y = fn(x);
    return typeof y === "number" ? y : Number.NaN;
  } catch {
    return Number.NaN;
  }
}
