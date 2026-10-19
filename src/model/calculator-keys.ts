/**
 * The calculator's keypad and typing rules, apart from the DOM. Pure.
 *
 * Two blocks, as the Google and Windows calculators have them: three rows
 * of functions whose second meanings (sin ↔ sin⁻¹, √ ↔ ⁿ√) sit behind a
 * 2nd key instead of a wall of keys, and a number pad with the operators in
 * their own column on the right, as on iOS.
 *
 * Each key types text into the expression (in the display's own signs:
 * × ÷ − √ π, which the engine reads as they are) or is an action the
 * pop-up carries out. After a result, a key that continues a calculation
 * (an operator) starts from `Ans`; anything else starts afresh.
 */

export type CalcAction = "equals" | "back" | "clear" | "shift" | "mc" | "mr" | "m+" | "m-";

export interface CalcKey {
  /** What the key shows. */
  label: string;
  /** Spoken name, where the label is a sign. */
  aria?: string;
  /** Text it types; absent for an action key. */
  insert?: string;
  action?: CalcAction;
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

const fn = (label: string, insert: string, extra: Partial<CalcKey> = {}): CalcKey => ({
  label,
  insert,
  tone: "fn",
  decimalOnly: true,
  ...extra,
});
const op = (label: string, insert: string, aria: string): CalcKey => ({
  label,
  insert,
  aria,
  tone: "op",
  continues: true,
});
const digit = (d: number): CalcKey => ({
  label: d.toString(16).toUpperCase(),
  insert: `${d}`,
  digit: d,
});
const hex = (d: number): CalcKey => ({ ...digit(d), insert: d.toString(16).toUpperCase() });
const anyBase = { decimalOnly: false } as const;

/** The function block: six keys a row. */
export const SCIENTIFIC_ROWS: readonly (readonly CalcKey[])[] = [
  [
    { label: "2nd", action: "shift", aria: "second functions", tone: "mode" },
    fn("sin", "sin(", { shift: fn("sin⁻¹", "asin(", { aria: "arcsine" }) }),
    fn("cos", "cos(", { shift: fn("cos⁻¹", "acos(", { aria: "arccosine" }) }),
    fn("tan", "tan(", { shift: fn("tan⁻¹", "atan(", { aria: "arctangent" }) }),
    fn("ln", "ln(", { shift: fn("eˣ", "e^(", { aria: "e to the power" }) }),
    fn("log", "log(", {
      aria: "log, base ten or log(x, base)",
      shift: fn("10ˣ", "10^(", { aria: "ten to the power" }),
    }),
  ],
  [
    fn("√", "√(", {
      aria: "square root",
      shift: fn("ⁿ√", "root(", { aria: "nth root: root(x, n)" }),
    }),
    fn("x²", "²", {
      aria: "squared",
      continues: true,
      ...anyBase,
      shift: fn("x³", "³", { aria: "cubed", continues: true, ...anyBase }),
    }),
    fn("xʸ", "^", {
      aria: "to the power",
      continues: true,
      ...anyBase,
      shift: fn("x⁻¹", "^(−1)", { aria: "reciprocal", continues: true }),
    }),
    fn("π", "π", { aria: "pi" }),
    fn("e", "e"),
    fn("x", "x", { aria: "variable x" }),
  ],
  [
    fn("d/dx", "d/dx(", {
      aria: "derivative: d/dx(f, at)",
      shift: fn("nCr", "nCr(", { aria: "combinations: nCr(n, r)", ...anyBase }),
    }),
    fn("∫", "∫(", {
      aria: "integral: ∫(f, from, to)",
      shift: fn("nPr", "nPr(", { aria: "permutations: nPr(n, r)", ...anyBase }),
    }),
    fn("Σ", "Σ(", {
      aria: "sum: Σ(f, from, to)",
      shift: fn("mod", "mod(", { aria: "mod(a, b)", ...anyBase }),
    }),
    fn("solve", "solve(", {
      aria: "solve f = 0: solve(f, guess)",
      shift: fn("|x|", "abs(", { aria: "absolute value", ...anyBase }),
    }),
    fn("n!", "!", {
      aria: "factorial",
      continues: true,
      ...anyBase,
      shift: fn("rnd", "round(", { aria: "round(x, places)" }),
    }),
    fn("%", "%", {
      aria: "percent",
      continues: true,
      ...anyBase,
      shift: fn("EXP", "E", { aria: "times ten to the power" }),
    }),
  ],
];

/** Hex digits, in place of the third function row in base 16. */
export const HEX_ROW: readonly CalcKey[] = [10, 11, 12, 13, 14, 15].map(hex);

/** The number pad: five keys a row, the operators on the right. */
export const NUMBER_ROWS: readonly (readonly CalcKey[])[] = [
  [
    { label: "AC", action: "clear", aria: "clear", tone: "mode" },
    { label: "⌫", action: "back", aria: "delete", tone: "mode" },
    { label: "(", insert: "(", tone: "mode" },
    { label: ")", insert: ")", tone: "mode" },
    op("÷", "÷", "divided by"),
  ],
  [
    digit(7),
    digit(8),
    digit(9),
    { label: "Ans", insert: "Ans", aria: "last answer", tone: "mode" },
    op("×", "×", "times"),
  ],
  [
    digit(4),
    digit(5),
    digit(6),
    {
      label: "MR",
      action: "mr",
      aria: "memory recall",
      tone: "mode",
      shift: { label: "MC", action: "mc", aria: "memory clear", tone: "mode" },
    },
    op("−", "−", "minus"),
  ],
  [
    digit(1),
    digit(2),
    digit(3),
    {
      label: "M+",
      action: "m+",
      aria: "add to memory",
      tone: "mode",
      shift: { label: "M−", action: "m-", aria: "subtract from memory", tone: "mode" },
    },
    op("+", "+", "plus"),
  ],
  [
    { ...digit(0), span: 2 },
    { label: ".", insert: ".", aria: "point", decimalOnly: true },
    { label: ",", insert: ",", aria: "comma, between inputs" },
    { label: "=", action: "equals", aria: "equals", tone: "equals" },
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

/** What the display is typing into. */
export interface Entry {
  expr: string;
  /** A result is on show: the next key starts again (or carries it on). */
  fresh: boolean;
}

/** `insert` typed into `entry`. */
export function typeInto(entry: Entry, insert: string, continues: boolean): Entry {
  if (entry.fresh) return { expr: (continues ? "Ans" : "") + insert, fresh: false };
  return { expr: entry.expr + insert, fresh: false };
}

/** A key of a hardware keyboard: what to type, or which action. Null when it is not the calculator's. */
export function keyboardKey(
  key: string,
): { insert: string; continues: boolean } | { action: CalcAction } | null {
  switch (key) {
    case "Enter":
    case "=":
      return { action: "equals" };
    case "Backspace":
      return { action: "back" };
    case "Delete":
      return { action: "clear" };
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
  }
  if (key.length !== 1) return null;
  if (/[0-9.(),]/.test(key)) return { insert: key, continues: false };
  if (/[a-zA-Z]/.test(key)) return { insert: key, continues: false };
  return null;
}

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
