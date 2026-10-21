/**
 * From the calculator's syntax tree (`CalcNode`, `model/calculator.ts`) to
 * a symbolic expression, so anything the keypad or a keyboard types can be
 * worked symbolically. Pure: no DOM.
 *
 * What the algebra has no symbolic meaning for (n!, %, mod, nCr, Ans,
 * bases) throws {@link AlgebraError}, and the calculator works it in
 * numbers as before.
 */

import { type CalcNode, type CalcValue, isRational, parseExpression } from "../calculator";
import {
  AlgebraError,
  E,
  type Expr,
  FN_NAMES,
  type FnName,
  PI,
  add,
  div,
  fn,
  mul,
  neg,
  num,
  numQ,
  pow,
  q,
  sqrt,
  sub,
  sym,
} from "./expr";

function value(v: CalcValue): Expr {
  if (isRational(v)) return numQ(q(v.n, v.d));
  throw new AlgebraError("Not exact");
}

const FNS = new Set<string>(FN_NAMES);

/** `node` as a symbolic expression. */
export function fromNode(node: CalcNode): Expr {
  switch (node.k) {
    case "num":
      return value(node.v);
    case "name":
      if (node.name === "pi") return PI;
      if (node.name === "e") return E;
      if (node.name === "ans" || node.name === "inf" || node.slot !== undefined)
        throw new AlgebraError("Not symbolic");
      if (node.name === "theta") return sym("θ");
      return sym(node.name);
    case "neg":
      return neg(fromNode(node.a));
    case "bin": {
      const a = fromNode(node.a);
      const b = fromNode(node.b);
      switch (node.op) {
        case "+":
          return add(a, b);
        case "-":
          return sub(a, b);
        case "*":
          return mul(a, b);
        case "/":
          return div(a, b);
        case "^":
          return pow(a, b);
        default:
          throw new AlgebraError("Not symbolic");
      }
    }
    case "post":
      if (node.op === "°") return mul(fromNode(node.a), div(PI, num(180)));
      throw new AlgebraError("Not symbolic");
    case "rel":
      throw new AlgebraError("An equation, not an expression");
    case "call":
      return call(node);
  }
}

function call(node: Extract<CalcNode, { k: "call" }>): Expr {
  const args = node.args.map((a) => fromNode(a));
  switch (node.fn) {
    case "(":
      return args[0];
    case "sqrt":
      return sqrt(args[0]);
    case "root":
      return pow(args[0], div(num(1), args[1]));
    case "exp":
      return pow(E, args[0]);
  }
  if (FNS.has(node.fn) && args.length === 1) return fn(node.fn as FnName, args[0]);
  throw new AlgebraError("Not symbolic");
}

/** Calculator text as a symbolic expression (letters allowed); throws when it cannot be. */
export function fromCalc(text: string): Expr {
  const parsed = parseExpression(text, 10, { letters: true });
  if (!parsed.ok) throw new AlgebraError(parsed.error);
  return fromNode(parsed.node);
}
