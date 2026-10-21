/**
 * Antiderivatives (∫ f dx without limits), with the working: linearity, a
 * table of standard integrals (with a linear inside, ∫cos(3x + 1) dx),
 * expanding a polynomial, polynomial division and partial fractions,
 * completing the square, u-substitution, integration by parts and the
 * power-reduction formulas for sin² and cos². Pure: no DOM.
 *
 * A step rewrites every outermost ∫ once, as `derive.ts` does with d/dx. A
 * substitution names its new variable (u, then w, …) and adds a step of its
 * own when it is put back. Every answer is checked by differentiating it and
 * comparing with the integrand at several points; one that fails is refused
 * rather than shown, and so is an integrand none of the rules fits.
 */

import { type Step, agree, derivative } from "./derive";
import {
  AlgebraError,
  type Expr,
  ONE,
  ZERO,
  add,
  div,
  evaluate as evaluateNumber,
  fn,
  free,
  integral,
  isNum,
  key,
  mul,
  neg,
  nodes,
  num,
  numQ,
  plain,
  pow,
  q,
  qadd,
  qdiv,
  qmul,
  qneg,
  replace,
  size,
  sqrt,
  sub,
  sym,
} from "./expr";
import { derivePoly, divide, evalPoly, factorPoly, fromPoly, toPoly, trim } from "./poly";

const MAX_STEPS = 40;
/** Integrands bigger than this are not tried: the search is not cheap. */
const MAX_SIZE = 400;
/** Letters a substitution may introduce, in order. */
const FRESH = ["u", "w", "s", "z", "p"];

/** ∫ f dv, straight to the answer (no + C); null when no rule fits. */
export function antiderivative(f: Expr, v = "x"): Expr | null {
  try {
    return integrateSteps(f, v).result;
  } catch (error) {
    if (error instanceof AlgebraError) return null;
    throw error;
  }
}

interface Pending {
  v: string;
  by: Expr;
}

/** ∫ f dv with its steps (no + C); throws AlgebraError when no rule fits. */
export function integrateSteps(f: Expr, v = "x"): { result: Expr; steps: Step[] } {
  if (size(f) > MAX_SIZE) throw new AlgebraError("Too complex");
  let current = integral(f, v);
  const steps: Step[] = [];
  const pending: Pending[] = [];
  const used = new Set(nodes(f).flatMap((n) => (n.t === "sym" ? [n.name] : [])));
  used.add(v);
  for (let i = 0; i < MAX_STEPS; i++) {
    if (!hasInt(current)) {
      // Put back the substitutions whose integrals are all done.
      const done = pending.filter((p) => !hasIntIn(current, p.v));
      if (done.length === 0) break;
      for (const p of done) {
        current = replace(current, sym(p.v), p.by);
        pending.splice(pending.indexOf(p), 1);
        steps.push({ rule: `Substitute back ${p.v} = ${plain(p.by)}`, expr: current });
      }
      continue;
    }
    const rules = new Set<string>();
    current = pass(current, rules, pending, used);
    steps.push({ rule: [...rules].join(", "), expr: current });
    for (const p of [...pending]) {
      if (!hasIntIn(current, p.v) && !hasInt(current)) {
        current = replace(current, sym(p.v), p.by);
        pending.splice(pending.indexOf(p), 1);
        steps.push({ rule: `Substitute back ${p.v} = ${plain(p.by)}`, expr: current });
      }
    }
  }
  if (hasInt(current) || pending.length > 0) throw new AlgebraError("Too complex");
  if (!agree(derivative(current, v), f, v)) throw new AlgebraError("No antiderivative found");
  return { result: current, steps };
}

function hasInt(e: Expr): boolean {
  return nodes(e).some((n) => n.t === "int");
}

function hasIntIn(e: Expr, v: string): boolean {
  return nodes(e).some((n) => n.t === "int" && n.v === v);
}

function pass(e: Expr, rules: Set<string>, pending: Pending[], used: Set<string>): Expr {
  switch (e.t) {
    case "int":
      return rule(e.arg, e.v, rules, pending, used);
    case "num":
    case "sym":
      return e;
    case "add":
      return add(...e.terms.map((t) => pass(t, rules, pending, used)));
    case "mul":
      return mul(...e.factors.map((f) => pass(f, rules, pending, used)));
    case "pow":
      return pow(pass(e.base, rules, pending, used), pass(e.exp, rules, pending, used));
    case "fn":
      return fn(e.name, pass(e.arg, rules, pending, used));
    case "d":
      return e;
  }
}

/** ∫ g dv as still to do: a constant and v itself are done at once. */
function later(g: Expr, v: string): Expr {
  if (isNum(g, 0)) return ZERO;
  return integral(g, v);
}

/** a and b when g = a·v + b with a a nonzero constant; null otherwise. */
export function linear(g: Expr, v: string): { a: Expr; b: Expr } | null {
  if (free(g, v)) return null;
  const a = derivative(g, v);
  if (!free(a, v) || isNum(a, 0)) return null;
  return { a, b: sub(g, mul(a, sym(v))) };
}

/** One rule applied to ∫ f dv. */
function rule(f: Expr, v: string, rules: Set<string>, pending: Pending[], used: Set<string>): Expr {
  const x = sym(v);
  if (free(f, v)) {
    rules.add("Integral of a constant");
    return mul(f, x);
  }
  if (f.t === "add") {
    rules.add("Sum rule");
    return add(...f.terms.map((t) => later(t, v)));
  }
  if (f.t === "mul") {
    const constant = f.factors.filter((g) => free(g, v));
    if (constant.length > 0) {
      rules.add("Constant multiple");
      return mul(...constant, later(mul(...f.factors.filter((g) => !free(g, v))), v));
    }
  }
  const table = fromTable(f, v);
  if (table) {
    rules.add(table.rule);
    return table.result;
  }
  // A polynomial in brackets: multiply it out first.
  const poly = toPoly(f, v);
  if (poly && (f.t === "mul" || f.t === "pow")) {
    rules.add("Expand");
    return integral(fromPoly(poly, v), v);
  }
  const rational = rationalRule(f, v);
  if (rational) {
    rules.add(rational.rule);
    return rational.result;
  }
  const reduced = powerReduction(f, v);
  if (reduced) {
    rules.add("Power-reduction formula");
    return integral(reduced, v);
  }
  const substituted = substitution(f, v, used);
  if (substituted) {
    rules.add(
      `Substitute ${substituted.u} = ${plain(substituted.g)}, d${substituted.u} = ${plain(substituted.dg)} d${v}`,
    );
    pending.push({ v: substituted.u, by: substituted.g });
    used.add(substituted.u);
    return integral(substituted.h, substituted.u);
  }
  const parts = byParts(f, v);
  if (parts) {
    rules.add(`Integration by parts, u = ${plain(parts.u)}, dv = ${plain(parts.dv)} d${v}`);
    return parts.result;
  }
  throw new AlgebraError("No antiderivative found");
}

/** The standard integrals, each with a linear inside a·v + b allowed. */
function fromTable(f: Expr, v: string): { result: Expr; rule: string } | null {
  const x = sym(v);
  if (f.t === "sym" && f.name === v) {
    return { result: mul(num(1, 2), pow(x, num(2))), rule: "Power rule" };
  }
  if (f.t === "pow") {
    const { base, exp } = f;
    const lin = linear(base, v);
    if (lin && free(exp, v)) {
      if (isNum(exp, -1))
        return { result: div(fn("ln", fn("abs", base)), lin.a), rule: "Integral of 1/x" };
      const up = add(exp, ONE);
      return { result: div(pow(base, up), mul(lin.a, up)), rule: "Power rule" };
    }
    const linExp = linear(exp, v);
    if (linExp && free(base, v)) {
      const ln = base.t === "sym" && base.name === "e" ? ONE : fn("ln", base);
      return {
        result: div(f, mul(linExp.a, ln)),
        rule: ln === ONE ? "Integral of eˣ" : "Exponential rule",
      };
    }
    // 1/cos²(g) and 1/sin²(g).
    if (isNum(exp, -2) && base.t === "fn") {
      const l = linear(base.arg, v);
      if (l && base.name === "cos")
        return { result: div(fn("tan", base.arg), l.a), rule: "Integral of sec²" };
      if (l && base.name === "sin")
        return {
          result: neg(div(fn("cos", base.arg), mul(l.a, fn("sin", base.arg)))),
          rule: "Integral of csc²",
        };
    }
    // 1/(c + d·v²) and 1/√(c − d·v²).
    const quad = toPoly(base, v);
    if (quad && trim(quad).length === 3 && quad[1].n === 0n) {
      const c = quad[0];
      const dd = quad[2];
      if (isNum(exp, -1) && c.n > 0n && dd.n > 0n) {
        // ∫ 1/(c + d v²) = atan(v √(d/c)) / √(c d)
        return {
          result: div(fn("atan", mul(x, sqrt(numQ(qdiv(dd, c))))), sqrt(numQ(qmul(c, dd)))),
          rule: "Integral of 1/(1 + x²)",
        };
      }
      if (exp.t === "num" && exp.v.n === -1n && exp.v.d === 2n && c.n > 0n && dd.n < 0n) {
        // ∫ 1/√(c − d v²) = asin(v √(d/c)) / √d
        const pos = qneg(dd);
        return {
          result: div(fn("asin", mul(x, sqrt(numQ(qdiv(pos, c))))), sqrt(numQ(pos))),
          rule: "Integral of 1/√(1 − x²)",
        };
      }
    }
    // 1/(a v² + b v + c) with no real roots: complete the square.
    if (quad && trim(quad).length === 3 && isNum(exp, -1)) {
      const [c, b, a] = quad;
      const h = qdiv(b, qmul(q(2), a));
      const k = qadd(qdiv(c, a), qneg(qmul(h, h)));
      if (k.n > 0n) {
        const sk = sqrt(numQ(k));
        return {
          result: div(fn("atan", div(add(x, numQ(h)), sk)), mul(numQ(a), sk)),
          rule: "Complete the square",
        };
      }
    }
    return null;
  }
  if (f.t === "fn") {
    const g = f.arg;
    const lin = linear(g, v);
    if (!lin) return null;
    const a = lin.a;
    const named = (result: Expr): { result: Expr; rule: string } => ({
      result: div(result, a),
      rule: `Integral of ${f.name}`,
    });
    switch (f.name) {
      case "sin":
        return named(neg(fn("cos", g)));
      case "cos":
        return named(fn("sin", g));
      case "tan":
        return named(neg(fn("ln", fn("abs", fn("cos", g)))));
      case "cot":
        return named(fn("ln", fn("abs", fn("sin", g))));
      case "sec":
        return named(fn("ln", fn("abs", add(fn("sec", g), fn("tan", g)))));
      case "csc":
        return named(neg(fn("ln", fn("abs", add(fn("csc", g), fn("cot", g))))));
      case "sinh":
        return named(fn("cosh", g));
      case "cosh":
        return named(fn("sinh", g));
      case "tanh":
        return named(fn("ln", fn("cosh", g)));
      case "ln":
        return named(sub(mul(g, fn("ln", g)), g));
      case "log":
        return named(div(sub(mul(g, fn("ln", g)), g), fn("ln", num(10))));
      case "atan":
        return named(
          sub(mul(g, fn("atan", g)), mul(num(1, 2), fn("ln", add(ONE, pow(g, num(2)))))),
        );
      case "asin":
        return named(add(mul(g, fn("asin", g)), sqrt(sub(ONE, pow(g, num(2))))));
      case "acos":
        return named(sub(mul(g, fn("acos", g)), sqrt(sub(ONE, pow(g, num(2))))));
      default:
        return null;
    }
  }
  return null;
}

/** A quotient of polynomials: divide when the top is not smaller, then partial fractions or the square. */
function rationalRule(f: Expr, v: string): { result: Expr; rule: string } | null {
  const factors = f.t === "mul" ? f.factors : [f];
  const bottom = factors.filter(
    (g) => g.t === "pow" && g.exp.t === "num" && g.exp.v.n < 0n && !free(g.base, v),
  );
  if (bottom.length === 0) return null;
  const top = mul(...factors.filter((g) => !bottom.includes(g)));
  const den = mul(...bottom.map((g) => pow(g, num(-1))));
  const N = toPoly(top, v);
  const D = toPoly(den, v);
  if (!N || !D || trim(D).length < 2) return null;
  const x = sym(v);
  const Dx = fromPoly(D, v);
  if (trim(N).length >= trim(D).length) {
    const { quotient, remainder } = divide(N, D);
    return {
      result: add(later(fromPoly(quotient, v), v), later(div(fromPoly(remainder, v), Dx), v)),
      rule: "Polynomial division",
    };
  }
  const { linear: roots, rest } = factorPoly(D);
  if (trim(rest).length === 1 && roots.every((r) => r.times === 1) && roots.length >= 2) {
    // A_i = N(r_i) / D′(r_i)
    const dD = derivePoly(D);
    const terms = roots.map(({ root }) =>
      later(div(numQ(qdiv(evalPoly(N, root), evalPoly(dD, root))), sub(x, numQ(root))), v),
    );
    return { result: add(...terms), rule: "Partial fractions" };
  }
  if (trim(D).length === 3 && trim(N).length === 2) {
    // N = α·D′ + β: α ln|D| (the numerator is D's derivative) and an arctangent.
    const dD = derivePoly(D);
    const alpha = qdiv(N[1], dD[1]);
    const beta = qadd(N[0], qneg(qmul(alpha, dD[0])));
    return {
      result: add(mul(numQ(alpha), fn("ln", fn("abs", Dx))), later(div(numQ(beta), Dx), v)),
      rule: "Split the numerator",
    };
  }
  return null;
}

/** sin²(g) and cos²(g) as half-angle forms. */
function powerReduction(f: Expr, v: string): Expr | null {
  if (f.t !== "pow" || !isNum(f.exp, 2) || f.base.t !== "fn") return null;
  const g = f.base.arg;
  if (!linear(g, v)) return null;
  const double = fn("cos", mul(num(2), g));
  if (f.base.name === "sin") return mul(num(1, 2), sub(ONE, double));
  if (f.base.name === "cos") return mul(num(1, 2), add(ONE, double));
  return null;
}

/**
 * u-substitution: an inner part g whose derivative divides f, so that
 * f / g′ written with u for g has no v left in it.
 */
function substitution(
  f: Expr,
  v: string,
  used: Set<string>,
): { u: string; g: Expr; dg: Expr; h: Expr } | null {
  const u = FRESH.find((name) => !used.has(name));
  if (!u) return null;
  const candidates: Expr[] = [];
  const seen = new Set<string>();
  const consider = (g: Expr): void => {
    if (free(g, v) || linear(g, v) || (g.t === "sym" && g.name === v)) return;
    const k = key(g);
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(g);
  };
  for (const n of nodes(f)) {
    if (n.t === "fn") {
      consider(n.arg);
      consider(n);
    } else if (n.t === "pow") {
      consider(n.base);
      if (!free(n.exp, v)) consider(n.exp);
    }
  }
  candidates.sort((a, b) => size(b) - size(a));
  for (const g of candidates) {
    const dg = derivative(g, v);
    if (isNum(dg, 0)) continue;
    let h: Expr;
    try {
      h = mul(f, pow(dg, num(-1)));
    } catch (error) {
      if (error instanceof AlgebraError) continue;
      throw error;
    }
    const inU = replace(h, g, sym(u));
    if (free(inU, v)) return { u, g, dg, h: inU };
    // g^k inside h (x⁴ when g = x²): try rewriting powers of v.
    const inU2 = rewritePowers(h, g, u, v);
    if (inU2 && free(inU2, v)) return { u, g, dg, h: inU2 };
  }
  return null;
}

/** h with v^(k·n) written as u^k when g = v^n. */
function rewritePowers(h: Expr, g: Expr, u: string, v: string): Expr | null {
  if (g.t !== "pow" || g.base.t !== "sym" || g.base.name !== v || g.exp.t !== "num") return null;
  const n = g.exp.v;
  const walk = (e: Expr): Expr => {
    if (e.t === "pow" && e.base.t === "sym" && e.base.name === v && e.exp.t === "num") {
      const k = qdiv(e.exp.v, n);
      return pow(sym(u), numQ(k));
    }
    if (e.t === "add") return add(...e.terms.map(walk));
    if (e.t === "mul") return mul(...e.factors.map(walk));
    if (e.t === "pow") return pow(walk(e.base), walk(e.exp));
    if (e.t === "fn") return fn(e.name, walk(e.arg));
    return e;
  };
  return walk(h);
}

/** ∫ u dv = u·V − ∫ V du, for a polynomial times eˣ, sin or cos, or a logarithm or inverse trig times a polynomial. */
function byParts(f: Expr, v: string): { u: Expr; dv: Expr; result: Expr } | null {
  const factors = f.t === "mul" ? f.factors : [f];
  const isTranscendental = (g: Expr): boolean =>
    (g.t === "fn" && ["sin", "cos", "sinh", "cosh"].includes(g.name) && !!linear(g.arg, v)) ||
    (g.t === "pow" && free(g.base, v) && !!linear(g.exp, v));
  const isLogLike = (g: Expr): boolean =>
    g.t === "fn" && ["ln", "log", "atan", "asin", "acos"].includes(g.name) && !!linear(g.arg, v);
  // LIATE: a logarithm or inverse trig function is u.
  const log = factors.find(isLogLike);
  if (log) {
    const rest = mul(...factors.filter((g) => g !== log));
    const restPoly = toPoly(rest, v);
    if (!restPoly) return null;
    const V = integratePoly(restPoly, v);
    return {
      u: log,
      dv: rest,
      result: sub(mul(log, V), later(mul(V, derivative(log, v)), v)),
    };
  }
  const trans = factors.find(isTranscendental);
  if (!trans) return null;
  const P = mul(...factors.filter((g) => g !== trans));
  const poly = toPoly(P, v);
  if (!poly || trim(poly).length < 2 || trim(poly).length > 6) return null;
  const V = fromTable(trans, v)?.result;
  if (!V) return null;
  return { u: P, dv: trans, result: sub(mul(P, V), later(mul(V, derivative(P, v)), v)) };
}

function integratePoly(p: ReturnType<typeof toPoly> & object, v: string): Expr {
  const up = [q(0), ...p.map((c, i) => qdiv(c, q(i + 1)))];
  return fromPoly(up, v);
}

/** F(b) − F(a), worked out exactly where it can be. */
export function evaluateBetween(F: Expr, v: string, a: Expr, b: Expr): Expr {
  return sub(replace(F, sym(v), b), replace(F, sym(v), a));
}

/** A rough size check for tests and callers that want to know if an answer is plausible. */
export function definiteValue(F: Expr, v: string, a: number, b: number): number {
  const at = (t: number): number => {
    const vars = new Map([[v, t]]);
    return evaluateNumber(F, vars);
  };
  return at(b) - at(a);
}
