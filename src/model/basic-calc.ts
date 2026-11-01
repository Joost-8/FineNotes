/**
 * The calculator's Basic mode: a pocket calculator laid out as the iPhone's
 * Calculator in portrait (Joost's brief, 2026-10-30). Pure: a state, a key,
 * the next state; and what the display shows.
 *
 * How it counts, as the iPhone's does (iOS 17 and 18):
 *
 * - Precedence: 2 + 3 × 4 = is 14. × and ÷ bind before + and −. Pressing an
 *   operator works out what it can already (after 2 × 3 +, the display shows
 *   6; after 2 + 3 ×, it still shows 3, as the 3 belongs to the ×).
 * - Pressing another operator straight after one replaces it.
 * - = with an operator and no second number uses the number on show
 *   (5 + = is 10).
 * - = again repeats the last operation (2 + 3 = 5, = 8, = 11); after
 *   2 + 3 × 4 = it repeats × 4.
 * - % is a percentage of the number before it under + and − (50 + 10 % is
 *   50 + 5), and a hundredth otherwise.
 * - ± flips the sign of the number on show, or starts a negative one.
 * - C clears the number being typed and keeps the sum; AC clears it all.
 *   The key reads C while a number is being typed.
 * - Dividing by zero shows Error until a number or AC.
 *
 * Numbers are floats rounded to 15 significant digits after each step (so
 * 0.1 + 0.2 is 0.3), shown with at most {@link MAX_DIGITS} digits, and in
 * exponent form past that (1.2345e15), as the iPhone does.
 */

export type BasicOp = "+" | "−" | "×" | "÷";

export type BasicKey =
  | { digit: number }
  | { point: true }
  | { op: BasicOp }
  | { equals: true }
  | { percent: true }
  | { negate: true }
  | { clear: true }
  | { back: true };

/** A number waiting for the one after its operator. */
interface Pending {
  value: number;
  op: BasicOp;
}

export interface BasicState {
  /** The number being typed, as typed ("0.", "-12"); null when the display shows a value. */
  entry: string | null;
  /** The value on show when nothing is being typed. */
  value: number;
  /** The sum so far, oldest first; each waits for the number after its operator. */
  stack: readonly Pending[];
  /** An operator was just pressed: it lights up, and the next digit starts a new number. */
  awaiting: boolean;
  /** What = repeats: the last operation and its second number. */
  repeat: { op: BasicOp; operand: number } | null;
  /** The sum as written, for the line above the number and for history ("2 + 3 ×"). */
  tape: readonly string[];
  /** The last line worked out by =, kept until the next key starts another. */
  line: { expr: string; result: string } | null;
  error: boolean;
}

/** Digits the display holds, as on the iPhone in portrait. */
export const MAX_DIGITS = 9;
const PRECISION = 15;

export const BASIC_START: BasicState = {
  entry: null,
  value: 0,
  stack: [],
  awaiting: false,
  repeat: null,
  tape: [],
  line: null,
  error: false,
};

/** The key a keyboard key stands for (Enter is =, Escape clears); null for others. */
export function basicKeyFor(key: string): BasicKey | null {
  if (/^[0-9]$/.test(key)) return { digit: Number(key) };
  switch (key) {
    case ".":
    case ",":
      return { point: true };
    case "+":
      return { op: "+" };
    case "-":
    case "−":
      return { op: "−" };
    case "*":
    case "x":
    case "X":
    case "×":
      return { op: "×" };
    case "/":
    case "÷":
      return { op: "÷" };
    case "=":
    case "Enter":
      return { equals: true };
    case "%":
      return { percent: true };
    case "Escape":
    case "Delete":
      return { clear: true };
    case "Backspace":
      return { back: true };
  }
  return null;
}

/** The state after `key`. */
export function pressBasic(state: BasicState, key: BasicKey): BasicState {
  if ("clear" in key) return clear(state);
  if (state.error) {
    // Error waits for a new number or AC; operators, = and % do nothing.
    if ("digit" in key || "point" in key) return pressBasic(BASIC_START, key);
    return state;
  }
  if ("digit" in key) return typeDigit(state, String(key.digit));
  if ("point" in key) return typeDigit(state, ".");
  if ("back" in key) return backspace(state);
  if ("negate" in key) return negate(state);
  if ("percent" in key) return percent(state);
  if ("op" in key) return operator(state, key.op);
  return equals(state);
}

/** The value on show: the number typed, or the one worked out. */
export function shownValue(state: BasicState): number {
  return state.entry === null ? state.value : entryValue(state.entry);
}

/** What the display shows, grouped by thousands ("1,234.5", "-0", "Error"). */
export function basicDisplay(state: BasicState): string {
  if (state.error) return "Error";
  if (state.entry !== null) return groupDigits(state.entry.replace("-", "−"));
  return groupDigits(formatBasic(state.value));
}

/** The line above the number: the sum so far, or the last one worked out with its =. */
export function basicTape(state: BasicState): string {
  const words =
    state.line && state.tape.length === 0
      ? [...spaced(state.line.expr).split(" "), "="]
      : state.tape;
  return words.map(groupDigits).join(" ");
}

/** Nothing typed, worked out or waiting: AC would change nothing (Escape then closes). */
export function isBasicClear(state: BasicState): boolean {
  return (
    state.entry === null &&
    state.value === 0 &&
    !Object.is(state.value, -0) &&
    state.stack.length === 0 &&
    state.line === null &&
    !state.error
  );
}

/** C while a number is being typed (it clears only that), AC otherwise. */
export function clearLabel(state: BasicState): "AC" | "C" {
  return state.entry !== null && !state.error ? "C" : "AC";
}

/** The operator lit up: the one just pressed, until a number is typed. */
export function activeOp(state: BasicState): BasicOp | null {
  if (!state.awaiting || state.error) return null;
  return state.stack[state.stack.length - 1]?.op ?? null;
}

/**
 * `n` as the display writes it: up to {@link MAX_DIGITS} digits, no
 * trailing zeros, "−" for minus, and exponent form ("1.2345e15", "1e−9")
 * when it would not fit. "Error" for a number that is not finite.
 */
export function formatBasic(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  if (n === 0) return Object.is(n, -0) ? "−0" : "0";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const exponent = Math.floor(Math.log10(abs));
  // Written out when it fits the display's digits (a leading "0." is free),
  // keeping at least four significant digits of a small number.
  if (exponent < MAX_DIGITS && exponent >= -4) {
    const decimals = exponent >= 0 ? MAX_DIGITS - 1 - exponent : MAX_DIGITS - 1;
    const fixed = trimZeros(abs.toFixed(decimals));
    const digits = fixed.startsWith("0.") ? fixed.length - 2 : fixed.replace(".", "").length;
    if (digits <= MAX_DIGITS && fixed !== "0") return sign + fixed;
  }
  // Exponent form: as many mantissa digits as leave room for "e" and the exponent.
  const [, exp] = abs.toExponential().split("e");
  const expText = String(Number(exp)).replace("-", "−");
  const room = Math.max(1, MAX_DIGITS - expText.replace("−", "").length - 1);
  const [mantissa, finalExp] = abs.toExponential(room - 1).split("e");
  return `${sign}${trimZeros(mantissa)}e${String(Number(finalExp)).replace("-", "−")}`;
}

/** Thousands grouped with commas in the whole part ("1234567.5" → "1,234,567.5"). */
export function groupDigits(text: string): string {
  if (text.includes("e")) return text;
  const match = /^([−-]?)(\d+)(.*)$/.exec(text);
  if (!match) return text;
  const [, sign, whole, rest] = match;
  return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
}

// --- Keys ----------------------------------------------------------------

function clear(state: BasicState): BasicState {
  if (clearLabel(state) === "C") {
    // C: the number typed goes; the sum, and its lit operator, stay.
    return { ...state, entry: null, value: 0, awaiting: state.stack.length > 0 };
  }
  return BASIC_START;
}

function typeDigit(state: BasicState, digit: string): BasicState {
  const fresh = state.entry === null;
  // A number typed after = starts a new sum; = still repeats the last operation on it.
  const base =
    fresh && !state.awaiting && state.line ? { ...BASIC_START, repeat: state.repeat } : state;
  let entry = fresh ? (digit === "." ? "0." : digit) : state.entry;
  if (!fresh && entry !== null) {
    if (digit === "." && entry.includes(".")) return state;
    if (countDigits(entry) >= MAX_DIGITS) return state;
    if (digit !== "." && /^-?0$/.test(entry)) entry = entry.replace("0", digit);
    else entry += digit;
  }
  return { ...base, entry, awaiting: false, line: fresh ? null : base.line };
}

function backspace(state: BasicState): BasicState {
  if (state.entry === null) return state;
  const entry = state.entry.slice(0, -1);
  return { ...state, entry: entry === "" || entry === "-" ? "0" : entry };
}

function negate(state: BasicState): BasicState {
  if (state.entry !== null) {
    const entry = state.entry.startsWith("-") ? state.entry.slice(1) : `-${state.entry}`;
    return { ...state, entry };
  }
  // After an operator, or on a bare 0, ± starts a negative number.
  if (state.awaiting || (state.value === 0 && state.line === null)) {
    return { ...state, entry: "-0", awaiting: false };
  }
  return { ...state, value: clean(-state.value), line: null };
}

function percent(state: BasicState): BasicState {
  const x = shownValue(state);
  const top = state.stack[state.stack.length - 1];
  // Under + and −, a percentage of the number before (50 + 10 % is 50 + 5).
  const value =
    top && (top.op === "+" || top.op === "−") ? clean((top.value * x) / 100) : clean(x / 100);
  return { ...state, entry: null, value, awaiting: false, line: null };
}

function operator(state: BasicState, op: BasicOp): BasicState {
  if (state.awaiting && state.entry === null && state.stack.length > 0) {
    // Another operator straight after one replaces it.
    const stack = [...state.stack.slice(0, -1), { ...state.stack[state.stack.length - 1], op }];
    return { ...state, stack, tape: [...state.tape.slice(0, -1), op] };
  }
  let value = shownValue(state);
  const stack = [...state.stack];
  // What binds at least as tightly as the new operator can be worked out now.
  while (stack.length > 0 && precedence(stack[stack.length - 1].op) >= precedence(op)) {
    const top = stack.pop() as Pending;
    value = apply(top.value, top.op, value);
  }
  if (!Number.isFinite(value)) return failed(state);
  const operand = formatBasic(shownValue(state));
  return {
    ...state,
    entry: null,
    value,
    stack: [...stack, { value, op }],
    awaiting: true,
    tape: [...state.tape, operand, op],
    line: null,
  };
}

function equals(state: BasicState): BasicState {
  if (state.stack.length === 0) {
    // = again repeats the last operation on what is on show.
    const repeat = state.repeat;
    if (!repeat) return { ...state, entry: null, value: shownValue(state) };
    const from = shownValue(state);
    const value = apply(from, repeat.op, repeat.operand);
    if (!Number.isFinite(value)) return failed(state);
    const expr = [formatBasic(from), repeat.op, formatBasic(repeat.operand)].join("");
    return finish(state, value, expr, repeat);
  }
  // 5 + = takes the number on show as the second number.
  const operand = shownValue(state);
  let value = operand;
  const stack = [...state.stack];
  while (stack.length > 0) {
    const top = stack.pop() as Pending;
    value = apply(top.value, top.op, value);
  }
  if (!Number.isFinite(value)) return failed(state);
  const last = state.stack[state.stack.length - 1];
  const expr = [...state.tape, formatBasic(operand)].join("");
  return finish(state, value, expr, { op: last.op, operand });
}

function finish(
  state: BasicState,
  value: number,
  expr: string,
  repeat: { op: BasicOp; operand: number },
): BasicState {
  return {
    ...state,
    entry: null,
    value,
    stack: [],
    awaiting: false,
    repeat,
    tape: [],
    line: { expr, result: formatBasic(value) },
  };
}

function failed(state: BasicState): BasicState {
  return { ...BASIC_START, error: true, tape: state.tape };
}

// --- Arithmetic ----------------------------------------------------------

function precedence(op: BasicOp): number {
  return op === "×" || op === "÷" ? 2 : 1;
}

function apply(a: number, op: BasicOp, b: number): number {
  switch (op) {
    case "+":
      return clean(a + b);
    case "−":
      return clean(a - b);
    case "×":
      return clean(a * b);
    case "÷":
      return b === 0 ? NaN : clean(a / b);
  }
}

/** Float noise rounded away (0.1 + 0.2 is 0.3); -0 stays -0. */
function clean(n: number): number {
  if (!Number.isFinite(n) || n === 0) return n;
  return Number(n.toPrecision(PRECISION));
}

function entryValue(entry: string): number {
  const n = Number(entry.endsWith(".") ? entry.slice(0, -1) : entry);
  return Number.isFinite(n) ? n : 0;
}

function countDigits(entry: string): number {
  return entry.replace(/[^0-9]/g, "").length;
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** "2+3×4" as the tape writes it: "2 + 3 × 4" (a minus sign of a number stays put). */
function spaced(expr: string): string {
  return expr.replace(/(\d|\))([+−×÷])/g, "$1 $2 ").replace(/\s+/g, " ");
}
