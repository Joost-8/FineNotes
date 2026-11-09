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
  askedLetter,
  equationLetter,
  equationOfLine,
  functionGraphSpec,
  functionOfLine,
  mathsClause,
  showSum,
  spellNames,
  suggestionLabel,
  sumOfLine,
  variablesOfLines,
} from "../../src/model/calc-note";
import { type CalcValue, evaluate, formatValue, rational } from "../../src/model/calculator";
import { useLanguage } from "../../src/i18n/translate";

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

  it("knows an unknown name in any interface language", () => {
    useLanguage("de", { "calculator.errUnknownName": "Unbekannter Name: {name}" });
    try {
      expect(needsVariables(evaluate("b + 1"))).toBe(true);
      expect(needsVariables({ ok: false, error: "Unknown name: b" })).toBe(false);
    } finally {
      useLanguage("en");
    }
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

describe("names Grape writes differently (FineNotes#178)", () => {
  const answer = (line: string): string | null => {
    const sum = sumOfLine(line);
    const result = sum ? evaluateSum(sum) : null;
    return result?.ok ? formatValue(result.value) : null;
  };

  it("reads mod without spaces round it", () => {
    expect(spellNames("17mod5")).toBe("17 mod 5");
    expect(answer("17mod5 =")).toBe("2");
    expect(answer("(9+8)MOD5 =")).toBe("2");
    // Not inside a word.
    expect(spellNames("model 5")).toBe("model 5");
  });

  it("reads a logarithm with its base written low as log(x, base)", () => {
    expect(spellNames("log2(8)")).toBe("log(8, 2)");
    expect(spellNames("log_2(8)")).toBe("log(8, 2)");
    expect(answer("log2(8) =")).toBe("3");
    expect(answer("log10(1000)+1 =")).toBe("4");
    // The base's comma is no decimal comma, and the argument keeps its own.
    expect(answer("log2(1,5) =")).toBe(formatValue(Math.log2(1.5)));
    // Nested brackets stay whole; a plain log and ln are left alone.
    expect(spellNames("log3((2+1)*3)")).toBe("log((2+1)*3, 3)");
    expect(spellNames("log(100)+ln(8)")).toBe("log(100)+ln(8)");
  });
});

describe('equations asked for with "x =" (FineNotes#178)', () => {
  it("knows the letter a line asks for", () => {
    expect(askedLetter("x =")).toBe("x");
    expect(askedLetter("2x+3=7, X =")).toBe("x");
    expect(askedLetter("12x4 =")).toBeNull();
    expect(askedLetter("ax =")).toBeNull();
  });

  it("finds the equation on the line, without the ask or a label", () => {
    expect(equationOfLine("2x + 3 = 7", "x")).toEqual({ lhs: "2x+3", rhs: "7", letter: "x" });
    expect(equationOfLine("2X+3=7, x =", "x")).toEqual({ lhs: "2x+3", rhs: "7", letter: "x" });
    expect(equationOfLine("Ex 2: 3x = x+4", "x")).toEqual({ lhs: "3x", rhs: "x+4", letter: "x" });
    expect(equationOfLine("2a+1 = 5 a =", "a")).toEqual({ lhs: "2a+1", rhs: "5", letter: "a" });
  });

  it("finds none where there is no equation in that letter", () => {
    // A letter set, a line with no letter, two "=", the letter missing.
    expect(equationOfLine("x = 5", "x")).toBeNull();
    expect(equationOfLine("3 + 4 = 7", "x")).toBeNull();
    expect(equationOfLine("x = 2 = 3", "x")).toBeNull();
    expect(equationOfLine("2y = 4", "x")).toBeNull();
    expect(equationOfLine("x =", "x")).toBeNull();
  });
});

describe("a whole equation (ink after the =)", () => {
  it("finds its one letter", () => {
    expect(equationLetter("x + 5 = 7")).toBe("x");
    expect(equationLetter("2X+3=7")).toBe("x");
    expect(equationLetter("Ex 1: 3a - 2 = 4")).toBe("a");
    expect(equationLetter("sin(x) = 1")).toBe("x");
  });
  it("leaves alone what is no equation", () => {
    expect(equationLetter("3 + 4 = 7")).toBeNull();
    expect(equationLetter("a + b = 3")).toBeNull();
    expect(equationLetter("f is monic if lc = 1")).toBeNull();
    expect(equationLetter("x = 1 = 2")).toBeNull();
  });
  it("reads x + 5 = 7 as an equation, and a digit after the letter as a power", () => {
    expect(equationOfLine("x + 5 = 7", "x")).toEqual({ lhs: "x+5", rhs: "7", letter: "x" });
    expect(equationOfLine("2x2 + 3 = 11", "x")?.lhs).toBe("2x^2+3");
  });
});

describe("a function on a line", () => {
  it("reads y = and f(x) =", () => {
    expect(functionOfLine("y = 2x + 1")).toEqual({ name: "y", body: "2x+1" });
    expect(functionOfLine("f(x) = x2 + 1")).toEqual({ name: "f(x)", body: "x^2+1" });
    expect(functionOfLine("G (X) = sin(X)")).toEqual({ name: "g(x)", body: "sin(x)" });
    expect(functionOfLine("f(x) = 5")).toEqual({ name: "f(x)", body: "5" });
  });
  it("sees a bare left side as nothing to plot yet", () => {
    expect(functionOfLine("f(x) =")).toEqual({ name: "f(x)", body: null });
    expect(functionOfLine("y =")).toEqual({ name: "y", body: null });
  });
  it("is not fooled by a value, an equation or a word", () => {
    expect(functionOfLine("y = 5")).toBeNull();
    expect(functionOfLine("x + 5 = 7")).toBeNull();
    expect(functionOfLine("y = monic x")).toBeNull();
    expect(functionOfLine("y = 2x = 4")).toBeNull();
    expect(functionOfLine("sin(x) = 1")).toBeNull();
  });
  it("makes a graph the calculator can draw", () => {
    const spec = functionGraphSpec({ name: "y", body: "2x+1" });
    expect(spec.expressions).toEqual(["y = 2x+1"]);
    expect(spec.yMax - spec.yMin).toBe(15);
  });
});

describe("the maths on a line (Joost's sheet, as Grape read it)", () => {
  const fn = (reading: string) => functionOfLine(mathsClause(reading));
  it("reads past a bullet and an earlier part of the line", () => {
    expect(fn("- f(x) = x2")).toEqual({ name: "f(x)", body: "x^2" });
    expect(fn(", y = xz")).toEqual({ name: "y", body: "x^2" });
    expect(fn("- f(x) =")).toEqual({ name: "f(x)", body: null });
  });
  it("takes letters that only look like digits as digits on a line about x", () => {
    expect(mathsClause("x2-3ox+ho=o")).toBe("x2-30x+40=0");
    expect(equationOfLine(mathsClause("x2-3ox+ho=o"), "x")?.rhs).toBe("0");
  });
  it("takes the last of two equations, and nothing while it is half written", () => {
    expect(mathsClause("x2-3*x + 4o=0, x2-1=0")).toBe("x2-1=0");
    expect(equationLetter(mathsClause("x2-3*x + 40=0, x2-7"))).toBeNull();
  });
  it("leaves a decimal comma, a bracket's comma and a function's name alone", () => {
    expect(mathsClause("x = 2,5")).toBe("x = 2,5");
    expect(mathsClause("log(8, 2) = x")).toBe("log(8, 2) = x");
    expect(mathsClause("s(x) = x")).toBe("s(x) = x");
  });
  it("keeps a line with no x as it is", () => {
    expect(mathsClause("so 3 = 3")).toBe("so 3 = 3");
  });
});
