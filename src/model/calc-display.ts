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
  /** `bold` only from typed LaTeX (`\mathbf`); the calculator never sets it. */
  | { t: "text"; s: string; role: "num" | "op" | "fn" | "var"; bold?: true }
  /** An operand not typed yet; `active` while the cursor is on it. */
  | { t: "slot"; active?: true; index?: number }
  /** Where the next key types. */
  | { t: "caret" }
  /** `bar: false`: no line between them (a binomial coefficient). */
  | { t: "frac"; num: MathBox; den: MathBox; bar?: false }
  | { t: "sup"; base: MathBox; exp: MathBox }
  /** A lowered index, with a raised one beside it when both are written (`x_i^2`). */
  | { t: "sub"; base: MathBox; sub: MathBox; sup?: MathBox }
  | { t: "root"; body: MathBox; index?: MathBox }
  /** Round brackets, or the ones `open` and `close` name ("" for none, as `\left.`). */
  | { t: "paren"; body: MathBox; open?: string; close?: string }
  | { t: "abs"; body: MathBox }
  /**
   * ∫ or Σ with limits above and below; `side`: the limits beside the sign
   * instead (an integral, as print sets it).
   */
  | {
      t: "bigop";
      sym: string;
      lo?: MathBox;
      hi?: MathBox;
      body: MathBox;
      tail?: string;
      side?: true;
    }
  /**
   * A grid of cells (a matrix, cases, aligned lines) between `open` and
   * `close` ("" for none). `align`: every column centred (absent), left, or
   * in right-left pairs as `aligned` sets them.
   */
  | { t: "matrix"; rows: MathBox[][]; open: string; close: string; align?: "l" | "rl" }
  /** A mark over (or, `under`, a line under) its body: \vec, \bar, \hat… */
  | { t: "accent"; body: MathBox; mark: MathAccent }
  /** Room, in ems of the size it is set at (`\,`, `\quad`; negative for `\!`). */
  | { t: "space"; em: number };

/** The marks {@link MathBox} `accent` can carry. */
export type MathAccent = "vec" | "bar" | "hat" | "tilde" | "dot" | "ddot" | "under";

const text = (s: string, role: "num" | "op" | "fn" | "var"): MathBox => ({ t: "text", s, role });
const row = (...items: MathBox[]): MathBox => ({ t: "row", items });

/** What the tokenizer read as these names, as a textbook prints them. */
const NAMES: Readonly<Record<string, string>> = {
  pi: "π",
  ans: "Ans",
  m: "M",
  theta: "θ",
  inf: "∞",
  // The constant of integration: the tokenizer lowers case, so it travels as a word.
  constant: "C",
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
/**
 * `node` drawn where the layout groups it (a denominator, an exponent, under
 * a root), and whether the cursor stood just after its hidden bracket: that
 * place is outside the group (after the fraction, the power, the root), so
 * the caller draws it there. Drawn inside, ▶ could never leave the group.
 */
function closedGroup(node: CalcNode): { inner: MathBox; after: boolean } {
  if (node.k === "call" && node.fn === "(" && node.caretAfter) {
    return { inner: grouped({ ...node, caretAfter: undefined }), after: true };
  }
  return { inner: grouped(node), after: false };
}

/** `b`, with the cursor after it when `after`. */
function thenCaret(b: MathBox, after: boolean): MathBox {
  return after ? row(b, { t: "caret" }) : b;
}

function grouped(node: CalcNode): MathBox {
  if (node.k === "call" && node.fn === "(") {
    // The bracket is not drawn, but a cursor that stood just inside or outside it still is.
    const inner = box(node.args[0]);
    if (!node.caretBefore && !node.caretAfter) return inner;
    return row(
      ...(node.caretBefore ? [{ t: "caret" } as const] : []),
      inner,
      ...(node.caretAfter ? [{ t: "caret" } as const] : []),
    );
  }
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
  const inner = shape(node);
  if (!node.caretBefore && !node.caretAfter) return inner;
  return row(
    ...(node.caretBefore ? [{ t: "caret" } as const] : []),
    inner,
    // d/dx(f, a) ends in "x=a" with no bracket drawn: a gap tells "after it" from "after a".
    ...(node.caretAfter && node.k === "call" && node.fn === "deriv" ? [text(" ", "op")] : []),
    ...(node.caretAfter ? [{ t: "caret" } as const] : []),
  );
}

function shape(node: CalcNode): MathBox {
  switch (node.k) {
    case "num": {
      const s = node.text ?? "";
      if (node.caretAt === undefined) return text(s, "num");
      return row(
        text(s.slice(0, node.caretAt), "num"),
        { t: "caret" },
        text(s.slice(node.caretAt), "num"),
      );
    }
    case "name":
      if (node.name === PLACEHOLDER) return { t: "slot", index: node.slot };
      if (node.name === ACTIVE_BOX) return { t: "slot", active: true, index: node.slot };
      if (node.name === CARET) return { t: "caret" };
      return text(NAMES[node.name] ?? node.name, node.name === "ans" ? "fn" : "var");
    case "neg":
      return row(text("−", "op"), box(node.a));
    case "post":
      return row(box(node.a), text(node.op, "op"));
    case "bin":
      switch (node.op) {
        case "/": {
          const den = closedGroup(node.b);
          return thenCaret({ t: "frac", num: grouped(node.a), den: den.inner }, den.after);
        }
        case "^": {
          const exp = closedGroup(node.b);
          return thenCaret({ t: "sup", base: box(node.a), exp: exp.inner }, exp.after);
        }
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
    case "sqrt": {
      const body = closedGroup(a);
      return thenCaret({ t: "root", body: body.inner }, body.after);
    }
    case "root": {
      const body = closedGroup(a);
      return thenCaret({ t: "root", body: body.inner, index: box(b) }, body.after);
    }
    case "abs": {
      const body = closedGroup(a);
      return thenCaret({ t: "abs", body: body.inner }, body.after);
    }
    case "integral":
      // ∫(f) without limits; ∫(f, u) in another letter (a substitution's step); ∫(f, a, b) with them.
      if (node.args.length === 1) return { t: "bigop", sym: "∫", body: box(a), tail: "dx" };
      if (node.args.length === 2 && b.k === "name" && b.slot === undefined) {
        return { t: "bigop", sym: "∫", body: box(a), tail: `d${b.name}` };
      }
      // Half typed (∫(x, ▢): the upper limit still to come is a box too.
      return {
        t: "bigop",
        sym: "∫",
        lo: box(b),
        hi: c ? box(c) : { t: "slot" },
        body: box(a),
        tail: "dx",
      };
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
      if (node.args.length === 1)
        return row(
          { t: "frac", num: text("d", "fn"), den: text("dx", "fn") },
          { t: "paren", body: box(a) },
        );
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
  return layoutWithEnding(expression, base, options)?.box ?? null;
}

/**
 * {@link layoutExpression}, and the text it had to add at the end to read
 * (`▢,▢,▢` for a bare `Σ(`): the boxes drawn for it are not in the typed
 * text, so a tap on one must add them before the cursor can go there.
 */
export function layoutWithEnding(
  expression: string,
  base: NumberBase = 10,
  /** `graph`: a graph's line (run-together letters, = or < at the top); `relations`: = with whole names (a worked answer). */
  options: { graph?: boolean; relations?: boolean } = {},
): { box: MathBox; ending: string } | null {
  if (!expression.trim()) return null;
  // A graph line's restriction, {0 < x < 5}, is shown as typed after its curve.
  const brace = options.graph ? expression.indexOf("{") : -1;
  if (brace > 0) {
    const main = layoutExpression(expression.slice(0, brace), base, options);
    return main
      ? { box: row(main, text(` ${expression.slice(brace).trim()}`, "op")), ending: "" }
      : null;
  }
  // A graph line: run-together letters (ax), and = or < at the top.
  const parse = options.graph
    ? { letters: true, relations: true }
    : { letters: false, relations: options.relations === true };
  // What a half-typed expression lacks: an operand, then more inputs of a function.
  const endings = ["", PLACEHOLDER, `,${PLACEHOLDER}`, `,${PLACEHOLDER}`, `,${PLACEHOLDER}`];
  let attempt = expression;
  for (const ending of endings) {
    attempt += ending;
    const parsed = parseExpression(attempt, base, parse);
    if (parsed.ok) return { box: box(parsed.node), ending: attempt.slice(expression.length) };
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
      return b.bar === false
        ? `[${boxText(b.num)} over ${boxText(b.den)}]`
        : `[${boxText(b.num)}/${boxText(b.den)}]`;
    case "sup":
      return `${boxText(b.base)}^{${boxText(b.exp)}}`;
    case "sub":
      return `${boxText(b.base)}_{${boxText(b.sub)}}${b.sup ? `^{${boxText(b.sup)}}` : ""}`;
    case "matrix":
      return `${b.open}${b.rows.map((cells) => cells.map(boxText).join(" & ")).join(" ; ")}${b.close}`;
    case "accent":
      return `${b.mark}{${boxText(b.body)}}`;
    case "space":
      return " ";
    case "root":
      return b.index ? `root{${boxText(b.index)}}{${boxText(b.body)}}` : `√{${boxText(b.body)}}`;
    case "paren":
      return `${b.open ?? "("}${boxText(b.body)}${b.close ?? ")"}`;
    case "abs":
      return `|${boxText(b.body)}|`;
    case "bigop": {
      const hi = b.hi ? `^{${boxText(b.hi)}}` : "";
      const lo = b.lo ? `_{${boxText(b.lo)}}` : "";
      return `${b.sym}${lo}${hi}${boxText(b.body)}${b.tail ? ` ${b.tail}` : ""}`;
    }
  }
}
