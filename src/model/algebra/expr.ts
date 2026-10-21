/**
 * Symbolic expressions for the calculator's algebra: exact fractions,
 * letters, sums, products, powers and functions, kept in one canonical
 * form so that equal expressions print alike. Pure: no DOM.
 *
 * Every constructor simplifies as it builds (SymPy's "automatic
 * simplification"): sums collect like terms and fold numbers, products
 * collect powers of the same base, `x^0` is 1, `(x^2)^3` is `x^6`, √12 is
 * 2√3 and 1/√2 is √2/2. Nothing here expands brackets or factors; that is
 * `poly.ts`'s work, asked for on purpose.
 *
 * Two further nodes stand for work still to do, so a worked solution can
 * show it: `d` (a derivative not taken yet) and `int` (an antiderivative
 * not found yet). `derive.ts` and `integrate.ts` rewrite them away.
 *
 * {@link print} writes an expression in the calculator's own syntax, so the
 * natural display (`calc-display.ts`) lays a step out as it lays out
 * anything typed.
 */

/** An exact fraction in lowest terms, `d > 0`. */
export interface Q {
  n: bigint;
  d: bigint;
}

export type FnName =
  | "sin"
  | "cos"
  | "tan"
  | "sec"
  | "csc"
  | "cot"
  | "asin"
  | "acos"
  | "atan"
  | "sinh"
  | "cosh"
  | "tanh"
  | "ln"
  | "log"
  | "abs";

export const FN_NAMES: readonly FnName[] = [
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "ln",
  "log",
  "abs",
];

export type Expr =
  | { t: "num"; v: Q }
  /** A letter: `x`, `pi`, `e`, a constant of integration `C`, or a parameter. */
  | { t: "sym"; name: string }
  | { t: "add"; terms: Expr[] }
  | { t: "mul"; factors: Expr[] }
  | { t: "pow"; base: Expr; exp: Expr }
  | { t: "fn"; name: FnName; arg: Expr }
  /** d/dv of `arg`, not taken yet. */
  | { t: "d"; arg: Expr; v: string }
  /** ∫ `arg` dv, not found yet. */
  | { t: "int"; arg: Expr; v: string };

/** Something the algebra cannot do: the calculator falls back to numbers. */
export class AlgebraError extends Error {}

/** Numerators and denominators past this many bits are too large to keep exact. */
const MAX_BITS = 512;

// --- Fractions ------------------------------------------------------------------

function babs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function gcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function q(n: bigint | number, d: bigint | number = 1n): Q {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new AlgebraError("Divide by zero");
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd) || 1n;
  nn /= g;
  dd /= g;
  if (nn.toString(2).length > MAX_BITS || dd.toString(2).length > MAX_BITS)
    throw new AlgebraError("Too large");
  return { n: nn, d: dd };
}

export const qadd = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const qmul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
export const qneg = (a: Q): Q => ({ n: -a.n, d: a.d });
export const qsub = (a: Q, b: Q): Q => qadd(a, qneg(b));
export function qdiv(a: Q, b: Q): Q {
  if (b.n === 0n) throw new AlgebraError("Divide by zero");
  return q(a.n * b.d, a.d * b.n);
}
export const qeq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;
export const qcmp = (a: Q, b: Q): number => {
  const diff = a.n * b.d - b.n * a.d;
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
};
export const qint = (a: Q): boolean => a.d === 1n;
export const qnum = (a: Q): number => Number(a.n) / Number(a.d);

/** `a` to a whole power, exactly; refused when the result would be huge. */
export function qpow(a: Q, k: bigint): Q {
  if (k < 0n) return qdiv(q(1), qpow(a, -k));
  if (k > 4096n) throw new AlgebraError("Too large");
  const bits = Math.max(a.n.toString(2).length, a.d.toString(2).length);
  if (bits * Number(k) > MAX_BITS * 2) throw new AlgebraError("Too large");
  return q(a.n ** k, a.d ** k);
}

// --- Building -------------------------------------------------------------------

export const num = (n: bigint | number, d: bigint | number = 1n): Expr => ({
  t: "num",
  v: q(n, d),
});
export const numQ = (v: Q): Expr => ({ t: "num", v });
export const sym = (name: string): Expr => ({ t: "sym", name });

export const ZERO = num(0);
export const ONE = num(1);
export const X = sym("x");
export const PI = sym("pi");
export const E = sym("e");

export const isNum = (e: Expr, n?: number): boolean =>
  e.t === "num" && (n === undefined || (e.v.d === 1n && e.v.n === BigInt(n)));

export function neg(e: Expr): Expr {
  return mul(num(-1), e);
}

export function sub(a: Expr, b: Expr): Expr {
  return add(a, neg(b));
}

export function div(a: Expr, b: Expr): Expr {
  if (isNum(b, 0)) throw new AlgebraError("Divide by zero");
  return mul(a, pow(b, num(-1)));
}

export function sqrt(e: Expr): Expr {
  return pow(e, num(1, 2));
}

/** A sum: like terms collected (3x + 2x = 5x), numbers folded, in a fixed order. */
export function add(...parts: Expr[]): Expr {
  const flat: Expr[] = [];
  for (const p of parts) {
    if (p.t === "add") flat.push(...p.terms);
    else flat.push(p);
  }
  let constant = q(0);
  const like = new Map<string, { coef: Q; rest: Expr }>();
  for (const term of flat) {
    if (term.t === "num") {
      constant = qadd(constant, term.v);
      continue;
    }
    const { coef, rest } = splitCoefficient(term);
    const k = key(rest);
    const seen = like.get(k);
    if (seen) seen.coef = qadd(seen.coef, coef);
    else like.set(k, { coef, rest });
  }
  const terms: Expr[] = [];
  for (const { coef, rest } of like.values()) {
    if (coef.n === 0n) continue;
    terms.push(withCoefficient(coef, rest));
  }
  terms.sort(compareTerms);
  // 5 − √13 and π/6 + 2πk: a sum with no x starts with its number.
  if (constant.n !== 0n) {
    if (terms.every((t) => free(t, "x"))) terms.unshift(numQ(constant));
    else terms.push(numQ(constant));
  }
  if (terms.length === 0) return ZERO;
  if (terms.length === 1) return terms[0];
  return { t: "add", terms };
}

/** A term as its number and the rest: 3x² is (3, x²), x is (1, x). */
export function splitCoefficient(term: Expr): { coef: Q; rest: Expr } {
  if (term.t === "num") return { coef: term.v, rest: ONE };
  if (term.t === "mul" && term.factors[0].t === "num") {
    const rest = term.factors.slice(1);
    return {
      coef: term.factors[0].v,
      rest: rest.length === 1 ? rest[0] : { t: "mul", factors: rest },
    };
  }
  return { coef: q(1), rest: term };
}

/** coef × rest, where rest carries no number of its own (no simplifying needed). */
function withCoefficient(coef: Q, rest: Expr): Expr {
  if (qeq(coef, q(1))) return rest;
  if (isNum(rest, 1)) return numQ(coef);
  if (rest.t === "mul") return { t: "mul", factors: [numQ(coef), ...rest.factors] };
  return { t: "mul", factors: [numQ(coef), rest] };
}

/** A product: powers of a base collected (x·x² = x³), numbers folded, √2·√3 = √6. */
export function mul(...parts: Expr[]): Expr {
  const flat: Expr[] = [];
  for (const p of parts) {
    if (p.t === "mul") flat.push(...p.factors);
    else flat.push(p);
  }
  let coef = q(1);
  const bases = new Map<string, { base: Expr; exps: Expr[] }>();
  for (const f of flat) {
    if (f.t === "num") {
      coef = qmul(coef, f.v);
      if (coef.n === 0n) return ZERO;
      continue;
    }
    const base = f.t === "pow" ? f.base : f;
    const exp = f.t === "pow" ? f.exp : ONE;
    const k = key(base);
    const seen = bases.get(k);
    if (seen) seen.exps.push(exp);
    else bases.set(k, { base, exps: [exp] });
  }
  const others: Expr[] = [];
  // Numeric radicals with the same exponent share one root: √2·√3 = √6.
  const radicals = new Map<string, { base: Q; exp: Expr }>();
  for (const { base, exps } of bases.values()) {
    const exp = exps.length === 1 ? exps[0] : add(...exps);
    if (base.t === "num" && exp.t === "num") {
      const k = key(exp);
      const seen = radicals.get(k);
      if (seen) seen.base = qmul(seen.base, base.v);
      else radicals.set(k, { base: base.v, exp });
      continue;
    }
    const p = exps.length === 1 ? raw(base, exp) : pow(base, exp);
    collect(p);
  }
  for (const { base, exp } of radicals.values()) collect(pow(numQ(base), exp));
  function collect(p: Expr): void {
    if (p.t === "num") coef = qmul(coef, p.v);
    else if (p.t === "mul") {
      for (const f of p.factors) {
        if (f.t === "num") coef = qmul(coef, f.v);
        else others.push(f);
      }
    } else others.push(p);
  }
  if (coef.n === 0n) return ZERO;
  others.sort(compareFactors);
  if (others.length === 0) return numQ(coef);
  if (qeq(coef, q(1)) && others.length === 1) return others[0];
  const factors = qeq(coef, q(1)) ? others : [numQ(coef), ...others];
  return { t: "mul", factors };
}

/** base^exp as given, unless it is base^1 or base^0. */
function raw(base: Expr, exp: Expr): Expr {
  if (isNum(exp, 1)) return base;
  if (isNum(exp, 0)) return ONE;
  return { t: "pow", base, exp };
}

/** A power, simplified: whole powers of numbers worked out, roots of numbers reduced and rationalised. */
export function pow(base: Expr, exp: Expr): Expr {
  if (isNum(exp, 0)) return ONE;
  if (isNum(exp, 1)) return base;
  if (base.t === "num") {
    if (isNum(base, 1)) return ONE;
    if (isNum(base, 0)) {
      if (exp.t === "num" && exp.v.n > 0n) return ZERO;
      throw new AlgebraError("Divide by zero");
    }
    if (exp.t === "num") return numPower(base.v, exp.v);
  }
  if (base.t === "pow" && exp.t === "num" && qint(exp.v)) {
    return pow(base.base, mul(base.exp, exp));
  }
  if (base.t === "mul" && exp.t === "num" && qint(exp.v)) {
    return mul(...base.factors.map((f) => pow(f, exp)));
  }
  if (base.t === "sym" && base.name === "e" && exp.t === "fn" && exp.name === "ln") return exp.arg;
  return { t: "pow", base, exp };
}

/** The largest whole a with a^k dividing n, and what is left. */
function perfectPart(n: bigint, k: number): { root: bigint; rest: bigint } {
  let root = 1n;
  let rest = n;
  const kk = BigInt(k);
  for (let p = 2n; p ** kk <= rest && p < 100000n; p++) {
    const pk = p ** kk;
    while (rest % pk === 0n) {
      rest /= pk;
      root *= p;
    }
  }
  return { root, rest };
}

/** A rational to a rational power: exact where it can be, else a reduced radical. */
function numPower(b: Q, e: Q): Expr {
  if (qint(e)) return numQ(qpow(b, e.n));
  const k = Number(e.d);
  if (b.n < 0n) {
    // An odd root of a negative number is real; an even one is not.
    if (k % 2 === 0) throw new AlgebraError("Not a real number");
    return neg(numPower(qneg(b), e));
  }
  if (k > 12) return { t: "pow", base: numQ(b), exp: numQ(e) };
  // b^(p/k) = b^w · b^(r/k), with 0 < r < k.
  const w = e.n >= 0n ? e.n / e.d : -((-e.n + e.d - 1n) / e.d);
  const r = e.n - w * e.d;
  const whole = qpow(b, w);
  // Numerator: n^(r/k) = a^r · rest^(r/k). Denominator, rationalised: d^(r/k) = d · d^(-(k-r)/k)… kept as d^((k-r)/k)/d.
  const top = perfectPart(b.n, k);
  let coef = qmul(whole, qpow(q(top.root), r));
  const factors: Expr[] = [];
  if (top.rest !== 1n) factors.push({ t: "pow", base: num(top.rest), exp: num(r, k) });
  if (b.d !== 1n) {
    // 1/d^(r/k) = d^((k-r)/k) / d.
    const bottom = perfectPart(b.d, k);
    coef = qdiv(coef, qpow(q(bottom.root), r));
    if (bottom.rest !== 1n) {
      coef = qdiv(coef, q(bottom.rest));
      factors.push({ t: "pow", base: num(bottom.rest), exp: num(BigInt(k) - r, k) });
    }
  }
  // Two radicals of numbers (a numerator's and a denominator's) multiply into one.
  if (factors.length === 2) {
    const [a, b2] = factors as Array<{
      t: "pow";
      base: { t: "num"; v: Q };
      exp: { t: "num"; v: Q };
    }>;
    if (qeq(a.exp.v, b2.exp.v)) return mul(numQ(coef), pow(numQ(qmul(a.base.v, b2.base.v)), a.exp));
  }
  if (factors.length === 0) return numQ(coef);
  return qeq(coef, q(1)) && factors.length === 1
    ? factors[0]
    : { t: "mul", factors: qeq(coef, q(1)) ? factors : [numQ(coef), ...factors] };
}

/** A function of an expression, with its exact values (sin(π/6) = 1/2, ln(e) = 1, ln(1) = 0). */
export function fn(name: FnName, arg: Expr): Expr {
  const exact = exactValue(name, arg);
  if (exact) return exact;
  return { t: "fn", name, arg };
}

/** sin, cos and tan of whole multiples of π/12 that have a short exact form, and their inverses. */
const TRIG_TABLE: ReadonlyArray<[Q, Expr, Expr]> = [
  // [x/π, sin x, cos x] for x in [0, π/2].
  [q(0), ZERO, ONE],
  [q(1, 6), num(1, 2), mul(num(1, 2), sqrt(num(3)))],
  [q(1, 4), mul(num(1, 2), sqrt(num(2))), mul(num(1, 2), sqrt(num(2)))],
  [q(1, 3), mul(num(1, 2), sqrt(num(3))), num(1, 2)],
  [q(1, 2), ONE, ZERO],
];

/** The multiple of π that `e` is (π/6 → 1/6, 0 → 0), or null. */
export function piMultiple(e: Expr): Q | null {
  if (isNum(e, 0)) return q(0);
  if (e.t === "sym" && e.name === "pi") return q(1);
  if (e.t === "mul" && e.factors.length === 2 && e.factors[0].t === "num") {
    const second = e.factors[1];
    if (second.t === "sym" && second.name === "pi") return e.factors[0].v;
  }
  return null;
}

/** sin and cos of t·π exactly, or null when t is not in the table. */
export function exactTrig(t: Q): { sin: Expr; cos: Expr } | null {
  // Reduce to [0, 2): sin and cos have period 2π.
  const two = q(2);
  let r = q(t.n % (2n * t.d), t.d);
  if (r.n < 0n) r = qadd(r, two);
  // Fold into the first quadrant, remembering the signs.
  let sinSign = 1;
  let cosSign = 1;
  if (qcmp(r, q(1)) >= 0) {
    r = qsub(r, q(1));
    sinSign = -1;
    cosSign = -1;
  }
  if (qcmp(r, q(1, 2)) > 0) {
    r = qsub(q(1), r);
    cosSign = -cosSign;
  }
  const row = TRIG_TABLE.find(([at]) => qeq(at, r));
  if (!row) return null;
  return {
    sin: sinSign < 0 ? neg(row[1]) : row[1],
    cos: cosSign < 0 ? neg(row[2]) : row[2],
  };
}

function exactValue(name: FnName, arg: Expr): Expr | null {
  switch (name) {
    case "ln":
      if (isNum(arg, 1)) return ZERO;
      if (arg.t === "sym" && arg.name === "e") return ONE;
      if (arg.t === "pow" && arg.base.t === "sym" && arg.base.name === "e") return arg.exp;
      return null;
    case "log":
      if (isNum(arg, 1)) return ZERO;
      if (arg.t === "num" && qint(arg.v) && arg.v.n > 0n) {
        const digits = arg.v.n.toString();
        if (/^10*$/.test(digits)) return num(digits.length - 1);
      }
      if (arg.t === "pow" && isNum(arg.base, 10)) return arg.exp;
      return null;
    case "abs":
      if (arg.t === "num") return numQ({ n: babs(arg.v.n), d: arg.v.d });
      if (arg.t === "sym" && (arg.name === "pi" || arg.name === "e")) return arg;
      return null;
    case "sin":
    case "cos":
    case "tan": {
      const t = piMultiple(arg);
      if (!t) return null;
      const exact = exactTrig(t);
      if (!exact) return null;
      if (name === "sin") return exact.sin;
      if (name === "cos") return exact.cos;
      if (isNum(exact.cos, 0)) throw new AlgebraError("tan is undefined there");
      return div(exact.sin, exact.cos);
    }
    case "asin":
    case "acos":
    case "atan": {
      for (const [at, s, c] of TRIG_TABLE) {
        const value = name === "asin" ? s : name === "acos" ? c : isNum(c, 0) ? null : div(s, c);
        if (value && equal(value, arg)) return mul(numQ(at), PI);
        if (value && name !== "acos" && !isNum(value, 0) && equal(neg(value), arg))
          return mul(numQ(qneg(at)), PI);
        if (value && name === "acos" && !isNum(value, 0) && equal(neg(value), arg))
          return mul(numQ(qsub(q(1), at)), PI);
      }
      return null;
    }
    default:
      return null;
  }
}

export const d = (arg: Expr, v = "x"): Expr => ({ t: "d", arg, v });
export const integral = (arg: Expr, v = "x"): Expr => ({ t: "int", arg, v });

// --- Order ------------------------------------------------------------------------

/** How a term ranks in a sum: by its degree in x (highest first), then by text. */
function degree(e: Expr): number {
  if (e.t === "sym") return e.name === "x" ? 1 : 0;
  if (e.t === "pow" && e.base.t === "sym" && e.base.name === "x" && e.exp.t === "num")
    return qnum(e.exp.v);
  if (e.t === "mul") return e.factors.reduce((s, f) => s + degree(f), 0);
  return 0;
}

/** Whether `e` has a letter other than x, π and e (a parameter such as k). */
function hasParameter(e: Expr): boolean {
  return nodes(e).some((n) => n.t === "sym" && !["x", "pi", "e"].includes(n.name));
}

function compareTerms(a: Expr, b: Expr): number {
  // The constant of integration always last.
  const ca = a.t === "sym" && a.name === "C" ? 1 : 0;
  const cb = b.t === "sym" && b.name === "C" ? 1 : 0;
  if (ca !== cb) return ca - cb;
  const da = degree(a);
  const db = degree(b);
  if (da !== db) return db - da;
  const fa = free(a, "x") ? 1 : 0;
  const fb = free(b, "x") ? 1 : 0;
  if (fa !== fb) return fa - fb;
  // Terms with a parameter (2πk) after those without (π/6).
  const pa = hasParameter(a) ? 1 : 0;
  const pb = hasParameter(b) ? 1 : 0;
  if (pa !== pb) return pa - pb;
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** Factors in a product: numbers, then constants (π, e, letters), then x, then functions and brackets. */
function factorRank(e: Expr): number {
  const base = e.t === "pow" ? e.base : e;
  if (base.t === "num") return 0;
  if (base.t === "sym") {
    if (base.name === "pi") return 1;
    if (base.name === "e") return 4;
    if (base.name === "x") return 3;
    return 2;
  }
  if (base.t === "fn") return 5;
  if (base.t === "d" || base.t === "int") return 7;
  return 6;
}

function compareFactors(a: Expr, b: Expr): number {
  const ra = factorRank(a);
  const rb = factorRank(b);
  if (ra !== rb) return ra - rb;
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

// --- Reading ------------------------------------------------------------------------

/** A canonical text for `e`, for comparing and as a map key. */
export function key(e: Expr): string {
  switch (e.t) {
    case "num":
      return e.v.d === 1n ? `${e.v.n}` : `${e.v.n}/${e.v.d}`;
    case "sym":
      return e.name;
    case "add":
      return `(+ ${e.terms.map(key).join(" ")})`;
    case "mul":
      return `(* ${e.factors.map(key).join(" ")})`;
    case "pow":
      return `(^ ${key(e.base)} ${key(e.exp)})`;
    case "fn":
      return `(${e.name} ${key(e.arg)})`;
    case "d":
      return `(d/d${e.v} ${key(e.arg)})`;
    case "int":
      return `(int d${e.v} ${key(e.arg)})`;
  }
}

export const equal = (a: Expr, b: Expr): boolean => key(a) === key(b);

/** Whether `v` does not occur in `e`. */
export function free(e: Expr, v: string): boolean {
  switch (e.t) {
    case "num":
      return true;
    case "sym":
      return e.name !== v;
    case "add":
      return e.terms.every((t) => free(t, v));
    case "mul":
      return e.factors.every((f) => free(f, v));
    case "pow":
      return free(e.base, v) && free(e.exp, v);
    case "fn":
    case "d":
    case "int":
      return free(e.arg, v);
  }
}

/** Every node of `e`, parents first. */
export function nodes(e: Expr): Expr[] {
  const out: Expr[] = [e];
  switch (e.t) {
    case "add":
      for (const t of e.terms) out.push(...nodes(t));
      break;
    case "mul":
      for (const f of e.factors) out.push(...nodes(f));
      break;
    case "pow":
      out.push(...nodes(e.base), ...nodes(e.exp));
      break;
    case "fn":
    case "d":
    case "int":
      out.push(...nodes(e.arg));
      break;
  }
  return out;
}

/** `e` rebuilt bottom-up with `visit` applied to each node after its children (and simplified). */
export function rebuild(e: Expr, visit: (e: Expr) => Expr = (x) => x): Expr {
  switch (e.t) {
    case "num":
    case "sym":
      return visit(e);
    case "add":
      return visit(add(...e.terms.map((t) => rebuild(t, visit))));
    case "mul":
      return visit(mul(...e.factors.map((f) => rebuild(f, visit))));
    case "pow":
      return visit(pow(rebuild(e.base, visit), rebuild(e.exp, visit)));
    case "fn":
      return visit(fn(e.name, rebuild(e.arg, visit)));
    case "d":
      return visit({ t: "d", arg: rebuild(e.arg, visit), v: e.v });
    case "int":
      return visit({ t: "int", arg: rebuild(e.arg, visit), v: e.v });
  }
}

/** `e` with every occurrence of `target` (a letter or any subexpression) replaced by `by`. */
export function replace(e: Expr, target: Expr, by: Expr): Expr {
  const k = key(target);
  const walk = (node: Expr): Expr => {
    if (key(node) === k) return by;
    switch (node.t) {
      case "num":
      case "sym":
        return node;
      case "add":
        return add(...node.terms.map(walk));
      case "mul":
        return mul(...node.factors.map(walk));
      case "pow":
        return pow(walk(node.base), walk(node.exp));
      case "fn":
        return fn(node.name, walk(node.arg));
      case "d":
        return { t: "d", arg: walk(node.arg), v: node.v };
      case "int":
        return { t: "int", arg: walk(node.arg), v: node.v };
    }
  };
  return walk(e);
}

export const substitute = (e: Expr, v: string, by: Expr): Expr => replace(e, sym(v), by);

/** How many nodes `e` has: a bound on work. */
export function size(e: Expr): number {
  return nodes(e).length;
}

/** `e` in floats, with the letters given (π and e known); NaN where it is undefined. */
export function evaluate(e: Expr, vars: ReadonlyMap<string, number> = new Map()): number {
  switch (e.t) {
    case "num":
      return qnum(e.v);
    case "sym": {
      const v = vars.get(e.name);
      if (v !== undefined) return v;
      if (e.name === "pi") return Math.PI;
      if (e.name === "e") return Math.E;
      return NaN;
    }
    case "add":
      return e.terms.reduce((s, t) => s + evaluate(t, vars), 0);
    case "mul":
      return e.factors.reduce((s, f) => s * evaluate(f, vars), 1);
    case "pow": {
      const b = evaluate(e.base, vars);
      const x = evaluate(e.exp, vars);
      // An odd root of a negative number is real.
      if (b < 0 && e.exp.t === "num" && !qint(e.exp.v) && e.exp.v.d % 2n === 1n) {
        const r = Math.pow(-b, x);
        return e.exp.v.n % 2n === 0n ? r : -r;
      }
      return Math.pow(b, x);
    }
    case "fn": {
      const a = evaluate(e.arg, vars);
      switch (e.name) {
        case "sin":
          return Math.sin(a);
        case "cos":
          return Math.cos(a);
        case "tan":
          return Math.tan(a);
        case "sec":
          return 1 / Math.cos(a);
        case "csc":
          return 1 / Math.sin(a);
        case "cot":
          return 1 / Math.tan(a);
        case "asin":
          return Math.asin(a);
        case "acos":
          return Math.acos(a);
        case "atan":
          return Math.atan(a);
        case "sinh":
          return Math.sinh(a);
        case "cosh":
          return Math.cosh(a);
        case "tanh":
          return Math.tanh(a);
        case "ln":
          return a > 0 ? Math.log(a) : NaN;
        case "log":
          return a > 0 ? Math.log10(a) : NaN;
        case "abs":
          return Math.abs(a);
      }
      return NaN;
    }
    case "d":
    case "int":
      return NaN;
  }
}

// --- Writing ------------------------------------------------------------------------

const NAMES: Readonly<Record<string, string>> = { pi: "π" };

/** Whether a term is shown with a leading minus (a negative number or coefficient). */
export function isNegative(e: Expr): boolean {
  if (e.t === "num") return e.v.n < 0n;
  return e.t === "mul" && e.factors[0].t === "num" && e.factors[0].v.n < 0n;
}

/** `e` in the calculator's syntax, which the natural display lays out. */
export function print(e: Expr): string {
  switch (e.t) {
    case "num":
      return e.v.d === 1n ? `${e.v.n}` : `${e.v.n}/${e.v.d}`;
    case "sym":
      return NAMES[e.name] ?? e.name;
    case "add": {
      let out = print(e.terms[0]);
      for (const term of e.terms.slice(1)) {
        out += isNegative(term) ? ` - ${print(neg(term))}` : ` + ${print(term)}`;
      }
      return out;
    }
    case "mul":
      return printProduct(e.factors);
    case "pow":
      if (e.exp.t === "num" && e.exp.v.n < 0n) return printProduct([e]);
      return printPower(e.base, e.exp);
    case "fn":
      return `${e.name}(${print(e.arg)})`;
    case "d":
      return e.v === "x" ? `d/dx(${print(e.arg)})` : `d/dx(${print(e.arg)})`;
    case "int":
      return e.v === "x" ? `∫(${print(e.arg)})` : `∫(${print(e.arg)}, ${e.v})`;
  }
}

/** An operand of a product or power: bracketed when it is a sum or a fraction. */
function atom(e: Expr): string {
  if (e.t === "add") return `(${print(e)})`;
  if (e.t === "num" && (e.v.d !== 1n || e.v.n < 0n)) return `(${print(e)})`;
  if (e.t === "mul" || (e.t === "pow" && e.exp.t === "num" && e.exp.v.n < 0n))
    return `(${print(e)})`;
  return print(e);
}

function printPower(base: Expr, exp: Expr): string {
  if (exp.t === "num" && qeq(exp.v, q(1, 2))) {
    const inner = print(base);
    return base.t === "num" || base.t === "sym" ? `√${inner}` : `√(${inner})`;
  }
  if (exp.t === "num" && exp.v.n === 1n && exp.v.d > 2n) {
    return `root(${print(base)}, ${exp.v.d})`;
  }
  const b = base.t === "pow" || base.t === "fn" ? `(${print(base)})` : atom(base);
  const x = exp.t === "num" && qint(exp.v) && exp.v.n >= 0n ? print(exp) : `(${print(exp)})`;
  return `${b}^${x}`;
}

function printProduct(factors: readonly Expr[]): string {
  let coef = q(1);
  const top: Expr[] = [];
  const bottom: Expr[] = [];
  for (const f of factors) {
    if (f.t === "num") coef = qmul(coef, f.v);
    else if (f.t === "pow" && f.exp.t === "num" && f.exp.v.n < 0n)
      bottom.push(pow(f.base, numQ(qneg(f.exp.v))));
    else top.push(f);
  }
  const sign = coef.n < 0n ? "-" : "";
  const n = babs(coef.n);
  const parts: string[] = [];
  if (n !== 1n || top.length === 0) parts.push(`${n}`);
  for (const f of top) parts.push(atom(f));
  // Juxtaposed, as written by hand: 2x, x sin(x), 3(x + 1).
  let numerator = "";
  for (const part of parts) {
    // A letter or digit before a letter would run into it (x^2 cos, 2x sin): a space there.
    const glue =
      !/^[0-9]*$/.test(numerator) && /[A-Za-z0-9]$/.test(numerator) && /^[A-Za-z]/.test(part)
        ? " "
        : "";
    numerator += glue + part;
  }
  if (coef.d !== 1n) bottom.unshift(num(coef.d));
  if (bottom.length === 0) return `${sign}${numerator}`;
  const den = bottom.map((b) => atom(b)).join(" ");
  const denominator = bottom.length > 1 || den.includes(" ") ? `(${den})` : den;
  return `${sign}${numerator}/${denominator}`;
}

/** `e` as plain text for a step's caption: x², √3, π, 2x + 1. */
export function plain(e: Expr): string {
  const superscripts: Record<string, string> = {
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
  return print(e)
    .replace(/\^([0-9]+)/g, (_m, digits: string) =>
      [...digits].map((c) => superscripts[c] ?? c).join(""),
    )
    .replace(/-/g, "−")
    .replace(/\babs\(([^()]*)\)/g, "|$1|");
}
