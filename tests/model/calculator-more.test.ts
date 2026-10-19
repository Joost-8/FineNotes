import { describe, expect, it } from "vitest";
import { limit } from "../../src/model/calculus";
import { calculate, parseExpression } from "../../src/model/calculator";
import { boxText, layoutExpression } from "../../src/model/calc-display";

function show(expr: string, angle: "deg" | "rad" = "deg", base: 2 | 8 | 10 | 16 = 10): string {
  const r = calculate(expr, { angle, base });
  return r.ok ? r.text : `! ${r.error}`;
}

describe("mod as an operator", () => {
  it.each([
    ["17 mod 5", "2"],
    ["-17 mod 5", "3"],
    ["17 mod -5", "-3"],
    ["-17 mod -5", "-2"],
    ["7.5 mod 2", "1.5"],
    ["2+17 mod 5×2", "6"],
    ["(2+17) mod 5", "4"],
    ["2^5 mod 7", "4"],
    ["17 mod 0", "! Divide by zero"],
    ["mod(17, 5) mod 3", "2"],
    ["10 mod 3 mod 2", "1"],
  ])("%s = %s", (expr, want) => {
    expect(show(expr)).toBe(want);
  });

  it("works in other bases", () => {
    expect(show("FF mod 10", "deg", 16)).toBe("F");
  });
});

describe("more functions", () => {
  it.each([
    ["sinh(0)", "0"],
    ["cosh(0)", "1"],
    ["tanh(1)", "0.761594155956"],
    ["asinh(1)", "0.88137358702"],
    ["acosh(1)", "0"],
    ["acosh(0.5)", "! Not a real number"],
    ["atanh(0.5)", "0.549306144334"],
    ["sec(60)", "2"],
    ["csc(30)", "2"],
    ["cot(45)", "1"],
    ["sec(90)", "! Undefined"],
    ["cot(0)", "! Undefined"],
    ["asec(2)", "60"],
    ["acsc(2)", "30"],
    ["acot(1)", "45"],
    ["acot(0)", "90"],
    ["arcsinh(0)", "0"],
  ])("degrees: %s = %s", (expr, want) => {
    expect(show(expr)).toBe(want);
  });

  it("converts degrees with °", () => {
    expect(show("sin(30°)", "rad")).toBe("0.5");
    expect(show("sin(30°)", "deg")).toBe("0.5");
    expect(show("180°", "rad")).toBe("3.14159265359");
    expect(show("acot(0)", "rad")).toBe("1.57079632679");
  });

  it.each([
    ["and(12, 10)", "8"],
    ["or(12, 10)", "14"],
    ["xor(12, 10)", "6"],
    ["not(5)", "-6"],
    ["shl(1, 10)", "1024"],
    ["shr(1024, 3)", "128"],
    ["shr(-5, 1)", "-3"],
    ["and(1.5, 1)", "! Whole numbers only"],
    ["shl(1, -1)", "! Shift by 0 to 4096"],
    ["shl(1, 5000)", "! Shift by 0 to 4096"],
  ])("bitwise: %s = %s", (expr, want) => {
    expect(show(expr)).toBe(want);
  });

  it("does bitwise work in hex", () => {
    expect(show("and(FF, 0F)", "deg", 16)).toBe("F");
    expect(show("xor(1010, 0110)", "deg", 2)).toBe("1100");
  });
});

describe("Π and lim", () => {
  it.each([
    ["Π(x, 1, 5)", "120"],
    ["Π(k/(k+1), k, 1, 9)", "0.1"],
    ["Π(x, 5, 1)", "1"],
    ["Π(1+1/x, 1, 3000)", "3001"],
    ["Π(x, 1.5, 3)", "! Π counts in whole numbers"],
    ["lim(sin(x)/x, 0)", "1"],
    ["lim(1/x, ∞)", "0"],
    ["lim(1/x, 0)", "! Limit does not exist"],
    ["lim(1/x^2, 0)", "! Tends to ∞"],
    ["lim(x^2, 3)", "9"],
    ["lim((x^2-4)/(x-2), 2)", "4"],
    ["lim(abs(x)/x, 0)", "! Limit does not exist"],
    ["lim(x, -∞)", "! Tends to −∞"],
    ["lim(sin(x), ∞)", "! Limit does not exist"],
    ["∞", "! ∞ only as a limit's target"],
  ])("%s = %s", (expr, want) => {
    expect(show(expr, "rad")).toBe(want);
  });

  it("finds e as (1 + 1/x)^x grows, to the digits floats keep", () => {
    // (1 + 1/x)^x itself loses ~11 digits to rounding at large x; the last shown digit may differ.
    expect(Math.abs(Number(show("lim((1+1/x)^x, ∞)", "rad")) - Math.E)).toBeLessThan(1e-10);
  });

  it("refuses a NaN target", () => {
    expect(limit((x) => x, Number.NaN)).toEqual({ ok: false, error: "Not a real number" });
  });
});

describe("solve with an equation", () => {
  it.each([
    ["solve(x^2 = 2, 1)", "1.41421356237"],
    ["solve(2x+1 = 7, 0)", "3"],
    ["solve(cos(x) = x, 0)", "0.739085133215"],
    ["solve(x^2 = 4, -5, 0)", "-2"],
    ["solve(x < 2, 0)", "! solve needs an equation"],
    ["2 = 2", "! Syntax error"],
    ["solve(x, 1 = 2)", "! Syntax error"],
  ])("%s = %s", (expr, want) => {
    expect(show(expr, "rad")).toBe(want);
  });
});

describe("graph lines: letters and relations", () => {
  it("splits run-together letters", () => {
    const parsed = parseExpression("ax+b", 10, { letters: true });
    expect(parsed.ok).toBe(true);
    expect(boxText(layoutExpression("y = ax^2+bx+c", 10, { graph: true })!)).toBe("y=ax^{2}+bx+c");
    expect(boxText(layoutExpression("sinx", 10, { graph: true })!)).toBe("sin(x)");
    expect(boxText(layoutExpression("r = 1+cosθ", 10, { graph: true })!)).toBe("r=1+cos(θ)");
    expect(boxText(layoutExpression("x^2+y^2 <= 25", 10, { graph: true })!)).toBe("x^{2}+y^{2}≤25");
  });

  it("keeps the calculator's names whole", () => {
    expect(show("ab")).toBe("! Unknown name: ab");
  });

  it("lays out the new forms", () => {
    expect(boxText(layoutExpression("17 mod 5")!)).toBe("17 mod 5");
    expect(boxText(layoutExpression("Π(x, 1, 5)")!)).toBe("Π_{x=1}^{5}x");
    expect(boxText(layoutExpression("lim(sin(x)/x, 0)")!)).toBe("lim_{x→0}[sin(x)/x]");
    expect(boxText(layoutExpression("sin(30°)")!)).toBe("sin(30°)");
    expect(boxText(layoutExpression("asinh(1)+and(1,2)")!)).toBe("sinh⁻¹(1)+AND(1, 2)");
    expect(boxText(layoutExpression("lim(1/x, ∞)")!)).toBe("lim_{x→∞}[1/x]");
  });
});
