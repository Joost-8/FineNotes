/**
 * Polynomials in one letter with exact fractional coefficients: expanding
 * brackets, reading an expression as a polynomial, dividing, and finding
 * rational roots and factors (the rational root theorem, as a textbook
 * does it). Pure: no DOM.
 */

import {
  AlgebraError,
  type Expr,
  type Q,
  add,
  free,
  isNum,
  mul,
  num,
  numQ,
  pow,
  q,
  qadd,
  qdiv,
  qeq,
  qint,
  qmul,
  qneg,
  qpow,
  qsub,
  sym,
} from "./expr";

/** Coefficients, lowest degree first: [c0, c1, c2] is c0 + c1·x + c2·x². */
export type Poly = Q[];

/** The highest degree a polynomial is expanded to or solved at. */
export const MAX_DEGREE = 12;

/** `e` with every product of sums multiplied out and every whole power of a sum expanded. */
export function expand(e: Expr): Expr {
  switch (e.t) {
    case "add":
      return add(...e.terms.map(expand));
    case "mul":
      return e.factors.map(expand).reduce(multiplyOut, num(1));
    case "pow": {
      const base = expand(e.base);
      if (base.t === "add" && e.exp.t === "num" && qint(e.exp.v) && e.exp.v.n > 1n) {
        if (e.exp.v.n > BigInt(MAX_DEGREE)) throw new AlgebraError("Too complex");
        let out: Expr = base;
        for (let i = 1n; i < e.exp.v.n; i++) out = multiplyOut(out, base);
        return out;
      }
      return pow(base, e.exp);
    }
    default:
      return e;
  }
}

/** a·b with both multiplied out term by term (never collected into a power of a sum). */
function multiplyOut(a: Expr, b: Expr): Expr {
  const left = a.t === "add" ? a.terms : [a];
  const right = b.t === "add" ? b.terms : [b];
  if (left.length * right.length > 4096) throw new AlgebraError("Too complex");
  const terms: Expr[] = [];
  for (const x of left) for (const y of right) terms.push(mul(x, y));
  return add(...terms);
}

/** `e` as a polynomial in `v`, or null when it is not one (after expanding). */
export function toPoly(e: Expr, v = "x"): Poly | null {
  const expanded = expand(e);
  const terms = expanded.t === "add" ? expanded.terms : [expanded];
  const coefs: Poly = [];
  for (const term of terms) {
    let coef = q(1);
    let deg = 0;
    const factors = term.t === "mul" ? term.factors : [term];
    for (const f of factors) {
      if (f.t === "num") coef = qmul(coef, f.v);
      else if (f.t === "sym" && f.name === v) deg += 1;
      else if (
        f.t === "pow" &&
        f.base.t === "sym" &&
        f.base.name === v &&
        f.exp.t === "num" &&
        qint(f.exp.v) &&
        f.exp.v.n > 0n
      )
        deg += Number(f.exp.v.n);
      else if (free(f, v)) {
        // A coefficient that is not a number (a parameter, π, √2): not a polynomial over the rationals.
        return null;
      } else return null;
    }
    if (deg > MAX_DEGREE) return null;
    while (coefs.length <= deg) coefs.push(q(0));
    coefs[deg] = qadd(coefs[deg], coef);
  }
  return trim(coefs);
}

/** Without leading zero coefficients (the zero polynomial is []). */
export function trim(p: Poly): Poly {
  const out = [...p];
  while (out.length > 0 && out[out.length - 1].n === 0n) out.pop();
  return out;
}

export const degree = (p: Poly): number => trim(p).length - 1;

/** The polynomial as an expression in `v`, highest degree first. */
export function fromPoly(p: Poly, v = "x"): Expr {
  const x = sym(v);
  return add(...p.map((c, i) => mul(numQ(c), pow(x, num(i)))));
}

/** p(x) exactly. */
export function evalPoly(p: Poly, x: Q): Q {
  let out = q(0);
  for (let i = p.length - 1; i >= 0; i--) out = qadd(qmul(out, x), p[i]);
  return out;
}

/** p / d: quotient and remainder. */
export function divide(p: Poly, d: Poly): { quotient: Poly; remainder: Poly } {
  const den = trim(d);
  if (den.length === 0) throw new AlgebraError("Divide by zero");
  let rem = trim(p);
  const quot: Poly = [];
  const lead = den[den.length - 1];
  while (rem.length >= den.length) {
    const shift = rem.length - den.length;
    const c = qdiv(rem[rem.length - 1], lead);
    while (quot.length <= shift) quot.push(q(0));
    quot[shift] = c;
    const next = [...rem];
    for (let i = 0; i < den.length; i++) next[i + shift] = qsub(next[i + shift], qmul(c, den[i]));
    next.pop();
    rem = trim(next);
  }
  return { quotient: trim(quot), remainder: rem };
}

/** The derivative of a polynomial. */
export function derivePoly(p: Poly): Poly {
  return trim(p.slice(1).map((c, i) => qmul(c, q(i + 1))));
}

function gcdN(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Positive divisors of n, or null when n is too large to list them. */
function divisors(n: bigint): bigint[] | null {
  const m = n < 0n ? -n : n;
  if (m === 0n) return [];
  if (m > 10n ** 9n) return null;
  const small: bigint[] = [];
  const large: bigint[] = [];
  for (let i = 1n; i * i <= m; i++) {
    if (m % i === 0n) {
      small.push(i);
      if (i * i !== m) large.unshift(m / i);
    }
  }
  return [...small, ...large];
}

/** The polynomial times the smallest whole number that makes every coefficient whole. */
export function integerCoefficients(p: Poly): bigint[] {
  let lcm = 1n;
  for (const c of p) lcm = (lcm * c.d) / gcdN(lcm, c.d);
  return p.map((c) => (c.n * lcm) / c.d);
}

/**
 * Rational roots by the rational root theorem: every p/q with p dividing
 * the constant term and q the leading coefficient, tried exactly. Each root
 * once, smallest first; zero included when the constant term is zero.
 */
export function rationalRoots(poly: Poly): Q[] {
  let p = trim(poly);
  const roots: Q[] = [];
  while (p.length > 1 && p[0].n === 0n) {
    if (!roots.some((r) => r.n === 0n)) roots.push(q(0));
    p = p.slice(1);
  }
  if (p.length < 2) return roots;
  const ints = integerCoefficients(p);
  const ps = divisors(ints[0]);
  const qs = divisors(ints[ints.length - 1]);
  if (!ps || !qs || ps.length * qs.length > 20000) return roots;
  const seen = new Set<string>();
  for (const a of ps) {
    for (const b of qs) {
      for (const sign of [1n, -1n]) {
        const r = q(sign * a, b);
        const k = `${r.n}/${r.d}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (evalPoly(p, r).n === 0n) roots.push(r);
      }
    }
  }
  return roots.sort((x, y) => Number(x.n * y.d - y.n * x.d));
}

/** How many times `r` is a root of `p`. */
export function multiplicity(p: Poly, r: Q): number {
  let m = 0;
  let cur = trim(p);
  const factor = [qneg(r), q(1)];
  while (cur.length > 1 && evalPoly(cur, r).n === 0n) {
    cur = divide(cur, factor).quotient;
    m++;
  }
  return m;
}

/**
 * A polynomial split into its number, linear factors with rational roots
 * (each with its multiplicity) and what is left (degree 0 when it split
 * completely). `(2x - 1)` is kept with whole coefficients, as written.
 */
export function factorPoly(poly: Poly): {
  content: Q;
  linear: Array<{ root: Q; times: number }>;
  rest: Poly;
} {
  let p = trim(poly);
  if (p.length === 0) return { content: q(0), linear: [], rest: [q(1)] };
  const linear: Array<{ root: Q; times: number }> = [];
  for (const root of rationalRoots(p)) {
    const times = multiplicity(p, root);
    for (let i = 0; i < times; i++) p = divide(p, [qneg(root), q(1)]).quotient;
    linear.push({ root, times });
  }
  // p = lead · Π(x − r)ᵗ · monic, and (x − n/d) = (dx − n)/d.
  const lead = p[p.length - 1];
  let content = lead;
  for (const { root, times } of linear) content = qdiv(content, qpow(q(root.d), BigInt(times)));
  if (p.length === 1) return { content, linear, rest: [q(1)] };
  // The monic rest with whole coefficients and no common factor: monic = R · g / lcm.
  const monic = p.map((c) => qdiv(c, lead));
  let lcm = 1n;
  for (const c of monic) lcm = (lcm * c.d) / gcdN(lcm, c.d);
  const ints = monic.map((c) => (c.n * lcm) / c.d);
  const g = ints.reduce((a, b) => gcdN(a, b), 0n) || 1n;
  return {
    content: qmul(content, q(g, lcm)),
    linear,
    rest: ints.map((c) => q(c / g)),
  };
}

/** The factor of a rational root as written by hand: x - 3, 2x + 1. */
export function linearFactor(root: Q, v = "x"): Expr {
  return add(mul(num(root.d), sym(v)), numQ(qneg(q(root.n))));
}

/** The factored polynomial as an expression: 2(x - 1)²(x + 3). */
export function factoredExpr(poly: Poly, v = "x"): Expr {
  const { content, linear, rest } = factorPoly(poly);
  const parts: Expr[] = [numQ(content)];
  for (const { root, times } of linear) parts.push(pow(linearFactor(root, v), num(times)));
  if (rest.length > 1) parts.push(fromPoly(rest, v));
  return mul(...parts);
}

/** Whether `e` is a whole number of the polynomial's coefficients' kind (helper for tests). */
export function isZeroPoly(p: Poly): boolean {
  return trim(p).length === 0 || (trim(p).length === 1 && isNum(numQ(trim(p)[0]), 0));
}

export { qeq as sameCoefficient };
