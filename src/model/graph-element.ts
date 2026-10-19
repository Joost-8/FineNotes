/**
 * Graphs as one page element (`GraphElement`): a y = f(x) plot from the
 * calculator, placed on a page and kept there. Only what it shows is stored
 * (the expressions, their colours, the ranges, a frame); the curve itself is
 * sampled again whenever it is drawn, at the resolution it is drawn at, so a
 * graph costs a few hundred bytes of JSON however sharp it is printed.
 *
 * Like a table it is drawn under the ink, stays upright and is moved,
 * resized, copied and deleted by the lasso with every other element. Its
 * own edits (the range after exploring, the expressions after editing) are
 * {@link EditGraph}, one undo step each.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { type GraphElement, type GraphExpression, type InkDocument, pageById } from "./document";
import { isHexColor } from "./text-style";

/** A graph is never smaller than this a side, page px: room for its axes. */
export const GRAPH_MIN_SIDE = 40;
/** Nor larger: a page is at most a few thousand px. */
export const GRAPH_MAX_SIDE = 4000;
/** The most expressions one graph keeps. */
export const GRAPH_MAX_EXPRESSIONS = 8;
/** The longest expression kept, characters: past it, a file is not something anyone typed. */
export const GRAPH_MAX_EXPRESSION_LENGTH = 500;
/** The narrowest and widest a range may be: past either, a double can no longer tell its ticks apart. */
export const GRAPH_MIN_SPAN = 1e-9;
export const GRAPH_MAX_SPAN = 1e9;
/** A range's ends stay inside this, so a pan can never carry it to infinity. */
const GRAPH_MAX_ABS = 1e12;
/** The size a graph is placed at, page px. */
export const GRAPH_DEFAULT_W = 320;
export const GRAPH_DEFAULT_H = 240;
/** The colour an expression is drawn in when the file has none to give. */
export const GRAPH_DEFAULT_COLOR = "#2f6fdf";
/** The ranges a graph opens at when nothing better is known. */
const DEFAULT_RANGE: readonly [number, number] = [-10, 10];

/** What a new graph is made from. */
export interface NewGraph {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  expressions: readonly GraphExpression[];
  xRange: readonly [number, number];
  yRange: readonly [number, number];
  grid?: boolean;
  labels?: boolean;
}

/** A graph ready to go on a page, its fields as the loader would keep them. */
export function makeGraph(spec: NewGraph): GraphElement {
  const graph = normalizeGraph(
    {
      id: spec.id,
      x: spec.x,
      y: spec.y,
      w: spec.w ?? GRAPH_DEFAULT_W,
      h: spec.h ?? GRAPH_DEFAULT_H,
      expressions: spec.expressions,
      xRange: spec.xRange,
      yRange: spec.yRange,
      ...(spec.grid === false ? { grid: false } : {}),
      ...(spec.labels === false ? { labels: false } : {}),
    },
    () => spec.id,
  );
  // `normalizeGraph` only refuses a graph with no expression; keep an empty one placeable.
  return (
    graph ?? {
      id: spec.id,
      x: finite(spec.x, 0),
      y: finite(spec.y, 0),
      w: side(spec.w, GRAPH_DEFAULT_W),
      h: side(spec.h, GRAPH_DEFAULT_H),
      expressions: [],
      xRange: readRange(spec.xRange),
      yRange: readRange(spec.yRange),
    }
  );
}

/** A graph id not yet used anywhere in `doc`: one above the highest `f<N>`. */
export function nextGraphId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const graph of page.graphs ?? []) {
      const match = /^f(\d+)$/.exec(graph.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `f${max + 1}`;
}

/**
 * What a graph's drawing depends on, as one string: its expressions,
 * colours, ranges, size and options. A cached curve or raster is good
 * while this is unchanged. Its place on the page is not in it: moving a
 * graph moves the same picture.
 */
export function graphContentKey(graph: GraphElement): string {
  return JSON.stringify([
    graph.expressions.map((e) => [e.text, e.color]),
    graph.xRange,
    graph.yRange,
    round2(graph.w),
    round2(graph.h),
    graph.grid === false ? 0 : 1,
    graph.labels === false ? 0 : 1,
  ]);
}

/** Where a graph sits on its page, page px. */
export function graphBounds(graph: Pick<GraphElement, "x" | "y" | "w" | "h">): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return { minX: graph.x, minY: graph.y, maxX: graph.x + graph.w, maxY: graph.y + graph.h };
}

/**
 * Scale a graph by `k` (a lasso resize) about (ax, ay): its place and its
 * frame. Its ranges stay, so the same curve is shown larger.
 */
export function scaleGraph(graph: GraphElement, ax: number, ay: number, k: number): void {
  if (!(k > 0) || !Number.isFinite(k)) return;
  graph.x = ax + (graph.x - ax) * k;
  graph.y = ay + (graph.y - ay) * k;
  graph.w = side(graph.w * k, graph.w);
  graph.h = side(graph.h * k, graph.h);
}

// --- Exploring: ranges after a pan or a pinch ---------------------------------

/** A graph's two ranges. */
export interface GraphView {
  xRange: [number, number];
  yRange: [number, number];
}

/**
 * The view after dragging the plot by (dx, dy) page px inside a `w` x `h`
 * frame: the curve follows the finger, so the ranges move the other way
 * (y grows upwards on a graph, downwards on a page).
 */
export function panView(view: GraphView, dx: number, dy: number, w: number, h: number): GraphView {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return copyView(view);
  const ux = ((view.xRange[1] - view.xRange[0]) * dx) / w;
  const uy = ((view.yRange[1] - view.yRange[0]) * dy) / h;
  return {
    xRange: shiftRange(view.xRange, -ux),
    yRange: shiftRange(view.yRange, uy),
  };
}

/**
 * The view after zooming by `k` (> 1 in) about the frame point (fx, fy),
 * page px from the frame's top-left: that point keeps the same value. `kx`
 * and `ky` may differ (a pinch along one axis). A span past
 * {@link GRAPH_MIN_SPAN} or {@link GRAPH_MAX_SPAN} stops there.
 */
export function zoomView(
  view: GraphView,
  kx: number,
  ky: number,
  fx: number,
  fy: number,
  w: number,
  h: number,
): GraphView {
  if (!(w > 0) || !(h > 0)) return copyView(view);
  const ax = view.xRange[0] + ((view.xRange[1] - view.xRange[0]) * fx) / w;
  const ay = view.yRange[1] - ((view.yRange[1] - view.yRange[0]) * fy) / h;
  return {
    xRange: zoomRange(view.xRange, kx, ax),
    yRange: zoomRange(view.yRange, ky, ay),
  };
}

/** The value at frame point (fx, fy), page px from the frame's top-left. */
export function valueAt(
  view: GraphView,
  fx: number,
  fy: number,
  w: number,
  h: number,
): { x: number; y: number } {
  return {
    x: view.xRange[0] + ((view.xRange[1] - view.xRange[0]) * fx) / w,
    y: view.yRange[1] - ((view.yRange[1] - view.yRange[0]) * fy) / h,
  };
}

/** Whether two views show the same thing, to the last bit. */
export function sameView(a: GraphView, b: GraphView): boolean {
  return (
    a.xRange[0] === b.xRange[0] &&
    a.xRange[1] === b.xRange[1] &&
    a.yRange[0] === b.yRange[0] &&
    a.yRange[1] === b.yRange[1]
  );
}

// --- Commands ------------------------------------------------------------------

/** Put a graph on a page, above the graphs already there. */
export class AddGraph implements Command {
  readonly label = "Add graph";
  /** Whether the page had no `graphs` list before, so undo leaves it without one. */
  private created = false;

  constructor(
    readonly pageId: string,
    private readonly graph: GraphElement,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.created = page.graphs === undefined;
    (page.graphs ??= []).push(this.graph);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    const graphs = page?.graphs;
    if (!page || !graphs) return;
    const index = graphs.indexOf(this.graph);
    if (index >= 0) graphs.splice(index, 1);
    if (this.created && graphs.length === 0) delete page.graphs;
  }
}

/** What a graph edit may change: its view, its expressions, its options. */
export interface GraphChanges {
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  expressions?: readonly GraphExpression[];
  grid?: boolean;
  labels?: boolean;
}

/**
 * A change to one graph (the range Explore left it at, the expressions Edit
 * gave it), undone by putting back the exact object it was, key order
 * included. The graph is held by identity, as every selection command holds
 * its elements.
 */
export class EditGraph implements Command {
  private before: GraphElement | null = null;

  constructor(
    readonly pageId: string,
    private readonly graph: GraphElement,
    private readonly changes: GraphChanges,
    readonly label = changes.expressions ? "Edit graph" : "Move graph view",
  ) {}

  apply(doc: InkDocument): void {
    this.before = null;
    const page = pageById(doc, this.pageId);
    if (!page?.graphs?.includes(this.graph)) return;
    this.before = structuredClone(this.graph);
    const c = this.changes;
    if (c.xRange) this.graph.xRange = readRange(c.xRange, this.graph.xRange);
    if (c.yRange) this.graph.yRange = readRange(c.yRange, this.graph.yRange);
    if (c.expressions) this.graph.expressions = readExpressions(c.expressions);
    if (c.grid === false) this.graph.grid = false;
    else if (c.grid === true) delete this.graph.grid;
    if (c.labels === false) this.graph.labels = false;
    else if (c.labels === true) delete this.graph.labels;
  }

  invert(doc: InkDocument): void {
    const before = this.before;
    const page = pageById(doc, this.pageId);
    if (!before || !page?.graphs?.includes(this.graph)) return;
    restoreGraph(this.graph, before);
    this.before = null;
  }
}

/** Put `before`'s fields back on `graph`, in `before`'s key order. */
export function restoreGraph(graph: GraphElement, before: GraphElement): void {
  const target = graph as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(graph, structuredClone(before));
}

// --- Reading from disk ----------------------------------------------------------

/**
 * A stored graph as the model keeps it, or `null` when it is not one (no
 * expression to draw). A range that is reversed, empty or not finite reads
 * as the default; a frame out of range is clamped to a size that can be
 * seen and grabbed, since the expressions are the user's.
 */
export function normalizeGraph(raw: unknown, mintId: () => string): GraphElement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const expressions = readExpressions(r.expressions);
  if (expressions.length === 0) return null;
  const graph: GraphElement = {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id : mintId(),
    x: finite(r.x, 0),
    y: finite(r.y, 0),
    w: side(r.w, GRAPH_DEFAULT_W),
    h: side(r.h, GRAPH_DEFAULT_H),
    expressions,
    xRange: readRange(r.xRange),
    yRange: readRange(r.yRange),
  };
  if (r.grid === false) graph.grid = false;
  if (r.labels === false) graph.labels = false;
  return graph;
}

function readExpressions(raw: unknown): GraphExpression[] {
  if (!Array.isArray(raw)) return [];
  const out: GraphExpression[] = [];
  for (const item of raw) {
    if (out.length >= GRAPH_MAX_EXPRESSIONS) break;
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.text !== "string") continue;
    const text = e.text.trim().slice(0, GRAPH_MAX_EXPRESSION_LENGTH);
    if (text.length === 0) continue;
    out.push({ text, color: isHexColor(e.color) ? e.color : GRAPH_DEFAULT_COLOR });
  }
  return out;
}

/** A range as `[lo, hi]` with `lo < hi`, both finite and the span inside the limits; else `fallback`. */
function readRange(
  raw: unknown,
  fallback: readonly [number, number] = DEFAULT_RANGE,
): [number, number] {
  if (Array.isArray(raw) && raw.length === 2) {
    const [lo, hi] = raw as unknown[];
    if (
      typeof lo === "number" &&
      typeof hi === "number" &&
      Number.isFinite(lo) &&
      Number.isFinite(hi) &&
      Math.abs(lo) <= GRAPH_MAX_ABS &&
      Math.abs(hi) <= GRAPH_MAX_ABS &&
      hi - lo >= GRAPH_MIN_SPAN &&
      hi - lo <= GRAPH_MAX_SPAN
    ) {
      return [lo, hi];
    }
  }
  return [fallback[0], fallback[1]];
}

function shiftRange(range: readonly [number, number], by: number): [number, number] {
  const lo = range[0] + by;
  const hi = range[1] + by;
  if (
    !Number.isFinite(lo) ||
    !Number.isFinite(hi) ||
    Math.max(Math.abs(lo), Math.abs(hi)) > GRAPH_MAX_ABS
  ) {
    return [range[0], range[1]];
  }
  return [lo, hi];
}

function zoomRange(range: readonly [number, number], k: number, about: number): [number, number] {
  if (!(k > 0) || !Number.isFinite(k)) return [range[0], range[1]];
  const span = range[1] - range[0];
  const next = Math.min(GRAPH_MAX_SPAN, Math.max(GRAPH_MIN_SPAN, span / k));
  const ratio = next / span;
  const lo = about - (about - range[0]) * ratio;
  const hi = lo + next;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return [range[0], range[1]];
  if (Math.max(Math.abs(lo), Math.abs(hi)) > GRAPH_MAX_ABS) return [range[0], range[1]];
  return [lo, hi];
}

function copyView(view: GraphView): GraphView {
  return { xRange: [view.xRange[0], view.xRange[1]], yRange: [view.yRange[0], view.yRange[1]] };
}

function finite(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function side(raw: unknown, fallback: number): number {
  const value = finite(raw, fallback);
  return Math.min(GRAPH_MAX_SIDE, Math.max(GRAPH_MIN_SIDE, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
