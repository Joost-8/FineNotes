/**
 * Derivatives, with the working a textbook shows: each step names the rules
 * it used (sum, constant multiple, power, product, quotient, chain) and
 * shows the whole expression with the derivatives still to take written as
 * d/dx(…). Pure: no DOM.
 *
 * A step rewrites every outermost d/dx(…) once, so a derivative takes about
 * as many steps as its expression is deep; d/dx of a constant or of x itself
 * is filled in at once rather than shown as a step of its own.
 */

import {
  AlgebraError,
  type Expr,
  ONE,
  ZERO,
  add,
  d,
  div,
  equal,
  evaluate as evaluateAt,
  fn,
  free,
  mul,
  neg,
  num,
  numQ,
  pow,
  qsub,
  sub,
} from "./expr";

export interface Step {
  /** What was done, in words: "Product rule", "Factor". */
  rule: string;
  /** The whole expression after it, in the calculator's syntax. */
  expr: Expr;
}

/** Steps past this and a derivative is refused: something is looping or huge. */
const MAX_STEPS = 40;

/** d/dv of `e`, straight to the answer. */
export function derivative(e: Expr, v = "x"): Expr {
  return rewriteAll(e, v, new Set()).expr;
}

/** d/dv of `e`, with its steps. */
export function deriveSteps(e: Expr, v = "x"): { result: Expr; steps: Step[] } {
  let current = d(e, v);
  const steps: Step[] = [];
  for (let i = 0; i < MAX_STEPS && hasD(current); i++) {
    const rules = new Set<string>();
    current = pass(current, v, rules);
    steps.push({ rule: [...rules].join(", "), expr: current });
  }
  if (hasD(current)) throw new AlgebraError("Too complex");
  return { result: current, steps };
}

function hasD(e: Expr): boolean {
  switch (e.t) {
    case "d":
      return true;
    case "num":
    case "sym":
      return false;
    case "add":
      return e.terms.some(hasD);
    case "mul":
      return e.factors.some(hasD);
    case "pow":
      return hasD(e.base) || hasD(e.exp);
    case "fn":
    case "int":
      return hasD(e.arg);
  }
}

/** One step: every outermost d/dv(…) rewritten by one rule. */
function pass(e: Expr, v: string, rules: Set<string>): Expr {
  switch (e.t) {
    case "d":
      return rule(e.arg, e.v, rules);
    case "num":
    case "sym":
      return e;
    case "add":
      return add(...e.terms.map((t) => pass(t, v, rules)));
    case "mul":
      return mul(...e.factors.map((f) => pass(f, v, rules)));
    case "pow":
      return pow(pass(e.base, v, rules), pass(e.exp, v, rules));
    case "fn":
      return fn(e.name, pass(e.arg, v, rules));
    case "int":
      return { t: "int", arg: pass(e.arg, v, rules), v: e.v };
  }
}

/** d/dv(f) as an expression still to work out: 0 and 1 filled in at once. */
function later(f: Expr, v: string): Expr {
  if (free(f, v)) return ZERO;
  if (f.t === "sym" && f.name === v) return ONE;
  return d(f, v);
}

/** The variable alone, or a constant, needs no chain rule. */
const isVar = (f: Expr, v: string): boolean => f.t === "sym" && f.name === v;

/** One rule applied to d/dv(f). */
function rule(f: Expr, v: string, rules: Set<string>): Expr {
  if (free(f, v)) {
    rules.add("Derivative of a constant");
    return ZERO;
  }
  if (isVar(f, v)) {
    rules.add("Power rule");
    return ONE;
  }
  switch (f.t) {
    case "add":
      rules.add("Sum rule");
      return add(...f.terms.map((t) => later(t, v)));
    case "mul": {
      const constant = f.factors.filter((x) => free(x, v));
      const rest = f.factors.filter((x) => !free(x, v));
      if (constant.length > 0) {
        rules.add("Constant multiple");
        return mul(...constant, later(mul(...rest), v));
      }
      const bottom = rest.filter((x) => x.t === "pow" && x.exp.t === "num" && x.exp.v.n < 0n);
      if (bottom.length > 0) {
        const top = mul(...rest.filter((x) => !bottom.includes(x)));
        const den = mul(...bottom.map((b) => pow(b, num(-1))));
        if (!free(top, v)) {
          rules.add("Quotient rule");
          return div(sub(mul(later(top, v), den), mul(top, later(den, v))), pow(den, num(2)));
        }
      }
      rules.add("Product rule");
      const [first, ...others] = rest;
      const second = mul(...others);
      return add(mul(later(first, v), second), mul(first, later(second, v)));
    }
    case "pow": {
      const { base, exp } = f;
      if (free(exp, v)) {
        // u^n → n·u^(n−1)·u′
        const lowered = exp.t === "num" ? numQ(qsub(exp.v, { n: 1n, d: 1n })) : sub(exp, ONE);
        if (isVar(base, v)) {
          rules.add("Power rule");
          return mul(exp, pow(base, lowered));
        }
        rules.add("Chain rule");
        return mul(exp, pow(base, lowered), later(base, v));
      }
      if (free(base, v)) {
        // a^u → a^u·ln(a)·u′
        rules.add(isVar(exp, v) ? "Exponential rule" : "Chain rule");
        const log = base.t === "sym" && base.name === "e" ? ONE : fn("ln", base);
        return mul(f, log, later(exp, v));
      }
      // u^w = e^(w ln u): logarithmic differentiation.
      rules.add("Logarithmic differentiation");
      return mul(f, later(mul(exp, fn("ln", base)), v));
    }
    case "fn": {
      const inner = f.arg;
      const outer = derivativeOfFunction(f.name, inner);
      const name = `Derivative of ${f.name}`;
      if (isVar(inner, v)) {
        rules.add(name);
        return outer;
      }
      rules.add("Chain rule");
      return mul(outer, later(inner, v));
    }
    default:
      throw new AlgebraError("Cannot differentiate that");
  }
}

/** f′(u) for f a named function, as a function of its argument u. */
export function derivativeOfFunction(name: string, u: Expr): Expr {
  switch (name) {
    case "sin":
      return fn("cos", u);
    case "cos":
      return neg(fn("sin", u));
    case "tan":
      return pow(fn("cos", u), num(-2));
    case "sec":
      return mul(fn("sec", u), fn("tan", u));
    case "csc":
      return neg(mul(fn("csc", u), fn("cot", u)));
    case "cot":
      return neg(pow(fn("sin", u), num(-2)));
    case "asin":
      return pow(sub(ONE, pow(u, num(2))), num(-1, 2));
    case "acos":
      return neg(pow(sub(ONE, pow(u, num(2))), num(-1, 2)));
    case "atan":
      return pow(add(ONE, pow(u, num(2))), num(-1));
    case "sinh":
      return fn("cosh", u);
    case "cosh":
      return fn("sinh", u);
    case "tanh":
      return pow(fn("cosh", u), num(-2));
    case "ln":
      return pow(u, num(-1));
    case "log":
      return pow(mul(u, fn("ln", num(10))), num(-1));
    case "abs":
      return div(u, fn("abs", u));
    default:
      throw new AlgebraError("Cannot differentiate that");
  }
}

/** Derivatives all the way down, without steps (`derivative`'s engine). */
function rewriteAll(e: Expr, v: string, rules: Set<string>): { expr: Expr } {
  let current = d(e, v);
  for (let i = 0; i < MAX_STEPS * 4 && hasD(current); i++) current = pass(current, v, rules);
  if (hasD(current)) throw new AlgebraError("Too complex");
  return { expr: current };
}

/** Whether two expressions agree as functions of x, at a few points where both are defined. */
export function agree(a: Expr, b: Expr, v = "x", points = [0.37, 1.13, 2.71, -0.83, 0.61, -1.7]): boolean {
  let tried = 0;
  for (const p of points) {
    const vars = new Map([[v, p]]);
    const va = evaluateAt(a, vars);
    const vb = evaluateAt(b, vars);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    tried++;
    if (Math.abs(va - vb) > 1e-7 * Math.max(1, Math.abs(va), Math.abs(vb))) return false;
  }
  return tried >= 2 || equal(a, b);
}
