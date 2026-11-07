/**
 * Calculation notes, the maths menu (FineNotes#178): a sum as LaTeX, for the
 * menu's typeset preview and for turning the handwriting into a typed
 * equation (`model/equation.ts`), and its answer in the forms the menu
 * offers (an exact fraction, a decimal).
 *
 * The input is the calculator's own text (`calc-note.ts`'s
 * `NoteSum.expression`: `*` times, `/` divided, `^` power, function calls).
 * A division is set as a fraction, the way it would be written by hand.
 *
 * PURE: no DOM, no Obsidian.
 */

import { fromCalc } from "./algebra/convert";
import { toPoly } from "./algebra/poly";
import { type CalcValue, formatValue, isRational } from "./calculator";
import { answerText } from "./calc-note";

/** A parsed piece: its LaTeX, and whether it is a bracketed group (stripped as a fraction's side). */
interface Node {
  tex: string;
  /** The tex inside the brackets, when the node is one bracketed group. */
  inner?: string;
}

/** Names set as operators (`\sin`), and the ones with a sign of their own. */
const OPERATORS = new Set(["sin", "cos", "tan", "log", "ln", "exp"]);
const CONSTANTS: Record<string, string> = { pi: "\\pi", e: "e" };

type Token = { kind: "num" | "name" | "op"; text: string };

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:E[-+]?\d+)?/.exec(text.slice(i));
    if (num) {
      tokens.push({ kind: "num", text: num[0] });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z][A-Za-z0-9]*/.exec(text.slice(i));
    if (name) {
      tokens.push({ kind: "name", text: name[0] });
      i += name[0].length;
      continue;
    }
    if ("+-*/^()!%,".includes(c)) {
      tokens.push({ kind: "op", text: c });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

class TexParser {
  private at = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly times: string,
  ) {}

  done(): boolean {
    return this.at >= this.tokens.length;
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private take(op?: string): Token | null {
    const t = this.tokens[this.at];
    if (!t || (op !== undefined && !(t.kind === "op" && t.text === op))) return null;
    this.at++;
    return t;
  }

  /** sum := term (("+" | "-") term)* */
  sum(): Node | null {
    let left = this.term();
    if (!left) return null;
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== "op" || (t.text !== "+" && t.text !== "-")) return left;
      this.at++;
      const right = this.term();
      if (!right) return null;
      left = { tex: `${left.tex}${t.text}${right.tex}` };
    }
  }

  /** term := power (("*" | "/" | juxtaposition) power)*; a "/" makes the term so far a fraction's top. */
  private term(): Node | null {
    let left = this.unary();
    if (!left) return null;
    for (;;) {
      const t = this.peek();
      if (!t) return left;
      // "17 mod 5": the calculator's remainder, an operator between terms.
      if (t.kind === "name" && t.text.toLowerCase() === "mod") {
        this.at++;
        const right = this.unary();
        if (!right) return null;
        left = { tex: `${left.tex}\\bmod ${right.tex}` };
        continue;
      }
      if (t.kind === "op" && (t.text === "*" || t.text === "/")) {
        this.at++;
        const right = this.unary();
        if (!right) return null;
        left =
          t.text === "*"
            ? { tex: `${left.tex}${this.times}${right.tex}` }
            : { tex: `\\frac{${left.inner ?? left.tex}}{${right.inner ?? right.tex}}` };
        continue;
      }
      // "2(3)", "2pi": written side by side.
      const starts = t.kind === "name" || (t.kind === "op" && t.text === "(");
      if (!starts) return left;
      const right = this.unary();
      if (!right) return null;
      left = { tex: `${left.tex}${right.tex}` };
    }
  }

  private unary(): Node | null {
    if (this.take("-")) {
      const inner = this.unary();
      return inner ? { tex: `-${inner.tex}` } : null;
    }
    if (this.take("+")) return this.unary();
    return this.power();
  }

  /** power := postfix ("^" unary)? */
  private power(): Node | null {
    const base = this.postfix();
    if (!base) return null;
    if (!this.take("^")) return base;
    const exp = this.unary();
    if (!exp) return null;
    return { tex: `{${base.tex}}^{${exp.inner ?? exp.tex}}` };
  }

  private postfix(): Node | null {
    let node = this.primary();
    while (node) {
      if (this.take("!")) node = { tex: `${node.tex}!` };
      else if (this.take("%")) node = { tex: `${node.tex}\\%` };
      else break;
    }
    return node;
  }

  private primary(): Node | null {
    const t = this.tokens[this.at];
    if (!t) return null;
    if (t.kind === "num") {
      this.at++;
      return { tex: t.text.replace(/E([-+]?\d+)$/, "\\times 10^{$1}") };
    }
    if (t.kind === "op" && t.text === "(") {
      this.at++;
      const inner = this.sum();
      if (!inner || !this.take(")")) return null;
      return { tex: `\\left(${inner.tex}\\right)`, inner: inner.tex };
    }
    if (t.kind === "name") {
      this.at++;
      const name = t.text;
      const lower = name.toLowerCase();
      // A single letter before a bracket is that letter times the bracket ("x(x-3)").
      const call = name.length > 1 || OPERATORS.has(lower);
      if (call && this.peek()?.kind === "op" && this.peek()?.text === "(") {
        this.at++;
        const args: string[] = [];
        if (!this.take(")")) {
          for (;;) {
            const arg = this.sum();
            if (!arg) return null;
            args.push(arg.tex);
            if (this.take(")")) break;
            if (!this.take(",")) return null;
          }
        }
        if (lower === "sqrt" && args.length === 1) return { tex: `\\sqrt{${args[0]}}` };
        if (lower === "root" && args.length === 2) {
          return { tex: `\\sqrt[${args[1]}]{${args[0]}}` };
        }
        if (lower === "abs" && args.length === 1) return { tex: `\\left|${args[0]}\\right|` };
        // log(8, 2): the logarithm of 8 to base 2, its base written low.
        if (lower === "log" && args.length === 2) {
          return { tex: `\\log_{${args[1]}}\\left(${args[0]}\\right)` };
        }
        const fn = OPERATORS.has(lower) ? `\\${lower}` : `\\operatorname{${name}}`;
        return { tex: `${fn}\\left(${args.join(",")}\\right)` };
      }
      if (lower in CONSTANTS) return { tex: CONSTANTS[lower] };
      return { tex: name };
    }
    return null;
  }
}

/**
 * The calculator's text of a sum as LaTeX: a division as a fraction, times
 * as `\times` (or `\cdot` with `dot`, when the sum was written with a raised
 * dot). Null when the text is not one expression the calculator reads.
 */
export function expressionTex(expression: string, options: { dot?: boolean } = {}): string | null {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return null;
  const parser = new TexParser(tokens, options.dot ? "\\cdot " : "\\times ");
  const node = parser.sum();
  return node && parser.done() ? node.tex : null;
}

/** An answer in each form the menu offers. */
export interface AnswerForms {
  /** As a fraction, when it is a fraction (not whole, and exact); else null. */
  fraction: { n: string; d: string; text: string; tex: string } | null;
  /**
   * As written in decimals (`answerText`): at most 8 significant digits. For
   * an expanded polynomial, its terms ("8x^2+18x+4"), with `tex` and `shown`
   * (superscript powers, for the card).
   */
  decimal: { text: string; exact: boolean; tex?: string; shown?: string };
}

/**
 * The forms of `value`: an exact fraction when it is one ("6/7"), and its
 * decimal. A whole number has only the decimal ("12"). Null when it cannot
 * be shown at all.
 */
export function answerForms(value: CalcValue): AnswerForms | null {
  const decimal = answerText(value);
  if (!decimal) return null;
  let fraction: AnswerForms["fraction"] = null;
  if (isRational(value) && value.d !== 1n) {
    const text = formatValue(value, { fractions: true });
    const m = text ? /^(-?\d+)\/(\d+)$/.exec(text) : null;
    if (m) {
      const n = m[1].replace(/^-/, "");
      const sign = m[1].startsWith("-") ? "-" : "";
      fraction = { n: m[1], d: m[2], text: `${m[1]}/${m[2]}`, tex: `${sign}\\frac{${n}}{${m[2]}}` };
    }
  }
  return { fraction, decimal };
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

/** Names in the calculator's text that are not a sum's letter (functions and constants). */
const NOT_LETTERS = new Set([
  "e",
  "pi",
  "mod",
  "sqrt",
  "root",
  "abs",
  "sin",
  "cos",
  "tan",
  "ln",
  "log",
  "exp",
]);

/**
 * A sum in one letter, expanded ("(2x+4)(4x+1)" is "8x^2+18x+4"): its terms
 * highest power first, with exact fraction coefficients. Null when the sum
 * has no letter, more than one, or is not a polynomial in it (a sine, a
 * division by the letter).
 */
export function polynomialAnswer(expression: string): AnswerForms | null {
  const names = new Set(
    (expression.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter(
      (n) => !NOT_LETTERS.has(n.toLowerCase()),
    ),
  );
  if (names.size !== 1) return null;
  const [letter] = [...names];
  if (!/^[A-Za-z]$/.test(letter)) return null;
  let poly;
  try {
    poly = toPoly(fromCalc(expression), letter);
  } catch {
    return null;
  }
  if (!poly) return null;
  const text: string[] = [];
  const tex: string[] = [];
  const shown: string[] = [];
  for (let k = poly.length - 1; k >= 0; k--) {
    const c = poly[k];
    if (c.n === 0n) continue;
    const negative = c.n < 0n;
    const n = negative ? -c.n : c.n;
    const sign = negative ? "-" : text.length > 0 ? "+" : "";
    const one = n === 1n && c.d === 1n && k > 0;
    const coefText = one ? "" : c.d === 1n ? `${n}` : `${n}/${c.d}`;
    const coefTex = one ? "" : c.d === 1n ? `${n}` : `\\frac{${n}}{${c.d}}`;
    const power = k > 1 ? `${k}` : "";
    text.push(`${sign}${coefText}${k > 0 ? letter : ""}${power ? `^${power}` : ""}`);
    tex.push(`${sign}${coefTex}${k > 0 ? letter : ""}${power ? `^{${power}}` : ""}`);
    shown.push(
      `${sign === "-" ? "−" : sign}${coefText}${k > 0 ? letter : ""}${Array.from(power)
        .map((d) => SUPERSCRIPT[d])
        .join("")}`,
    );
  }
  if (text.length === 0) return { fraction: null, decimal: { text: "0", exact: true } };
  return {
    fraction: null,
    decimal: { text: text.join(""), exact: true, tex: tex.join(""), shown: shown.join("") },
  };
}
