/**
 * Equations in x, solved exactly with their working where a textbook would
 * solve them, and numerically (marked ≈) where it cannot. Pure: no DOM.
 *
 * - Polynomials: linear by moving terms and dividing; higher degrees by
 *   factoring (common factor, rational roots) and the zero-product rule;
 *   a quadratic that does not factor by the quadratic formula, with its
 *   root simplified (√12 = 2√3).
 * - Fractions with x below are cleared first, and any answer that makes a
 *   denominator zero is dropped (and said so).
 * - An equation where x appears once (2^(x+1) = 16, ln(3x) = 2,
 *   sin(x) = 1/2, √(x + 1) = 3) is undone one layer at a time; trig
 *   equations give every solution, with k any whole number, in the
 *   calculator's angle unit.
 * - Anything else: the real roots between -100 and 100, found by sign
 *   changes and bisection, given as decimals.
 */

import {
  AlgebraError,
  type Expr,
  ONE,
  PI,
  type Q,
  ZERO,
  add,
  div,
  evaluate,
  exactTrig,
  fn,
  free,
  isNum,
  mul,
  neg,
  nodes,
  num,
  numQ,
  piMultiple,
  plain,
  pow,
  print,
  q,
  qcmp,
  qdiv,
  qint,
  qmul,
  qneg,
  qnum,
  qsub,
  replace,
  sqrt,
  sub,
  sym,
} from "./expr";
import {
  MAX_DEGREE,
  degree,
  factorPoly,
  fromPoly,
  linearFactor,
  toPoly,
  trim,
} from "./poly";

/** A line of working: what was done, and the equations it left (several are joined by "or"). */
export interface SolveStep {
  rule: string;
  /** Each in the calculator's syntax: `x - 2 = 0`. */
  math: string[];
}

export interface Solution {
  /** The solutions, each as the expression x equals. */
  values: Expr[];
  /** Found numerically: shown as decimals with ≈. */
  approx: boolean;
  /** For a periodic family, the letter that counts the periods (k). */
  integer?: string;
  /** "No real solution", "Every x is a solution": what is shown when there are no values. */
  message?: string;
  steps: SolveStep[];
}

export interface SolveOptions {
  angle?: "deg" | "rad";
  /** The letter solved for. */
  v?: string;
}

/** Equation `lhs = rhs`, solved for x. */
export function solveEquation(lhs: Expr, rhs: Expr, options: SolveOptions = {}): Solution {
  const v = options.v ?? "x";
  const angle = options.angle ?? "rad";
  if (free(lhs, v) && free(rhs, v)) throw new AlgebraError(`No ${v} to solve for`);
  const steps: SolveStep[] = [];
  const x = sym(v);

  // Undo one layer at a time when x appears only once.
  const isolated = isolate(lhs, rhs, v, angle, steps);
  if (isolated) return isolated;

  // Clear fractions with x below.
  let expr = sub(lhs, rhs);
  const denominators = denominatorsOf(expr, v);
  let current: Expr = expr;
  if (denominators.length > 0) {
    const lcd = mul(...denominators);
    current = mulOut(expr, lcd);
    steps.push({ rule: `Multiply both sides by ${plain(lcd)}`, math: [pair(current, ZERO)] });
  }
  const poly = toPoly(current, v);
  if (!poly) return numeric(sub(lhs, rhs), v, angle, steps);
  expr = fromPoly(poly, v);
  if (steps.length === 0 || !samePrinted(expr, current)) {
    steps.push({ rule: "Move everything to one side", math: [pair(expr, ZERO)] });
  }
  const p = trim(poly);
  const deg = degree(p);
  let result: Solution;
  if (deg < 0) result = { values: [], approx: false, message: `Every ${v} is a solution`, steps };
  else if (deg === 0) result = { values: [], approx: false, message: "No solution", steps };
  else if (deg === 1) result = linearSolve(p, v, steps);
  else result = polySolve(p, v, steps);
  // A solution that makes a denominator zero is not one.
  if (denominators.length > 0 && result.values.length > 0) {
    const kept = result.values.filter((value) =>
      denominators.every((den) => {
        const at = evaluate(replace(den, x, value));
        return Number.isFinite(at) && Math.abs(at) > 1e-12;
      }),
    );
    if (kept.length < result.values.length) {
      const dropped = result.values.filter((s) => !kept.includes(s));
      steps.push({
        rule: `${dropped.map((s) => `${v} = ${plain(s)}`).join(", ")} makes a denominator zero`,
        math: answerExpr(kept, v),
      });
      result = { ...result, values: kept, message: kept.length === 0 ? "No solution" : undefined };
    }
  }
  return result;
}

/** `a = b` in the calculator's syntax. */
export function pair(a: Expr, b: Expr): string {
  return `${print(a)} = ${print(b)}`;
}

/** The answer: x = 2, x = 3, one line each. */
export function answerExpr(values: Expr[], v = "x"): string[] {
  return values.map((value) => `${v} = ${print(value)}`);
}

function samePrinted(a: Expr, b: Expr): boolean {
  return plain(a) === plain(b);
}

/** The factors with a negative power that contain v: the denominators to clear. */
function denominatorsOf(e: Expr, v: string): Expr[] {
  const out = new Map<string, Expr>();
  for (const n of nodes(e)) {
    if (n.t === "pow" && n.exp.t === "num" && n.exp.v.n < 0n && !free(n.base, v)) {
      if (!qint(n.exp.v)) continue;
      const den = pow(n.base, numQ(qneg(n.exp.v)));
      out.set(plain(den), den);
    }
  }
  return [...out.values()];
}

/** e × m with every term multiplied separately (so fractions cancel). */
function mulOut(e: Expr, m: Expr): Expr {
  const terms = e.t === "add" ? e.terms : [e];
  return add(...terms.map((t) => mul(t, m)));
}

function linearSolve(p: Q[], v: string, steps: SolveStep[]): Solution {
  const [b, a] = p;
  const x = sym(v);
  if (b.n !== 0n) steps.push({ rule: `Move ${plain(numQ(b))} to the other side`, math: [pair(mul(numQ(a), x), numQ(qneg(b)))] });
  const root = qdiv(qneg(b), a);
  if (!(a.n === 1n && a.d === 1n)) steps.push({ rule: `Divide both sides by ${plain(numQ(a))}`, math: [pair(x, numQ(root))] });
  return { values: [numQ(root)], approx: false, steps };
}

function polySolve(p: Q[], v: string, steps: SolveStep[]): Solution {
  const { content, linear, rest } = factorPoly(p);
  const x = sym(v);
  const restDeg = trim(rest).length - 1;
  const values: Expr[] = linear.map((r) => numQ(r.root));
  // A quadratic with no rational roots: the formula.
  if (linear.length === 0 && restDeg === 2) return quadraticFormula(p, v, steps);
  if (linear.length > 0) {
    const factors: Expr[] = [numQ(content)];
    for (const { root, times } of linear) factors.push(pow(linearFactor(root, v), num(times)));
    if (restDeg > 0) factors.push(fromPoly(rest, v));
    const factored = mul(...factors);
    steps.push({ rule: "Factor", math: [pair(factored, ZERO)] });
    const each = linear.map(({ root }) => pair(linearFactor(root, v), ZERO));
    if (restDeg > 0) each.push(pair(fromPoly(rest, v), ZERO));
    steps.push({ rule: "A product is zero when one of its factors is", math: orExpr(each) });
  }
  let approx = false;
  if (restDeg === 2 && linear.length > 0) {
    const sub2 = quadraticFormula(rest, v, steps);
    values.push(...sub2.values);
  } else if (restDeg > 2) {
    const found = numericRoots((t) => evalPolyFloat(rest, t));
    values.push(...found.map((r) => num(Math.round(r * 1e9), 1e9)));
    approx = found.length > 0;
  }
  values.sort((a, b) => evaluate(a) - evaluate(b));
  if (values.length === 0) return { values, approx: false, message: "No real solution", steps };
  steps.push({ rule: "Solve each", math: answerExpr(values, v) });
  void x;
  return { values, approx, steps };
}

function evalPolyFloat(p: Q[], t: number): number {
  let out = 0;
  for (let i = p.length - 1; i >= 0; i--) out = out * t + qnum(p[i]);
  return out;
}

/** a·x² + b·x + c = 0 by x = (−b ± √(b² − 4ac)) / 2a. */
function quadraticFormula(p: Q[], v: string, steps: SolveStep[]): Solution {
  const [c, b, a] = p;
  const disc = qsub(qmul(b, b), qmul(q(4), qmul(a, c)));
  steps.push({
    rule: `Quadratic formula with a = ${plain(numQ(a))}, b = ${plain(numQ(b))}, c = ${plain(numQ(c))}`,
    math: [formulaText(a, b, disc, v)],
  });
  if (disc.n < 0n) {
    steps.push({ rule: `b² − 4ac = ${plain(numQ(disc))} is negative`, math: answerExpr([], v) });
    return { values: [], approx: false, message: "No real solution", steps };
  }
  const root = sqrt(numQ(disc));
  const two = numQ(qmul(q(2), a));
  const values =
    disc.n === 0n
      ? [div(numQ(qneg(b)), two)]
      : [div(sub(numQ(qneg(b)), root), two), div(add(numQ(qneg(b)), root), two)];
  values.sort((x, y) => evaluate(x) - evaluate(y));
  steps.push({ rule: "Simplify", math: answerExpr(values, v) });
  return { values, approx: false, steps };
}

/** x = (−b ± √D) / 2a, as plain text (the display shows text it cannot lay out as it is). */
function formulaText(a: Q, b: Q, disc: Q, v: string): string {
  return `${v} = (${plain(numQ(qneg(b)))} ± √${disc.n < 0n ? `(${plain(numQ(disc))})` : plain(numQ(disc))}) / ${plain(numQ(qmul(q(2), a)))}`;
}

/** Several equations joined by "or". */
function orExpr(parts: string[]): string[] {
  return parts;
}

// --- Undoing one layer at a time -------------------------------------------------------

function occurrences(e: Expr, v: string): number {
  return nodes(e).filter((n) => n.t === "sym" && n.name === v).length;
}

/** x appears once: undo its operations from the outside in. */
function isolate(
  lhs: Expr,
  rhs: Expr,
  v: string,
  angle: "deg" | "rad",
  steps: SolveStep[],
): Solution | null {
  // Keep x on the left.
  if (free(lhs, v)) [lhs, rhs] = [rhs, lhs];
  if (!free(rhs, v) || occurrences(lhs, v) !== 1) return null;
  // A polynomial is better solved as one (x² = 4 has two answers).
  if (toPoly(lhs, v) && !(lhs.t === "pow" && !isNum(lhs.exp, 2) && lhs.exp.t === "num")) {
    const p = toPoly(sub(lhs, rhs), v);
    if (p && degree(p) <= 2) return null;
  }
  let l = lhs;
  let r = rhs;
  for (let guard = 0; guard < 30; guard++) {
    if (l.t === "sym" && l.name === v) {
      return { values: [r], approx: false, steps };
    }
    if (l.t === "add") {
      const rest = l.terms.filter((t) => free(t, v));
      const inner = l.terms.find((t) => !free(t, v));
      if (!inner) return null;
      const moved = add(...rest);
      r = sub(r, moved);
      l = inner;
      steps.push({ rule: `Subtract ${plain(moved)} from both sides`, math: [pair(l, r)] });
      continue;
    }
    if (l.t === "mul") {
      const rest = l.factors.filter((f) => free(f, v));
      const inner = l.factors.find((f) => !free(f, v));
      if (!inner) return null;
      const by = mul(...rest);
      r = div(r, by);
      l = inner;
      steps.push({ rule: `Divide both sides by ${plain(by)}`, math: [pair(l, r)] });
      continue;
    }
    if (l.t === "pow") {
      if (free(l.exp, v)) {
        // u^n = r → u = r^(1/n), ± for an even whole n.
        const n = l.exp;
        if (n.t === "num" && qint(n.v) && n.v.n % 2n === 0n) {
          if (evaluate(r) < 0) return { values: [], approx: false, message: "No real solution", steps };
          const root = pow(r, div(ONE, n));
          if (isNum(root, 0)) {
            l = l.base;
            r = ZERO;
            steps.push({ rule: `Take the ${ordinal(n)} root`, math: [pair(l, r)] });
            continue;
          }
          return branches(l.base, [root, neg(root)], v, angle, steps, `Take the ${ordinal(n)} root of both sides`);
        }
        if (n.t === "num" && n.v.n < 0n && evaluate(r) === 0) return { values: [], approx: false, message: "No solution", steps };
        if (n.t === "num" && n.v.d === 2n && evaluate(r) < 0)
          return { values: [], approx: false, message: "No real solution", steps };
        r = pow(r, div(ONE, n));
        l = l.base;
        steps.push({
          rule: n.t === "num" && n.v.n === 1n && n.v.d === 2n ? "Square both sides" : `Raise both sides to the power ${plain(div(ONE, n))}`,
          math: [pair(l, r)],
        });
        continue;
      }
      if (free(l.base, v)) {
        // a^u = r → u = ln(r)/ln(a); e^u = r → u = ln(r).
        if (evaluate(r) <= 0) return { values: [], approx: false, message: "No real solution", steps };
        const base = l.base;
        const exact = exactLog(base, r);
        r = exact ?? (base.t === "sym" && base.name === "e" ? fn("ln", r) : div(fn("ln", r), fn("ln", base)));
        l = l.exp;
        steps.push({
          rule: base.t === "sym" && base.name === "e" ? "Take ln of both sides" : `Take the logarithm base ${plain(base)}`,
          math: [pair(l, r)],
        });
        continue;
      }
      return null;
    }
    if (l.t === "fn") {
      const inner = l.arg;
      switch (l.name) {
        case "ln":
          r = pow(sym("e"), r);
          l = inner;
          steps.push({ rule: "Raise e to both sides", math: [pair(l, r)] });
          continue;
        case "log":
          r = pow(num(10), r);
          l = inner;
          steps.push({ rule: "Raise 10 to both sides", math: [pair(l, r)] });
          continue;
        case "abs":
          if (evaluate(r) < 0) return { values: [], approx: false, message: "No solution", steps };
          return branches(inner, [r, neg(r)], v, angle, steps, "An absolute value is r or −r");
        case "sin":
        case "cos":
        case "tan":
          return trigFamily(l.name, inner, r, v, angle, steps);
        default:
          return null;
      }
    }
    return null;
  }
  return null;
}

/** Each of several right-hand sides solved on its own (± roots, |u| = r). */
function branches(
  l: Expr,
  rights: Expr[],
  v: string,
  angle: "deg" | "rad",
  steps: SolveStep[],
  rule: string,
): Solution | null {
  steps.push({ rule, math: orExpr(rights.map((r) => pair(l, r))) });
  const values: Expr[] = [];
  for (const r of rights) {
    const sub = isolate(l, r, v, angle, []);
    if (!sub) return null;
    values.push(...sub.values);
  }
  const unique = values.filter((a, i) => values.findIndex((b) => plain(b) === plain(a)) === i);
  unique.sort((a, b) => evaluate(a) - evaluate(b));
  steps.push({ rule: "Solve each", math: answerExpr(unique, v) });
  return { values: unique, approx: false, steps };
}

function ordinal(n: Expr): string {
  if (isNum(n, 2)) return "square";
  if (isNum(n, 3)) return "cube";
  return `${plain(n)}th`;
}

/** log_base(r) when it is a whole or simple number: 2^x = 16 → x = 4. */
function exactLog(base: Expr, r: Expr): Expr | null {
  if (base.t !== "num" || r.t !== "num") return null;
  for (let k = -64; k <= 64; k++) {
    const p = pow(base, num(k));
    if (p.t === "num" && p.v.n === r.v.n && p.v.d === r.v.d) return num(k);
  }
  return null;
}

/** sin(u) = r, cos(u) = r, tan(u) = r: every solution, k any whole number. */
function trigFamily(
  name: "sin" | "cos" | "tan",
  inner: Expr,
  r: Expr,
  v: string,
  angle: "deg" | "rad",
  steps: SolveStep[],
): Solution | null {
  const value = evaluate(r);
  if (name !== "tan" && Math.abs(value) > 1 + 1e-12)
    return { values: [], approx: false, message: "No real solution", steps };
  const k = sym("k");
  const full = angle === "deg" ? num(360) : mul(num(2), PI);
  const half = angle === "deg" ? num(180) : PI;
  const principal = exactInverse(name, r, angle);
  const base = principal ?? (angle === "deg" ? mul(num(180), div(fn(`a${name}` as "asin", r), PI)) : fn(`a${name}` as "asin", r));
  let rights: Expr[];
  if (name === "sin") rights = [add(base, mul(full, k)), add(sub(half, base), mul(full, k))];
  else if (name === "cos") rights = [add(base, mul(full, k)), add(neg(base), mul(full, k))];
  else rights = [add(base, mul(half, k))];
  steps.push({
    rule: `Every angle with ${name} = ${plain(r)}, k any whole number`,
    math: orExpr(rights.map((right) => pair(inner, right))),
  });
  const values: Expr[] = [];
  for (const right of rights) {
    const solved = isolate(inner, right, v, angle, []);
    if (!solved) return null;
    values.push(...solved.values);
  }
  const unique = values.filter((a, i) => values.findIndex((b) => plain(b) === plain(a)) === i);
  if (unique.length > 1) steps.push({ rule: "Solve each", math: answerExpr(unique, v) });
  return { values: unique, approx: false, integer: "k", steps };
}

/** asin, acos or atan of r exactly (π/6, or 30 in degrees), or null. */
function exactInverse(name: "sin" | "cos" | "tan", r: Expr, angle: "deg" | "rad"): Expr | null {
  const candidates: Q[] = [];
  for (let n = -12; n <= 12; n++) candidates.push(q(n, 12));
  const range =
    name === "acos" as string || name === "cos"
      ? candidates.filter((t) => qcmp(t, q(0)) >= 0 && qcmp(t, q(1)) <= 0)
      : candidates.filter((t) => qcmp(t, q(-1, 2)) >= 0 && qcmp(t, q(1, 2)) <= 0);
  const target = evaluate(r);
  for (const t of range) {
    const exact = exactTrig(t);
    if (!exact) continue;
    let value: Expr;
    if (name === "sin") value = exact.sin;
    else if (name === "cos") value = exact.cos;
    else {
      if (isNum(exact.cos, 0)) continue;
      value = div(exact.sin, exact.cos);
    }
    if (Math.abs(evaluate(value) - target) < 1e-12) {
      return angle === "deg" ? numQ(qmul(t, q(180))) : mul(numQ(t), PI);
    }
  }
  void piMultiple;
  return null;
}

// --- Numbers -----------------------------------------------------------------------

/** Real roots of f in [−100, 100]: sign changes, then bisection. */
export function numericRoots(f: (x: number) => number, from = -100, to = 100, samples = 4000): number[] {
  const roots: number[] = [];
  const step = (to - from) / samples;
  let x0 = from;
  let f0 = f(x0);
  for (let i = 1; i <= samples; i++) {
    const x1 = from + i * step;
    const f1 = f(x1);
    if (Number.isFinite(f0) && Number.isFinite(f1)) {
      if (f0 === 0) pushRoot(roots, x0);
      else if (f0 * f1 < 0) {
        let a = x0;
        let b = x1;
        let fa = f0;
        for (let k = 0; k < 80; k++) {
          const m = (a + b) / 2;
          const fm = f(m);
          if (!Number.isFinite(fm)) break;
          if (fa * fm <= 0) b = m;
          else {
            a = m;
            fa = fm;
          }
        }
        const root = (a + b) / 2;
        // A jump through a pole changes sign too: keep only where f is small.
        if (Math.abs(f(root)) < 1e-6 * Math.max(1, Math.abs(f0), Math.abs(f1))) pushRoot(roots, root);
      }
    }
    x0 = x1;
    f0 = f1;
  }
  return roots;
}

function pushRoot(roots: number[], r: number): void {
  if (!roots.some((s) => Math.abs(s - r) < 1e-9 * Math.max(1, Math.abs(r)))) roots.push(r);
}

/** Roots found in numbers, when no exact method applies. */
function numeric(e: Expr, v: string, angle: "deg" | "rad", steps: SolveStep[]): Solution {
  const scale = angle === "deg" ? Math.PI / 180 : 1;
  // Trig in degrees: evaluate with x in degrees.
  const f = (t: number): number => {
    const vars = new Map([[v, t]]);
    if (angle === "rad") return evaluate(e, vars);
    return evaluate(degreesIn(e), vars) * 1 + 0 * scale;
  };
  const roots = numericRoots(f);
  if (roots.length === 0) return { values: [], approx: true, message: "No solution found between −100 and 100", steps };
  if (roots.length > 12) throw new AlgebraError("Too many solutions to list");
  return {
    values: roots.map((r) => num(Math.round(r * 1e9), 1e9)),
    approx: true,
    steps: [...steps, { rule: "Found numerically", math: answerExpr([], v) }],
  };
}

/** e with each trig function's argument read in degrees. */
function degreesIn(e: Expr): Expr {
  const walk = (n: Expr): Expr => {
    if (n.t === "fn" && ["sin", "cos", "tan", "sec", "csc", "cot"].includes(n.name))
      return fn(n.name, mul(walk(n.arg), div(PI, num(180))));
    if (n.t === "add") return add(...n.terms.map(walk));
    if (n.t === "mul") return mul(...n.factors.map(walk));
    if (n.t === "pow") return pow(walk(n.base), walk(n.exp));
    if (n.t === "fn") return fn(n.name, walk(n.arg));
    return n;
  };
  return walk(e);
}

export { MAX_DEGREE, qdiv };
