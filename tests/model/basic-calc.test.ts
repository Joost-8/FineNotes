import { describe, expect, it } from "vitest";
import {
  BASIC_START,
  type BasicKey,
  type BasicState,
  MAX_DIGITS,
  activeOp,
  basicDisplay,
  basicKeyFor,
  basicTape,
  clearLabel,
  formatBasic,
  groupDigits,
  isBasicClear,
  pressBasic,
  shownValue,
} from "../../src/model/basic-calc";

/** Press keys written as on the keypad: digits, ".", + − × ÷, =, %, ±, C (clear), ⌫. */
function run(keys: string, from: BasicState = BASIC_START): BasicState {
  let state = from;
  for (const ch of keys.replace(/\s+/g, "")) {
    let key: BasicKey;
    if (/[0-9]/.test(ch)) key = { digit: Number(ch) };
    else if (ch === ".") key = { point: true };
    else if (ch === "=") key = { equals: true };
    else if (ch === "%") key = { percent: true };
    else if (ch === "±") key = { negate: true };
    else if (ch === "C") key = { clear: true };
    else if (ch === "⌫") key = { back: true };
    else key = { op: ch as "+" | "−" | "×" | "÷" };
    state = pressBasic(state, key);
  }
  return state;
}

const shows = (keys: string): string => basicDisplay(run(keys));

describe("Basic mode: typing numbers", () => {
  it("starts at 0 and types digits in place of it", () => {
    expect(basicDisplay(BASIC_START)).toBe("0");
    expect(shows("0")).toBe("0");
    expect(shows("007")).toBe("7");
    expect(shows("123")).toBe("123");
  });

  it("takes one decimal point, and a point first means 0.", () => {
    expect(shows(".5")).toBe("0.5");
    expect(shows("1.2.3")).toBe("1.23");
    expect(shows("3.")).toBe("3.");
  });

  it("holds at most nine digits", () => {
    expect(shows("1234567890")).toBe("123,456,789");
    expect(shows("0.123456789")).toBe("0.12345678");
  });

  it("deletes the last digit, down to 0", () => {
    expect(shows("123⌫")).toBe("12");
    expect(shows("5⌫")).toBe("0");
    expect(shows("5±⌫")).toBe("0");
    // A result is not typed: ⌫ leaves it.
    expect(shows("2+3=⌫")).toBe("5");
  });

  it("groups thousands", () => {
    expect(shows("1234567")).toBe("1,234,567");
    expect(shows("1234.5")).toBe("1,234.5");
  });
});

describe("Basic mode: operators", () => {
  it("adds, subtracts, multiplies and divides", () => {
    expect(shows("2+3=")).toBe("5");
    expect(shows("2−3=")).toBe("−1");
    expect(shows("6×7=")).toBe("42");
    expect(shows("1÷4=")).toBe("0.25");
  });

  it("follows precedence, as the iPhone does: 2 + 3 × 4 = 14", () => {
    expect(shows("2+3×4=")).toBe("14");
    expect(shows("2×3+4=")).toBe("10");
    expect(shows("10−2×3−1=")).toBe("3");
    expect(shows("8÷2÷2=")).toBe("2");
    expect(shows("2+3×4÷2−1=")).toBe("7");
  });

  it("shows what it can work out when an operator is pressed", () => {
    expect(shows("2×3+")).toBe("6");
    expect(shows("2+3×")).toBe("3");
    expect(shows("2+3×4+")).toBe("14");
    expect(shows("2+3+")).toBe("5");
  });

  it("lights the operator just pressed until a digit is typed", () => {
    expect(activeOp(run("2+"))).toBe("+");
    expect(activeOp(run("2+3"))).toBeNull();
    expect(activeOp(BASIC_START)).toBeNull();
  });

  it("replaces an operator pressed straight after another", () => {
    const state = run("5+×");
    expect(activeOp(state)).toBe("×");
    expect(basicDisplay(run("3", state))).toBe("3");
    expect(basicDisplay(run("3=", state))).toBe("15");
    expect(basicTape(state)).toBe("5 ×");
  });

  it("takes the number on show when = follows an operator", () => {
    expect(shows("5+=")).toBe("10");
    expect(shows("5×=")).toBe("25");
  });

  it("rounds float noise away", () => {
    expect(shows(".1+.2=")).toBe("0.3");
    expect(shows("1÷3×3=")).toBe("1");
    expect(shows("0.7×3=")).toBe("2.1");
  });

  it("carries a result into the next sum, and starts afresh on a digit", () => {
    expect(shows("2+3=×2=")).toBe("10");
    expect(shows("2+3=7")).toBe("7");
    expect(shows("2+3=7+1=")).toBe("8");
  });
});

describe("Basic mode: repeated =", () => {
  it("repeats the last operation", () => {
    expect(shows("2+3==")).toBe("8");
    expect(shows("2+3===")).toBe("11");
    expect(shows("10−1==")).toBe("8");
    expect(shows("2×3==")).toBe("18");
  });

  it("repeats the innermost operation of a sum with precedence", () => {
    expect(shows("2+3×4==")).toBe("56");
  });

  it("repeats on a new number typed after =", () => {
    expect(shows("2+3=10=")).toBe("13");
  });

  it("does nothing new on = alone", () => {
    expect(shows("=")).toBe("0");
    expect(shows("7=")).toBe("7");
  });
});

describe("Basic mode: %, ± and clearing", () => {
  it("takes a percentage of the number before under + and −", () => {
    expect(shows("50+10%")).toBe("5");
    expect(shows("50+10%=")).toBe("55");
    expect(shows("200−10%=")).toBe("180");
    expect(shows("50+%")).toBe("25");
  });

  it("takes a hundredth otherwise", () => {
    expect(shows("50%")).toBe("0.5");
    expect(shows("50×10%=")).toBe("5");
  });

  it("flips the sign of the number on show", () => {
    expect(shows("5±")).toBe("−5");
    expect(shows("5±±")).toBe("5");
    expect(shows("±")).toBe("−0");
    expect(shows("±5")).toBe("−5");
    expect(shows("2+3=±")).toBe("−5");
    expect(shows("3×±")).toBe("−0");
    expect(shows("3×±2=")).toBe("−6");
  });

  it("knows when there is nothing left to clear", () => {
    expect(isBasicClear(BASIC_START)).toBe(true);
    expect(isBasicClear(run("5"))).toBe(false);
    expect(isBasicClear(run("0"))).toBe(false);
    expect(isBasicClear(run("2+"))).toBe(false);
    expect(isBasicClear(run("2−2="))).toBe(false);
    expect(isBasicClear(run("5÷0="))).toBe(false);
    expect(isBasicClear(run("5+3CC"))).toBe(true);
  });

  it("C clears the number typed and keeps the sum; AC clears it all", () => {
    expect(clearLabel(BASIC_START)).toBe("AC");
    expect(clearLabel(run("5"))).toBe("C");
    expect(clearLabel(run("5+"))).toBe("AC");
    const cleared = run("5+3C");
    expect(basicDisplay(cleared)).toBe("0");
    expect(activeOp(cleared)).toBe("+");
    expect(clearLabel(cleared)).toBe("AC");
    expect(basicDisplay(run("4=", cleared))).toBe("9");
    expect(run("5+3CC")).toEqual(BASIC_START);
    expect(run("2+3=C")).toEqual(BASIC_START);
    // ± on 0 is typed, so C (not AC) clears it.
    expect(clearLabel(run("±"))).toBe("C");
  });
});

describe("Basic mode: errors", () => {
  it("shows Error on a division by zero", () => {
    const state = run("5÷0=");
    expect(basicDisplay(state)).toBe("Error");
    expect(clearLabel(state)).toBe("AC");
  });

  it("ignores operators until a number or AC", () => {
    const state = run("5÷0=");
    expect(run("+=%±⌫", state)).toBe(state);
    expect(basicDisplay(run("7", state))).toBe("7");
    expect(run("C", state)).toEqual(BASIC_START);
  });

  it("fails on an operator that divides by zero too", () => {
    expect(shows("5÷0+")).toBe("Error");
    expect(shows("1÷0==")).toBe("Error");
  });

  it("fails when a repeat overflows", () => {
    let state = run("99999999×99999999=");
    for (let i = 0; i < 40 && !state.error; i++) state = run("=", state);
    expect(state.error).toBe(true);
  });
});

describe("Basic mode: the tape and the line", () => {
  it("writes the sum so far above the number", () => {
    expect(basicTape(BASIC_START)).toBe("");
    expect(basicTape(run("2+3×"))).toBe("2 + 3 ×");
    expect(basicTape(run("2+3×4"))).toBe("2 + 3 ×");
    expect(basicTape(run("1250+2000×"))).toBe("1,250 + 2,000 ×");
    expect(basicTape(run("1250+2000="))).toBe("1,250 + 2,000 =");
    expect(run("1250+2000=").line).toEqual({ expr: "1250+2000", result: "3250" });
  });

  it("keeps the last line worked out, with its =", () => {
    const state = run("2+3×4=");
    expect(state.line).toEqual({ expr: "2+3×4", result: "14" });
    expect(basicTape(state)).toBe("2 + 3 × 4 =");
    expect(run("=", state).line).toEqual({ expr: "14×4", result: "56" });
    expect(run("7", state).line).toBeNull();
  });

  it("writes negative numbers in a line", () => {
    expect(run("3×±2=").line).toEqual({ expr: "3×−2", result: "−6" });
    expect(basicTape(run("3×±2="))).toBe("3 × −2 =");
  });

  it("gives the value on show", () => {
    expect(shownValue(run("12.5"))).toBe(12.5);
    expect(shownValue(run("12."))).toBe(12);
    expect(shownValue(run("2+3="))).toBe(5);
  });
});

describe("formatBasic", () => {
  it("writes whole numbers and decimals up to nine digits", () => {
    expect(formatBasic(0)).toBe("0");
    expect(formatBasic(-0)).toBe("−0");
    expect(formatBasic(42)).toBe("42");
    expect(formatBasic(-3.5)).toBe("−3.5");
    expect(formatBasic(123456789)).toBe("123456789");
    expect(formatBasic(1 / 3)).toBe("0.33333333");
    expect(formatBasic(2 / 3)).toBe("0.66666667");
    expect(formatBasic(12345.678912)).toBe("12345.6789");
    expect(formatBasic(0.0001234)).toBe("0.0001234");
  });

  it("falls back to exponent form past what fits", () => {
    expect(formatBasic(1234567890)).toBe("1.234568e9");
    expect(formatBasic(1234567890123)).toBe("1.23457e12");
    expect(formatBasic(1e15)).toBe("1e15");
    expect(formatBasic(-2.5e20)).toBe("−2.5e20");
    expect(formatBasic(1.234e-8)).toBe("1.234e−8");
    expect(formatBasic(1e-100)).toBe("1e−100");
    expect(formatBasic(999999999.6)).toBe("1e9");
  });

  it("never writes more than the display holds", () => {
    for (const n of [Math.PI * 1e5, Math.E * 1e-3, 7 / 11, 1e300, 123456789.123, -98765.4321]) {
      const digits = formatBasic(n)
        .replace(/e.*$/, "")
        .replace(/^−?0\./, "")
        .replace(/[^0-9]/g, "");
      expect(digits.length).toBeLessThanOrEqual(MAX_DIGITS);
    }
  });

  it("writes Error for what is not a number", () => {
    expect(formatBasic(NaN)).toBe("Error");
    expect(formatBasic(Infinity)).toBe("Error");
  });

  it("groups only the whole part, and never an exponent", () => {
    expect(groupDigits("1234567.1234")).toBe("1,234,567.1234");
    expect(groupDigits("−1000")).toBe("−1,000");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("1.23457e9")).toBe("1.23457e9");
    expect(groupDigits("Error")).toBe("Error");
  });
});

describe("basicKeyFor", () => {
  it("maps a keyboard to the keys", () => {
    expect(basicKeyFor("7")).toEqual({ digit: 7 });
    expect(basicKeyFor(".")).toEqual({ point: true });
    expect(basicKeyFor(",")).toEqual({ point: true });
    expect(basicKeyFor("+")).toEqual({ op: "+" });
    expect(basicKeyFor("-")).toEqual({ op: "−" });
    expect(basicKeyFor("*")).toEqual({ op: "×" });
    expect(basicKeyFor("x")).toEqual({ op: "×" });
    expect(basicKeyFor("/")).toEqual({ op: "÷" });
    expect(basicKeyFor("Enter")).toEqual({ equals: true });
    expect(basicKeyFor("=")).toEqual({ equals: true });
    expect(basicKeyFor("%")).toEqual({ percent: true });
    expect(basicKeyFor("Escape")).toEqual({ clear: true });
    expect(basicKeyFor("Backspace")).toEqual({ back: true });
  });

  it("ignores other keys", () => {
    expect(basicKeyFor("a")).toBeNull();
    expect(basicKeyFor("ArrowLeft")).toBeNull();
    expect(basicKeyFor("Shift")).toBeNull();
  });
});
