/**
 * Graphs as one page element (`GraphElement`): a plot from the calculator,
 * placed on a page and kept there. What is stored is the calculator's own
 * graph (`GraphSpec`, kept whole as plain JSON), the curves' colours and a
 * frame; the curves are sampled again whenever they are drawn, at the
 * resolution they are drawn at, so a graph costs a few hundred bytes however
 * sharp it is printed. Because the spec is kept whole, a field the
 * calculator adds later (sliders, points, other kinds of curve) survives a
 * save, a lasso copy and an undo here unchanged, and is drawn by the
 * calculator's code.
 *
 * Like a table it is drawn under the ink, stays upright and is moved,
 * resized, copied and deleted by the lasso with every other element. Its
 * own edits (the view after exploring, the spec after editing) are
 * {@link EditGraph}, one undo step each.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { type GraphElement, type GraphSpecData, type InkDocument, pageById } from "./document";
import { isHexColor } from "./text-style";
import type { GraphSpec } from "./graph";
import { normalizeGraphSpec } from "./graph-lines";
import { LINE_COLORS } from "./graph-sample";

/** A graph is never smaller than this a side, page px: room for its axes. */
export const GRAPH_MIN_SIDE = 40;
/** Nor larger: a page is at most a few thousand px. */
export const GRAPH_MAX_SIDE = 4000;
/** The largest spec kept, as JSON characters: past it, a file is not a graph anyone made. */
export const GRAPH_MAX_SPEC_CHARS = 65536;
/** The narrowest and widest a range may be: past either, a double can no longer tell its ticks apart. */
export const GRAPH_MIN_SPAN = 1e-9;
export const GRAPH_MAX_SPAN = 1e9;
/** A range's ends stay inside this, so a pan can never carry it to infinity. */
const GRAPH_MAX_ABS = 1e12;
/** The size a graph is placed at, page px. */
export const GRAPH_DEFAULT_W = 320;
export const GRAPH_DEFAULT_H = 240;
/** The ranges a graph opens at when nothing better is known. */
const DEFAULT_RANGE: readonly [number, number] = [-10, 10];

/**
 * Curve colours for lines without their own: the calculator's palette
 * (Desmos' order), so a graph on the page reads as it did in the pop-up.
 */
export const GRAPH_COLORS: readonly string[] = LINE_COLORS;

/** What a new graph is made from. */
export interface NewGraph {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  spec: GraphSpec | GraphSpecData;
  colors?: readonly string[];
  grid?: boolean;
  labels?: boolean;
}

/**
 * A graph ready to go on a page, its fields as the loader would keep them.
 * A spec the loader would refuse (no expression list) still makes a graph,
 * with an empty one, so a caller can test `spec.expressions.length`.
 */
export function makeGraph(spec: NewGraph): GraphElement {
  const stored = readSpec(spec.spec) ?? { ...defaultView(), expressions: [] };
  const graph: GraphElement = {
    id: spec.id,
    x: finite(spec.x, 0),
    y: finite(spec.y, 0),
    w: side(spec.w, GRAPH_DEFAULT_W),
    h: side(spec.h, GRAPH_DEFAULT_H),
    spec: stored,
    colors: colorsFor(stored, spec.colors ?? []),
  };
  if (spec.grid === false) graph.grid = false;
  if (spec.labels === false) graph.labels = false;
  return graph;
}

/**
 * A graph element at (x, y) from the calculator's `GraphSpec`, kept whole.
 * `colors` gives each expression's colour by position (Edit passes the
 * graph's own, so a curve keeps its colour); the rest take the palette's.
 */
export function graphFromSpec(
  id: string,
  x: number,
  y: number,
  spec: GraphSpec,
  colors: readonly string[] = [],
): GraphElement {
  return makeGraph({ id, x, y, spec, colors });
}

/** A graph's spec for the calculator again (Edit): a copy, every field it holds. */
export function specOfGraph(graph: GraphElement): GraphSpec {
  return structuredClone(graph.spec);
}

/** The colour of expression `index`: its own, else the palette's. */
export function curveColor(graph: Pick<GraphElement, "colors">, index: number): string {
  const own = graph.colors[index];
  return isHexColor(own) ? own : GRAPH_COLORS[index % GRAPH_COLORS.length];
}

/**
 * The height a graph `w` page px wide is placed at: the shape of its view,
 * so a plot that had equal x and y scales in the pop-up keeps them on the
 * page, between half and the whole of its width. `fallback` when the view
 * has no usable shape.
 */
export function graphFrameHeight(spec: GraphSpec, w: number, fallback: number): number {
  const ratio = (spec.yMax - spec.yMin) / (spec.xMax - spec.xMin);
  if (!(ratio > 0) || !Number.isFinite(ratio)) return fallback;
  return Math.round(w * Math.min(1, Math.max(0.5, ratio)));
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
 * What a graph's drawing depends on, as one string: its whole spec, its
 * colours, its size and options. A cached curve or raster is good while
 * this is unchanged. Its place on the page is not in it: moving a graph
 * moves the same picture.
 */
export function graphContentKey(graph: GraphElement): string {
  return JSON.stringify([
    graph.spec,
    graph.colors,
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
 * frame. Its view stays, so the same curve is shown larger.
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

/** The view a graph shows now. */
export function viewOf(graph: Pick<GraphElement, "spec">): GraphView {
  const s = graph.spec;
  return { xRange: [s.xMin, s.xMax], yRange: [s.yMin, s.yMax] };
}

/** Show `view` in `graph`: only the spec's four view fields change. */
export function setView(graph: Pick<GraphElement, "spec">, view: GraphView): void {
  graph.spec.xMin = view.xRange[0];
  graph.spec.xMax = view.xRange[1];
  graph.spec.yMin = view.yRange[0];
  graph.spec.yMax = view.yRange[1];
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
 * and `ky` may differ. A span past {@link GRAPH_MIN_SPAN} or
 * {@link GRAPH_MAX_SPAN} stops there.
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

/** What a graph edit may change: its whole spec (Edit), its view alone (Explore), colours, options. */
export interface GraphChanges {
  spec?: GraphSpec | GraphSpecData;
  view?: GraphView;
  colors?: readonly string[];
  grid?: boolean;
  labels?: boolean;
}

/**
 * A change to one graph (the view Explore left it at, the spec Edit gave
 * it), undone by putting back the exact object it was, key order included.
 * The graph is held by identity, as every selection command holds its
 * elements. A spec that cannot be read changes nothing.
 */
export class EditGraph implements Command {
  private before: GraphElement | null = null;

  constructor(
    readonly pageId: string,
    private readonly graph: GraphElement,
    private readonly changes: GraphChanges,
    readonly label = changes.spec ? "Edit graph" : "Move graph view",
  ) {}

  apply(doc: InkDocument): void {
    this.before = null;
    const page = pageById(doc, this.pageId);
    if (!page?.graphs?.includes(this.graph)) return;
    this.before = structuredClone(this.graph);
    const c = this.changes;
    if (c.spec) {
      const spec = readSpec(c.spec);
      if (spec) this.graph.spec = spec;
    }
    if (c.view) {
      const now = viewOf(this.graph);
      setView(this.graph, {
        xRange: readRange(c.view.xRange, now.xRange),
        yRange: readRange(c.view.yRange, now.yRange),
      });
    }
    if (c.colors) this.graph.colors = colorsFor(this.graph.spec, c.colors);
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
 * spec with an expression list). The spec is kept whole; a view that is
 * reversed, empty or not finite reads as the default; a frame out of range
 * is clamped to a size that can be seen and grabbed, since what it plots is
 * the user's. A graph saved before the spec was kept whole (expressions as
 * `{ text, color }`, `xRange`, `yRange`, `angle`) reads into the same shape.
 */
export function normalizeGraph(raw: unknown, mintId: () => string): GraphElement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const early = r.spec === undefined ? earlyShape(r) : null;
  const spec = readSpec(early?.spec ?? r.spec);
  if (!spec || spec.expressions.length === 0) return null;
  const colors = early?.colors ?? (Array.isArray(r.colors) ? (r.colors as unknown[]) : []);
  const graph: GraphElement = {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id : mintId(),
    x: finite(r.x, 0),
    y: finite(r.y, 0),
    w: side(r.w, GRAPH_DEFAULT_W),
    h: side(r.h, GRAPH_DEFAULT_H),
    spec,
    colors: colorsFor(spec, colors),
  };
  if (r.grid === false) graph.grid = false;
  if (r.labels === false) graph.labels = false;
  return graph;
}

/** A graph as the first builds stored it, as a spec and colours; null when it is not one. */
function earlyShape(r: Record<string, unknown>): { spec: unknown; colors: unknown[] } | null {
  if (!Array.isArray(r.expressions)) return null;
  const items = (r.expressions as unknown[]).filter(
    (e): e is { text: string; color?: unknown } =>
      typeof e === "object" && e !== null && typeof (e as { text?: unknown }).text === "string",
  );
  const x = Array.isArray(r.xRange) ? (r.xRange as unknown[]) : [];
  const y = Array.isArray(r.yRange) ? (r.yRange as unknown[]) : [];
  return {
    spec: {
      expressions: items.map((e) => e.text),
      xMin: x[0],
      xMax: x[1],
      yMin: y[0],
      yMax: y[1],
      ...(r.angle === "deg" ? { angle: "deg" } : {}),
    },
    colors: items.map((e) => e.color),
  };
}

/**
 * A spec as the page keeps it: a deep copy through JSON (so nothing but
 * plain data is stored, and nothing shared with the caller), read by the
 * calculator's own `normalizeGraphSpec` (a version 1 spec becomes lines,
 * known fields are checked, unknown ones kept at every level). Null when
 * it is not an object, holds no lines or expressions, cannot be written as
 * JSON, or is too large. The view is repaired per axis first.
 */
function readSpec(raw: unknown): GraphSpecData | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  let text: string;
  try {
    text = JSON.stringify(raw);
  } catch {
    return null;
  }
  if (typeof text !== "string" || text.length > GRAPH_MAX_SPEC_CHARS) return null;
  const spec = JSON.parse(text) as Record<string, unknown>;
  if (!Array.isArray(spec.lines) && !Array.isArray(spec.expressions)) return null;
  const x = readRange([spec.xMin, spec.xMax]);
  const y = readRange([spec.yMin, spec.yMax]);
  spec.xMin = x[0];
  spec.xMax = x[1];
  spec.yMin = y[0];
  spec.yMax = y[1];
  if (spec.angle !== undefined && spec.angle !== "deg" && spec.angle !== "rad") delete spec.angle;
  try {
    return normalizeGraphSpec(
      spec as Record<string, unknown> & { xMin: number; xMax: number; yMin: number; yMax: number },
    );
  } catch {
    return null;
  }
}

/** One colour per expression of `spec`: the given one by position when it is a colour, else the palette's. */
function colorsFor(spec: GraphSpecData, colors: readonly unknown[]): string[] {
  return spec.expressions.map((_, i) => {
    const color = colors[i];
    return isHexColor(color) ? color : GRAPH_COLORS[i % GRAPH_COLORS.length];
  });
}

function defaultView(): { xMin: number; xMax: number; yMin: number; yMax: number } {
  return {
    xMin: DEFAULT_RANGE[0],
    xMax: DEFAULT_RANGE[1],
    yMin: DEFAULT_RANGE[0],
    yMax: DEFAULT_RANGE[1],
  };
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
