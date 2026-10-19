import { describe, expect, it } from "vitest";
import { boxText, layoutExpression } from "../../src/model/calc-display";

const shown = (expr: string, base: 2 | 8 | 10 | 16 = 10): string | null => {
  const b = layoutExpression(expr, base);
  return b ? boxText(b) : null;
};

describe("natural display", () => {
  it.each([
    ["1÷3+1÷6", "[1/3]+[1/6]"],
    ["(1+2)÷(3−x)", "[1+2/3−x]"],
    ["2^(3+1)", "2^{3+1}"],
    ["x²", "x^{2}"],
    ["√(2)", "√{2}"],
    ["√9+1", "√{9}+1"],
    ["root(27, 3)", "root{3}{27}"],
    ["abs(−3)", "|−3|"],
    ["2(3+4)", "2(3+4)"],
    ["2π", "2π"],
    ["2×3", "2×3"],
    ["5!−3%", "5!−3%"],
    ["−x", "−x"],
    ["Ans×2", "Ans×2"],
    ["M+1", "M+1"],
    ["sin(30)", "sin(30)"],
    ["asin(1)", "sin⁻¹(1)"],
    ["nCr(5,2)", "nCr(5, 2)"],
    ["log(8, 2)", "log(8, 2)"],
    ["∫(x^2, 0, 3)", "∫_{0}^{3}x^{2} dx"],
    ["Σ(i^2, i, 1, 10)", "Σ_{i=1}^{10}i^{2}"],
    ["Σ(x, 1, 10)", "Σ_{x=1}^{10}x"],
    ["d/dx(x^2, 3)", "[d/dx](x^{2})|x=3"],
    ["solve(x−2, 0)", "solve(x−2, 0)"],
    ["1.50E3", "1.50E3"],
  ])("%s → %s", (expr, want) => {
    expect(shown(expr)).toBe(want);
  });

  it("boxes what is still to be typed", () => {
    expect(shown("2+")).toBe("2+□");
    expect(shown("2÷")).toBe("[2/□]");
    expect(shown("sin(")).toBe("sin(□)");
    expect(shown("2^")).toBe("2^{□}");
    expect(shown("∫(x,")).toBe("∫_{□}^{□}x dx");
    expect(shown("Σ(")).toBe("Σ_{x=□}^{□}□");
  });

  it("shows hex digits as typed", () => {
    expect(shown("ff+1", 16)).toBe("FF+1");
    expect(shown("0x1f")).toBe("0x1f");
  });

  it("gives up on what cannot be read", () => {
    expect(shown("")).toBeNull();
    expect(shown("2)")).toBeNull();
    expect(shown("2#")).toBeNull();
  });
});
