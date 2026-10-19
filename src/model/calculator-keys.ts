/**
 * The calculator's keypad and typing rules, apart from the DOM. Pure.
 *
 * Each key inserts text into the expression (in the display's own signs:
 * × ÷ − √ π, which the engine reads as they are) or is an action the
 * pop-up carries out. After a result, a key that continues a calculation
 * (an operator) starts from `Ans`; anything else starts afresh, as on a
 * pocket calculator.
 */

export type CalcAction =
  "equals" | "back" | "clear" | "mc" | "mr" | "m+" | "m-" | "angle" | "fractions";

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
  /** Drawn as an operator or as the = key. */
  tone?: "fn" | "op" | "equals" | "mode";
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

/** The function rows, six keys each. */
export const SCIENTIFIC_ROWS: readonly (readonly CalcKey[])[] = [
  [
    fn("sin", "sin("),
    fn("cos", "cos("),
    fn("tan", "tan("),
    fn("ln", "ln("),
    fn("log", "log(", { aria: "log, base ten or log(x, base)" }),
    fn("√", "√(", { aria: "square root" }),
  ],
  [
    fn("sin⁻¹", "asin(", { aria: "arcsine" }),
    fn("cos⁻¹", "acos(", { aria: "arccosine" }),
    fn("tan⁻¹", "atan(", { aria: "arctangent" }),
    fn("ⁿ√", "root(", { aria: "nth root: root(x, n)" }),
    fn("x⁻¹", "^(−1)", { aria: "reciprocal", continues: true, decimalOnly: false }),
    fn("x²", "²", { aria: "squared", continues: true, decimalOnly: false }),
  ],
  [
    fn("π", "π", { aria: "pi" }),
    fn("e", "e"),
    fn("xʸ", "^", { aria: "to the power", continues: true, decimalOnly: false }),
    fn("n!", "!", { aria: "factorial", continues: true, decimalOnly: false }),
    fn("%", "%", { aria: "percent", continues: true, decimalOnly: false }),
    fn("mod", "mod(", { aria: "mod(a, b)", decimalOnly: false }),
  ],
  [
    fn("nCr", "nCr(", { aria: "combinations: nCr(n, r)", decimalOnly: false }),
    fn("nPr", "nPr(", { aria: "permutations: nPr(n, r)", decimalOnly: false }),
    fn("abs", "abs(", { aria: "absolute value", decimalOnly: false }),
    fn("rnd", "round(", { aria: "round(x, places)" }),
    fn(",", ",", { aria: "comma, between inputs", decimalOnly: false }),
    fn("EXP", "E", { aria: "times ten to the power" }),
  ],
];

/** Hex digits, shown in base 16 only. */
export const HEX_ROW: readonly CalcKey[] = [10, 11, 12, 13, 14, 15].map(hex);

/** Memory and the two switches. The switches' labels are filled in by the view. */
export const MEMORY_ROW: readonly CalcKey[] = [
  { label: "MC", action: "mc", aria: "memory clear", tone: "mode" },
  { label: "MR", action: "mr", aria: "memory recall", tone: "mode" },
  { label: "M+", action: "m+", aria: "add to memory", tone: "mode" },
  { label: "M−", action: "m-", aria: "subtract from memory", tone: "mode" },
  { label: "DEG", action: "angle", aria: "degrees or radians", tone: "mode", decimalOnly: true },
  { label: "a/b", action: "fractions", aria: "show fractions", tone: "mode", decimalOnly: true },
];

/** The number pad. */
export const NUMBER_ROWS: readonly (readonly CalcKey[])[] = [
  [
    digit(7),
    digit(8),
    digit(9),
    { label: "(", insert: "(" },
    { label: ")", insert: ")" },
    { label: "⌫", action: "back", aria: "delete", tone: "op" },
  ],
  [
    digit(4),
    digit(5),
    digit(6),
    op("×", "×", "times"),
    op("÷", "÷", "divided by"),
    { label: "AC", action: "clear", aria: "clear", tone: "op" },
  ],
  [
    digit(1),
    digit(2),
    digit(3),
    op("+", "+", "plus"),
    op("−", "−", "minus"),
    { label: "Ans", insert: "Ans", aria: "last answer" },
  ],
  [
    { ...digit(0), span: 2 },
    { label: ".", insert: ".", aria: "point", decimalOnly: true },
    { label: "=", action: "equals", aria: "equals", tone: "equals", span: 3 },
  ],
];

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
