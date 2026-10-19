/**
 * A graph's lines: what each one plots, read from what the user typed.
 * Pure: no DOM.
 *
 * A {@link GraphSpec} (`./graph`) is the whole graph as one plain object.
 * From version 2 its `lines` carry each line's text and look (colour,
 * hidden, dashed, width, calculus overlays), `sliders` the letters it
 * varies, and view switches. Fields this version does not know are kept
 * as they are, so a newer FineNotes's graph survives an older one's edit.
 * `expressions` mirrors the lines' text for readers of version 1.
 *
 * What a line plots is decided from its text, as Desmos does:
 *
 * | typed                         | plots                                 |
 * |-------------------------------|---------------------------------------|
 * | `sin x`, `y = x²`, `f(x) = …` | a function of x                       |
 * | `x = y²`                      | x as a function of y                  |
 * | `x = 3`                       | a vertical line                       |
 * | `y < sin x`, `x ≥ 2`          | a shaded region, dashed edge if strict |
 * | `x² + y² = 25`                | an implicit curve (marching squares)  |
 * | `x² + y² < 25`                | an implicit region                    |
 * | `(cos t, sin t)`              | a parametric curve, t from 0 to 2π    |
 * | `r = 1 + cos θ`               | a polar curve, θ from 0 to 2π         |
 * | `(1, 2), (3, a)`              | points                                |
 * | `… {0 < x < 5}`               | the same, restricted                  |
 *
 * Any other letter (`a`, `k`) is a slider.
 */

import {
  type AngleMode,
  type CalcNode,
  type Relation,
  type VarFn,
  compileVars,
  namesIn,
  parseExpression,
} from "./calculator";

export const GRAPH_SPEC_VERSION = 2;
/** The most lines one graph keeps (Joost: about eight). */
export const MAX_LINES = 8;

export type LineStyle = "solid" | "dashed";

/** One line of a graph's list. Unknown fields are kept. */
export interface GraphLine {
  /** Stable while the line exists, for its colour, slider and reorder. */
  id: string;
  /** What was typed. */
  text: string;
  /** `#rrggbb`; the list's colour by position when absent. */
  color?: string;
  hidden?: boolean;
  style?: LineStyle;
  /** Stroke width, CSS px (default 2.25). */
  width?: number;
  /** Shade ∫ from a to b under a function of x, with its value. */
  area?: [number, number];
  /** Plot the derivative too (dashed, same colour). */
  derivative?: boolean;
  /** Draw the tangent at this x. */
  tangentAt?: number;
  /** Show a table of values under the line in the list. */
  table?: boolean;
  [key: string]: unknown;
}

/** A letter the graph varies. Unknown fields are kept. */
export interface GraphSlider {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  [key: string]: unknown;
}

export const DEFAULT_SLIDER: Readonly<{ value: number; min: number; max: number; step: number }> = {
  value: 1,
  min: -10,
  max: 10,
  step: 0.1,
};

/** Names a line may use without becoming a slider. */
const GRAPH_VARIABLES = new Set(["x", "y", "t", "theta", "r"]);

/** What a line's text plots. Each function reads its variables from one map (sliders included). */
export type Plot =
  | { kind: "function"; f: VarFn }
  | { kind: "sideways"; g: VarFn }
  | { kind: "vertical"; c: VarFn }
  | { kind: "region"; f: VarFn; below: boolean; strict: boolean }
  | { kind: "vregion"; c: VarFn; left: boolean; strict: boolean }
  | { kind: "implicit"; F: VarFn; rel: Relation }
  | { kind: "parametric"; X: VarFn; Y: VarFn; from: number; to: number }
  | { kind: "polar"; R: VarFn; from: number; to: number }
  | { kind: "points"; points: Array<[VarFn, VarFn]> }
  | { kind: "empty" }
  | { kind: "error"; error: string };

/** A line read and compiled: its plot, the domain it is restricted to, and its slider letters. */
export interface CompiledLine {
  plot: Plot;
  /** True where the line is shown; absent means everywhere. */
  domain?: VarFn;
  /** Letters it varies (each gets a slider). */
  free: string[];
}

// --- Spec ---------------------------------------------------------------------

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

const finiteOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** A line from stored data, its known fields checked and its unknown ones kept. */
function normalizeLine(raw: unknown, id: string): GraphLine | null {
  if (typeof raw === "string") return { id, text: raw };
  if (!isRecord(raw) || typeof raw.text !== "string") return null;
  const line: GraphLine = {
    ...raw,
    id: typeof raw.id === "string" && raw.id ? raw.id : id,
    text: raw.text,
  };
  if (
    line.color !== undefined &&
    !(typeof line.color === "string" && /^#[0-9a-f]{6}$/i.test(line.color))
  ) {
    delete line.color;
  }
  if (line.hidden !== undefined && line.hidden !== true) delete line.hidden;
  if (line.style !== undefined && line.style !== "dashed" && line.style !== "solid")
    delete line.style;
  if (line.width !== undefined) {
    const w = finiteOr(line.width, 0);
    if (w > 0) line.width = Math.min(12, w);
    else delete line.width;
  }
  const area = line.area;
  if (area !== undefined) {
    const ok =
      Array.isArray(area) &&
      area.length === 2 &&
      area.every((v) => typeof v === "number" && Number.isFinite(v));
    if (!ok) delete line.area;
  }
  if (line.derivative !== undefined && line.derivative !== true) delete line.derivative;
  if (line.table !== undefined && line.table !== true) delete line.table;
  if (
    line.tangentAt !== undefined &&
    !(typeof line.tangentAt === "number" && Number.isFinite(line.tangentAt))
  ) {
    delete line.tangentAt;
  }
  return line;
}

function normalizeSlider(raw: unknown): GraphSlider | null {
  if (!isRecord(raw) || typeof raw.name !== "string" || !/^[a-z]$/.test(raw.name)) return null;
  let min = finiteOr(raw.min, DEFAULT_SLIDER.min);
  let max = finiteOr(raw.max, DEFAULT_SLIDER.max);
  if (min > max) [min, max] = [max, min];
  if (min === max) max = min + 1;
  const step = Math.max(0, finiteOr(raw.step, DEFAULT_SLIDER.step));
  return {
    ...raw,
    name: raw.name,
    value: finiteOr(raw.value, DEFAULT_SLIDER.value),
    min,
    max,
    step,
  };
}

/**
 * A spec from stored data: version 1 (`expressions` only) is read into
 * lines, ids are made unique, known fields are checked, unknown fields are
 * kept, and `expressions` mirrors the lines again.
 */
export function normalizeGraphSpec<
  T extends { xMin: number; xMax: number; yMin: number; yMax: number },
>(
  raw: T & Record<string, unknown>,
): T & { version: number; lines: GraphLine[]; sliders: GraphSlider[]; expressions: string[] } {
  const source = Array.isArray(raw.lines)
    ? raw.lines
    : Array.isArray(raw.expressions)
      ? raw.expressions
      : [];
  const used = new Set<string>();
  const lines: GraphLine[] = [];
  source.forEach((entry: unknown, i: number) => {
    const line = normalizeLine(entry, `l${i + 1}`);
    if (!line || lines.length >= MAX_LINES) return;
    let id = line.id;
    for (let n = 1; used.has(id); n++) id = `l${i + 1}-${n}`;
    used.add(id);
    lines.push({ ...line, id });
  });
  const sliders: GraphSlider[] = [];
  if (Array.isArray(raw.sliders)) {
    for (const entry of raw.sliders as unknown[]) {
      const slider = normalizeSlider(entry);
      if (slider && !sliders.some((s) => s.name === slider.name)) sliders.push(slider);
    }
  }
  return {
    ...raw,
    version: Math.max(GRAPH_SPEC_VERSION, finiteOr(raw.version, GRAPH_SPEC_VERSION)),
    lines,
    sliders,
    expressions: lines.map((line) => line.text),
  };
}

/** A fresh id for a new line, unlike any in `lines`. */
export function newLineId(lines: readonly GraphLine[]): string {
  let n = lines.length + 1;
  while (lines.some((line) => line.id === `l${n}`)) n++;
  return `l${n}`;
}

/**
 * Sliders for every letter the lines use and no slider for one they no
 * longer do; a slider kept keeps its value and bounds.
 */
export function syncSliders(
  sliders: readonly GraphSlider[],
  compiled: readonly CompiledLine[],
): GraphSlider[] {
  const wanted: string[] = [];
  for (const line of compiled)
    for (const name of line.free) if (!wanted.includes(name)) wanted.push(name);
  wanted.sort();
  return wanted.map((name) => sliders.find((s) => s.name === name) ?? { name, ...DEFAULT_SLIDER });
}

/** The sliders' values, as the variables every line's functions read. */
export function sliderVars(sliders: readonly GraphSlider[]): Map<string, number> {
  const vars = new Map<string, number>();
  for (const slider of sliders) vars.set(slider.name, slider.value);
  return vars;
}

// --- Reading a line -----------------------------------------------------------

/** Where a top-level `{` restriction starts, or -1. */
function restrictionStart(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "{" && depth === 0) return i;
  }
  return -1;
}

/** Split at top-level commas (outside brackets). */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** `(a, b)` as its two parts, or null. */
function pairOf(text: string): [string, string] | null {
  const t = text.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) return null;
  // The outer brackets must be one pair.
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")") depth--;
    if (depth === 0 && i < t.length - 1) return null;
  }
  const inner = splitTop(t.slice(1, -1));
  return inner.length === 2 ? [inner[0], inner[1]] : null;
}

type Parsed = { ok: true; node: CalcNode } | { ok: false; error: string };

function parse(text: string, relations = false): Parsed {
  return parseExpression(text, 10, { letters: true, relations });
}

const isName = (node: CalcNode, name: string): boolean => node.k === "name" && node.name === name;
const uses = (node: CalcNode, name: string): boolean => namesIn(node).includes(name);
const flip: Readonly<Record<Relation, Relation>> = {
  "=": "=",
  "<": ">",
  ">": "<",
  "<=": ">=",
  ">=": "<=",
};

/** A relation chain such as `0 < x < 5` (or several, comma-separated) as one test. */
function compileRestriction(
  text: string,
  angle: AngleMode,
): { test: VarFn; free: string[] } | { error: string } {
  const tests: VarFn[] = [];
  const free = new Set<string>();
  for (const clause of splitTop(text)) {
    const parts: string[] = [];
    const ops: Relation[] = [];
    let rest = clause.replace(/≤/g, "<=").replace(/≥/g, ">=");
    for (;;) {
      const m = /<=|>=|<|>|=/.exec(rest);
      if (!m) break;
      parts.push(rest.slice(0, m.index));
      ops.push(m[0] as Relation);
      rest = rest.slice(m.index + m[0].length);
    }
    parts.push(rest);
    if (ops.length === 0) return { error: "A restriction needs < or >" };
    const fns: VarFn[] = [];
    for (const part of parts) {
      const parsed = parse(part);
      if (!parsed.ok) return { error: parsed.error };
      for (const name of namesIn(parsed.node)) free.add(name);
      fns.push(compileVars(parsed.node, angle));
    }
    tests.push((vars) => {
      for (let i = 0; i < ops.length; i++) {
        const a = fns[i](vars);
        const b = fns[i + 1](vars);
        if (!compare(a, ops[i], b)) return 0;
      }
      return 1;
    });
  }
  return { test: (vars) => (tests.every((t) => t(vars) === 1) ? 1 : 0), free: [...free] };
}

export function compare(a: number, rel: Relation, b: number): boolean {
  switch (rel) {
    case "<":
      return a < b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    case ">=":
      return a >= b;
    default:
      return a === b;
  }
}

/** The constant bounds `a < v < b` put on a variable, when a restriction says so plainly. */
function boundsOf(text: string, variable: string): [number, number] | null {
  const v = variable === "theta" ? "(?:θ|theta)" : variable;
  const num = "(-?[0-9.]+(?:π|pi)?|-?(?:π|pi))";
  const plain = text.replace(/≤/g, "<=").replace(/≥/g, ">=");
  const m = new RegExp(`^\\s*${num}\\s*<=?\\s*${v}\\s*<=?\\s*${num}\\s*$`).exec(plain);
  if (!m) return null;
  const read = (s: string): number => {
    const pi = /π|pi/.test(s);
    const n = s.replace(/π|pi/, "");
    const k = n === "" ? 1 : n === "-" ? -1 : Number(n);
    return pi ? k * Math.PI : k;
  };
  const a = read(m[1]);
  const b = read(m[2]);
  return Number.isFinite(a) && Number.isFinite(b) && a < b ? [a, b] : null;
}

/** Letters other than the line's own variables: its sliders. */
function slidersIn(nodes: readonly CalcNode[], own: readonly string[]): string[] {
  const out = new Set<string>();
  for (const node of nodes) {
    for (const name of namesIn(node)) {
      if (!own.includes(name) && !GRAPH_VARIABLES.has(name)) out.add(name);
    }
  }
  return [...out];
}

/** A name the line uses that it cannot (a graph variable where it means nothing, or a long name). */
function strayName(nodes: readonly CalcNode[], own: readonly string[]): string | null {
  for (const node of nodes) {
    for (const name of namesIn(node)) {
      if (own.includes(name)) continue;
      if (GRAPH_VARIABLES.has(name)) return name === "theta" ? "θ" : name;
      if (name.length > 1) return name;
    }
  }
  return null;
}

/**
 * What `text` plots, compiled. Never throws: a line that cannot be read is
 * `{ kind: "error" }` with a short message, and the others still draw.
 */
export function compileLine(text: string, angle: AngleMode = "rad"): CompiledLine {
  const fail = (error: string): CompiledLine => ({ plot: { kind: "error", error }, free: [] });
  const trimmed = text.trim();
  if (!trimmed) return { plot: { kind: "empty" }, free: [] };
  let body = trimmed;
  let domain: VarFn | undefined;
  let restriction = "";
  const free = new Set<string>();
  const brace = restrictionStart(body);
  if (brace >= 0) {
    restriction = body.slice(brace + 1).replace(/}\s*$/, "");
    body = body.slice(0, brace).trim();
    const compiled = compileRestriction(restriction, angle);
    if ("error" in compiled) return fail(compiled.error);
    domain = compiled.test;
    for (const name of compiled.free) if (!GRAPH_VARIABLES.has(name)) free.add(name);
  }
  const done = (plot: Plot, nodes: CalcNode[], own: string[]): CompiledLine => {
    const stray = strayName(nodes, own);
    if (stray !== null) {
      return fail(stray.length > 1 ? `Unknown name: ${stray}` : `${stray} has no meaning here`);
    }
    for (const name of slidersIn(nodes, own)) free.add(name);
    return { plot, ...(domain ? { domain } : {}), free: [...free].sort() };
  };
  // f(x) = … reads as y = …
  body = body.replace(/^\s*[a-z]\s*\(\s*x\s*\)\s*=/i, "y =");

  // Points and parametric curves: (a, b), (c, d) …
  const pieces = splitTop(body);
  const pairs = pieces.map(pairOf);
  if (pairs.every((pair) => pair !== null)) {
    const nodes: Array<[CalcNode, CalcNode]> = [];
    for (const pair of pairs) {
      const a = parse(pair[0]);
      const b = parse(pair[1]);
      if (!a.ok) return fail(a.error);
      if (!b.ok) return fail(b.error);
      nodes.push([a.node, b.node]);
    }
    const flat = nodes.flat();
    if (nodes.length === 1 && flat.some((n) => uses(n, "t"))) {
      const [range] = [boundsOf(restriction, "t") ?? [0, 2 * Math.PI]];
      return done(
        {
          kind: "parametric",
          X: compileVars(nodes[0][0], angle),
          Y: compileVars(nodes[0][1], angle),
          from: range[0],
          to: range[1],
        },
        flat,
        ["t"],
      );
    }
    return done(
      {
        kind: "points",
        points: nodes.map(([a, b]) => [compileVars(a, angle), compileVars(b, angle)]),
      },
      flat,
      [],
    );
  }
  if (pieces.length > 1) return fail("Points are written (x, y), (x, y)");

  const parsed = parse(body, true);
  if (!parsed.ok) return fail(parsed.error);
  const node = parsed.node;
  if (node.k !== "rel") {
    if (uses(node, "y")) return fail("Add = or < to plot a curve in x and y");
    return done({ kind: "function", f: compileVars(node, angle) }, [node], ["x"]);
  }
  let { a, b } = node;
  let rel = node.op;
  // Put the plain variable on the left: f(x) > y reads as y < f(x).
  if (!["y", "x", "r"].some((v) => isName(a, v)) && ["y", "x", "r"].some((v) => isName(b, v))) {
    [a, b] = [b, a];
    rel = flip[rel];
  }
  const strict = rel === "<" || rel === ">";
  if (isName(a, "y") && !uses(b, "y")) {
    const f = compileVars(b, angle);
    if (rel === "=") return done({ kind: "function", f }, [b], ["x"]);
    return done({ kind: "region", f, below: rel === "<" || rel === "<=", strict }, [b], ["x"]);
  }
  if (isName(a, "x") && !uses(b, "x")) {
    if (!uses(b, "y")) {
      const c = compileVars(b, angle);
      if (rel === "=") return done({ kind: "vertical", c }, [b], []);
      return done({ kind: "vregion", c, left: rel === "<" || rel === "<=", strict }, [b], []);
    }
    if (rel === "=") return done({ kind: "sideways", g: compileVars(b, angle) }, [b], ["y"]);
  }
  if (isName(a, "r") && !uses(b, "r")) {
    if (rel !== "=") return fail("A polar curve is r = f(θ)");
    const range = boundsOf(restriction, "theta") ?? (angle === "deg" ? [0, 360] : [0, 2 * Math.PI]);
    return done(
      { kind: "polar", R: compileVars(b, angle), from: range[0], to: range[1] },
      [b],
      ["theta"],
    );
  }
  // Anything else in x and y: an implicit curve or region, F(x, y) = a − b.
  const F = compileVars({ k: "bin", op: "-", a, b }, angle);
  return done({ kind: "implicit", F, rel }, [a, b], ["x", "y"]);
}
