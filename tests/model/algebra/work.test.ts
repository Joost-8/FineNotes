import { describe, expect, it } from "vitest";
import { work } from "../../../src/model/algebra/work";

function ok(text: string, angle: "deg" | "rad" = "rad") {
  const w = work(text, angle);
  if (!w || !w.ok) throw new Error(`${text}: ${w ? w.error : "not symbolic"}`);
  return w;
}

describe("the calculator's symbolic side", () => {
  it("leaves plain sums to the numbers", () => {
    expect(work("2+3")).toBeNull();
    expect(work("sin(30)")).toBeNull();
    expect(work("∫(x^2, 0, 1)")?.ok).toBe(true);
  });

  it("solves an equation typed bare or in solve(), with steps", () => {
    const w = ok("x^2 - 5x + 6 = 0");
    expect(w.answer).toEqual(["x = 2", "x = 3"]);
    expect(w.steps.length).toBeGreaterThan(1);
    expect(ok("solve(2x + 1 = 7)").answer).toEqual(["x = 3"]);
    expect(ok("solve(2x + 1 = 7)").value).toBe(3);
  });

  it("notes a family of solutions and missing ones", () => {
    expect(ok("sin(x) = 1/2").note).toBe("k is any whole number");
    expect(ok("x^2 + 1 = 0").note).toBe("No real solution");
    const approx = ok("cos(x) = x");
    expect(approx.approx).toBe(true);
    expect(approx.answer[0]).toMatch(/^x ≈ 0\.739085/);
  });

  it("differentiates, and gives the slope at a point exactly", () => {
    expect(ok("d/dx(x^2 sin(x))").answer).toEqual(["x^2 cos(x) + 2x sin(x)"]);
    const at = ok("d/dx(x^3, 2)");
    expect(at.answer).toEqual(["12"]);
    expect(at.value).toBe(12);
  });

  it("integrates without limits, + C, and with them exactly", () => {
    const w = ok("∫(2x cos(x^2))");
    expect(w.answer).toEqual(["sin(x^2) + C"]);
    expect(w.steps.at(-1)?.rule).toBe("Add the constant of integration");
    const definite = ok("∫(x^2, 0, 3)");
    expect(definite.answer).toEqual(["9"]);
    expect(ok("∫(1/x, 1, e)").answer).toEqual(["1"]);
  });

  it("says when no antiderivative is found, or when trig needs radians", () => {
    expect(work("∫(e^(x^2))")).toEqual({
      ok: false,
      error: "No antiderivative found with the usual rules",
    });
    expect(work("∫(e^(x^2), 0, 1)")).toBeNull();
    expect(work("d/dx(sin(x))", "deg")).toEqual({
      ok: false,
      error: "Calculus with trig works in radians: switch to RAD",
    });
  });

  it("multiplies out a polynomial in x", () => {
    expect(ok("(x + 1)^2").answer).toEqual(["x^2 + 2x + 1"]);
  });
});
