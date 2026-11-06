/**
 * A {@link MathBox} tree measured and laid out as print sets a displayed
 * formula: what to draw, in ops relative to the formula's left edge and
 * baseline, and how far it reaches above (`a`) and below (`d`) it. The
 * renderer paints the ops into page tiles and exports (typed equations,
 * discussion #166); nothing here touches a canvas.
 *
 * Glyph widths come from the caller's `measure`, so they are the device's
 * own; heights are fixed fractions of the size, the same on every device,
 * so a formula is as tall everywhere. Rules (a fraction's bar, a root's
 * line) and growing brackets are drawn as paths, not as glyphs.
 *
 * Pure: no DOM.
 */

import type { MathAccent, MathBox } from "../model/calc-display";

/** The family every equation is set in: on iPadOS, macOS and Windows alike. */
export const MATH_FONT_FAMILY = '"Times New Roman", Times, serif';

/** One glyph run, its baseline at `y`. */
export interface MathGlyph {
  k: "glyph";
  x: number;
  y: number;
  s: string;
  size: number;
  italic: boolean;
  bold: boolean;
}

/** A filled rectangle: a fraction's bar, an overline. */
export interface MathRule {
  k: "rule";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A path segment: move, line, or quadratic curve to the last point. */
export type MathSegment =
  ["M", number, number] | ["L", number, number] | ["Q", number, number, number, number];

/** A stroked path (a root's sign, a bracket), `w` wide; `fill`: filled instead (a dot, an arrowhead). */
export interface MathPath {
  k: "path";
  d: MathSegment[];
  w: number;
  fill?: true;
}

export type MathOp = MathGlyph | MathRule | MathPath;

/** A laid-out formula: its width, its reach above and below the baseline, and what to draw. */
export interface MathLayout {
  w: number;
  a: number;
  d: number;
  ops: MathOp[];
}

/** How wide `s` is set at `font` (a CSS font string, as `ctx.font` takes). */
export type MathMeasure = (s: string, font: string) => number;

/** The canvas font for a glyph op. */
export function mathFont(op: Pick<MathGlyph, "size" | "italic" | "bold">): string {
  const style = op.italic ? "italic " : "";
  const weight = op.bold ? "bold " : "";
  return `${style}${weight}${round(op.size)}px ${MATH_FONT_FAMILY}`;
}

/** TeX's styles: display, text, script, scriptscript. */
type Style = 0 | 1 | 2 | 3;
const SCALE: readonly number[] = [1, 1, 0.7, 0.5];
/** The style a fraction's parts are set in. */
const FRAC_STYLE: readonly Style[] = [1, 2, 3, 3];
/** The style scripts are set in. */
const SCRIPT_STYLE: readonly Style[] = [2, 2, 3, 3];

/** A glyph's reach above and below its baseline, in ems. */
const ASCENT = 0.72;
const DESCENT = 0.22;
/** Where a fraction's bar and a formula's middle sit above the baseline, in ems. */
const AXIS = 0.26;

/** Signs that get room on both sides: relations widest, then binary operators. */
const RELATIONS = new Set(Array.from("=≠<>≤≥≈≡∼≃≅∝≔∈∉∋⊂⊃⊆⊇→←↔⇒⇐⇔↦∣⊥∥≪≫"));
const BINARY = new Set(Array.from("+−±∓×÷·∗⋆∘•⊕⊗∪∩∖∧∨"));

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Ctx {
  /** The formula's base size, px. */
  base: number;
  measure: MathMeasure;
}

/**
 * `box` laid out at `size` px (a 1:1 page's font size). `measure` gives a
 * run's width in a font; glyph heights are taken as fixed fractions of the
 * size.
 */
export function layoutMath(box: MathBox, size: number, measure: MathMeasure): MathLayout {
  return lay(box, 0, { base: size, measure });
}

function sizeOf(style: Style, ctx: Ctx): number {
  return ctx.base * SCALE[style];
}

function empty(): MathLayout {
  return { w: 0, a: 0, d: 0, ops: [] };
}

/** `ops` of `child` moved by (dx, dy), appended to `into`. */
function place(into: MathOp[], child: MathLayout, dx: number, dy: number): void {
  for (const op of child.ops) into.push(moved(op, dx, dy));
}

function moved(op: MathOp, dx: number, dy: number): MathOp {
  switch (op.k) {
    case "glyph":
    case "rule":
      return { ...op, x: op.x + dx, y: op.y + dy };
    case "path":
      return {
        ...op,
        d: op.d.map((seg): MathSegment => {
          if (seg[0] === "Q") return ["Q", seg[1] + dx, seg[2] + dy, seg[3] + dx, seg[4] + dy];
          return [seg[0], seg[1] + dx, seg[2] + dy];
        }),
      };
  }
}

function glyph(s: string, size: number, italic: boolean, bold: boolean, ctx: Ctx): MathLayout {
  const op: MathGlyph = { k: "glyph", x: 0, y: 0, s, size, italic, bold };
  const w = ctx.measure(s, mathFont(op));
  return { w, a: ASCENT * size, d: DESCENT * size, ops: s ? [op] : [] };
}

function lay(box: MathBox, style: Style, ctx: Ctx): MathLayout {
  const size = sizeOf(style, ctx);
  switch (box.t) {
    case "row":
      return layRow(box.items, style, ctx);
    case "text": {
      // Letters italic, as print sets variables; a word of them (\text) upright.
      const italic = box.role === "var" && box.bold !== true;
      return glyph(box.s, size, italic, box.bold === true, ctx);
    }
    case "space":
      return { w: box.em * size, a: 0, d: 0, ops: [] };
    case "caret":
      return empty();
    case "slot": {
      // An operand not typed yet (the calculator's): an empty square.
      const side = 0.5 * size;
      const line = Math.max(0.6, 0.04 * size);
      return {
        w: side + 0.1 * size,
        a: side,
        d: 0,
        ops: [
          {
            k: "path",
            w: line,
            d: [
              ["M", 0.05 * size, 0],
              ["L", 0.05 * size + side, 0],
              ["L", 0.05 * size + side, -side],
              ["L", 0.05 * size, -side],
              ["L", 0.05 * size, 0],
            ],
          },
        ],
      };
    }
    case "frac":
      return layFrac(box.num, box.den, box.bar !== false, style, ctx);
    case "sup":
      return layScripts(box.base, undefined, box.exp, style, ctx);
    case "sub":
      return layScripts(box.base, box.sub, box.sup, style, ctx);
    case "root":
      return layRoot(box.body, box.index, style, ctx);
    case "paren":
      return fenced(lay(box.body, style, ctx), box.open ?? "(", box.close ?? ")", size, false);
    case "abs":
      return fenced(lay(box.body, style, ctx), "|", "|", size, false);
    case "bigop":
      return layBigOp(box, style, ctx);
    case "matrix":
      return layMatrix(box, style, ctx);
    case "accent":
      return layAccent(lay(box.body, style, ctx), box.mark, size);
  }
}

/** The room before and after an item in a row, in ems. */
function spacing(item: MathBox, first: boolean, last: boolean): [number, number] {
  if (item.t !== "text" || item.role !== "op") {
    // A function's name keeps a little room from what it applies to.
    if (item.t === "text" && item.role === "fn" && item.s.length > 1 && !last) return [0, 0.17];
    return [0, 0];
  }
  if (item.s === "," || item.s === ";") return [0, 0.17];
  if (RELATIONS.has(item.s)) return first || last ? [0, 0] : [0.28, 0.28];
  // A sign at the start is a sign of what follows (−x), not between two things.
  if (BINARY.has(item.s)) return first || last ? [0, 0] : [0.22, 0.22];
  return [0, 0];
}

function layRow(items: readonly MathBox[], style: Style, ctx: Ctx): MathLayout {
  const size = sizeOf(style, ctx);
  const out: MathLayout = { w: 0, a: 0, d: 0, ops: [] };
  let previousOp = true;
  items.forEach((item, i) => {
    const child = lay(item, style, ctx);
    // A sign right after another sign (= −3) is the operand's own.
    const [before, after] = spacing(item, previousOp, i === items.length - 1);
    // Scripts are set tighter (TeX drops binary room there).
    const k = style >= 2 ? 0.5 : 1;
    out.w += before * size * k;
    place(out.ops, child, out.w, 0);
    out.w += child.w + after * size * k;
    out.a = Math.max(out.a, child.a);
    out.d = Math.max(out.d, child.d);
    previousOp = item.t === "text" && item.role === "op" && item.s !== "′";
  });
  return out;
}

function layFrac(
  numBox: MathBox,
  denBox: MathBox,
  bar: boolean,
  style: Style,
  ctx: Ctx,
): MathLayout {
  const size = sizeOf(style, ctx);
  const inner = FRAC_STYLE[style];
  const num = lay(numBox, inner, ctx);
  const den = lay(denBox, inner, ctx);
  const thick = Math.max(0.6, 0.045 * size);
  const gap = (style === 0 ? 0.16 : 0.1) * size;
  const pad = 0.1 * size;
  const w = Math.max(num.w, den.w, 0.3 * size) + 2 * pad;
  const axis = AXIS * size;
  const numBase = -axis - thick / 2 - gap - num.d;
  const denBase = -axis + thick / 2 + gap + den.a;
  const ops: MathOp[] = [];
  place(ops, num, (w - num.w) / 2, numBase);
  place(ops, den, (w - den.w) / 2, denBase);
  if (bar) ops.push({ k: "rule", x: pad / 2, y: -axis - thick / 2, w: w - pad, h: thick });
  // A thin space each side, as TeX gives a fraction.
  const side = 0.08 * size;
  return {
    w: w + 2 * side,
    a: -numBase + num.a,
    d: denBase + den.d,
    ops: ops.map((op) => moved(op, side, 0)),
  };
}

/** Whether a base is a single italic letter (its script sits a little right). */
function italicBase(box: MathBox): boolean {
  return box.t === "text" && box.role === "var" && box.bold !== true;
}

function layScripts(
  baseBox: MathBox,
  subBox: MathBox | undefined,
  supBox: MathBox | undefined,
  style: Style,
  ctx: Ctx,
): MathLayout {
  const size = sizeOf(style, ctx);
  const base = lay(baseBox, style, ctx);
  const inner = SCRIPT_STYLE[style];
  const sup = supBox ? lay(supBox, inner, ctx) : null;
  const sub = subBox ? lay(subBox, inner, ctx) : null;
  const tall = base.a > ASCENT * size * 1.05;
  // Raised so its middle clears a tall base's top part; lowered under a deep one.
  let up = sup ? Math.max(0.42 * size, tall ? base.a - 0.5 * sup.a : 0) : 0;
  let down = sub ? Math.max(sup ? 0.26 * size : 0.18 * size, base.d - 0.3 * sub.a) : 0;
  if (sup && sub) {
    // Keep a gap between the two.
    const clash = 0.12 * size - (up - sup.d - (sub.a - down));
    if (clash > 0) {
      up += clash / 2;
      down += clash / 2;
    }
  }
  const ops: MathOp[] = [...base.ops];
  const lean = italicBase(baseBox) ? 0.06 * size : 0.02 * size;
  let w = base.w;
  if (sup) place(ops, sup, base.w + lean, -up);
  if (sub) place(ops, sub, base.w + 0.01 * size, down);
  w += Math.max(sup ? sup.w + lean : 0, sub ? sub.w : 0) + 0.04 * size;
  return {
    w,
    a: Math.max(base.a, sup ? up + sup.a : 0, sub ? sub.a - down : 0),
    d: Math.max(base.d, sub ? down + sub.d : 0, sup ? sup.d - up : 0),
    ops,
  };
}

function layRoot(
  bodyBox: MathBox,
  indexBox: MathBox | undefined,
  style: Style,
  ctx: Ctx,
): MathLayout {
  const size = sizeOf(style, ctx);
  const body = lay(bodyBox, style, ctx);
  const thick = Math.max(0.6, 0.05 * size);
  const gap = 0.12 * size;
  const top = -(Math.max(body.a, ASCENT * size * 0.9) + gap + thick / 2);
  const bottom = Math.max(body.d, 0.1 * size) + 0.04 * size;
  const height = bottom - top;
  const sign = Math.min(0.62 * size, 0.42 * size + 0.08 * height);
  const index = indexBox ? lay(indexBox, 3, ctx) : null;
  // The index sits over the sign's short stroke; a wide one pushes the sign right.
  const shift = index ? Math.max(0, index.w - sign * 0.45) : 0;
  const tick = bottom - height * 0.42;
  const path: MathPath = {
    k: "path",
    w: thick,
    d: [
      ["M", shift, tick + 0.02 * size],
      ["L", shift + sign * 0.22, tick - 0.05 * size],
      ["L", shift + sign * 0.55, bottom],
      ["L", shift + sign, top],
      ["L", shift + sign + body.w + 0.14 * size, top],
    ],
  };
  const ops: MathOp[] = [path];
  place(ops, body, shift + sign + 0.07 * size, 0);
  let a = -top + thick;
  if (index) {
    const indexBase = tick - 0.1 * size - index.d;
    place(ops, index, Math.max(0, shift + sign * 0.45 - index.w), indexBase);
    a = Math.max(a, -indexBase + index.a);
  }
  return { w: shift + sign + body.w + 0.18 * size, a, d: bottom + thick, ops };
}

/** A bracket's width, ems, by kind. */
function fenceWidth(c: string, height: number, size: number): number {
  if (c === "") return 0;
  if (c === "|" || c === "‖") return (c === "‖" ? 0.36 : 0.24) * size;
  const grow = Math.min(0.12 * size, 0.04 * height);
  if (c === "{" || c === "}") return 0.44 * size + grow;
  if (c === "[" || c === "]" || c === "⌊" || c === "⌋" || c === "⌈" || c === "⌉") {
    return 0.32 * size + grow * 0.5;
  }
  return 0.38 * size + grow;
}

/** The path of bracket `c`, `w` wide, from `top` to `bottom`, left edge at 0. */
function fencePath(c: string, w: number, top: number, bottom: number, thick: number): MathPath[] {
  const mid = (top + bottom) / 2;
  const h = bottom - top;
  const line = (d: MathSegment[]): MathPath => ({ k: "path", w: thick, d });
  switch (c) {
    case "(":
      return [
        line([
          ["M", w * 0.82, top],
          ["Q", w * 0.02, mid, w * 0.82, bottom],
        ]),
      ];
    case ")":
      return [
        line([
          ["M", w * 0.18, top],
          ["Q", w * 0.98, mid, w * 0.18, bottom],
        ]),
      ];
    case "[":
      return [
        line([
          ["M", w * 0.8, top],
          ["L", w * 0.3, top],
          ["L", w * 0.3, bottom],
          ["L", w * 0.8, bottom],
        ]),
      ];
    case "]":
      return [
        line([
          ["M", w * 0.2, top],
          ["L", w * 0.7, top],
          ["L", w * 0.7, bottom],
          ["L", w * 0.2, bottom],
        ]),
      ];
    case "⌊":
      return [
        line([
          ["M", w * 0.3, top],
          ["L", w * 0.3, bottom],
          ["L", w * 0.8, bottom],
        ]),
      ];
    case "⌋":
      return [
        line([
          ["M", w * 0.7, top],
          ["L", w * 0.7, bottom],
          ["L", w * 0.2, bottom],
        ]),
      ];
    case "⌈":
      return [
        line([
          ["M", w * 0.8, top],
          ["L", w * 0.3, top],
          ["L", w * 0.3, bottom],
        ]),
      ];
    case "⌉":
      return [
        line([
          ["M", w * 0.2, top],
          ["L", w * 0.7, top],
          ["L", w * 0.7, bottom],
        ]),
      ];
    case "{":
    case "}": {
      const x = (f: number): number => (c === "{" ? f : 1 - f) * w;
      return [
        line([
          ["M", x(0.85), top],
          ["Q", x(0.45), top, x(0.45), top + h * 0.14],
          ["L", x(0.45), mid - h * 0.1],
          ["Q", x(0.45), mid, x(0.1), mid],
          ["Q", x(0.45), mid, x(0.45), mid + h * 0.1],
          ["L", x(0.45), bottom - h * 0.14],
          ["Q", x(0.45), bottom, x(0.85), bottom],
        ]),
      ];
    }
    case "|":
      return [
        line([
          ["M", w / 2, top],
          ["L", w / 2, bottom],
        ]),
      ];
    case "‖":
      return [
        line([
          ["M", w * 0.33, top],
          ["L", w * 0.33, bottom],
        ]),
        line([
          ["M", w * 0.67, top],
          ["L", w * 0.67, bottom],
        ]),
      ];
    case "⟨":
      return [
        line([
          ["M", w * 0.8, top],
          ["L", w * 0.22, mid],
          ["L", w * 0.8, bottom],
        ]),
      ];
    case "⟩":
      return [
        line([
          ["M", w * 0.2, top],
          ["L", w * 0.78, mid],
          ["L", w * 0.2, bottom],
        ]),
      ];
  }
  return [];
}

/**
 * `body` between brackets that reach as far above and below the formula's
 * middle as it does. Around one line of letters (`always` unset), the
 * brackets are the font's own glyphs.
 */
function fenced(
  body: MathLayout,
  open: string,
  close: string,
  size: number,
  always: boolean,
): MathLayout {
  const plain = !always && body.a <= ASCENT * size * 1.08 && body.d <= DESCENT * size * 1.4;
  const ops: MathOp[] = [];
  if (plain) {
    const glyphOf = (c: string): MathGlyph => ({
      k: "glyph",
      x: 0,
      y: 0,
      s: c,
      size,
      italic: false,
      bold: false,
    });
    // A glyph bracket's width: a fixed share of the size, close to Times'.
    const wOf = (c: string): number => (c === "" ? 0 : c === "|" ? 0.22 * size : 0.34 * size);
    const wl = wOf(open);
    const wr = wOf(close);
    if (open) ops.push({ ...glyphOf(open), x: 0.02 * size });
    place(ops, body, wl, 0);
    if (close) ops.push({ ...glyphOf(close), x: wl + body.w + 0.02 * size });
    return {
      w: wl + body.w + wr,
      a: Math.max(body.a, ASCENT * size),
      d: Math.max(body.d, DESCENT * size),
      ops,
    };
  }
  const axis = AXIS * size;
  const reach = 0.1 * size;
  const half = Math.max(body.a + reach - axis, body.d + reach + axis, 0.6 * size);
  const top = -axis - half;
  const bottom = -axis + half;
  const thick = Math.max(0.7, 0.06 * size);
  const wl = fenceWidth(open, bottom - top, size);
  const wr = fenceWidth(close, bottom - top, size);
  for (const path of fencePath(open, wl, top, bottom, thick)) ops.push(path);
  place(ops, body, wl + 0.04 * size, 0);
  for (const path of fencePath(close, wr, top, bottom, thick)) {
    ops.push(moved(path, wl + body.w + 0.08 * size, 0));
  }
  return {
    w: wl + body.w + 0.08 * size + wr,
    a: Math.max(body.a, -top + thick),
    d: Math.max(body.d, bottom + thick),
    ops,
  };
}

/** A big sign's size, and its baseline's drop so that its middle is on the axis, in ems. */
function bigSign(sym: string, style: Style): { scale: number; italic: boolean } {
  const integral = /[∫∬∭∮]/.test(sym);
  const display = style === 0;
  if (integral) return { scale: display ? 2.1 : 1.45, italic: true };
  return { scale: display ? 1.55 : 1.15, italic: false };
}

function layBigOp(box: Extract<MathBox, { t: "bigop" }>, style: Style, ctx: Ctx): MathLayout {
  const size = sizeOf(style, ctx);
  const word = Array.from(box.sym).length > 1;
  const inner = SCRIPT_STYLE[style];
  const hi = box.hi ? lay(box.hi, inner, ctx) : null;
  const lo = box.lo ? lay(box.lo, inner, ctx) : null;
  const ops: MathOp[] = [];
  let signW: number;
  let signTop: number;
  let signBottom: number;
  let signX = 0;
  if (word) {
    // lim, max: an upright word on the baseline.
    const g = glyph(box.sym, size, false, false, ctx);
    signW = g.w;
    signTop = -g.a;
    signBottom = g.d;
    ops.push(...g.ops);
  } else {
    const { scale, italic } = bigSign(box.sym, style);
    const symSize = size * scale;
    const g = glyph(box.sym, symSize, italic, false, ctx);
    // A sign set on its baseline spans about its cap height; an integral the whole line.
    const integral = italic;
    const up = (integral ? 0.76 : 0.68) * symSize;
    const below = (integral ? 0.22 : 0) * symSize;
    const axis = AXIS * size;
    const baseline = -axis + (up - below) / 2;
    signW = g.w;
    signTop = baseline - up;
    signBottom = baseline + below;
    place(ops, g, 0, baseline);
  }
  const limitsBeside = box.side === true || style !== 0;
  let w: number;
  let a = -signTop;
  let d = signBottom;
  if (limitsBeside && !word) {
    // Beside the sign, high and low (an integral's ∫ₐᵇ).
    const lean = /[∫∬∭∮]/.test(box.sym) ? 0.2 * size : 0.05 * size;
    let reach = signW;
    if (hi) {
      const y = signTop + hi.a * 0.9;
      place(ops, hi, signW + 0.02 * size, y);
      reach = Math.max(reach, signW + 0.02 * size + hi.w);
      a = Math.max(a, -y + hi.a);
    }
    if (lo) {
      const y = signBottom - lo.d * 0.3;
      place(ops, lo, signW - lean, y);
      reach = Math.max(reach, signW - lean + lo.w);
      d = Math.max(d, y + lo.d);
    }
    w = reach;
  } else {
    // Above and below, centred (Σ's limits; lim's under the word).
    const gap = 0.12 * size;
    w = Math.max(signW, hi?.w ?? 0, lo?.w ?? 0);
    signX = (w - signW) / 2;
    const signOps = ops.splice(0, ops.length);
    for (const op of signOps) ops.push(moved(op, signX, 0));
    if (hi) {
      const y = signTop - gap - hi.d;
      place(ops, hi, (w - hi.w) / 2, y);
      a = Math.max(a, -y + hi.a);
    }
    if (lo) {
      const y = signBottom + gap + lo.a;
      place(ops, lo, (w - lo.w) / 2, y);
      d = Math.max(d, y + lo.d);
    }
  }
  w += 0.12 * size;
  const body = lay(box.body, style, ctx);
  if (body.w > 0) {
    place(ops, body, w, 0);
    w += body.w;
    a = Math.max(a, body.a);
    d = Math.max(d, body.d);
  }
  if (box.tail) {
    const tail = glyph(box.tail, size, true, false, ctx);
    place(ops, tail, w + 0.17 * size, 0);
    w += tail.w + 0.17 * size;
  }
  return { w, a, d, ops };
}

function layMatrix(box: Extract<MathBox, { t: "matrix" }>, style: Style, ctx: Ctx): MathLayout {
  const size = sizeOf(style, ctx);
  const inner: Style = style === 0 ? 1 : style;
  const cells = box.rows.map((cellsOfRow) => cellsOfRow.map((cell) => lay(cell, inner, ctx)));
  const columns = Math.max(1, ...cells.map((r) => r.length));
  const widths: number[] = Array.from({ length: columns }, (_, j) =>
    Math.max(0, ...cells.map((r) => r[j]?.w ?? 0)),
  );
  const colGap = (j: number): number => {
    // aligned's columns come in right-left pairs: none inside a pair, a quad between.
    if (box.align === "rl") return j % 2 === 1 ? 0 : size;
    return box.align === "l" ? size : 0.9 * size;
  };
  const rowGap = 0.32 * size;
  const ascents = cells.map((r) => Math.max(ASCENT * size, ...r.map((c) => c.a)));
  const descents = cells.map((r) => Math.max(DESCENT * size, ...r.map((c) => c.d)));
  const height =
    ascents.reduce((s, v) => s + v, 0) +
    descents.reduce((s, v) => s + v, 0) +
    rowGap * Math.max(0, cells.length - 1);
  const axis = AXIS * size;
  const top = -axis - height / 2;
  const ops: MathOp[] = [];
  let y = top;
  let gridW = 0;
  cells.forEach((r, i) => {
    const baseline = y + ascents[i];
    let x = 0;
    for (let j = 0; j < columns; j++) {
      const cell = r[j];
      if (cell) {
        let dx: number;
        if (box.align === "l") dx = 0;
        else if (box.align === "rl") dx = j % 2 === 0 ? widths[j] - cell.w : 0;
        else dx = (widths[j] - cell.w) / 2;
        place(ops, cell, x + dx, baseline);
      }
      x += widths[j] + (j < columns - 1 ? colGap(j) : 0);
    }
    gridW = Math.max(gridW, x);
    y = baseline + descents[i] + rowGap;
  });
  const grid: MathLayout = { w: gridW, a: -top, d: top + height, ops };
  if (!box.open && !box.close) return padded(grid, 0.1 * size);
  return fenced(padded(grid, 0.1 * size), box.open, box.close, size, true);
}

/** `layout` with `pad` of room on each side. */
function padded(layout: MathLayout, pad: number): MathLayout {
  return { ...layout, w: layout.w + 2 * pad, ops: layout.ops.map((op) => moved(op, pad, 0)) };
}

function layAccent(body: MathLayout, mark: MathAccent, size: number): MathLayout {
  const thick = Math.max(0.6, 0.045 * size);
  const ops: MathOp[] = [...body.ops];
  const w = Math.max(body.w, 0.36 * size);
  const left = (w - body.w) / 2;
  const shifted = ops.map((op) => moved(op, left, 0));
  if (mark === "under") {
    const y = body.d + 0.06 * size;
    shifted.push({ k: "rule", x: 0, y, w, h: thick });
    return { w, a: body.a, d: y + thick, ops: shifted };
  }
  const base = -(Math.max(body.a, 0.5 * size) + 0.06 * size);
  // A single italic letter's accent sits a little right, over the letter's lean.
  const lean =
    body.ops.length === 1 && body.ops[0].k === "glyph" && body.ops[0].italic ? 0.06 * size : 0;
  const x0 = 0.08 * size + lean;
  const x1 = w - 0.04 * size + lean;
  let a = -base;
  switch (mark) {
    case "bar":
      shifted.push({ k: "rule", x: x0, y: base - thick, w: x1 - x0, h: thick });
      a += thick;
      break;
    case "vec": {
      const y = base - 0.08 * size;
      const head = 0.12 * size;
      shifted.push({
        k: "path",
        w: thick,
        d: [
          ["M", x0, y],
          ["L", x1, y],
        ],
      });
      shifted.push({
        k: "path",
        w: thick,
        d: [
          ["M", x1 - head, y - head * 0.7],
          ["L", x1, y],
          ["L", x1 - head, y + head * 0.7],
        ],
      });
      a = -y + head;
      break;
    }
    case "hat": {
      const mid = (x0 + x1) / 2;
      const rise = 0.14 * size;
      shifted.push({
        k: "path",
        w: thick,
        d: [
          ["M", x0, base],
          ["L", mid, base - rise],
          ["L", x1, base],
        ],
      });
      a += rise + thick;
      break;
    }
    case "tilde": {
      const third = (x1 - x0) / 3;
      const y = base - 0.08 * size;
      const amp = 0.07 * size;
      shifted.push({
        k: "path",
        w: thick,
        d: [
          ["M", x0, y + amp / 2],
          ["Q", x0 + third, y - amp * 1.6, (x0 + x1) / 2, y],
          ["Q", x1 - third, y + amp * 1.6, x1, y - amp / 2],
        ],
      });
      a += 0.16 * size;
      break;
    }
    case "dot":
    case "ddot": {
      const r = 0.05 * size;
      const y = base - r * 1.4;
      const mid = (x0 + x1) / 2;
      const xs = mark === "dot" ? [mid] : [mid - 0.12 * size, mid + 0.12 * size];
      for (const x of xs) shifted.push(dotPath(x, y, r));
      a = -y + r * 2;
      break;
    }
  }
  return { w, a, d: body.d, ops: shifted };
}

/** A filled dot of radius `r` at (x, y), as a four-curve path. */
function dotPath(x: number, y: number, r: number): MathPath {
  return {
    k: "path",
    w: 0,
    fill: true,
    d: [
      ["M", x + r, y],
      ["Q", x + r, y + r, x, y + r],
      ["Q", x - r, y + r, x - r, y],
      ["Q", x - r, y - r, x, y - r],
      ["Q", x + r, y - r, x + r, y],
    ],
  };
}
