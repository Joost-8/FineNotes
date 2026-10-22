import { describe, expect, it } from "vitest";
import { fromCalc } from "../../../src/model/algebra/convert";
import { evaluate, print } from "../../../src/model/algebra/expr";
import { numericRoots, solveEquation } from "../../../src/model/algebra/solve";

function solve(text: string, angle: "deg" | "rad" = "rad") {
  const [l, r] = text.split("=");
  return solveEquation(fromCalc(l), fromCalc(r), { angle });
}

const values = (text: string, angle: "deg" | "rad" = "rad"): string[] =>
  solve(text, angle).values.map(print);

describe("equations", () => {
  it("solves a linear equation by moving and dividing", () => {
    const s = solve("3x + 4 = 10");
    expect(s.values.map(print)).toEqual(["2"]);
    expect(s.approx).toBe(false);
    expect(s.steps.length).toBeGreaterThan(0);
  });

  it("factors a quadratic with rational roots", () => {
    const s = solve("x^2 - 5x + 6 = 0");
    expect(s.values.map(print)).toEqual(["2", "3"]);
    expect(s.steps.some((st) => st.rule === "Factor")).toBe(true);
    expect(s.steps.find((st) => st.rule === "Factor")?.math[0]).toBe("(x - 2)(x - 3) = 0");
  });

  it("uses the quadratic formula when it does not factor, roots simplified", () => {
    expect(values("x^2 - 5x + 3 = 0")).toEqual(["(5 - √13)/2", "(5 + √13)/2"]);
    expect(values("x^2 - 2x - 2 = 0")).toEqual(["1 - √3", "1 + √3"]);
  });

  it("says when there is no real solution, or every x is one", () => {
    expect(solve("x^2 + 1 = 0").message).toBe("No real solution");
    expect(solve("2x + 1 = 2x + 3").message).toBe("No solution");
    expect(solve("2(x + 1) = 2x + 2").message).toBe("Every x is a solution");
  });

  it("solves cubics by rational roots", () => {
    expect(values("x^3 - 6x^2 + 11x - 6 = 0")).toEqual(["1", "2", "3"]);
    expect(values("2x^3 - 3x^2 - 2x = 0")).toEqual(["-1/2", "0", "2"]);
  });

  it("clears fractions and drops answers that divide by zero", () => {
    expect(values("1/x + 1/2 = 1")).toEqual(["2"]);
    const s = solve("x^2/(x - 1) = 1/(x - 1)");
    expect(s.values.map(print)).toEqual(["-1"]);
    expect(s.steps.some((st) => st.rule.includes("denominator zero"))).toBe(true);
  });

  it("undoes one layer at a time when x appears once", () => {
    expect(values("2^(x+1) = 16")).toEqual(["3"]);
    expect(values("e^(2x) = 5")).toEqual(["ln(5)/2"]);
    expect(values("ln(3x) = 2")).toEqual(["e^2/3"]);
    expect(values("√(x + 1) = 3")).toEqual(["8"]);
    expect(values("abs(x - 2) = 5")).toEqual(["-3", "7"]);
    expect(values("(x - 1)^4 = 16")).toEqual(["-1", "3"]);
  });

  it("gives every solution of a trig equation, in the angle unit", () => {
    const rad = solve("sin(x) = 1/2");
    expect(rad.values.map(print)).toEqual(["π/6 + 2πk", "5π/6 + 2πk"]);
    expect(rad.integer).toBe("k");
    expect(values("sin(x) = 1/2", "deg")).toEqual(["30 + 360k", "150 + 360k"]);
    expect(values("2cos(x) = 1", "deg")).toEqual(["60 + 360k", "-60 + 360k"]);
    expect(solve("sin(x) = 2").message).toBe("No real solution");
  });

  it("falls back to numbers, marked as such", () => {
    const s = solve("cos(x) = x");
    expect(s.approx).toBe(true);
    expect(s.values.length).toBe(1);
    expect(evaluate(s.values[0])).toBeCloseTo(0.739085133, 6);
  });

  it("finds roots by sign changes, never at a pole", () => {
    expect(numericRoots((x) => x * x - 2)).toHaveLength(2);
    expect(numericRoots((x) => 1 / (x - 0.5))).toHaveLength(0);
  });
});
