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

import { type TextKey, t } from "../i18n/translate";
import { boxText, layoutExpression } from "./calc-display";
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

/**
 * The tabs, in order; Graph only shows while a graph line is edited. Each
 * name is read when it is asked for (a getter), never when this file loads.
 */
export const KEY_TABS: ReadonlyArray<{ id: KeyTab; label: string }> = [
  {
    id: "basic",
    get label() {
      return t("calculator.tabBasic");
    },
  },
  {
    id: "trig",
    get label() {
      return t("calculator.tabTrig");
    },
  },
  {
    id: "calculus",
    get label() {
      return t("calculator.tabCalculus");
    },
  },
  {
    id: "bases",
    get label() {
      return t("calculator.tabBases");
    },
  },
  {
    id: "memory",
    get label() {
      return t("calculator.tabMemory");
    },
  },
  {
    id: "graph",
    get label() {
      return t("calculator.graph");
    },
  },
];

export function isKeyTab(value: unknown): value is KeyTab {
  return KEY_TABS.some((tab) => tab.id === value);
}

const BOX = PLACEHOLDER;

/**
 * A function key types its bracket closed with a box inside (`sin(▢)`), as
 * natural-display calculators do: the cursor sits in the box, ▶ or `)`
 * steps out past the bracket, and an operator typed inside stays inside
 * (sin(30+2) is a real sum). Before 2026-10-19 the key typed `sin(` and the
 * bracket was only drawn, so there was no way past it (Joost, iPad).
 */
function closed(insert: string): string {
  return insert.endsWith("(") ? `${insert}${BOX})` : insert;
}

/**
 * `key` with its spoken name and help line read from the language when they
 * are asked for, never when this file loads (the tables below are constants).
 */
function worded(key: CalcKey, help?: TextKey | (() => string), aria?: TextKey): CalcKey {
  if (help !== undefined) {
    const read = typeof help === "function" ? help : () => t(help);
    Object.defineProperty(key, "help", { get: read, enumerable: true, configurable: true });
  }
  if (aria !== undefined) {
    Object.defineProperty(key, "aria", {
      get: () => t(aria),
      enumerable: true,
      configurable: true,
    });
  }
  return key;
}

/** The extras a key may carry: its spoken name is given as a text key. */
type Extra = Partial<Omit<CalcKey, "aria" | "help">> & { aria?: TextKey };

const fn = (label: string, insert: string, help: TextKey, extra: Extra = {}): CalcKey => {
  const { aria, ...rest } = extra;
  return worded(
    { label, insert: closed(insert), tone: "fn", decimalOnly: true, ...rest },
    help,
    aria,
  );
};
const op = (label: string, insert: string, aria: TextKey, help: TextKey): CalcKey =>
  worded({ label, insert, tone: "op", continues: true }, help, aria);
const digit = (d: number): CalcKey => ({
  label: d.toString(16).toUpperCase(),
  insert: `${d}`,
  digit: d,
});
const hex = (d: number): CalcKey =>
  worded({ ...digit(d), insert: d.toString(16).toUpperCase() }, () =>
    t("calculator.helpHexDigit", { letter: d.toString(16).toUpperCase(), value: d }),
  );
const anyBase = { decimalOnly: false } as const;
const baseKey = (base: NumberBase, label: string, help: TextKey): CalcKey =>
  worded({ label, action: "base", base, tone: "mode" }, help);

/** A function key's rows, six slots each; null is an empty slot. */
export type KeyRows = ReadonlyArray<ReadonlyArray<CalcKey | null>>;

const BASIC: KeyRows = [
  [
    fn("x²", "²", "calculator.helpSquare", {
      aria: "calculator.ariaSquared",
      continues: true,
      ...anyBase,
    }),
    fn("xʸ", `^(${BOX})`, "calculator.helpPower", {
      aria: "calculator.ariaToThePower",
      continues: true,
      ...anyBase,
    }),
    fn("√", `√(`, "calculator.helpSquareRoot", { aria: "calculator.ariaSquareRoot" }),
    fn("ⁿ√", `root(${BOX}, ${BOX})`, "calculator.helpNthRoot", { aria: "calculator.ariaNthRoot" }),
    fn("x⁻¹", "^(−1)", "calculator.helpReciprocal", {
      aria: "calculator.ariaReciprocal",
      continues: true,
    }),
    fn("π", "π", "calculator.helpPi", { aria: "calculator.ariaPi" }),
  ],
  [
    fn("ln", "ln(", "calculator.helpLn"),
    fn("log", "log(", "calculator.helpLog"),
    fn("eˣ", "e^(", "calculator.helpETo", { aria: "calculator.ariaETo" }),
    fn("10ˣ", "10^(", "calculator.helpTenTo", { aria: "calculator.ariaTenTo" }),
    fn("e", "e", "calculator.helpE"),
    fn("x", "x", "calculator.helpVariableXMany", { aria: "calculator.ariaVariableX" }),
  ],
  [
    fn("mod", " mod ", "calculator.helpMod", {
      continues: true,
      ...anyBase,
    }),
    fn("|x|", "abs(", "calculator.helpAbsolute", {
      aria: "calculator.ariaAbsolute",
      ...anyBase,
    }),
    fn("%", "%", "calculator.helpPercent", {
      aria: "calculator.ariaPercent",
      continues: true,
      ...anyBase,
    }),
    fn("n!", "!", "calculator.helpFactorial", {
      aria: "calculator.ariaFactorial",
      continues: true,
      ...anyBase,
    }),
    fn("EXP", "E", "calculator.helpTimesTen", {
      aria: "calculator.ariaTimesTen",
    }),
    fn("logₐ", `log(${BOX}, ${BOX})`, "calculator.helpLogBase", {
      aria: "calculator.ariaLogAnyBase",
    }),
  ],
];

const TRIG: KeyRows = [
  [
    worded(
      {
        label: "2nd",
        action: "shift",
        tone: "mode",
      },
      "calculator.helpShowInverses",
      "calculator.ariaSecond",
    ),
    fn("sin", "sin(", "calculator.helpSine", {
      shift: fn("sin⁻¹", "asin(", "calculator.helpArcsine"),
    }),
    fn("cos", "cos(", "calculator.helpCosine", {
      shift: fn("cos⁻¹", "acos(", "calculator.helpArccosine"),
    }),
    fn("tan", "tan(", "calculator.helpTangent", {
      shift: fn("tan⁻¹", "atan(", "calculator.helpArctangent"),
    }),
    fn("°", "°", "calculator.helpDegrees", { continues: true }),
    worded(
      {
        label: "DEG",
        action: "angle",
        tone: "mode",
        decimalOnly: true,
      },
      "calculator.helpSwitchAngles",
      "calculator.ariaDegRad",
    ),
  ],
  [
    fn("sinh", "sinh(", "calculator.helpSinh", {
      shift: fn("sinh⁻¹", "asinh(", "calculator.helpAsinh"),
    }),
    fn("cosh", "cosh(", "calculator.helpCosh", {
      shift: fn("cosh⁻¹", "acosh(", "calculator.helpAcosh"),
    }),
    fn("tanh", "tanh(", "calculator.helpTanh", {
      shift: fn("tanh⁻¹", "atanh(", "calculator.helpAtanh"),
    }),
    fn("sec", "sec(", "calculator.helpSec", {
      shift: fn("sec⁻¹", "asec(", "calculator.helpAsec"),
    }),
    fn("csc", "csc(", "calculator.helpCsc", {
      shift: fn("csc⁻¹", "acsc(", "calculator.helpAcsc"),
    }),
    fn("cot", "cot(", "calculator.helpCot", {
      shift: fn("cot⁻¹", "acot(", "calculator.helpAcot"),
    }),
  ],
  [
    fn("π", "π", "calculator.helpPi", { aria: "calculator.ariaPi" }),
    fn("x", "x", "calculator.helpVariableX", { aria: "calculator.ariaVariableX" }),
    null,
    null,
    null,
    null,
  ],
];

const CALCULUS: KeyRows = [
  [
    fn("d/dx", `d/dx(${BOX})`, "calculator.helpDeriv"),
    fn("∫", `∫(${BOX})`, "calculator.helpIntegral"),
    fn("Σ", `Σ(${BOX}, ${BOX}, ${BOX})`, "calculator.helpSum"),
    fn("Π", `Π(${BOX}, ${BOX}, ${BOX})`, "calculator.helpProduct"),
    fn("lim", `lim(${BOX}, ${BOX})`, "calculator.helpLimit"),
    fn("solve", `solve(${BOX} = ${BOX})`, "calculator.helpSolve"),
  ],
  [
    fn("x", "x", "calculator.helpVariableX", { aria: "calculator.ariaVariableX" }),
    fn("∞", "∞", "calculator.helpInfinity", { aria: "calculator.ariaInfinity" }),
    fn("π", "π", "calculator.helpPi", { aria: "calculator.ariaPi" }),
    fn("e", "e", "calculator.helpE"),
    fn("∫ₐᵇ", `∫(${BOX}, ${BOX}, ${BOX})`, "calculator.helpDefIntegral", {
      aria: "calculator.ariaDefiniteIntegral",
    }),
    fn("f′(a)", `d/dx(${BOX}, ${BOX})`, "calculator.helpSlope", {
      aria: "calculator.ariaSlopeAtPoint",
    }),
  ],
  [null, null, null, null, null, null],
];

const BASES: KeyRows = [
  [
    baseKey(10, "DEC", "calculator.helpDecimal"),
    baseKey(16, "HEX", "calculator.helpHexadecimal"),
    baseKey(2, "BIN", "calculator.helpBinary"),
    baseKey(8, "OCT", "calculator.helpOctal"),
    fn("<<", `shl(${BOX}, ${BOX})`, "calculator.helpShl", { ...anyBase }),
    fn(">>", `shr(${BOX}, ${BOX})`, "calculator.helpShr", {
      ...anyBase,
    }),
  ],
  [10, 11, 12, 13, 14, 15].map(hex),
  [
    fn("AND", `and(${BOX}, ${BOX})`, "calculator.helpAnd", { ...anyBase }),
    fn("OR", `or(${BOX}, ${BOX})`, "calculator.helpOr", { ...anyBase }),
    fn("XOR", `xor(${BOX}, ${BOX})`, "calculator.helpXor", { ...anyBase }),
    fn("NOT", "not(", "calculator.helpNot", { ...anyBase }),
    fn("mod", " mod ", "calculator.helpModShort", { continues: true, ...anyBase }),
    null,
  ],
];

const MEMORY: KeyRows = [
  [
    worded(
      {
        label: "MC",
        action: "mc",
        tone: "mode",
      },
      "calculator.helpMemoryClear",
      "calculator.ariaMemoryClear",
    ),
    worded(
      {
        label: "MR",
        action: "mr",
        tone: "mode",
      },
      "calculator.helpMemoryRecall",
      "calculator.ariaMemoryRecall",
    ),
    worded(
      {
        label: "M+",
        action: "m+",
        tone: "mode",
      },
      "calculator.helpMemoryAdd",
      "calculator.ariaAddToMemory",
    ),
    worded(
      {
        label: "M−",
        action: "m-",
        tone: "mode",
      },
      "calculator.helpMemorySubtract",
      "calculator.ariaSubtractFromMemory",
    ),
    worded(
      { label: "Ans", insert: "Ans", tone: "mode" },
      "calculator.helpLastAnswer",
      "calculator.ariaLastAnswer",
    ),
    null,
  ],
  [
    fn("nCr", `nCr(${BOX}, ${BOX})`, "calculator.helpNcr", {
      ...anyBase,
    }),
    fn("nPr", `nPr(${BOX}, ${BOX})`, "calculator.helpNpr", {
      ...anyBase,
    }),
    fn("n!", "!", "calculator.helpFactorial", {
      aria: "calculator.ariaFactorial",
      continues: true,
      ...anyBase,
    }),
    fn("|x|", "abs(", "calculator.helpAbsoluteShort", {
      aria: "calculator.ariaAbsolute",
      ...anyBase,
    }),
    fn("rnd", `round(${BOX}, ${BOX})`, "calculator.helpRound"),
    fn("mod", " mod ", "calculator.helpModShort", { continues: true, ...anyBase }),
  ],
  [null, null, null, null, null, null],
];

const GRAPH: KeyRows = [
  [
    fn("x", "x", "calculator.helpGraphX"),
    fn("y", "y", "calculator.helpGraphY"),
    fn("=", "=", "calculator.helpEquation", {
      aria: "calculator.ariaEqualsSign",
    }),
    fn("<", "<", "calculator.helpLess", { aria: "calculator.ariaLessThan" }),
    fn(">", ">", "calculator.helpShade", { aria: "calculator.ariaGreaterThan" }),
    fn("≤", "≤", "calculator.helpShadeEdge", { aria: "calculator.ariaAtMost" }),
  ],
  [
    fn("t", "t", "calculator.helpParameter"),
    fn("θ", "θ", "calculator.helpTheta", { aria: "calculator.ariaTheta" }),
    fn("r", "r", "calculator.helpRadius"),
    fn("{", "{", "calculator.helpRestrict", { aria: "calculator.ariaOpenBrace" }),
    fn("}", "}", "calculator.helpEndRestriction", { aria: "calculator.ariaCloseBrace" }),
    fn("≥", "≥", "calculator.helpShadeEdge", { aria: "calculator.ariaAtLeast" }),
  ],
  [
    fn("a", "a", "calculator.helpSlider"),
    fn("b", "b", "calculator.helpSliderShort"),
    fn("k", "k", "calculator.helpSliderShort"),
    fn("sin", "sin(", "calculator.helpSine"),
    fn("cos", "cos(", "calculator.helpCosine"),
    fn("π", "π", "calculator.helpPiShort", { aria: "calculator.ariaPi" }),
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
    worded(
      {
        label: "AC",
        action: "clear",
        tone: "mode",
      },
      "calculator.helpClearKey",
      "calculator.ariaClear",
    ),
    worded(
      {
        label: "⌫",
        action: "back",
        tone: "mode",
      },
      "calculator.helpBackspace",
      "calculator.ariaDelete",
    ),
    worded({ label: "(", insert: "(", tone: "mode" }, "calculator.helpOpenBracket"),
    worded(
      {
        label: ")",
        insert: ")",
        tone: "mode",
      },
      "calculator.helpCloseBracket",
    ),
    op("÷", "÷", "calculator.ariaDividedBy", "calculator.helpDivide"),
  ],
  [
    digit(7),
    digit(8),
    digit(9),
    worded(
      { label: "Ans", insert: "Ans", tone: "mode" },
      "calculator.helpLastAnswer",
      "calculator.ariaLastAnswer",
    ),
    op("×", "×", "calculator.ariaTimes", "calculator.helpMultiply"),
  ],
  [
    digit(4),
    digit(5),
    digit(6),
    worded(
      {
        label: "solve",
        insert: `solve(${BOX} = ${BOX})`,
        tone: "mode",
        decimalOnly: true,
      },
      "calculator.helpSolve",
    ),
    op("−", "−", "calculator.ariaMinus", "calculator.helpSubtract"),
  ],
  [
    digit(1),
    digit(2),
    digit(3),
    worded(
      {
        label: "x",
        insert: "x",
        tone: "mode",
        decimalOnly: true,
      },
      "calculator.helpVariableX",
      "calculator.ariaVariableX",
    ),
    op("+", "+", "calculator.ariaPlus", "calculator.helpAdd"),
  ],
  [
    { ...digit(0), span: 2 },
    worded(
      { label: ".", insert: ".", decimalOnly: true },
      "calculator.helpPoint",
      "calculator.ariaPoint",
    ),
    worded(
      {
        label: ",",
        insert: ",",
      },
      "calculator.helpComma",
      "calculator.ariaComma",
    ),
    worded(
      {
        label: "=",
        action: "equals",
        tone: "equals",
      },
      "calculator.helpEqualsKey",
      "calculator.ariaEquals",
    ),
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

/**
 * A key typed as a person means it: `,`, `)` or `=` typed where the template
 * already has one steps over it (onto the next box), and `,` typed in an
 * empty box goes to the next box; anything else is {@link typeInto}.
 */
export function typeKey(entry: Entry, insert: string, continues: boolean): Entry {
  if (!entry.fresh && (insert === "," || insert === ")" || insert === "=")) {
    const at = cursorOf(entry);
    if (insert === "," && entry.expr[at] === BOX) {
      const next = boxes(entry.expr).find((i) => i > at);
      if (next !== undefined) return { ...entry, cursor: next };
    }
    // Over spaces, the sign itself, and spaces after it (no regex built from text: ledger).
    let i = at;
    while (entry.expr[i] === " ") i++;
    if (entry.expr[i] === insert) {
      i++;
      while (entry.expr[i] === " ") i++;
      return { ...entry, cursor: i };
    }
  }
  return typeInto(entry, insert, continues);
}

/**
 * The cursor into box `k` (0-based, in display order) of the expression as
 * drawn, where `ending` is what the display added to read it (its boxes are
 * not typed yet): those are added first, so the box can be filled.
 */
export function moveToBox(entry: Entry, k: number, ending = ""): Entry {
  const real = boxes(entry.expr);
  if (k < real.length) return { ...entry, cursor: real[k], fresh: false };
  const expr = entry.expr + ending;
  const all = boxes(expr);
  if (k >= all.length) return { ...entry, cursor: entry.expr.length, fresh: false };
  return { expr, cursor: all[k], fresh: false };
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

/** Names the cursor never stands inside: a function (before its bracket) and a constant. */
const UNIT = /d\/dx(?=\()|[A-Za-z]+(?=\()|ans|pi|theta|inf|mod/gi;

/**
 * Whether the cursor can stand at `at` in `expr`: not inside a function's name
 * or between it and its bracket, and where the display can draw it. Moving
 * through `sin(` or `d/dx(` one sign at a time stopped on places that showed
 * the raw text or no cursor at all.
 */
export function isStop(expr: string, at: number): boolean {
  if (at < 0 || at > expr.length) return false;
  // Beside a box the cursor stands on it instead: typing there would not fill it.
  if (expr[at] !== BOX) {
    if (expr[at - 1] === BOX) return false;
    let r = at;
    while (expr[r] === " ") r++;
    if (expr[r] === BOX) return false;
  }
  for (const m of expr.matchAll(UNIT)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const bracket = expr[end] === "(";
    if (at > start && (bracket ? at <= end : at < end)) return false;
  }
  const laid = layoutExpression(withCursor({ expr, cursor: at, fresh: false }));
  if (!laid) return false;
  const text = boxText(laid);
  return text.includes("|") || text.includes("■");
}

/** The expression as drawn with the cursor at `at`. */
function stopText(expr: string, at: number): string {
  const laid = layoutExpression(withCursor({ expr, cursor: at, fresh: false }));
  return laid ? boxText(laid) : "";
}

/** `at`, or the nearest place the cursor can stand (to the left first). */
function nearestStop(expr: string, at: number): number {
  for (let d = 0; d <= expr.length; d++) {
    if (isStop(expr, at - d)) return at - d;
    if (isStop(expr, at + d)) return at + d;
  }
  return Math.max(0, Math.min(expr.length, at));
}

/**
 * An operand left empty at `cursor` gets its box back: between separators
 * (`log(▢, 2)`), and before ÷, × or ^ with nothing left to divide, multiply
 * or raise (a fraction whose numerator was rubbed out read as raw text).
 */
function refillBox(expr: string, cursor: number): string {
  let l = cursor - 1;
  while (expr[l] === " ") l--;
  let r = cursor;
  while (expr[r] === " ") r++;
  if (expr[r] === BOX || expr[l] === BOX) return expr;
  const opens = l < 0 ? false : "(,=".includes(expr[l]);
  const closes = r >= expr.length || "),=".includes(expr[r]);
  const between = opens && closes && !(expr[l] === "=" && expr[r] === "=");
  const lone =
    (l < 0 || "(,=+−×÷^".includes(expr[l])) && r < expr.length && "÷×^".includes(expr[r]);
  return between || lone ? expr.slice(0, cursor) + BOX + expr.slice(cursor) : expr;
}

/** The ")" closing the "(" at `open`, or -1 when it is still open. */
function closingBracket(expr: string, open: number): number {
  let depth = 0;
  for (let i = open; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Whether `inner` has a comma outside every bracket of its own. */
function hasTopLevelComma(inner: string): boolean {
  let depth = 0;
  for (const c of inner) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return true;
  }
  return false;
}

/**
 * ⌫ at the cursor: at the end, the whole function name with its bracket or
 * one sign (`deleteLast`). Inside, it takes apart what the display shows as
 * one thing at a time: a bracket goes with its partner and a function with
 * its name; at the start of a denominator, an exponent or a later input it
 * steps back into what comes before instead of gluing the two together; an
 * operator goes with the empty box after it.
 */
export function backspace(entry: Entry, deleteLast: (expr: string) => string): Entry {
  if (entry.fresh) return { expr: "", cursor: 0, fresh: false };
  const at = cursorOf(entry);
  if (at === entry.expr.length) {
    // One ⌫, one change you can see: `√(` then `√` drew the same empty root twice.
    const before = stopText(entry.expr, at);
    let expr = deleteLast(entry.expr);
    for (let n = 0; n < 3 && expr !== "" && stopText(expr, expr.length) === before; n++) {
      expr = deleteLast(expr);
    }
    return { expr, cursor: expr.length, fresh: false };
  }
  const done = (text: string, cursor: number): Entry => {
    const expr = refillBox(text, cursor);
    return { expr, cursor: nearestStop(expr, cursor), fresh: false };
  };
  // An empty function, sin(▢) with the cursor in its box: ⌫ takes it whole.
  if (entry.expr[at] === BOX && entry.expr[at + 1] === ")" && entry.expr[at - 1] === "(") {
    const name = /(?:[a-zA-Z]+|√|d\/dx|∫|Σ|Π|\^|e\^|10\^)\($/.exec(entry.expr.slice(0, at));
    const onlyBox = name && !entry.expr.slice(name.index, at).includes(",");
    if (onlyBox && name) {
      return done(entry.expr.slice(0, name.index) + entry.expr.slice(at + 2), name.index);
    }
  }
  if (entry.expr[at] === BOX) {
    // An operator and the box that waits for its operand go together.
    let j = at - 1;
    while (j > 0 && entry.expr[j] === " ") j--;
    if (j >= 0 && "+−×÷^".includes(entry.expr[j])) {
      return done(entry.expr.slice(0, j) + entry.expr.slice(at + 1), j);
    }
    // Otherwise go back to the box before, if any, rather than eat the template.
    const before = boxes(entry.expr).filter((i) => i < at);
    if (before.length > 0) return { ...entry, cursor: before[before.length - 1] };
  }
  if (at === 0) return entry;
  let j = at - 1;
  while (j > 0 && entry.expr[j] === " ") j--;
  const c = entry.expr[j];
  // The start of a later input, a denominator or an exponent, or just after a bracket's close:
  // step back into what comes before (or inside) rather than gluing or unbalancing.
  if (c === "," || c === "÷" || c === "^" || c === ")") return { ...entry, cursor: j };
  if (c === "(") {
    if (entry.expr[j - 1] === "÷" || entry.expr[j - 1] === "^") {
      return { ...entry, cursor: j - 1 };
    }
    const close = closingBracket(entry.expr, j);
    const inner = entry.expr.slice(j + 1, close < 0 ? entry.expr.length : close);
    const tail = close < 0 ? "" : entry.expr.slice(close + 1);
    const name = /(?:d\/dx|[a-zA-Z]+|√|∫|Σ|Π)$/.exec(entry.expr.slice(0, j));
    const start = name ? name.index : j;
    // A function with several inputs goes whole; one input, or a bracket, keeps its content.
    const keep = name && hasTopLevelComma(inner) ? "" : inner;
    return done(entry.expr.slice(0, start) + keep + tail, start);
  }
  // A constant goes whole: Ans, π typed as words.
  const word = /(?:ans|pi|theta|inf|mod)$/i.exec(entry.expr.slice(0, at));
  if (word) {
    return done(entry.expr.slice(0, word.index) + entry.expr.slice(at), word.index);
  }
  return done(entry.expr.slice(0, at - 1) + entry.expr.slice(at), at - 1);
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
  const at = cursorOf(entry);
  // ▶ at the very end with a bracket still open: close it and step past,
  // as the display already draws it closed.
  if (by === 1 && at === entry.expr.length && openBrackets(entry.expr) > 0) {
    const expr = `${entry.expr})`;
    return { ...entry, expr, cursor: expr.length };
  }
  // One stop at a time: not into the middle of a function's name, and past
  // places the display draws alike (either side of a ", " or a hidden bracket).
  const seen = stopText(entry.expr, at);
  for (let p = at + by; p >= 0 && p <= entry.expr.length; p += by) {
    if (isStop(entry.expr, p) && stopText(entry.expr, p) !== seen) return { ...entry, cursor: p };
  }
  return entry;
}

/** Brackets opened and not yet closed in `expr`. */
export function openBrackets(expr: string): number {
  let depth = 0;
  for (const c of expr) {
    if (c === "(") depth++;
    else if (c === ")" && depth > 0) depth--;
  }
  return depth;
}

/**
 * The cursor after everything shown: every bracket the display draws
 * closed is closed in the text, and the cursor goes past them all (a tap
 * on the display's tail, right of the last bracket).
 */
export function toEnd(entry: Entry): Entry {
  if (entry.fresh) return entry;
  const expr = entry.expr + ")".repeat(openBrackets(entry.expr));
  return { ...entry, expr, cursor: expr.length };
}

// --- Hints --------------------------------------------------------------------

/** What each function's inputs are, for the line under the display while one is being filled. */
const HINTS: ReadonlyArray<[RegExp, TextKey]> = [
  [/solve$/, "calculator.hintSolve"],
  [/d\/dx$/, "calculator.hintDeriv"],
  [/∫$/, "calculator.hintIntegral"],
  [/Σ$/, "calculator.hintSum"],
  [/Π$/, "calculator.hintProduct"],
  [/lim$/, "calculator.hintLimit"],
  [/(^|[^a-z])log$/, "calculator.hintLog"],
  [/root$/, "calculator.hintRoot"],
  [/round$/, "calculator.hintRound"],
  [/nCr$/i, "calculator.hintNcr"],
  [/nPr$/i, "calculator.hintNpr"],
  [/(^|[^a-z])and$/, "calculator.hintAnd"],
  [/(^|[^a-z])x?or$/, "calculator.hintOr"],
  [/sh[lr]$/, "calculator.hintShift"],
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
        if (hint) return t(hint[1]);
      } else {
        depth--;
      }
    }
  }
  return boxes(entry.expr).length > 0 ? t("calculator.hintFillBoxes") : "";
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
