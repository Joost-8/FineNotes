/**
 * The calculator's natural display: an expression laid out as a textbook
 * writes it (stacked fractions, raised powers, roots with a bar, ∫ and Σ
 * with their limits), as NumWorks and Casio's natural display show it while
 * typing. Pure: this builds a tree of boxes, `view/calculator-popover.ts`
 * turns it into spans.
 *
 * A half-typed expression still lays out: what is missing is drawn as an
 * empty box ("2 ÷ ▢"), and only when even that cannot be parsed does the
 * plain text show.
 */

import {
  ACTIVE_BOX,
  CARET,
  type CalcNode,
  type NumberBase,
  PLACEHOLDER,
  parseExpression,
} from "./calculator";

export type MathBox =
  | { t: "row"; items: MathBox[] }
  | { t: "text"; s: string; role: "num" | "op" | "fn" | "var" }
  /** An operand not typed yet; `active` while the cursor is on it. */
  | { t: "slot"; active?: true }
  /** Where the next key types. */
  | { t: "caret" }
  | { t: "frac"; num: MathBox; den: MathBox }
  | { t: "sup"; base: MathBox; exp: MathBox }
  | { t: "root"; body: MathBox; index?: MathBox }
  | { t: "paren"; body: MathBox }
  | { t: "abs"; body: MathBox }
  /** ∫ or Σ with limits above and below. */
  | { t: "bigop"; sym: string; lo: MathBox; hi?: MathBox; body: MathBox; tail?: string };

const text = (s: string, role: "num" | "op" | "fn" | "var"): MathBox => ({ t: "text", s, role });
const row = (...items: MathBox[]): MathBox => ({ t: "row", items });

/** What the tokenizer read as these names, as a textbook prints them. */
const NAMES: Readonly<Record<string, string>> = {
  pi: "π",
  ans: "Ans",
  m: "M",
  theta: "θ",
  inf: "∞",
};
const FUNCTION_NAMES: Readonly<Record<string, string>> = {
  asin: "sin⁻¹",
  acos: "cos⁻¹",
  atan: "tan⁻¹",
  asinh: "sinh⁻¹",
  acosh: "cosh⁻¹",
  atanh: "tanh⁻¹",
  asec: "sec⁻¹",
  acsc: "csc⁻¹",
  acot: "cot⁻¹",
  ncr: "nCr",
  npr: "nPr",
  and: "AND",
  or: "OR",
  xor: "XOR",
  not: "NOT",
  shl: "SHL",
  shr: "SHR",
};
const RELATION_SIGNS: Readonly<Record<string, string>> = {
  "=": "=",
  "<": "<",
  ">": ">",
  "<=": "≤",
  ">=": "≥",
};

/** A user's bracket, dropped where the layout already groups (a numerator, an exponent, under a root). */
function grouped(node: CalcNode): MathBox {
  if (node.k === "call" && node.fn === "(") return box(node.args[0]);
  return box(node);
}

function args(nodes: CalcNode[]): MathBox {
  const items: MathBox[] = [];
  nodes.forEach((node, i) => {
    if (i > 0) items.push(text(", ", "op"));
    items.push(box(node));
  });
  return { t: "paren", body: row(...items) };
}

function box(node: CalcNode): MathBox {
  switch (node.k) {
    case "num":
      return text(node.text ?? "", "num");
    case "name":
      if (node.name === PLACEHOLDER) return { t: "slot" };
      if (node.name === ACTIVE_BOX) return { t: "slot", active: true };
      if (node.name === CARET) return { t: "caret" };
      return text(NAMES[node.name] ?? node.name, node.name === "ans" ? "fn" : "var");
    case "neg":
      return row(text("−", "op"), box(node.a));
    case "post":
      return row(box(node.a), text(node.op, "op"));
    case "bin":
      switch (node.op) {
        case "/":
          return { t: "frac", num: grouped(node.a), den: grouped(node.b) };
        case "^":
          return { t: "sup", base: box(node.a), exp: grouped(node.b) };
        case "*":
          return node.implicit
            ? row(box(node.a), box(node.b))
            : row(box(node.a), text("×", "op"), box(node.b));
        case "mod":
          return row(box(node.a), text(" mod ", "fn"), box(node.b));
        default:
          return row(box(node.a), text(node.op === "-" ? "−" : "+", "op"), box(node.b));
      }
    case "rel":
      return row(box(node.a), text(RELATION_SIGNS[node.op], "op"), box(node.b));
    case "call":
      return call(node);
  }
}

function call(node: Extract<CalcNode, { k: "call" }>): MathBox {
  const [a, b, c, d] = node.args;
  switch (node.fn) {
    case "(":
      return { t: "paren", body: box(a) };
    case "sqrt":
      return { t: "root", body: grouped(a) };
    case "root":
      return { t: "root", body: grouped(a), index: box(b) };
    case "abs":
      return { t: "abs", body: grouped(a) };
    case "integral":
      return { t: "bigop", sym: "∫", lo: box(b), hi: box(c), body: box(a), tail: "dx" };
    case "lim":
      return {
        t: "bigop",
        sym: "lim",
        lo: row(text("x→", "var"), box(b)),
        body: grouped(a),
      };
    case "sum":
    case "prod": {
      const four = node.args.length === 4;
      const index = four ? box(b) : text("x", "var");
      return {
        t: "bigop",
        sym: node.fn === "sum" ? "Σ" : "Π",
        lo: row(index, text("=", "op"), box(four ? c : b)),
        hi: box(four ? d : c),
        body: box(a),
      };
    }
    case "deriv":
      return row(
        { t: "frac", num: text("d", "fn"), den: text("dx", "fn") },
        { t: "paren", body: box(a) },
        text("|", "op"),
        row(text("x=", "var"), box(b)),
      );
  }
  return row(text(FUNCTION_NAMES[node.fn] ?? node.fn, "fn"), args(node.args));
}

/**
 * `expression` laid out; null when it cannot be read even with its missing
 * operands boxed (the display then shows the text as typed).
 */
export function layoutExpression(
  expression: string,
  base: NumberBase = 10,
  options: { graph?: boolean } = {},
): MathBox | null {
  if (!expression.trim()) return null;
  // A graph line's restriction, {0 < x < 5}, is shown as typed after its curve.
  const brace = options.graph ? expression.indexOf("{") : -1;
  if (brace > 0) {
    const main = layoutExpression(expression.slice(0, brace), base, options);
    return main ? row(main, text(` ${expression.slice(brace).trim()}`, "op")) : null;
  }
  // A graph line: run-together letters (ax), and = or < at the top.
  const parse = options.graph
    ? { letters: true, relations: true }
    : { letters: false, relations: false };
  // What a half-typed expression lacks: an operand, then more inputs of a function.
  const endings = ["", PLACEHOLDER, `,${PLACEHOLDER}`, `,${PLACEHOLDER}`, `,${PLACEHOLDER}`];
  let attempt = expression;
  for (const ending of endings) {
    attempt += ending;
    const parsed = parseExpression(attempt, base, parse);
    if (parsed.ok) return box(parsed.node);
  }
  return null;
}

/** The box as plain text (for tests, and for screen readers). */
export function boxText(b: MathBox): string {
  switch (b.t) {
    case "row":
      return b.items.map(boxText).join("");
    case "text":
      return b.s;
    case "slot":
      return b.active ? "■" : "□";
    case "caret":
      return "|";
    case "frac":
      return `[${boxText(b.num)}/${boxText(b.den)}]`;
    case "sup":
      return `${boxText(b.base)}^{${boxText(b.exp)}}`;
    case "root":
      return b.index ? `root{${boxText(b.index)}}{${boxText(b.body)}}` : `√{${boxText(b.body)}}`;
    case "paren":
      return `(${boxText(b.body)})`;
    case "abs":
      return `|${boxText(b.body)}|`;
    case "bigop": {
      const hi = b.hi ? `^{${boxText(b.hi)}}` : "";
      return `${b.sym}_{${boxText(b.lo)}}${hi}${boxText(b.body)}${b.tail ? ` ${b.tail}` : ""}`;
    }
  }
}
