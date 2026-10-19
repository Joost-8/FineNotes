import { describe, expect, it } from "vitest";
import {
  type EvalContext,
  type FormatOptions,
  add,
  calculate,
  deleteLast,
  evaluate,
  formatValue,
  rational,
  subtract,
  toFloat,
} from "../../src/model/calculator";

/** What the display shows: the result, or the error. */
function show(expr: string, ctx: EvalContext = {}, opts: FormatOptions = {}): string {
  const r = calculate(expr, ctx, opts);
  return r.ok ? r.text : `! ${r.error}`;
}

describe("calculator: arithmetic and precedence", () => {
  it.each([
    ["1+2*3", "7"],
    ["(1+2)*3", "9"],
    ["10-4-3", "3"],
    ["2*3/4", "1.5"],
    ["8/2/2", "2"],
    ["2^3^2", "512"],
    ["-2^2", "-4"],
    ["(-2)^2", "4"],
    ["2^-1", "0.5"],
    ["--3", "3"],
    ["+-3", "-3"],
    ["3--2", "5"],
    ["0.1+0.2", "0.3"],
    [".5*4", "2"],
    ["1.5E3", "1500"],
    ["2.5E-3", "0.0025"],
    ["1E+2", "100"],
    ["50%", "0.5"],
    ["200*10%", "20"],
    ["3!", "6"],
    ["3!!", "720"],
    ["2^3!", "64"],
    ["  7 ×  6 ", "42"],
    ["9÷3−1", "2"],
    ["2·3∗4⋅5", "120"],
    ["3²", "9"],
    ["2³", "8"],
  ])("%s = %s", (expr, want) => {
    expect(show(expr)).toBe(want);
  });

  it("multiplies implicitly", () => {
    expect(show("2(3+4)")).toBe("14");
    expect(show("(1+2)(3+4)")).toBe("21");
    expect(show("2π")).toBe(show("2*pi"));
    expect(show("3sin(30)")).toBe("1.5");
    expect(show("2√9")).toBe("6");
    expect(show("4!2")).toBe("48");
    expect(show("1/2π")).toBe(show("pi/2"));
  });

  it("keeps an e after digits as the constant unless it is a capital exponent", () => {
    expect(show("2e")).toBe(show("2*e"));
    expect(show("2e+1")).toBe(show("2*e+1"));
    expect(show("2E1")).toBe("20");
    expect(show("2E")).toBe(show("2*e"));
  });

  it("is exact with fractions", () => {
    expect(show("1/3+1/6", {}, { fractions: true })).toBe("1/2");
    expect(show("1/3", {}, { fractions: true })).toBe("1/3");
    expect(show("1/3")).toBe("0.333333333333");
    expect(show("2/3")).toBe("0.666666666667");
    expect(show("0.75", {}, { fractions: true })).toBe("3/4");
    expect(show("-6/4", {}, { fractions: true })).toBe("-3/2");
    expect(show("(2/3)^2", {}, { fractions: true })).toBe("4/9");
    expect(show("(1/4)^(1/2)", {}, { fractions: true })).toBe("1/2");
    expect(show("8^(2/3)")).toBe("4");
    expect(show("(-8)^(1/3)")).toBe("-2");
    expect(show("(4/9)^-1", {}, { fractions: true })).toBe("9/4");
    // Irrational results fall back to decimals, fractions on or off.
    expect(show("sqrt(2)", {}, { fractions: true })).toBe("1.41421356237");
  });

  it("shows a long fraction as a decimal", () => {
    expect(show("1/3^30", {}, { fractions: true })).toBe("4.85693574962E-15");
  });
});

describe("calculator: functions", () => {
  it.each([
    ["sin(30)", "0.5"],
    ["sin 30", "0.5"],
    ["cos(60)", "0.5"],
    ["cos(90)", "0"],
    ["tan(45)", "1"],
    ["tan(135)", "-1"],
    ["tan(180)", "0"],
    ["sin(-30)", "-0.5"],
    ["sin(390)", "0.5"],
    ["sin(45)", "0.707106781187"],
    ["tan(10)", "0.176326980708"],
    ["asin(0.5)", "30"],
    ["acos(0)", "90"],
    ["atan(1)", "45"],
    ["asin(0.3)", "17.4576031237"],
    ["sin(30.5)", "0.507538362961"],
  ])("degrees: %s = %s", (expr, want) => {
    expect(show(expr, { angle: "deg" })).toBe(want);
  });

  it.each([
    ["sin(pi)", "0"],
    ["cos(pi)", "-1"],
    ["sin(pi/6)", "0.5"],
    ["tan(pi/4)", "1"],
    ["asin(1)", "1.57079632679"],
    ["atan(1)*4", "3.14159265359"],
    ["cos(1)", "0.540302305868"],
  ])("radians: %s = %s", (expr, want) => {
    expect(show(expr, { angle: "rad" })).toBe(want);
  });

  it.each([
    ["ln(e)", "1"],
    ["ln(1)", "0"],
    ["ln(2)", "0.69314718056"],
    ["log(1000)", "3"],
    ["log(8, 2)", "3"],
    ["log(9; 3)", "2"],
    ["log(1/8, 2)", "-3"],
    ["log(10, 3)", "2.09590327429"],
    ["sqrt(16)", "4"],
    ["√16", "4"],
    ["√(2)^2", "2"],
    ["sqrt(2)", "1.41421356237"],
    ["root(27, 3)", "3"],
    ["root(-32, 5)", "-2"],
    ["root(10, 3)", "2.15443469003"],
    ["abs(-3.5)", "3.5"],
    ["abs(4)", "4"],
    ["abs(-pi)", "3.14159265359"],
    ["round(2.5)", "3"],
    ["round(-2.5)", "-3"],
    ["round(2.449, 1)", "2.4"],
    ["round(pi, 3)", "3.142"],
    ["rnd(1.25, 1)", "1.3"],
    ["mod(7, 3)", "1"],
    ["mod(-7, 3)", "2"],
    ["mod(7, -3)", "-2"],
    ["mod(7.5, 2)", "1.5"],
    ["mod(pi, 1)", "0.14159265359"],
    ["nCr(5, 2)", "10"],
    ["ncr(52, 5)", "2598960"],
    ["nCr(5, 7)", "0"],
    ["nPr(5, 2)", "20"],
    ["nPr(10, 10)", "3628800"],
    ["0!", "1"],
    ["20!", "2.43290200818E18"],
    ["arcsin(1)", "90"],
  ])("%s = %s", (expr, want) => {
    expect(show(expr)).toBe(want);
  });

  it("keeps huge exact integers", () => {
    expect(show("100!")).toBe("9.33262154439E157");
    expect(show("2^1000")).toBe("1.07150860719E301");
    expect(show("ln(2^2000)")).toBe("1386.29436112");
    expect(show("10^400/10^399")).toBe("10");
  });

  it("reads Ans and memory", () => {
    expect(show("Ans*2", { ans: rational(21n) })).toBe("42");
    expect(show("ans+1")).toBe("1");
    expect(show("M+1", { memory: rational(1n, 2n) }, { fractions: true })).toBe("3/2");
    expect(show("2M", { memory: 4 })).toBe("8");
  });
});

describe("calculator: errors", () => {
  it.each([
    ["1/0", "Divide by zero"],
    ["mod(1, 0)", "Divide by zero"],
    ["0^-1", "Divide by zero"],
    ["1/(2-2)", "Divide by zero"],
    ["1/sin(0)", "Divide by zero"],
    ["2)", "Missing bracket"],
    [")", "Missing bracket"],
    ["", "Nothing to calculate"],
    ["   ", "Nothing to calculate"],
    ["2+", "Syntax error"],
    ["*2", "Syntax error"],
    ["()", "Syntax error"],
    ["1.2.3", "Syntax error"],
    ["sin(1,2)", "sin takes 1 number"],
    ["mod(1)", "mod takes 2 numbers"],
    ["log()", "log takes 1 or 2 numbers"],
    ["foo(2)", "Unknown name: foo"],
    ["2#3", "Unknown sign: #"],
    ["sqrt(-4)", "Not a real number"],
    ["(-8)^0.5", "Not a real number"],
    ["ln(0)", "Not a real number"],
    ["log(-1)", "Not a real number"],
    ["asin(2)", "Not a real number"],
    ["log(5, 1)", "Undefined"],
    ["tan(90)", "Undefined"],
    ["tan(-270)", "Undefined"],
    ["2.5!", "Whole numbers ≥ 0 only"],
    ["(-3)!", "Whole numbers ≥ 0 only"],
    ["nCr(2.5, 1)", "Whole numbers ≥ 0 only"],
    ["round(2, 0.5)", "Places: 0 to 15"],
    ["1001!", "Too large"],
    ["10^400*1.5^2000", "Too large"],
    ["e^1000", "Too large"],
    ["1E5000", "Too large"],
    ["nCr(20000, 10000)", "Too large"],
  ])("%s → %s", (expr, error) => {
    expect(show(expr)).toBe(`! ${error}`);
  });

  it("refuses tan at a right angle in radians", () => {
    expect(show("tan(pi/2)", { angle: "rad" })).toBe("! Undefined");
  });

  it("closes brackets left open at the end", () => {
    expect(show("sin(30")).toBe("0.5");
    expect(show("2*(3+(4")).toBe("14");
  });

  it("refuses nesting too deep and input too long", () => {
    expect(show("(".repeat(300) + "1")).toBe("! Too complex");
    expect(show("-".repeat(300) + "1")).toBe("! Too complex");
    expect(show("1+".repeat(1500) + "1")).toBe("! Too long");
  });

  it("never yields NaN or Infinity", () => {
    const exprs = ["0/0", "ln(-1)", "1E308*10", "(-1)^(1/2)", "sqrt(-0.5)", "tan(90)", "0^0"];
    for (const expr of exprs) {
      const r = evaluate(expr);
      if (r.ok && typeof r.value === "number") expect(Number.isFinite(r.value)).toBe(true);
      expect(show(expr)).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe("calculator: number bases", () => {
  it("reads and shows integers in each base", () => {
    expect(show("FF+1", { base: 16 })).toBe("100");
    expect(show("ff*2", { base: 16 })).toBe("1FE");
    expect(show("e", { base: 16 })).toBe("E");
    expect(show("1010+1", { base: 2 })).toBe("1011");
    expect(show("17", { base: 8 })).toBe("17");
    expect(show("7+1", { base: 8 })).toBe("10");
    expect(show("10-20", { base: 16 })).toBe("-10");
    expect(show("abs(-A)", { base: 16 })).toBe("A");
    expect(show("mod(11, 3)", { base: 16 })).toBe("2");
  });

  it("refuses digits outside the base and non-whole results", () => {
    expect(show("12", { base: 2 })).toBe("! 2 is not a BIN digit");
    expect(show("9", { base: 8 })).toBe("! 9 is not a OCT digit");
    expect(show("1/2", { base: 16 })).toBe("! Not a whole number");
    expect(show("sqrt(10)", { base: 2 })).toBe("! Not a whole number");
  });

  it("reads 0x, 0b and 0o literals in decimal", () => {
    expect(show("0xFF")).toBe("255");
    expect(show("0b101")).toBe("5");
    expect(show("0o17")).toBe("15");
    expect(show("0b2")).toBe("! 2 is not a BIN digit");
  });

  it("formats a value in any base, or says it cannot", () => {
    expect(formatValue(rational(255n), { base: 16 })).toBe("FF");
    expect(formatValue(rational(5n), { base: 2 })).toBe("101");
    expect(formatValue(64, { base: 8 })).toBe("100");
    expect(formatValue(rational(1n, 3n), { base: 16 })).toBeNull();
    expect(formatValue(0.5, { base: 2 })).toBeNull();
    expect(formatValue(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("calculator: display", () => {
  it.each([
    [123456789012, "123456789012"],
    [1234567890123, "1.23456789012E12"],
    [0.000001, "0.000001"],
    [0.00000012345, "1.2345E-7"],
    [1e-8, "1E-8"],
    [-2.5, "-2.5"],
    [-0, "0"],
    [1 / 3, "0.333333333333"],
    [0.1 + 0.2, "0.3"],
    [999999999999.7, "1E12"],
  ])("%s → %s", (value, want) => {
    expect(formatValue(value)).toBe(want);
  });

  it("rounds exact values to twelve digits", () => {
    expect(formatValue(rational(2n, 3n))).toBe("0.666666666667");
    expect(formatValue(rational(999999999999999n))).toBe("1E15");
    expect(formatValue(rational(-1n, 8n))).toBe("-0.125");
    expect(formatValue(rational(0n))).toBe("0");
    expect(formatValue(rational(5n), { fractions: true })).toBe("5");
  });

  it("converts big rationals to floats faithfully", () => {
    expect(toFloat(rational(10n ** 30n, 3n))).toBeCloseTo(3.333333333333333e29, -15);
    expect(toFloat(rational(-(10n ** 400n)))).toBe(Number.NEGATIVE_INFINITY);
    expect(toFloat(rational(1n, 10n ** 400n))).toBe(0);
  });
});

describe("calculator: memory arithmetic", () => {
  it("adds and subtracts exactly", () => {
    const m = add(rational(1n, 3n), rational(1n, 6n));
    expect(formatValue(m, { fractions: true })).toBe("1/2");
    expect(formatValue(subtract(m, 0.25))).toBe("0.25");
  });
});

describe("calculator: deleteLast", () => {
  it.each([
    ["12+3", "12+"],
    ["sin(", ""],
    ["2*asin(", "2*"],
    ["nCr(", ""],
    ["1+Ans", "1+"],
    ["2π", "2"],
    ["√", ""],
    ["x ", ""],
    ["", ""],
  ])("%s → %s", (expr, want) => {
    expect(deleteLast(expr)).toBe(want);
  });
});
