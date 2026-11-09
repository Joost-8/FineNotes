/**
 * `src/model/calc-tex.ts`: a calculation note's sum as LaTeX (a division set
 * as a fraction), and its answer as a fraction and a decimal. Every LaTeX it
 * makes must read back through the equation parser (`model/latex.ts`)
 * without unknown commands, since the menu turns it into a typed equation.
 */

import { describe, expect, it } from "vitest";
import {
  CLEAN_GLYPHS,
  writeFraction,
  writeText,
  writeWithPowers,
} from "../../src/model/answer-glyphs";
import {
  answerForms,
  equationAnswer,
  expressionTex,
  polynomialAnswer,
} from "../../src/model/calc-tex";
import { evaluate } from "../../src/model/calculator";
import { parseLatex } from "../../src/model/latex";

function valueOf(expression: string) {
  const result = evaluate(expression);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("expressionTex", () => {
  it("makes LaTeX the equation parser reads without an unknown command", () => {
    const sums = [
      "(3*2)/7",
      "1+3/4",
      "2^(3+1)",
      "sqrt(16)+root(27,3)",
      "abs(-4)",
      "sin(pi)+ln(2)",
      "5!+10%",
      "1.5E3",
      "mod(7,3)",
    ];
    for (const sum of sums) {
      const tex = expressionTex(sum, { dot: true });
      expect(tex, sum).not.toBeNull();
      // An unknown command stays as its own text, backslash and all.
      expect(JSON.stringify(parseLatex(`${tex} = \\frac{6}{7}`)), sum).not.toMatch(/\\\\[a-z]/);
    }
  });

  it("sets a division as a fraction, its sides without their brackets", () => {
    expect(expressionTex("(3*2)/7")).toBe("\\frac{3\\times 2}{7}");
    expect(expressionTex("1+3/4")).toBe("1+\\frac{3}{4}");
    expect(expressionTex("(1/2)/3")).toBe("\\frac{\\frac{1}{2}}{3}");
  });

  it("writes times as × or, for a sum written with a raised dot, as ·", () => {
    expect(expressionTex("3*3")).toBe("3\\times 3");
    expect(expressionTex("3*3", { dot: true })).toBe("3\\cdot 3");
  });

  it("sets powers, roots, functions, constants and signs", () => {
    expect(expressionTex("2^(3+1)")).toBe("{2}^{3+1}");
    expect(expressionTex("sqrt(16)+root(27,3)")).toBe("\\sqrt{16}+\\sqrt[3]{27}");
    expect(expressionTex("abs(-4)")).toBe("\\left|-4\\right|");
    expect(expressionTex("sin(pi)")).toBe("\\sin\\left(\\pi\\right)");
    expect(expressionTex("5!+10%")).toBe("5!+10\\%");
    expect(expressionTex("-(2-3)")).toBe("-\\left(2-3\\right)");
    expect(expressionTex("2(3)")).toBe("2\\left(3\\right)");
    expect(expressionTex("1.5E3")).toBe("1.5\\times 10^{3}");
  });

  it("gives null for what is not one expression", () => {
    expect(expressionTex("")).toBeNull();
    expect(expressionTex("3*")).toBeNull();
    expect(expressionTex("(3")).toBeNull();
    expect(expressionTex("3 = 4")).toBeNull();
    expect(expressionTex("2)")).toBeNull();
  });
});

describe("answerForms", () => {
  it("offers 6/7 and its decimal for (3×2)/7", () => {
    const forms = answerForms(valueOf("(3*2)/7"));
    expect(forms?.fraction).toEqual({ n: "6", d: "7", text: "6/7", tex: "\\frac{6}{7}" });
    expect(forms?.decimal).toEqual({ text: "0.85714286", exact: false });
  });

  it("offers only the decimal for a whole number, and keeps a minus outside the fraction", () => {
    expect(answerForms(valueOf("3*3"))?.fraction).toBeNull();
    expect(answerForms(valueOf("3*3"))?.decimal.text).toBe("9");
    expect(answerForms(valueOf("-1/4"))?.fraction?.tex).toBe("-\\frac{1}{4}");
    expect(answerForms(valueOf("1/4"))?.decimal).toEqual({ text: "0.25", exact: true });
  });
});

describe("writeFraction", () => {
  const glyph = (w: number) => ({
    strokes: [[[0, 0] as [number, number], [w, 1] as [number, number]]],
    width: w,
  });
  const glyphs = new Map([
    ["6", glyph(0.5)],
    ["7", glyph(0.5)],
    ["1", glyph(0.2)],
    ["2", glyph(0.5)],
  ]);

  it("centres the top over the bottom across a bar level with the =", () => {
    const at = { x: 100, baseline: 200, height: 40 };
    const strokes = writeFraction("6", "12", glyphs, at);
    // 1 stroke for "6", the bar, 2 for "12".
    expect(strokes).toHaveLength(4);
    const bar = strokes[1];
    const barY = bar[1];
    expect(barY).toBeCloseTo(200 - 40 * 0.45, 5);
    const barMid = (bar[0] + bar[6]) / 2;
    const xs = (s: number[]) => s.filter((_, i) => i % 3 === 0);
    const mid = (ss: number[][]) => {
      const all = ss.flatMap(xs);
      return (Math.min(...all) + Math.max(...all)) / 2;
    };
    expect(mid([strokes[0]])).toBeCloseTo(barMid, 5);
    expect(mid(strokes.slice(2))).toBeCloseTo(barMid, 5);
    // The top sits over the bar, the bottom under it.
    expect(Math.max(...strokes[0].filter((_, i) => i % 3 === 1))).toBeLessThan(barY);
    expect(Math.min(...strokes[2].filter((_, i) => i % 3 === 1))).toBeGreaterThan(barY);
    // As a plain number it would have been one line.
    expect(writeText("612", glyphs, at)).toHaveLength(3);
  });
});

describe("names and letters (FineNotes#178)", () => {
  it("sets mod, a logarithm's base and a letter before a bracket", () => {
    expect(expressionTex("17 mod 5")).toBe(String.raw`17\bmod 5`);
    expect(expressionTex("log(8, 2)")).toBe(String.raw`\log_{2}\left(8\right)`);
    expect(expressionTex("x(x-3)")).toBe(String.raw`x\left(x-3\right)`);
    expect(expressionTex("5^(2)")).toBe("{5}^{2}");
  });

  it("expands a sum in one letter into its polynomial", () => {
    expect(polynomialAnswer("(2x+4)(4x+1)")?.decimal).toEqual({
      text: "8x^2+18x+4",
      exact: true,
      tex: "8x^{2}+18x+4",
      shown: "8x²+18x+4",
    });
    expect(polynomialAnswer("x(x-3)")?.decimal.text).toBe("x^2-3x");
    expect(polynomialAnswer("(a-1)(a+1)")?.decimal.shown).toBe("a²−1");
    expect(polynomialAnswer("(x+1)/2")?.decimal.tex).toBe(String.raw`\frac{1}{2}x+\frac{1}{2}`);
    expect(polynomialAnswer("(x-1)(x+1)-x^2+1")?.decimal.text).toBe("0");
    // No letter, two letters, or no polynomial: no expansion.
    expect(polynomialAnswer("3+4")).toBeNull();
    expect(polynomialAnswer("(x+y)(x-y)")).toBeNull();
    expect(polynomialAnswer("sin(x)")).toBeNull();
    expect(polynomialAnswer("1/x")).toBeNull();
  });
});

describe("writeWithPowers", () => {
  it("writes each power small and raised after its base", () => {
    const at = { x: 100, baseline: 200, height: 40 };
    const plain = writeText("8x", CLEAN_GLYPHS, at);
    const written = writeWithPowers("8x^2+1", CLEAN_GLYPHS, at);
    const two = writeText("2", CLEAN_GLYPHS, { x: 0, baseline: 0, height: 1 }).length;
    const powerStrokes = written.slice(plain.length, plain.length + two);
    const ys = powerStrokes.flatMap((s) => s.filter((_, i) => i % 3 === 1));
    const xs = powerStrokes.flatMap((s) => s.filter((_, i) => i % 3 === 0));
    // Its foot well above the line, and smaller than a digit.
    expect(Math.max(...ys)).toBeLessThan(200 - 40 * 0.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(40 * 0.7);
    // After the x.
    const xRight = Math.max(...plain.flatMap((s) => s.filter((_, i) => i % 3 === 0)));
    expect(Math.min(...xs)).toBeGreaterThan(xRight);
  });
});

describe("equationAnswer", () => {
  it("solves an equation in one letter", () => {
    expect(equationAnswer("2x+3", "7", "x")?.decimal).toMatchObject({ text: "2", shown: "2" });
    expect(equationAnswer("x^2", "9", "x")?.decimal).toMatchObject({
      text: "-3, 3",
      shown: "−3 or 3",
    });
    expect(equationAnswer("3x", "x+4", "x")?.decimal.text).toBe("2");
    expect(equationAnswer("2a+1", "5", "a")?.decimal.text).toBe("2");
  });

  it("offers nothing without a real solution, or with a second letter", () => {
    expect(equationAnswer("x^2+1", "0", "x")).toBeNull();
    expect(equationAnswer("y", "2x+1", "x")).toBeNull();
  });

  it("expands brackets whatever the case of their letter", () => {
    expect(polynomialAnswer("(X+7)(x+4)")?.decimal.text).toBe("x^2+11x+28");
  });
});
