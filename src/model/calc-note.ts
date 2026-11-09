/**
 * Calculation notes, the text side: what Grape read on a line that ends in
 * "=", turned into something the calculator (calculator.ts) can work out,
 * and the answer as it is shown and written.
 *
 * Grape's alphabet has no × or ÷, so a handwritten "12×4" comes back as
 * "12x4": an x (or X) between two numbers is times. A lone letter is a
 * variable, set on an earlier line ("a = 5"). Only the end of the line is
 * the sum: "Exercise 3: 12x4 =" calculates 12x4.
 *
 * Readings are not trusted: nothing here writes anything. The view shows
 * what was read and the answer, and writes only when the user taps it.
 *
 * PURE: no DOM, no Obsidian.
 */

import {
  type CalcValue,
  type EvalResult,
  compileFunction,
  evaluate,
  formatValue,
  isUnknownNameError,
  isRational,
  toFloat,
} from "./calculator";
import type { GraphSpec } from "./graph";

/** Function and constant names a sum may use (the calculator knows more; these are the ones a line is scanned for). */
const NAMES = new Set([
  "sqrt",
  "root",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "log",
  "ln",
  "abs",
  "round",
  "mod",
  "pi",
  "e",
]);

/** Characters a sum is made of, besides letters. */
const SUM_CHARS = /[0-9\s+\-*/^().,%!:×·∗⋅÷∕−–]/;

/** A variable's name: a letter, then up to three letters or digits ("a", "v0", "rate"). */
const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9]{0,3}$/;

/** Most significant digits an answer is written with; more are rounded. */
export const ANSWER_DIGITS = 8;

/** The variables set on earlier lines, by lower-case name. */
export type CalcVariables = ReadonlyMap<string, CalcValue>;

/** A sum found at the end of a line. */
export interface NoteSum {
  /** What the calculator reads. */
  expression: string;
  /** The sum as the suggestion shows it: × for times, − for minus. */
  shown: string;
}

/**
 * The digits Grape most often reads as letters, inside a run that is
 * otherwise a number: "1O0" is 100, "l2" is 12. Only runs with a digit in
 * them and no other letter beside them change, so a word is never turned
 * into a number. A bar stays a bar: it may be an absolute value.
 */
function fixDigitLetters(text: string): string {
  return spellNames(fixDigits(text));
}

/** The digit a letter read in place of a logarithm's low base most likely is. */
const BASE_LOOKALIKES: Record<string, string> = {
  z: "2",
  Z: "2",
  y: "4",
  q: "9",
  g: "8",
  s: "5",
  S: "5",
  b: "6",
  t: "7",
  T: "7",
  l: "1",
  I: "1",
  o: "0",
  O: "0",
};

/**
 * How Grape writes two names the calculator spells otherwise: "17mod5"
 * (it often reads no spaces round a word between numbers) is "17 mod 5", and
 * a logarithm with its base written low after it, read as "log2(8)" or
 * "log_2(8)", is the calculator's "log(8,2)".
 */
export function spellNames(text: string): string {
  let s = text.replace(/([0-9)\]])\s*mod\s*(?=[0-9(])/gi, "$1 mod ");
  // A base written low is often read as the letter it resembles ("logz(8)",
  // "logy(76)"): the digit it most likely is. A guess, shown in the card.
  s = s.replace(/log\s*([zZyqgsSbtTlIoO])\s*\(/g, (_, c: string) => `log${BASE_LOOKALIKES[c]}(`);
  for (let guard = 0; guard < 8; guard++) {
    const m = /log_?\s*([0-9]+(?:\.[0-9]+)?)\s*\(/i.exec(s);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) break;
    // ", base" with a space: a comma between two digits is a decimal comma.
    s = `${s.slice(0, m.index)}log(${s.slice(open + 1, close)}, ${m[1]})${s.slice(close + 1)}`;
  }
  return s;
}

function fixDigits(text: string): string {
  // Letters other than x on either side make it a word; x is times ("1Ox4").
  return text.replace(/(?<![A-WYZa-wyz])[0-9OoIl]+(?:\.[0-9OoIl]+)?(?![A-WYZa-wyz])/g, (run) => {
    if (!/[0-9]/.test(run)) return run;
    return run.replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
  });
}

/**
 * Typography to the calculator's: an x between numbers (or brackets) is
 * times; a colon between numbers is divided by (as written in Dutch and
 * German schools); a comma between digits is a decimal point, unless three
 * digits follow it (a thousands separator, dropped). An x standing alone
 * between spaces is times too, unless x is one of the variables.
 */
function toCalculator(text: string, variables: CalcVariables): string {
  let s = text
    .replace(/[×·∗⋅]/g, "*")
    .replace(/[÷∕]/g, "/")
    .replace(/[−–—]/g, "-");
  // Times: repeated, since "2x3x4" shares its 3 between two matches.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/([0-9.)\]])\s*[xX]\s*(?=[0-9.([])/g, "$1*");
    if (next === s) break;
    s = next;
  }
  if (!variables.has("x")) s = s.replace(/(\S)\s+[xX]\s+(?=\S)/g, "$1 * ");
  s = s.replace(/([0-9)])\s*:\s*(?=[0-9(])/g, "$1/");
  s = s.replace(/([0-9]),([0-9]{3})(?![0-9])/g, "$1$2");
  s = s.replace(/([0-9]),(?=[0-9])/g, "$1.");
  return s.replace(/\s+/g, " ").trim();
}

/** The calculator's text as the suggestion shows it. */
export function showSum(expression: string): string {
  return expression
    .replace(/\s*\*\s*/g, "×")
    .replace(/\s*\/\s*/g, "÷")
    .replace(/(^|[^E])-/g, "$1−")
    .replace(/\s*−\s*/g, "−")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The longest end of `text` that is made of a sum's characters, known names
 * and the given variables. Words stop it: "total 12x4" gives "12x4".
 */
function sumAtEnd(text: string, variables: CalcVariables): string {
  let start = text.length;
  let i = text.length;
  while (i > 0) {
    const c = text[i - 1];
    if (SUM_CHARS.test(c)) {
      i--;
      start = i;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j > 0 && /[A-Za-z0-9]/.test(text[j - 1])) j--;
      const word = text.slice(j, i);
      const letters = word.replace(/^[0-9]+/, "");
      const lower = letters.toLowerCase();
      // "12x4": the x is times, part of the sum.
      const times = /^[0-9.]*(?:[xX][0-9.]+)+$/.test(word) || /^[xX]$/.test(word);
      if (NAMES.has(lower) || variables.has(lower) || times || /^[0-9]+[xX]/.test(word)) {
        i = j;
        start = i;
        continue;
      }
      // A variable written straight after a number: "2a".
      const m = /^([0-9.]+)([A-Za-z][A-Za-z0-9]*)$/.exec(word);
      if (m && variables.has(m[2].toLowerCase())) {
        i = j;
        start = i;
        continue;
      }
      break;
    }
    break;
  }
  return text.slice(start);
}

/** Variables in `expression` replaced by their values, exactly, in brackets. */
function substitute(expression: string, variables: CalcVariables): string {
  if (variables.size === 0) return expression;
  return expression.replace(/[A-Za-z][A-Za-z0-9]*/g, (word) => {
    const value = variables.get(word.toLowerCase());
    if (value === undefined) return word;
    if (isRational(value)) return `(${value.n.toString()}/${value.d.toString()})`;
    return `(${toFloat(value).toPrecision(17)})`;
  });
}

/**
 * The sum a line ends with, from what Grape read: the text before its last
 * "=", from the last label (": ") or earlier "=" on, cut to its sum. Null
 * when the line does not end in "=", or what is left is not a sum (no
 * operator and no variable: "12 =" is not worth an answer).
 */
export function sumOfLine(reading: string, variables: CalcVariables = new Map()): NoteSum | null {
  const text = reading.replace(/\s+$/, "");
  if (!text.endsWith("=")) return null;
  let body = text.slice(0, -1);
  // A chain or a label before the sum: "y = 2x3 =", "Ex. 3: 12x4 =".
  const cut = Math.max(body.lastIndexOf("="), body.lastIndexOf(": "), body.lastIndexOf("; "));
  if (cut >= 0) body = body.slice(cut + 1);
  body = fixDigitLetters(body);
  const raw = sumAtEnd(body, variables).trim();
  if (raw === "" || !/[0-9A-Za-z]/.test(raw)) return null;
  const expression = toCalculator(raw, variables);
  // Starting on an operator, the sum lost its first term to a word it did
  // not know ("a+2" without a): half a sum is no sum.
  if (/^[+*/^%!]/.test(expression)) return null;
  const names = (expression.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).map((w) => w.toLowerCase());
  const usesVariable = names.some((name) => variables.has(name));
  const operates =
    /[+\-*/^%!]/.test(expression.replace(/^-/, "")) || names.some((n) => NAMES.has(n));
  if (!operates && !usesVariable) return null;
  return { expression, shown: showSum(expression) };
}

/** Work out a sum with the variables set so far. */
export function evaluateSum(sum: NoteSum, variables: CalcVariables = new Map()): EvalResult {
  // A variable's value in brackets may now stand beside an x: "(5/1) x 2".
  return evaluate(toCalculator(substitute(sum.expression, variables), variables));
}

/**
 * A line that sets a variable ("a = 5", "r = 2x3"): its name and value.
 * Null when it is not one, or its right side does not work out.
 */
export function assignmentOfLine(
  reading: string,
  variables: CalcVariables = new Map(),
): { name: string; value: CalcValue } | null {
  const m = /^\s*([A-Za-z][A-Za-z0-9]{0,3})\s*=\s*(.*[0-9A-Za-z)].*?)\s*$/.exec(reading);
  if (!m || !VARIABLE_NAME.test(m[1])) return null;
  const name = m[1].toLowerCase();
  if (NAMES.has(name)) return null;
  const right = fixDigitLetters(m[2]);
  if (right.includes("=")) return null;
  const result = evaluate(toCalculator(substitute(right, variables), variables));
  return result.ok ? { name, value: result.value } : null;
}

/**
 * The variables a page's lines set, top to bottom, each line seeing the
 * ones above it. Lines that set nothing are skipped.
 */
export function variablesOfLines(readings: readonly string[]): Map<string, CalcValue> {
  const vars = new Map<string, CalcValue>();
  for (const reading of readings) {
    const set = assignmentOfLine(reading, vars);
    if (set) vars.set(set.name, set.value);
  }
  return vars;
}

/** Whether a failed sum failed for a name it did not know (so variables may help). */
export function needsVariables(result: EvalResult): boolean {
  return !result.ok && isUnknownNameError(result.error);
}

/**
 * An answer as it is written: a whole number in full, else at most
 * {@link ANSWER_DIGITS} significant digits, without trailing zeros, and no
 * exponent while it fits. `exact` is false when digits were dropped.
 */
export function answerText(value: CalcValue): { text: string; exact: boolean } | null {
  const full = formatValue(value);
  if (full === null) return null;
  if (isRational(value) && value.d === 1n) return { text: full, exact: true };
  const digits = full.replace(/^-/, "").replace(/E.*$/, "").replace(".", "").replace(/^0+/, "");
  if (digits.length <= ANSWER_DIGITS && !/E/.test(full)) {
    return { text: full, exact: isRational(value) };
  }
  const x = toFloat(value);
  if (!Number.isFinite(x)) return null;
  let text = x.toPrecision(ANSWER_DIGITS);
  if (/e/.test(text)) {
    const [m, e] = text.split("e");
    text = `${m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m}E${Number(e)}`;
  } else if (text.includes(".")) {
    text = text.replace(/0+$/, "").replace(/\.$/, "");
  }
  return { text, exact: false };
}

/** The suggestion's words: "12×4 = 48", or "1÷3 ≈ 0.33333333" when rounded. */
export function suggestionLabel(sum: NoteSum, answer: { text: string; exact: boolean }): string {
  return `${sum.shown} ${answer.exact ? "=" : "≈"} ${answer.text.replace(/^-/, "−")}`;
}

/** An equation to solve: its two sides in the calculator's text, and the letter asked for. */
export interface NoteEquation {
  lhs: string;
  rhs: string;
  letter: string;
}

/**
 * The letter a line asks for, when it ends in it and an "=" ("x =", or
 * "2x+3=7, x ="): solve for it. Null otherwise.
 */
export function askedLetter(reading: string): string | null {
  const m = /(?:^|[^A-Za-z0-9])([A-Za-z])\s*=\s*$/.exec(reading.replace(/\s+$/, ""));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Grape reads a raised power on the line: a digit straight after the letter
 * ("x2", "2x3 + 1") is that power. Nobody writes "x times 2" as "x2".
 */
function powersOf(side: string, letter: string): string {
  return side.replace(new RegExp(`(?<![A-Za-z])${letter}([2-9])(?![0-9.])`, "g"), `${letter}^$1`);
}

/** One side of an equation as read, in the calculator's text. */
function equationSide(text: string): string {
  return fixDigitLetters(text)
    .replace(/[×·∗⋅]/g, "*")
    .replace(/[÷∕]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/([0-9)])\s*:\s*(?=[0-9(])/g, "$1/")
    .replace(/([0-9]),(?=[0-9])/g, "$1.")
    .replace(/^[\s,;:]+|[\s,;:]+$/g, "")
    .replace(/\s+/g, "");
}

/**
 * The equation in `letter` a line holds ("2x + 3 = 7"), when it holds one:
 * a single "=" with something on both sides and the letter in it. The
 * letter's own ask at the end ("…, x =") and a label before it ("Ex 2:")
 * are left out; the letter is read in either case. Null when there is none.
 */
export function equationOfLine(reading: string, letter: string): NoteEquation | null {
  let text = reading.replace(/\s+$/, "");
  const ask = new RegExp(String.raw`(?:^|[^A-Za-z0-9])${letter}\s*=\s*$`, "i");
  const asked = ask.exec(text);
  if (asked) text = text.slice(0, asked.index + (/[^A-Za-z0-9]/.test(asked[0][0]) ? 1 : 0));
  const label = Math.max(text.lastIndexOf(": "), text.lastIndexOf("; "));
  if (label >= 0) text = text.slice(label + 1);
  const parts = text.split("=");
  if (parts.length !== 2) return null;
  const same = (s: string) =>
    powersOf(
      equationSide(s).replace(new RegExp(`(?<![A-Za-z])${letter}(?![A-Za-z])`, "gi"), letter),
      letter,
    );
  const lhs = same(parts[0]);
  const rhs = same(parts[1]);
  if (!lhs || !rhs) return null;
  const has = new RegExp(`(?<![A-Za-z])${letter}(?![A-Za-z])`);
  if (!has.test(lhs) && !has.test(rhs)) return null;
  // "x = 5": a letter being set, not an equation to solve.
  if (lhs === letter && !has.test(rhs)) return null;
  return { lhs, rhs, letter };
}

/**
 * The one unknown of a whole equation as read ("x + 5 = 7"): the single letter
 * it holds beside the names a sum may use. Null when it has none, several, or
 * a word in it (prose with an "=" in it is no equation).
 */
export function equationLetter(reading: string): string | null {
  if ((reading.match(/=/g) ?? []).length !== 1) return null;
  const label = Math.max(reading.lastIndexOf(": "), reading.lastIndexOf("; "));
  const body = fixDigitLetters(label >= 0 ? reading.slice(label + 1) : reading);
  const letters = new Set<string>();
  for (const word of body.match(/[A-Za-z]+/g) ?? []) {
    const lower = word.toLowerCase();
    if (NAMES.has(lower)) continue;
    if (lower.length > 1) return null;
    letters.add(lower);
  }
  return letters.size === 1 ? [...letters][0] : null;
}

/** A function written on a line ("y = 2x + 1", "f(x) = x2"): what to plot. */
export interface NoteFunction {
  /** What is defined: "y", or "f(x)" with its own letter. */
  name: string;
  /** Its right side in the calculator's text; null when nothing is written there yet. */
  body: string | null;
}

/**
 * The function a line defines, when it starts with "y =" or "f(x) =" and
 * its right side can be plotted. "y" needs an x on its right ("y = 5" sets a
 * value). A word the calculator does not know is no function.
 */
export function functionOfLine(reading: string): NoteFunction | null {
  const label = Math.max(reading.lastIndexOf(": "), reading.lastIndexOf("; "));
  const text = label >= 0 ? reading.slice(label + 1) : reading;
  const m = /^\s*(?:([yY])|([A-Za-z])\s*\(\s*[xX]\s*\))\s*=([^=]*)$/.exec(text);
  if (!m) return null;
  const name = m[1] ? "y" : `${m[2].toLowerCase()}(x)`;
  const rest = m[3].replace(/[\s.,;:]+$/, "");
  if (rest.trim() === "") return { name, body: null };
  const body = powersOf(equationSide(rest).replace(/(?<![A-Za-z])X(?![A-Za-z])/g, "x"), "x");
  const hasX = /(?<![A-Za-z])x(?![A-Za-z])/.test(body);
  if ((m[1] && !hasX) || !compileFunction(body).ok) return null;
  return { name, body };
}

/** The view a written function's graph opens at: x from -10 to 10, y at the same scale in a 4:3 frame. */
const GRAPH_VIEW = { xMin: -10, xMax: 10, yMin: -7.5, yMax: 7.5 };

/** The graph of a written function, as the calculator's graphs are kept. */
export function functionGraphSpec(fn: NoteFunction & { body: string }): GraphSpec {
  return { ...GRAPH_VIEW, expressions: [`${fn.name} = ${fn.body}`] };
}
