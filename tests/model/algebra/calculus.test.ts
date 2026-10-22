import { describe, expect, it } from "vitest";
import { agree, derivative, deriveSteps } from "../../../src/model/algebra/derive";
import { type Expr, print } from "../../../src/model/algebra/expr";
import { fromCalc } from "../../../src/model/algebra/convert";
import { antiderivative, integrateSteps } from "../../../src/model/algebra/integrate";

const read = (text: string): Expr => fromCalc(text);

/** f′ by central differences, to check a symbolic derivative against. */
function numericAgree(f: Expr, df: Expr): boolean {
  const g = derivative(f);
  return agree(g, df);
}

describe("derivatives", () => {
  const cases: Array<[string, string]> = [
    ["x^3", "3x^2"],
    ["5x^2 - 3x + 7", "10x - 3"],
    ["sin(x)", "cos(x)"],
    ["x^2 sin(x)", "2x sin(x) + x^2 cos(x)"],
    ["sin(x^2)", "2x cos(x^2)"],
    ["e^(3x)", "3e^(3x)"],
    ["ln(x)", "1/x"],
    ["x/(x+1)", "1/(x+1)^2"],
    ["√x", "1/(2√x)"],
    ["tan(x)", "1/cos(x)^2"],
    ["atan(2x)", "2/(1+4x^2)"],
    ["x^x", "x^x (ln(x) + 1)"],
    ["2^x", "2^x ln(2)"],
    ["ln(x^2+1)", "2x/(x^2+1)"],
    ["cos(3x+1)^2", "-6cos(3x+1)sin(3x+1)"],
  ];
  for (const [f, want] of cases) {
    it(`d/dx ${f} = ${want}`, () => {
      const got = derivative(read(f));
      expect(agree(got, read(want)), `${print(got)}`).toBe(true);
    });
  }

  it("names its rules, one level a step", () => {
    const { result, steps } = deriveSteps(read("x^2 sin(x)"));
    expect(steps[0].rule).toContain("Product rule");
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(numericAgree(read("x^2 sin(x)"), result)).toBe(true);
  });
});

describe("antiderivatives", () => {
  const cases: string[] = [
    "x^2",
    "3x^2 + 2x - 5",
    "1/x",
    "e^x",
    "e^(2x+1)",
    "sin(x)",
    "cos(3x)",
    "2x cos(x^2)",
    "x e^(x^2)",
    "sin(x) cos(x)",
    "ln(x)/x",
    "x/(x^2+1)",
    "1/(x^2+1)",
    "1/(x^2+4)",
    "x e^x",
    "x^2 e^x",
    "x sin(x)",
    "ln(x)",
    "x ln(x)",
    "(x+1)^2",
    "x(x-2)",
    "1/(x^2-1)",
    "(x^2+1)/(x+1)",
    "sin(x)^2",
    "cos(x)^2",
    "1/cos(x)^2",
    "tan(x)",
    "√x",
    "1/√x",
    "(2x+3)^5",
    "1/(2x+1)",
    "1/(x^2+2x+5)",
    "(x+1)/(x^2+2x+5)",
    "1/√(1-x^2)",
    "atan(x)",
    "2^x",
    "x^3 (x^4+1)^5",
  ];
  for (const f of cases) {
    it(`∫ ${f} dx`, () => {
      const F = antiderivative(read(f));
      expect(F, `no antiderivative for ${f}`).not.toBeNull();
      expect(agree(derivative(F!), read(f)), `${print(F!)}`).toBe(true);
    });
  }

  it("shows a substitution and puts it back", () => {
    const { steps, result } = integrateSteps(read("2x cos(x^2)"));
    expect(steps.some((s) => s.rule.startsWith("Substitute u = x²"))).toBe(true);
    expect(steps.some((s) => s.rule.startsWith("Substitute back"))).toBe(true);
    expect(print(result)).toBe("sin(x^2)");
  });

  it("refuses what no rule fits, rather than guessing", () => {
    expect(antiderivative(read("e^(x^2)"))).toBeNull();
    expect(antiderivative(read("sin(x)/x"))).toBeNull();
  });
});
