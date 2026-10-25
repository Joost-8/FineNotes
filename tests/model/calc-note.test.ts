/**
 * `src/model/calc-note.ts`: what Grape read on a line ending in "=", as a
 * sum, its answer, and the variables set above it. Grape's alphabet has no
 * × or ÷, and it misreads, so the inputs are readings as Grape gives them.
 */

import { describe, expect, it } from "vitest";
import {
  ANSWER_DIGITS,
  answerText,
  assignmentOfLine,
  evaluateSum,
  needsVariables,
  showSum,
  suggestionLabel,
  sumOfLine,
  variablesOfLines,
} from "../../src/model/calc-note";
import { type CalcValue, formatValue, rational } from "../../src/model/calculator";

/** The answer a reading gets, as written, or null when it gets none. */
function answer(reading: string, vars: ReadonlyMap<string, CalcValue> = new Map()): string | null {
  const sum = sumOfLine(reading, vars);
  if (!sum) return null;
  const result = evaluateSum(sum, vars);
  if (!result.ok) return null;
  return answerText(result.value)?.text ?? null;
}

describe("sumOfLine and evaluateSum", () => {
  it("reads an x between numbers as times, as Grape writes ×", () => {
    expect(sumOfLine("12x4=")).toEqual({ expression: "12*4", shown: "12×4" });
    expect(answer("12x4=")).toBe("48");
    expect(answer("12 x 4 =")).toBe("48");
    expect(answer("12X4=")).toBe("48");
    expect(answer("2x3x4=")).toBe("24");
    expect(answer("(2+3)x4=")).toBe("20");
    expect(answer("3x(1+1)=")).toBe("6");
    expect(answer("0.5x8=")).toBe("4");
  });

  it("takes the typographic signs too", () => {
    expect(answer("12×4=")).toBe("48");
    expect(answer("12·4=")).toBe("48");
    expect(answer("12÷4=")).toBe("3");
    expect(answer("12−4=")).toBe("8");
    expect(sumOfLine("12−4=")?.shown).toBe("12−4");
  });

  it("works whatever the spacing, and with a space before the =", () => {
    expect(answer("1 + 1 =")).toBe("2");
    expect(answer("1+1=")).toBe("2");
    expect(answer("1 + 1 = ")).toBe("2");
    expect(answer("  7 - 10 =")).toBe("-3");
  });

  it("reads a colon between numbers as divided by, a comma as a decimal point", () => {
    expect(answer("6:3=")).toBe("2");
    expect(answer("1,5+2=")).toBe("3.5");
    // Three digits after a comma: a thousands separator.
    expect(answer("1,000+1=")).toBe("1001");
  });

  it("fixes the letters Grape reads for digits inside a number, never in a word", () => {
    expect(answer("1O0-1=")).toBe("99");
    expect(answer("l2+1=")).toBe("13");
    expect(answer("2O x 3 =")).toBe("60");
    // "lo" in a word stays letters: the word ends the sum.
    expect(sumOfLine("hello 2+2=")?.expression).toBe("2+2");
  });

  it("calculates only the end of the line: labels and words before it are left out", () => {
    expect(answer("Ex. 3: 12x4 =")).toBe("48");
    expect(answer("Total 12x4=")).toBe("48");
    expect(answer("y = 2x3 =")).toBe("6");
    expect(answer("Question 4b; 9-3=")).toBe("6");
  });

  it("gives nothing for a line without = at its end, or with no sum in it", () => {
    expect(sumOfLine("12x4")).toBeNull();
    expect(sumOfLine("12x4 = 48")).toBeNull();
    expect(sumOfLine("12 =")).toBeNull();
    expect(sumOfLine("-3 =")).toBeNull();
    expect(sumOfLine("hello =")).toBeNull();
    expect(sumOfLine("=")).toBeNull();
    expect(sumOfLine(". =")).toBeNull();
  });

  it("knows the calculator's functions and constants", () => {
    expect(answer("sqrt(16)=")).toBe("4");
    expect(answer("2^10=")).toBe("1024");
    expect(answer("5!=")).toBe("120");
    expect(answer("sqrt 9 =")).toBe("3");
  });

  it("does not calculate a reading the calculator refuses", () => {
    const sum = sumOfLine("4/0=");
    expect(sum).not.toBeNull();
    expect(evaluateSum(sum!).ok).toBe(false);
    expect(answer("2++=")).toBeNull();
  });

  it("uses variables set above: a lone letter, or one after a number", () => {
    const vars = new Map<string, CalcValue>([["a", rational(5n)]]);
    expect(sumOfLine("a*2=", vars)).toEqual({ expression: "a*2", shown: "a×2" });
    expect(answer("a*2=", vars)).toBe("10");
    expect(answer("a x 2 =", vars)).toBe("10");
    expect(answer("2a+1=", vars)).toBe("11");
    expect(answer("a=", vars)).toBe("5");
    expect(answer("A + 1 =", vars)).toBe("6");
    // Without the variable, the letter is not part of the sum, and what is
    // left ("+2") is half a sum: no answer, not 2.
    expect(sumOfLine("a*2=")).toBeNull();
    expect(sumOfLine("a+2=")).toBeNull();
    expect(answer("a+2=", vars)).toBe("7");
    // A leading minus is a sign, not a lost term.
    expect(answer("-2+5=")).toBe("3");
  });

  it("keeps x a variable when one named x is set", () => {
    const vars = new Map<string, CalcValue>([["x", rational(3n)]]);
    // Every x is the variable then: x·x·2.
    expect(answer("x x 2 =", vars)).toBe("18");
    expect(answer("2x =", vars)).toBe("6");
    expect(answer("x + 1 =", vars)).toBe("4");
  });

  it("says when a sum failed for a name it did not know", () => {
    expect(needsVariables({ ok: false, error: "Unknown name: b" })).toBe(true);
    expect(needsVariables({ ok: false, error: "Divide by zero" })).toBe(false);
    expect(needsVariables({ ok: true, value: rational(1n) })).toBe(false);
  });
});

describe("assignments", () => {
  it("reads a line that sets a variable", () => {
    expect(assignmentOfLine("a = 5")).toEqual({ name: "a", value: rational(5n) });
    expect(assignmentOfLine("r = 2x3")).toEqual({ name: "r", value: rational(6n) });
    expect(assignmentOfLine("v0 = 1,5")).toEqual({ name: "v0", value: rational(3n, 2n) });
  });

  it("refuses what is not one", () => {
    expect(assignmentOfLine("a =")).toBeNull();
    expect(assignmentOfLine("a = b + 1")).toBeNull();
    expect(assignmentOfLine("sin = 5")).toBeNull();
    expect(assignmentOfLine("12 = 5")).toBeNull();
    expect(assignmentOfLine("a = 2 = 3")).toBeNull();
    expect(assignmentOfLine("the answer is 5")).toBeNull();
  });

  it("sets them top to bottom, each line seeing the ones above", () => {
    const vars = variablesOfLines(["a = 5", "some notes", "b = a x 2", "c = b + a"]);
    expect([...vars.keys()]).toEqual(["a", "b", "c"]);
    expect(formatValue(vars.get("b")!)).toBe("10");
    expect(formatValue(vars.get("c")!)).toBe("15");
    // A later line overrides an earlier one.
    expect(formatValue(variablesOfLines(["a = 1", "a = 2"]).get("a")!)).toBe("2");
  });
});

describe("the answer's text", () => {
  it("writes whole numbers in full and short fractions exactly", () => {
    expect(answerText(rational(48n))).toEqual({ text: "48", exact: true });
    expect(answerText(rational(1n, 8n))).toEqual({ text: "0.125", exact: true });
    expect(answerText(rational(-7n))).toEqual({ text: "-7", exact: true });
    expect(answerText(0.25)).toEqual({ text: "0.25", exact: false });
  });

  it("rounds a long one, and says so", () => {
    const third = answerText(rational(1n, 3n));
    expect(third).toEqual({ text: "0.33333333", exact: false });
    expect(third!.text.replace(/[^0-9]/g, "").replace(/^0+/, "")).toHaveLength(ANSWER_DIGITS);
    expect(answerText(Math.PI)).toEqual({ text: "3.1415927", exact: false });
    expect(answerText(1e-9 / 3)?.text).toMatch(/^3\.3333333E-10$/);
    expect(answerText(1.5e20)?.text).toBe("1.5E20");
  });

  it("labels the suggestion with what was read", () => {
    const sum = sumOfLine("12x4=")!;
    expect(suggestionLabel(sum, { text: "48", exact: true })).toBe("12×4 = 48");
    expect(suggestionLabel(sumOfLine("1/3=")!, { text: "0.33333333", exact: false })).toBe(
      "1÷3 ≈ 0.33333333",
    );
    expect(suggestionLabel(sumOfLine("3-10=")!, { text: "-7", exact: true })).toBe("3−10 = −7");
  });

  it("shows the calculator's text with × ÷ −", () => {
    expect(showSum("2 * 3 / 4 - 1")).toBe("2×3÷4−1");
    expect(showSum("1.5E-3 + 1")).toBe("1.5E-3+1");
  });
});
