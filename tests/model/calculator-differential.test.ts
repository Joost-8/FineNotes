/**
 * Differential tests: the calculator's engine against math.js (Apache-2.0)
 * and fraction.js (MIT), both devDependencies only and never bundled.
 *
 * Random expressions are generated from a seeded grammar (so a failure
 * repeats), written once in the calculator's syntax and once in math.js's,
 * and the two answers compared. math.js runs on 64-digit BigNumbers, so a
 * difference is ours unless it is a known, deliberate one (listed where it
 * is excused). Exact arithmetic is compared to fraction.js value for value.
 */

import Fraction from "fraction.js";
import { all, create } from "mathjs";
import { describe, expect, it } from "vitest";
import { evaluate, isRational, toFloat } from "../../src/model/calculator";

const big = create(all, { number: "BigNumber", precision: 64, predictable: true });
/** math.js in doubles, as ours computes once a value is irrational. */
const double = create(all, { number: "number", predictable: true });

/** A small seeded generator (mulberry32), so every run sees the same expressions. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pair {
  ours: string;
  theirs: string;
}

const pair = (ours: string, theirs = ours): Pair => ({ ours, theirs });
const wrap = (p: Pair): Pair => pair(`(${p.ours})`, `(${p.theirs})`);

/**
 * A random expression `depth` levels deep, in both syntaxes. `tame` keeps
 * the huge literals out: inside sin or mod they lose their last digits in
 * doubles before either engine sees them.
 */
function generate(rand: () => number, depth: number, tame = false): Pair {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  if (depth <= 0 || rand() < 0.25) {
    switch (int(0, 6)) {
      case 0:
      case 1:
        return pair(`${int(0, 12)}`);
      case 2:
        return pair(pick(["2.5", "0.125", "0.1", "3.75", "1.5"]));
      case 3:
        return pair(pick(tame ? ["3E-7", "2.5E-4"] : ["1E12", "4.5E9", "3E-7", "2.5E-4"]));
      case 4:
        return pair("π", "pi");
      case 5:
        return pair("e");
      default:
        return pair(`${int(1, 9)}`);
    }
  }
  const a = generate(rand, depth - 1, tame);
  switch (int(1, 13)) {
    case 1: {
      const b = generate(rand, depth - 1, tame);
      return pair(`${a.ours}+${b.ours}`, `${a.theirs}+${b.theirs}`);
    }
    case 2: {
      const b = generate(rand, depth - 1, tame);
      return pair(`${a.ours}-${b.ours}`, `${a.theirs}-${b.theirs}`);
    }
    case 3: {
      const b = generate(rand, depth - 1, tame);
      return pair(`${a.ours}×${b.ours}`, `${a.theirs}*${b.theirs}`);
    }
    case 4: {
      const b = generate(rand, depth - 1, tame);
      return pair(`${a.ours}÷${wrap(b).ours}`, `${a.theirs}/${wrap(b).theirs}`);
    }
    case 5: {
      // Integer powers only: a negative base to a fractional power is a known difference.
      const k = int(-3, 4);
      const w = wrap(a);
      return pair(`${w.ours}^${k < 0 ? `(${k})` : k}`, `${w.theirs}^${k < 0 ? `(${k})` : k}`);
    }
    case 6: {
      // Implicit multiplication: number by bracket, number by constant.
      const n = int(2, 9);
      return rand() < 0.5 ? pair(`${n}(${a.ours})`, `${n}(${a.theirs})`) : pair(`${n}π`, `${n} pi`);
    }
    case 7:
      return pair(`-${wrap(a).ours}`, `-${wrap(a).theirs}`);
    case 8: {
      const f = pick(["sin", "cos", "tan", "atan", "abs", "sqrt"] as const);
      const t = ["sin", "cos", "tan"].includes(f) ? generate(rand, depth - 1, true) : a;
      const arg = f === "sqrt" ? `abs(${t.ours})` : t.ours;
      const argTheirs = f === "sqrt" ? `abs(${t.theirs})` : t.theirs;
      return pair(`${f}(${arg})`, `${f}(${argTheirs})`);
    }
    case 9: {
      const v = pick(["0.5", "-0.5", "0.25", "1", "-1", "0", "0.9"]);
      const f = pick(["asin", "acos"]);
      return pair(`${f}(${v})`);
    }
    case 10: {
      // Logarithms of something positive.
      const pos = pair(`abs(${a.ours})+1`, `abs(${a.theirs})+1`);
      const which = int(0, 2);
      if (which === 0) return pair(`ln(${pos.ours})`, `log(${pos.theirs})`);
      if (which === 1) return pair(`log(${pos.ours})`, `log10(${pos.theirs})`);
      const b = int(2, 10);
      return pair(`log(${pos.ours}, ${b})`, `log(${pos.theirs}, ${b})`);
    }
    case 11: {
      const n = int(0, 20);
      const r = int(0, n);
      return pick([
        pair(`nCr(${n},${r})`, `combinations(${n},${r})`),
        pair(`nPr(${n},${r})`, `permutations(${n},${r})`),
        pair(`(${int(0, 15)})!`),
      ]);
    }
    case 12: {
      const b = int(1, 9) * (rand() < 0.5 ? -1 : 1);
      const t = generate(rand, depth - 1, true);
      return pick([
        // A dividend of at least 1: math.js snaps mod(1e-29, -2) to 1e-29 (pinned below).
        pair(`mod(abs(${t.ours})+1, ${b})`, `mod(abs(${t.theirs})+1, ${b})`),
        pair(`round(${a.ours})`, `round(${a.theirs})`),
        pair(`round(${a.ours}, 2)`, `round(${a.theirs}, 2)`),
        pair(`root(abs(${a.ours}), ${-b})`, `nthRoot(abs(${a.theirs}), ${-b})`),
      ]);
    }
    default: {
      const w = wrap(a);
      return pair(`${w.ours}%`, `${w.theirs}/100`);
    }
  }
}

/** math.js's answer as a number: NaN when it has none, ±Infinity when it overflows. */
function reference(expr: string, engine = big): number {
  try {
    const value: unknown = engine.evaluate(expr);
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && "toNumber" in value) {
      return (value as { toNumber(): number }).toNumber();
    }
    if (typeof value === "boolean") return Number(value);
    return Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/** Why `ours` and `theirs` disagree, or null when they agree (within float noise). */
function disagreement(expr: Pair, angle: "deg" | "rad" = "rad"): string | null {
  const ours = evaluate(expr.ours, { angle });
  const theirs = reference(expr.theirs);
  const theirsFinite = Number.isFinite(theirs);
  if (!ours.ok) {
    // Agreeing in kind: math.js has no number, or one at a pole or past the float range.
    if (!theirsFinite || Math.abs(theirs) > 1e11) return null;
    // Our exact zero where math.js's floats land 1e-16 off it (1/sin(π)).
    if (ours.error === "Divide by zero") return null;
    return `ours: ${ours.error}, math.js: ${theirs}`;
  }
  const v = toFloat(ours.value);
  if (!theirsFinite) {
    // Our exact value past the float range, which math.js's BigNumber also overflows.
    if (isRational(ours.value) && !Number.isFinite(v)) return null;
    return `ours: ${v}, math.js: ${theirs}`;
  }
  if (!Number.isFinite(v))
    return Math.abs(theirs) > 1e300 ? null : `ours: ${v}, math.js: ${theirs}`;
  const close = (x: number): boolean => Math.abs(v - x) <= 1e-9 * Math.max(1, Math.abs(x));
  if (close(theirs)) return null;
  // The same doubles math.js would use: a huge argument to tan or mod has
  // lost its last digits before either engine sees it (tan(4.5E9×e)).
  if (close(reference(expr.theirs, double))) return null;
  return `ours: ${v}, math.js: ${theirs}`;
}

describe("differential: the engine against math.js", () => {
  it("agrees on 3000 random expressions", () => {
    const rand = random(20261019);
    const failures: string[] = [];
    let answered = 0;
    for (let i = 0; i < 3000; i++) {
      const expr = generate(rand, 1 + Math.floor(rand() * 4));
      const why = disagreement(expr);
      if (why) failures.push(`${expr.ours}  |  ${expr.theirs}  →  ${why}`);
      if (evaluate(expr.ours).ok) answered++;
    }
    expect(failures.slice(0, 10), `${failures.length} disagreements`).toEqual([]);
    // Not vacuous: most expressions have an answer to compare.
    expect(answered).toBeGreaterThan(2400);
  });

  it.each([
    // Precedence and associativity, as math.js reads them.
    ["-2^2", "-2^2"],
    ["2^3^2", "2^3^2"],
    ["2^-1", "2^-1"],
    ["-3!", "-3!"],
    ["8÷2(2+2)", "8/2(2+2)"],
    ["1÷2π", "1/2 pi"],
    ["2π÷3", "2 pi / 3"],
    ["2(3)(4)", "2(3)(4)"],
    ["(1+2)(3+4)", "(1+2)(3+4)"],
    ["3--2", "3--2"],
    ["50%", "50/100"],
    ["200×10%", "200*10/100"],
    // Rounding and remainders.
    ["round(2.5)", "round(2.5)"],
    ["round(-2.5)", "round(-2.5)"],
    ["round(1.005, 2)", "round(1.005, 2)"],
    ["mod(-7, 3)", "mod(-7, 3)"],
    ["mod(7, -3)", "mod(7, -3)"],
    ["mod(7.5, 2)", "mod(7.5, 2)"],
    // Magnitudes.
    ["1E300×1E8", "1e300*1e8"],
    ["3E-300÷7", "3e-300/7"],
    ["2^200", "2^200"],
    ["170!", "170!"],
    ["0.1+0.2-0.3", "0.1+0.2-0.3"],
    ["(1E12+0.1)-1E12", "(1e12+0.1)-1e12"],
    // Functions at their edges.
    ["0^0", "0^0"],
    ["nCr(52, 5)", "combinations(52, 5)"],
    ["nPr(10, 0)", "permutations(10, 0)"],
    ["root(32, 5)", "nthRoot(32, 5)"],
    ["log(1E-300)", "log10(1e-300)"],
    ["ln(1E300)", "log(1e300)"],
    ["atan(1E20)", "atan(1e20)"],
    ["sqrt(1E-20)", "sqrt(1e-20)"],
  ])("%s agrees with math.js's %s", (ours, theirs) => {
    expect(disagreement({ ours, theirs })).toBeNull();
  });

  it("agrees on trig in degrees", () => {
    const rand = random(7);
    const angles = [
      0, 15, 30, 45, 60, 90, 120, 135, 150, 180, 210, 270, 300, 330, 360, -45, -390, 720,
    ];
    for (let i = 0; i < 40; i++) angles.push(Math.round((rand() * 1440 - 720) * 1000) / 1000);
    const failures: string[] = [];
    for (const a of angles) {
      for (const f of ["sin", "cos", "tan"]) {
        const why = disagreement({ ours: `${f}(${a})`, theirs: `${f}((${a}) * pi / 180)` }, "deg");
        if (why) failures.push(`${f}(${a}°): ${why}`);
      }
    }
    for (const v of [-1, -0.5, 0, 0.25, 0.5, 0.75, 1]) {
      for (const f of ["asin", "acos", "atan"]) {
        const why = disagreement({ ours: `${f}(${v})`, theirs: `${f}(${v}) * 180 / pi` }, "deg");
        if (why) failures.push(`${f}(${v}) in degrees: ${why}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("refuses what math.js has no real answer for", () => {
    for (const [ours, theirs] of [
      ["sqrt(-4)", "sqrt(-4)"],
      ["ln(0)", "log(0)"],
      ["ln(-1)", "log(-1)"],
      ["asin(2)", "asin(2)"],
      ["1÷0", "1/0"],
      ["0÷0", "0/0"],
      ["log(5, 1)", "log(5, 1)"],
    ]) {
      expect(evaluate(ours).ok, ours).toBe(false);
      expect(Number.isFinite(reference(theirs)), theirs).toBe(false);
    }
  });

  it("differs from math.js only where it means to", () => {
    // n! of a non-integer: math.js (numbers) gives Γ(n+1); a calculator refuses.
    expect(evaluate("2.5!").ok).toBe(false);
    // A negative number to an odd root's power is real here (as on a calculator).
    expect(evaluate("(-8)^(1/3)")).toMatchObject({ ok: true, value: { n: -2n, d: 1n } });
    // mod is floored at every size; math.js snaps a quotient near 0 to 0.
    expect(toFloat((evaluate("mod(1E-29, -2)") as { value: number }).value)).toBe(-2);
    expect(reference("mod(1e-29, -2)")).toBe(1e-29);
    expect(reference("mod(0.5, -2)")).toBe(-1.5);
    // log is base ten here, natural in math.js.
    expect(toFloat((evaluate("log(100)") as { value: number }).value)).toBe(2);
  });
});

describe("differential: exact fractions against fraction.js", () => {
  /** A random rational expression and its value by fraction.js. */
  function rationalCase(rand: () => number, depth: number): { expr: string; value: Fraction } {
    const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
    if (depth <= 0 || rand() < 0.3) {
      if (rand() < 0.3) {
        const text = `${int(0, 99)}.${int(0, 999)}`;
        return { expr: text, value: new Fraction(text) };
      }
      const n = int(0, 40);
      return { expr: `${n}`, value: new Fraction(n) };
    }
    const a = rationalCase(rand, depth - 1);
    const b = rationalCase(rand, depth - 1);
    switch (int(0, 5)) {
      case 0:
        return { expr: `(${a.expr})+(${b.expr})`, value: a.value.add(b.value) };
      case 1:
        return { expr: `(${a.expr})-(${b.expr})`, value: a.value.sub(b.value) };
      case 2:
        return { expr: `(${a.expr})×(${b.expr})`, value: a.value.mul(b.value) };
      case 3:
        if (b.value.valueOf() === 0) return a;
        return { expr: `(${a.expr})÷(${b.expr})`, value: a.value.div(b.value) };
      case 4: {
        const k = int(-3, 3);
        if (k < 0 && a.value.valueOf() === 0) return a;
        return { expr: `(${a.expr})^(${k})`, value: a.value.pow(k) };
      }
      default:
        return { expr: `-(${a.expr})`, value: a.value.neg() };
    }
  }

  it("matches value for value on 2000 random rational expressions", () => {
    const rand = random(1729);
    const failures: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const { expr, value } = rationalCase(rand, 1 + Math.floor(rand() * 4));
      const ours = evaluate(expr);
      if (!ours.ok || !isRational(ours.value)) {
        failures.push(`${expr}: ours ${ours.ok ? "a float" : ours.error}`);
        continue;
      }
      const want = `${value.s * value.n}/${value.d}`;
      const got = `${ours.value.n}/${ours.value.d}`;
      if (got !== want) failures.push(`${expr}: ours ${got}, fraction.js ${want}`);
    }
    expect(failures.slice(0, 10), `${failures.length} disagreements`).toEqual([]);
  });

  it("matches on mod, round and roots of exact squares", () => {
    const cases: Array<[string, Fraction]> = [
      ["mod(17/3, 2)", new Fraction(17, 3).mod(2)],
      ["mod(-7/2, 3)", new Fraction(5, 2)],
      ["round(7/3, 2)", new Fraction(233, 100)],
      ["sqrt(49/64)", new Fraction(7, 8)],
      ["root(-27/125, 3)", new Fraction(-3, 5)],
      ["(9/4)^(3/2)", new Fraction(27, 8)],
    ];
    for (const [expr, want] of cases) {
      const ours = evaluate(expr);
      expect(ours.ok && isRational(ours.value) && `${ours.value.n}/${ours.value.d}`, expr).toBe(
        `${want.s * want.n}/${want.d}`,
      );
    }
  });
});
