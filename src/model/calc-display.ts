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

import { type CalcNode, type NumberBase, PLACEHOLDER, parseExpression } from "./calculator";

export type MathBox =
  | { t: "row"; items: MathBox[] }
  | { t: "text"; s: string; role: "num" | "op" | "fn" | "var" }
  /** An operand not typed yet. */
  | { t: "slot" }
  | { t: "frac"; num: MathBox; den: MathBox }
  | { t: "sup"; base: MathBox; exp: MathBox }
  | { t: "root"; body: MathBox; index?: MathBox }
  | { t: "paren"; body: MathBox }
  | { t: "abs"; body: MathBox }
  /** ∫ or Σ with limits above and below. */
  | { t: "bigop"; sym: string; lo: MathBox; hi: MathBox; body: MathBox; tail?: string };

const text = (s: string, role: "num" | "op" | "fn" | "var"): MathBox => ({ t: "text", s, role });
const row = (...items: MathBox[]): MathBox => ({ t: "row", items });

/** What the tokenizer read as these names, as a textbook prints them. */
const NAMES: Readonly<Record<string, string>> = { pi: "π", ans: "Ans", m: "M" };
const FUNCTION_NAMES: Readonly<Record<string, string>> = {
  asin: "sin⁻¹",
  acos: "cos⁻¹",
  atan: "tan⁻¹",
  ncr: "nCr",
  npr: "nPr",
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
        default:
          return row(box(node.a), text(node.op === "-" ? "−" : "+", "op"), box(node.b));
      }
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
    case "sum": {
      const four = node.args.length === 4;
      const index = four ? box(b) : text("x", "var");
      return {
        t: "bigop",
        sym: "Σ",
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
export function layoutExpression(expression: string, base: NumberBase = 10): MathBox | null {
  if (!expression.trim()) return null;
  // What a half-typed expression lacks: an operand, then more inputs of a function.
  const endings = ["", PLACEHOLDER, `,${PLACEHOLDER}`, `,${PLACEHOLDER}`, `,${PLACEHOLDER}`];
  let attempt = expression;
  for (const ending of endings) {
    attempt += ending;
    const parsed = parseExpression(attempt, base);
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
      return "□";
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
    case "bigop":
      return `${b.sym}_{${boxText(b.lo)}}^{${boxText(b.hi)}}${boxText(b.body)}${b.tail ? ` ${b.tail}` : ""}`;
  }
}
