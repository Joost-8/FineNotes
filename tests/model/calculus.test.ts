import { describe, expect, it } from "vitest";
import { derivative, integrate, solveIn, solveNear } from "../../src/model/calculus";
import { calculate, compileFunction, usesVariable } from "../../src/model/calculator";

const value = (r: { ok: true; value: number } | { ok: false; error: string }): number | string =>
  r.ok ? r.value : r.error;

/** |got − want| within `tol` of a successful result; the error text otherwise. */
function near(r: { ok: true; value: number } | { ok: false; error: string }, want: number): number {
  if (!r.ok) throw new Error(r.error);
  return Math.abs(r.value - want);
}

function show(expr: string, angle: "deg" | "rad" = "rad"): string {
  const r = calculate(expr, { angle });
  return r.ok ? r.text : `! ${r.error}`;
}

describe("derivative", () => {
  it("is accurate on smooth functions", () => {
    expect(value(derivative((x) => x * x, 3))).toBe(6);
    expect(value(derivative(Math.sin, 0))).toBe(1);
    expect(near(derivative(Math.exp, 2), Math.exp(2))).toBeLessThan(1e-9);
    expect(
      near(
        derivative((x) => x ** 3, 1000),
        3e6,
      ) / 3e6,
    ).toBeLessThan(1e-9);
  });

  it("refuses corners, jumps, poles and non-finite points", () => {
    expect(value(derivative(Math.abs, 0))).toBe("Not differentiable here");
    expect(value(derivative((x) => (x < 0 ? 0 : 1), 0))).toBe("Not differentiable here");
    expect(value(derivative((x) => 1 / x, 0))).toBe("Not differentiable here");
    expect(value(derivative(Math.sqrt, -1))).toBe("Not differentiable here");
    expect(value(derivative(Math.sin, Number.NaN))).toBe("Not a real number");
  });
});

describe("integrate", () => {
  it("integrates smooth and endpoint-singular functions", () => {
    expect(value(integrate((x) => x * x, 0, 3))).toBe(9);
    expect(near(integrate(Math.sin, 0, Math.PI), 2)).toBeLessThan(1e-12);
    expect(
      near(
        integrate((x) => 1 / Math.sqrt(x), 0, 1),
        2,
      ),
    ).toBeLessThan(1e-7);
    expect(
      near(
        integrate((x) => Math.exp(-x * x), -10, 10),
        Math.sqrt(Math.PI),
      ),
    ).toBeLessThan(1e-10);
    expect(
      near(
        integrate((x) => Math.sin(50 * x), 0, Math.PI),
        0,
      ),
    ).toBeLessThan(1e-9);
  });

  it("handles reversed and empty ranges", () => {
    expect(value(integrate((x) => x, 2, 0))).toBe(-2);
    expect(value(integrate((x) => x, 1, 1))).toBe(0);
  });

  it("says so when it does not converge", () => {
    expect(value(integrate((x) => 1 / x, -1, 1))).toBe("Integral does not converge");
    expect(value(integrate((x) => 1 / (x * x), 0, 1))).toBe("Integral does not converge");
    expect(value(integrate(() => Number.NaN, 0, 1))).toBe("Integral does not converge");
    expect(value(integrate((x) => x, 0, Number.POSITIVE_INFINITY))).toBe("Limits must be finite");
  });
});

describe("solve", () => {
  it("finds the root nearest the guess", () => {
    expect(value(solveNear((x) => x * x - 4, 1))).toBe(2);
    expect(value(solveNear((x) => x * x - 4, -1))).toBe(-2);
    expect(value(solveNear((x) => x * x - 4, 2))).toBe(2);
    expect(near(solveNear(Math.cos, 1), Math.PI / 2)).toBeLessThan(1e-12);
    // A double root has no sign change: Newton finds it.
    expect(
      near(
        solveNear((x) => (x - 3) ** 2, 0),
        3,
      ),
    ).toBeLessThan(1e-6);
    expect(value(solveNear((x) => x - 1e6, 0))).toBe(1e6);
  });

  it("does not take a pole for a root", () => {
    expect(solveNear((x) => 1 / x, 0.5).ok).toBe(false);
  });

  it("reports when there is none", () => {
    expect(value(solveNear((x) => x * x + 1, 0))).toBe("No root found");
    expect(value(solveIn((x) => x * x + 1, -5, 5))).toBe("No root found in range");
    expect(value(solveIn((x) => x - 10, 0, 5))).toBe("No root found in range");
    expect(value(solveNear(Math.sin, Number.NaN))).toBe("Not a real number");
    expect(value(solveIn(Math.sin, 0, Number.NaN))).toBe("Limits must be finite");
  });

  it("solves inside a range, either way round", () => {
    expect(near(solveIn(Math.sin, 2, 4), Math.PI)).toBeLessThan(1e-12);
    expect(near(solveIn(Math.sin, 4, 2), Math.PI)).toBeLessThan(1e-12);
  });
});

describe("calculus in the calculator", () => {
  it.each([
    ["d/dx(x^2, 3)", "6"],
    ["d/dx(sin(x), 0)", "1"],
    ["diff(x^3, 2)", "12"],
    ["∫(x^2, 0, 3)", "9"],
    ["int(1/x, 1, e)", "1"],
    ["∫(sin(x), 0, π)", "2"],
    ["Σ(x, 1, 100)", "5050"],
    ["Σ(i^2, i, 1, 10)", "385"],
    ["Σ(1/k, k, 1, 4)", "2.08333333333"],
    ["∑(2^n, n, 0, 10)", "2047"],
    ["Σ(1/x^2, 1, 100000)", "1.6449240669"],
    ["Σ(x, 5, 1)", "0"],
    ["solve(x^2-2, 1)", "1.41421356237"],
    ["solve(x^2-2, -5, 0)", "-1.41421356237"],
    ["solve(cos(x)-x, 0)", "0.739085133215"],
    ["2·∫(x, 0, 1)", "1"],
    ["d/dx(t·x, 5)", "! Unknown name: t"],
  ])("%s = %s", (expr, want) => {
    expect(show(expr)).toBe(want);
  });

  it("respects degrees inside calculus", () => {
    expect(show("solve(sin(x)-0.5, 20)", "deg")).toBe("30");
  });

  it("explains bad calculus input", () => {
    expect(show("Σ(x, 1.5, 3)")).toBe("! Σ counts in whole numbers");
    expect(show("Σ(x, 2, 1, 3)")).toBe("! Σ needs a letter to count with");
    expect(show("Σ(x, 1, 2000000)")).toBe("! Too many terms");
    expect(show("d/dx(x)")).toBe("! d/dx(f) is a function: d/dx(f, a) is its slope at a");
    expect(show("∫(x)")).toBe("! ∫(f) is a function: ∫(f, a, b) is a number");
    expect(show("∫(1/x, -1, 1)")).toBe("! Integral does not converge");
    expect(show("solve(x^2+1, 0)")).toBe("! No root found");
    expect(show("x+1")).toBe("! Unknown name: x");
  });

  it("keeps short sums exact", () => {
    const r = calculate("Σ(1/i, i, 1, 3)", {}, { fractions: true });
    expect(r.ok && r.text).toBe("11/6");
  });
});

describe("compileFunction", () => {
  it("compiles y = … into a real function", () => {
    const c = compileFunction("y = x^2 + 1");
    expect(c.ok && c.fn(3)).toBe(10);
    const f = compileFunction("f(x) = sin(x)");
    expect(f.ok && f.fn(0)).toBe(0);
    const g = compileFunction("1/x");
    expect(g.ok && g.fn(0)).toBe(Number.POSITIVE_INFINITY);
    const h = compileFunction("sqrt(x)");
    expect(h.ok && h.fn(-1)).toBeNaN();
  });

  it("agrees with the exact engine", () => {
    const exprs = [
      "x^3-2x+1",
      "(-8)^(1/3)·x",
      "abs(x)!",
      "round(x/3, 1)",
      "mod(x, 3)",
      "nCr(10, 3)+nPr(5,2)",
      "log(x+11)+log(x+11, 2)+ln(x+11)",
      "asin(0.5)+acos(0.5)+atan(x)",
      "e^x+π",
      "root(27, 3)+5%",
    ];
    for (const expr of exprs) {
      const c = compileFunction(expr, { angle: "rad" });
      if (!c.ok) throw new Error(`${expr}: ${c.error}`);
      for (const x of [-3, -0.5, 0, 2, 4]) {
        const exact = calculate(expr.replace(/x/g, `(${x})`), { angle: "rad" });
        const y = c.fn(x);
        if (!exact.ok) continue;
        expect(
          Math.abs(y - Number(exact.text)) / Math.max(1, Math.abs(y)),
          `${expr} at ${x}`,
        ).toBeLessThan(1e-9);
      }
    }
  });

  it("evaluates calculus at every point", () => {
    const d = compileFunction("d/dx(x^3, x)");
    expect(d.ok && Math.abs(d.fn(2) - 12)).toBeLessThan(1e-8);
    const i = compileFunction("∫(x^2, 0, x)");
    expect(i.ok && Math.abs(i.fn(3) - 9)).toBeLessThan(1e-9);
    const s = compileFunction("Σ(x^k, k, 0, 3)");
    expect(s.ok && s.fn(2)).toBe(15);
    const t = compileFunction("Σ(k, k, 1, x)");
    expect(t.ok && t.fn(4)).toBe(10);
    expect(t.ok && t.fn(2.5)).toBeNaN();
    const z = compileFunction("solve(x^2-2, 1, 2)");
    expect(z.ok && Math.abs(z.fn(0) - Math.SQRT2)).toBeLessThan(1e-12);
    const near0 = compileFunction("solve(x^2-2, 1)");
    expect(near0.ok && Math.abs(near0.fn(0) - Math.SQRT2)).toBeLessThan(1e-12);
    const n = compileFunction("d/dx(abs(x), 0)");
    expect(n.ok && n.fn(0)).toBeNaN();
    const big = compileFunction("Σ(k, k, 0, 2000000)");
    expect(big.ok && big.fn(0)).toBeNaN();
    const f = compileFunction("3!+x!");
    expect(f.ok && f.fn(0.5)).toBeNaN();
  });

  it("names what it does not know", () => {
    expect(compileFunction("y = t + 1")).toEqual({ ok: false, error: "Unknown name: t" });
    expect(compileFunction("2+")).toEqual({ ok: false, error: "Syntax error" });
    expect(compileFunction("Σ(k^2, k, 1, 3) + q")).toEqual({ ok: false, error: "Unknown name: q" });
    expect(compileFunction("Ans + M + x").ok).toBe(true);
  });

  it("knows when x is free", () => {
    expect(usesVariable("sin(x)")).toBe(true);
    expect(usesVariable("d/dx(x^2, 3)")).toBe(false);
    expect(usesVariable("d/dx(x^2, x)")).toBe(true);
    expect(usesVariable("-x!+2")).toBe(true);
    expect(usesVariable("2+3")).toBe(false);
    expect(usesVariable("2+")).toBe(false);
  });
});

describe("closed forms", () => {
  const ok = (r: { ok: true; value: number } | { ok: false; error: string }): number => {
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it("integrates x^n over [0, 1] to 1/(n+1)", () => {
    for (let n = 0; n <= 12; n++) {
      expect(Math.abs(ok(integrate((x) => x ** n, 0, 1)) - 1 / (n + 1)), `n = ${n}`).toBeLessThan(
        1e-14,
      );
    }
  });

  it("is exact for polynomials up to the Kronrod rule's degree on one piece", () => {
    // K15 integrates degree ≤ 22 exactly, G7 degree ≤ 13: so a degree-13
    // polynomial needs no subdivision and lands on the closed form.
    const p = (x: number): number => 3 * x ** 13 - x ** 7 + 2 * x - 5;
    const P = (x: number): number => (3 * x ** 14) / 14 - x ** 8 / 8 + x * x - 5 * x;
    expect(Math.abs(ok(integrate(p, -1, 2)) - (P(2) - P(-1)))).toBeLessThan(1e-9);
  });

  it("integrates exp, trig and a Gaussian to their closed forms", () => {
    expect(Math.abs(ok(integrate(Math.exp, 0, 1)) - (Math.E - 1))).toBeLessThan(1e-14);
    expect(Math.abs(ok(integrate(Math.cos, 0, Math.PI / 2)) - 1)).toBeLessThan(1e-14);
    expect(Math.abs(ok(integrate((x) => 1 / (1 + x * x), 0, 1)) - Math.PI / 4)).toBeLessThan(1e-14);
    expect(Math.abs(ok(integrate(Math.log, 1, Math.E)) - 1)).toBeLessThan(1e-14);
  });

  it("finds the roots of known polynomials", () => {
    const cubic = (x: number): number => x ** 3 - 6 * x * x + 11 * x - 6; // (x−1)(x−2)(x−3)
    expect(ok(solveIn(cubic, 0.5, 1.5))).toBe(1);
    expect(ok(solveIn(cubic, 1.5, 2.5))).toBe(2);
    expect(ok(solveIn(cubic, 2.5, 3.5))).toBe(3);
    expect(ok(solveNear(cubic, 2.9))).toBe(3);
    const quartic = (x: number): number => x ** 4 - 10 * x * x + 9; // roots ±1, ±3
    expect([-3, -1, 1, 3].map((g) => ok(solveNear(quartic, g + 0.2)))).toEqual([-3, -1, 1, 3]);
    expect(Math.abs(ok(solveNear((x) => x * x - 2, 1)) - Math.SQRT2)).toBeLessThan(1e-15);
    expect(Math.abs(ok(solveNear((x) => Math.exp(x) - 10, 0)) - Math.log(10))).toBeLessThan(1e-14);
  });

  it("differentiates polynomials, exp and trig", () => {
    const poly = (x: number): number => 4 * x ** 5 - 3 * x ** 2 + 7;
    const dpoly = (x: number): number => 20 * x ** 4 - 6 * x;
    for (const x of [-2, -0.5, 0, 1, 3]) {
      expect(
        Math.abs(ok(derivative(poly, x)) - dpoly(x)) / Math.max(1, Math.abs(dpoly(x))),
      ).toBeLessThan(1e-10);
    }
    for (const x of [-1, 0, 0.5, 2]) {
      expect(Math.abs(ok(derivative(Math.exp, x)) - Math.exp(x))).toBeLessThan(1e-10);
      expect(Math.abs(ok(derivative(Math.sin, x)) - Math.cos(x))).toBeLessThan(1e-10);
      expect(Math.abs(ok(derivative(Math.cos, x)) + Math.sin(x))).toBeLessThan(1e-10);
    }
    expect(Math.abs(ok(derivative(Math.tan, 1)) - 1 / Math.cos(1) ** 2)).toBeLessThan(1e-9);
  });
});
