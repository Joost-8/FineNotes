/**
 * The calculator's keypad and typing rules, apart from the DOM. Pure.
 *
 * Two blocks. Above, tabs of functions (Basic, Trig, Calculus, Bases,
 * Memory, and Graph while a graph line is edited), each three rows of six
 * so switching never moves the number pad; Trig keeps its inverses behind
 * a 2nd key, as Google's and Windows' calculators do. Below, a number pad
 * with the operators in their own column on the right, as on iOS.
 *
 * Each key types text into the expression (in the display's own signs:
 * × ÷ − √ π, which the engine reads as they are) or is an action the
 * pop-up carries out. A function of several inputs types a template with
 * a box per input (`solve(▢ = ▢, ▢)`), and the cursor goes to the first
 * box, as Casio's natural display does. Every key has a one-line `help`,
 * shown on a long press and as a hover title.
 *
 * After a result, a key that continues a calculation (an operator) starts
 * from `Ans`; anything else starts afresh.
 */

import { ACTIVE_BOX, CARET, type NumberBase, PLACEHOLDER } from "./calculator";

export { ACTIVE_BOX, CARET };

export type CalcAction =
  "equals" | "back" | "clear" | "shift" | "angle" | "base" | "mc" | "mr" | "m+" | "m-";

export interface CalcKey {
  /** What the key shows. */
  label: string;
  /** Spoken name, where the label is a sign. */
  aria?: string;
  /** What it does, in one line: a long press and the hover title show it. */
  help?: string;
  /** Text it types (▢ marks an input to fill); absent for an action key. */
  insert?: string;
  action?: CalcAction;
  /** For the `base` action: which base. */
  base?: NumberBase;
  /** Typed after a result, it carries the result on (`Ans` + the key). */
  continues?: boolean;
  /** Only meaningful in decimal: off in the other bases. */
  decimalOnly?: boolean;
  /** A digit, off in a base too small for it. */
  digit?: number;
  /** Columns it spans (one when absent). */
  span?: number;
  /** How it is drawn. */
  tone?: "fn" | "op" | "equals" | "mode";
  /** The key's second meaning, behind 2nd. */
  shift?: CalcKey;
}

export type KeyTab = "basic" | "trig" | "calculus" | "bases" | "memory" | "graph";

/** The tabs, in order; Graph only shows while a graph line is edited. */
export const KEY_TABS: ReadonlyArray<{ id: KeyTab; label: string }> = [
  { id: "basic", label: "Basic" },
  { id: "trig", label: "Trig" },
  { id: "calculus", label: "Calculus" },
  { id: "bases", label: "Bases" },
  { id: "memory", label: "Memory" },
  { id: "graph", label: "Graph" },
];

export function isKeyTab(value: unknown): value is KeyTab {
  return KEY_TABS.some((tab) => tab.id === value);
}

const BOX = PLACEHOLDER;

const fn = (
  label: string,
  insert: string,
  help: string,
  extra: Partial<CalcKey> = {},
): CalcKey => ({
  label,
  insert,
  help,
  tone: "fn",
  decimalOnly: true,
  ...extra,
});
const op = (label: string, insert: string, aria: string, help: string): CalcKey => ({
  label,
  insert,
  aria,
  help,
  tone: "op",
  continues: true,
});
const digit = (d: number): CalcKey => ({
  label: d.toString(16).toUpperCase(),
  insert: `${d}`,
  digit: d,
});
const hex = (d: number): CalcKey => ({
  ...digit(d),
  insert: d.toString(16).toUpperCase(),
  help: `Hex digit ${d.toString(16).toUpperCase()} (${d}); base 16 only`,
});
const anyBase = { decimalOnly: false } as const;
const baseKey = (base: NumberBase, label: string, help: string): CalcKey => ({
  label,
  action: "base",
  base,
  help,
  tone: "mode",
});

/** A function key's rows, six slots each; null is an empty slot. */
export type KeyRows = ReadonlyArray<ReadonlyArray<CalcKey | null>>;

const BASIC: KeyRows = [
  [
    fn("x²", "²", "Square what is before it", { aria: "squared", continues: true, ...anyBase }),
    fn("xʸ", "^", "To the power of what follows: 2^10", {
      aria: "to the power",
      continues: true,
      ...anyBase,
    }),
    fn("√", `√(`, "Square root", { aria: "square root" }),
    fn("ⁿ√", `root(${BOX}, ${BOX})`, "root(x, n): the nth root of x", { aria: "nth root" }),
    fn("x⁻¹", "^(−1)", "One over what is before it", { aria: "reciprocal", continues: true }),
    fn("π", "π", "Pi, 3.14159…", { aria: "pi" }),
  ],
  [
    fn("ln", "ln(", "Natural logarithm (base e)"),
    fn("log", "log(", "Logarithm base 10"),
    fn("eˣ", "e^(", "e to the power", { aria: "e to the power" }),
    fn("10ˣ", "10^(", "Ten to the power", { aria: "ten to the power" }),
    fn("e", "e", "Euler's number, 2.71828…"),
    fn("x", "x", "The variable x: for d/dx, ∫, solve and graphs", { aria: "variable x" }),
  ],
  [
    fn("mod", " mod ", "Remainder: 17 mod 5 = 2 (it takes the sign of the divisor)", {
      continues: true,
      ...anyBase,
    }),
    fn("|x|", "abs(", "Absolute value: the distance from 0", {
      aria: "absolute value",
      ...anyBase,
    }),
    fn("%", "%", "Percent: 50% is 0.5", { aria: "percent", continues: true, ...anyBase }),
    fn("n!", "!", "Factorial: 5! = 120", { aria: "factorial", continues: true, ...anyBase }),
    fn("EXP", "E", "Times ten to the power: 3E8 = 300 000 000", {
      aria: "times ten to the power",
    }),
    fn("logₐ", `log(${BOX}, ${BOX})`, "log(x, b): logarithm of x in base b", {
      aria: "log in any base",
    }),
  ],
];

const TRIG: KeyRows = [
  [
    {
      label: "2nd",
      action: "shift",
      aria: "second functions",
      help: "Show the inverses",
      tone: "mode",
    },
    fn("sin", "sin(", "Sine", {
      shift: fn("sin⁻¹", "asin(", "Inverse sine: the angle whose sine it is"),
    }),
    fn("cos", "cos(", "Cosine", { shift: fn("cos⁻¹", "acos(", "Inverse cosine") }),
    fn("tan", "tan(", "Tangent", { shift: fn("tan⁻¹", "atan(", "Inverse tangent") }),
    fn("°", "°", "Degrees: sin(30°) works in either angle mode", { continues: true }),
    {
      label: "DEG",
      action: "angle",
      aria: "degrees or radians",
      help: "Switch angles between degrees and radians",
      tone: "mode",
      decimalOnly: true,
    },
  ],
  [
    fn("sinh", "sinh(", "Hyperbolic sine", {
      shift: fn("sinh⁻¹", "asinh(", "Inverse hyperbolic sine"),
    }),
    fn("cosh", "cosh(", "Hyperbolic cosine", {
      shift: fn("cosh⁻¹", "acosh(", "Inverse hyperbolic cosine"),
    }),
    fn("tanh", "tanh(", "Hyperbolic tangent", {
      shift: fn("tanh⁻¹", "atanh(", "Inverse hyperbolic tangent"),
    }),
    fn("sec", "sec(", "Secant, 1/cos", { shift: fn("sec⁻¹", "asec(", "Inverse secant") }),
    fn("csc", "csc(", "Cosecant, 1/sin", { shift: fn("csc⁻¹", "acsc(", "Inverse cosecant") }),
    fn("cot", "cot(", "Cotangent, 1/tan", { shift: fn("cot⁻¹", "acot(", "Inverse cotangent") }),
  ],
  [
    fn("π", "π", "Pi, 3.14159…", { aria: "pi" }),
    fn("x", "x", "The variable x", { aria: "variable x" }),
    null,
    null,
    null,
    null,
  ],
];

const CALCULUS: KeyRows = [
  [
    fn("d/dx", `d/dx(${BOX}, ${BOX})`, "d/dx(f, a): the slope of f at x = a"),
    fn("∫", `∫(${BOX}, ${BOX}, ${BOX})`, "∫(f, a, b): the area under f from x = a to b"),
    fn("Σ", `Σ(${BOX}, ${BOX}, ${BOX})`, "Σ(f, a, b): f added up for x = a, a+1, …, b"),
    fn("Π", `Π(${BOX}, ${BOX}, ${BOX})`, "Π(f, a, b): f multiplied for x = a, a+1, …, b"),
    fn("lim", `lim(${BOX}, ${BOX})`, "lim(f, a): the value f approaches as x → a (a may be ∞)"),
    fn(
      "solve",
      `solve(${BOX} = ${BOX}, ${BOX})`,
      "solve(f = g, near): the x where f = g, nearest to near",
    ),
  ],
  [
    fn("x", "x", "The variable x", { aria: "variable x" }),
    fn("∞", "∞", "Infinity, as a limit's target: lim(1/x, ∞)", { aria: "infinity" }),
    fn("π", "π", "Pi, 3.14159…", { aria: "pi" }),
    fn("e", "e", "Euler's number, 2.71828…"),
    null,
    null,
  ],
  [null, null, null, null, null, null],
];

const BASES: KeyRows = [
  [
    baseKey(10, "DEC", "Decimal: base 10"),
    baseKey(16, "HEX", "Hexadecimal: base 16, digits 0–9 and A–F"),
    baseKey(2, "BIN", "Binary: base 2, digits 0 and 1"),
    baseKey(8, "OCT", "Octal: base 8, digits 0–7"),
    fn("<<", `shl(${BOX}, ${BOX})`, "shl(a, n): shift a left n bits (× 2ⁿ)", { ...anyBase }),
    fn(">>", `shr(${BOX}, ${BOX})`, "shr(a, n): shift a right n bits (÷ 2ⁿ, rounded down)", {
      ...anyBase,
    }),
  ],
  [10, 11, 12, 13, 14, 15].map(hex),
  [
    fn("AND", `and(${BOX}, ${BOX})`, "and(a, b): bits set in both", { ...anyBase }),
    fn("OR", `or(${BOX}, ${BOX})`, "or(a, b): bits set in either", { ...anyBase }),
    fn("XOR", `xor(${BOX}, ${BOX})`, "xor(a, b): bits set in one but not both", { ...anyBase }),
    fn("NOT", "not(", "not(a): every bit flipped, which is −a − 1", { ...anyBase }),
    fn("mod", " mod ", "Remainder: 17 mod 5 = 2", { continues: true, ...anyBase }),
    null,
  ],
];

const MEMORY: KeyRows = [
  [
    {
      label: "MC",
      action: "mc",
      aria: "memory clear",
      help: "Memory clear: set the memory to 0",
      tone: "mode",
    },
    {
      label: "MR",
      action: "mr",
      aria: "memory recall",
      help: "Memory recall: type the stored number (M)",
      tone: "mode",
    },
    {
      label: "M+",
      action: "m+",
      aria: "add to memory",
      help: "Add the answer on show to the memory",
      tone: "mode",
    },
    {
      label: "M−",
      action: "m-",
      aria: "subtract from memory",
      help: "Take the answer on show from the memory",
      tone: "mode",
    },
    { label: "Ans", insert: "Ans", aria: "last answer", help: "The last answer", tone: "mode" },
    null,
  ],
  [
    fn("nCr", `nCr(${BOX}, ${BOX})`, "nCr(n, r): ways to choose r of n, order not counting", {
      ...anyBase,
    }),
    fn("nPr", `nPr(${BOX}, ${BOX})`, "nPr(n, r): ways to arrange r of n, order counting", {
      ...anyBase,
    }),
    fn("n!", "!", "Factorial: 5! = 120", { aria: "factorial", continues: true, ...anyBase }),
    fn("|x|", "abs(", "Absolute value", { aria: "absolute value", ...anyBase }),
    fn("rnd", `round(${BOX}, ${BOX})`, "round(x, d): x rounded to d decimals"),
    fn("mod", " mod ", "Remainder: 17 mod 5 = 2", { continues: true, ...anyBase }),
  ],
  [null, null, null, null, null, null],
];

const GRAPH: KeyRows = [
  [
    fn("x", "x", "The variable along the x axis"),
    fn("y", "y", "The variable along the y axis: x² + y² = 25"),
    fn("=", "=", "An equation: y = …, x = 3, r = …, or any curve in x and y", {
      aria: "equals sign",
    }),
    fn("<", "<", "Shade where it holds: y < sin x", { aria: "less than" }),
    fn(">", ">", "Shade where it holds", { aria: "greater than" }),
    fn("≤", "≤", "Shade where it holds, edge included", { aria: "at most" }),
  ],
  [
    fn("t", "t", "The parameter of a curve (x(t), y(t))"),
    fn("θ", "θ", "The angle of a polar curve r = f(θ)", { aria: "theta" }),
    fn("r", "r", "Distance from the origin, for r = f(θ)"),
    fn("{", "{", "Restrict a curve: sin x {0 < x < 5}", { aria: "open brace" }),
    fn("}", "}", "End a restriction", { aria: "close brace" }),
    fn("≥", "≥", "Shade where it holds, edge included", { aria: "at least" }),
  ],
  [
    fn("a", "a", "A slider: any other letter gets one"),
    fn("b", "b", "A slider"),
    fn("k", "k", "A slider"),
    fn("sin", "sin(", "Sine"),
    fn("cos", "cos(", "Cosine"),
    fn("π", "π", "Pi", { aria: "pi" }),
  ],
];

export const TAB_ROWS: Readonly<Record<KeyTab, KeyRows>> = {
  basic: BASIC,
  trig: TRIG,
  calculus: CALCULUS,
  bases: BASES,
  memory: MEMORY,
  graph: GRAPH,
};

/** The number pad: five keys a row, the operators on the right. */
export const NUMBER_ROWS: readonly (readonly CalcKey[])[] = [
  [
    {
      label: "AC",
      action: "clear",
      aria: "clear",
      help: "C clears what is typed; AC everything",
      tone: "mode",
    },
    {
      label: "⌫",
      action: "back",
      aria: "delete",
      help: "Delete one sign (or swipe the display)",
      tone: "mode",
    },
    { label: "(", insert: "(", help: "Open bracket", tone: "mode" },
    {
      label: ")",
      insert: ")",
      help: "Close bracket (left open ones close at the end)",
      tone: "mode",
    },
    op("÷", "÷", "divided by", "Divide"),
  ],
  [
    digit(7),
    digit(8),
    digit(9),
    { label: "Ans", insert: "Ans", aria: "last answer", help: "The last answer", tone: "mode" },
    op("×", "×", "times", "Multiply"),
  ],
  [
    digit(4),
    digit(5),
    digit(6),
    {
      label: "mod",
      insert: " mod ",
      help: "Remainder: 17 mod 5 = 2",
      tone: "mode",
      continues: true,
    },
    op("−", "−", "minus", "Subtract"),
  ],
  [
    digit(1),
    digit(2),
    digit(3),
    {
      label: "x",
      insert: "x",
      aria: "variable x",
      help: "The variable x",
      tone: "mode",
      decimalOnly: true,
    },
    op("+", "+", "plus", "Add"),
  ],
  [
    { ...digit(0), span: 2 },
    { label: ".", insert: ".", aria: "point", help: "Decimal point", decimalOnly: true },
    {
      label: ",",
      insert: ",",
      aria: "comma, between inputs",
      help: "Between a function's inputs: log(8, 2)",
    },
    {
      label: "=",
      action: "equals",
      aria: "equals",
      help: "Work it out (or go to the next box)",
      tone: "equals",
    },
  ],
];

/** The key as shown: its second meaning while 2nd is on. */
export function shownKey(key: CalcKey, shifted: boolean): CalcKey {
  return shifted && key.shift ? key.shift : key;
}

/** Whether `key` can be used in `base`. */
export function keyEnabled(key: CalcKey, base: number): boolean {
  if (key.decimalOnly && base !== 10) return false;
  if (key.digit !== undefined && key.digit >= base) return false;
  return true;
}

// --- Typing -------------------------------------------------------------------

/** What the display is typing into. */
export interface Entry {
  expr: string;
  /** Where the next key types, 0…expr.length; at a ▢ it fills that box. */
  cursor?: number;
  /** A result is on show: the next key starts again (or carries it on). */
  fresh: boolean;
}

const cursorOf = (entry: Entry): number =>
  Math.max(0, Math.min(entry.expr.length, entry.cursor ?? entry.expr.length));

/** Where the cursor goes after `inserted` went in at `at`: its first box, else after it. */
function after(inserted: string, at: number): number {
  const box = inserted.indexOf(BOX);
  return box >= 0 ? at + box : at + inserted.length;
}

/** `insert` typed into `entry` at its cursor; a box there is filled, not pushed along. */
export function typeInto(entry: Entry, insert: string, continues: boolean): Entry {
  if (entry.fresh) {
    const expr = (continues ? "Ans" : "") + insert;
    return { expr, cursor: after(insert, expr.length - insert.length), fresh: false };
  }
  const at = cursorOf(entry);
  const filling = entry.expr[at] === BOX;
  const expr = entry.expr.slice(0, at) + insert + entry.expr.slice(filling ? at + 1 : at);
  return { expr, cursor: after(insert, at), fresh: false };
}

/** The positions of the boxes still to fill. */
export function boxes(expr: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < expr.length; i++) if (expr[i] === BOX) out.push(i);
  return out;
}

/** The cursor at the next box after it (or the first, from the end); unchanged when there is none. */
export function nextBox(entry: Entry): Entry {
  const all = boxes(entry.expr);
  if (all.length === 0) return entry;
  const at = cursorOf(entry);
  const next = all.find((i) => i > at) ?? all[0];
  return { ...entry, cursor: next };
}

/**
 * ⌫ at the cursor: at the end, the whole function name with its bracket or
 * one sign (`deleteLast`); inside, the sign before the cursor, and a box
 * comes back where an input is left empty.
 */
export function backspace(entry: Entry, deleteLast: (expr: string) => string): Entry {
  if (entry.fresh) return { expr: "", cursor: 0, fresh: false };
  const at = cursorOf(entry);
  if (at === entry.expr.length) {
    const expr = deleteLast(entry.expr);
    return { expr, cursor: expr.length, fresh: false };
  }
  // At a box: go back to the box before, if any, rather than eat the template.
  if (entry.expr[at] === BOX) {
    const before = boxes(entry.expr).filter((i) => i < at);
    if (before.length > 0) return { ...entry, cursor: before[before.length - 1] };
  }
  if (at === 0) return entry;
  let expr = entry.expr.slice(0, at - 1) + entry.expr.slice(at);
  const cursor = at - 1;
  const left = expr[cursor - 1];
  const right = expr[cursor];
  const opens = left === "(" || left === ",";
  const closes =
    right === ")" || right === "," || right === undefined || expr.startsWith(" =", cursor);
  const seps = left === " " && expr.slice(cursor - 2, cursor) === "= ";
  if ((opens && closes) || (seps && (right === "," || right === ")"))) {
    expr = expr.slice(0, cursor) + BOX + expr.slice(cursor);
  }
  return { expr, cursor, fresh: false };
}

/** The expression with the cursor marked in it, for laying out. */
export function withCursor(entry: Entry): string {
  const at = cursorOf(entry);
  if (entry.expr[at] === BOX)
    return entry.expr.slice(0, at) + ACTIVE_BOX + entry.expr.slice(at + 1);
  return entry.expr.slice(0, at) + CARET + entry.expr.slice(at);
}

/** A key of a hardware keyboard: what to type, or which action. Null when it is not the calculator's. */
export function keyboardKey(
  key: string,
): { insert: string; continues: boolean } | { action: CalcAction } | { move: -1 | 1 } | null {
  switch (key) {
    case "Enter":
      return { action: "equals" };
    case "Backspace":
      return { action: "back" };
    case "Delete":
      return { action: "clear" };
    case "ArrowLeft":
      return { move: -1 };
    case "ArrowRight":
    case "Tab":
      return { move: 1 };
    case "*":
      return { insert: "×", continues: true };
    case "/":
      return { insert: "÷", continues: true };
    case "-":
      return { insert: "−", continues: true };
    case "+":
    case "^":
    case "!":
    case "%":
      return { insert: key, continues: true };
    case "=":
    case "<":
    case ">":
    case "{":
    case "}":
      return { insert: key, continues: false };
  }
  if (key.length !== 1) return null;
  if (/[0-9.(),]/.test(key)) return { insert: key, continues: false };
  if (/[a-zA-Z]/.test(key)) return { insert: key, continues: false };
  return null;
}

/** The cursor moved one sign left or right (a box counts as one sign). */
export function moveCursor(entry: Entry, by: -1 | 1): Entry {
  if (entry.fresh) return entry;
  const at = cursorOf(entry) + by;
  return { ...entry, cursor: Math.max(0, Math.min(entry.expr.length, at)) };
}

// --- Hints --------------------------------------------------------------------

/** What each function's inputs are, for the line under the display while one is being filled. */
const HINTS: ReadonlyArray<[RegExp, string]> = [
  [/solve$/, "solve(f = g, near): the x where f = g, closest to near"],
  [/d\/dx$/, "d/dx(f, a): the slope of f at x = a"],
  [/∫$/, "∫(f, a, b): area under f from x = a to x = b"],
  [/Σ$/, "Σ(f, a, b): f added for x = a … b; Σ(f, i, a, b) counts with i"],
  [/Π$/, "Π(f, a, b): f multiplied for x = a … b"],
  [/lim$/, "lim(f, a): what f tends to as x → a; a may be ∞"],
  [/(^|[^a-z])log$/, "log(x) is base 10; log(x, b) is base b"],
  [/root$/, "root(x, n): the nth root of x"],
  [/round$/, "round(x, d): x to d decimals"],
  [/nCr$/i, "nCr(n, r): choices of r from n"],
  [/nPr$/i, "nPr(n, r): arrangements of r from n"],
  [/(^|[^a-z])and$/, "and(a, b): bitwise AND"],
  [/(^|[^a-z])x?or$/, "or(a, b) / xor(a, b): bitwise OR / exclusive OR"],
  [/sh[lr]$/, "shl(a, n) / shr(a, n): shift a by n bits"],
];

/** The hint for the function whose inputs the cursor is in; "" when there is none. */
export function hintFor(entry: Entry): string {
  if (entry.fresh) return "";
  const at = cursorOf(entry);
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = entry.expr[i];
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth === 0) {
        const name = entry.expr.slice(Math.max(0, i - 6), i);
        const hint = HINTS.find(([pattern]) => pattern.test(name));
        if (hint) return hint[1];
      } else {
        depth--;
      }
    }
  }
  return boxes(entry.expr).length > 0 ? "Fill in the boxes; = goes to the next one" : "";
}

// --- Elsewhere ----------------------------------------------------------------

/**
 * `Ans` in `expr` spelled out as the value it stood for, so a line kept in
 * the history or put on the page reads on its own.
 */
export function spellAns(expr: string, ansText: string): string {
  const bare = /^[0-9.A-F]+$/.test(ansText);
  return expr.replace(/Ans/g, bare ? ansText : `(${ansText})`);
}

/**
 * Where a text box `w` × `h` (page px) goes to sit in the middle of what is
 * in view of the page (`view`, page px; the whole page when null), kept on
 * the page.
 */
export function centredOrigin(
  view: { x: number; y: number; w: number; h: number } | null,
  page: { width: number; height: number },
  w: number,
  h: number,
): { x: number; y: number } {
  const area = view ?? { x: 0, y: 0, w: page.width, h: page.height };
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(Math.max(0, max), v));
  return {
    x: clamp(area.x + (area.w - w) / 2, page.width - w),
    y: clamp(area.y + (area.h - h) / 2, page.height - h),
  };
}

/**
 * The result's font size: `max` while the text fits `width`, smaller in
 * proportion when it does not, never under `min` (iOS shrinks the result
 * the same way rather than wrapping it).
 */
export function fittedFontSize(
  textWidthAtMax: number,
  width: number,
  max: number,
  min: number,
): number {
  if (!(textWidthAtMax > width)) return max;
  return Math.max(min, Math.floor((max * width) / textWidthAtMax));
}
