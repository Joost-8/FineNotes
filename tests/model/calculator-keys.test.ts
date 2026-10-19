import { describe, expect, it } from "vitest";
import { calculate } from "../../src/model/calculator";
import {
  type CalcKey,
  HEX_ROW,
  NUMBER_ROWS,
  SCIENTIFIC_ROWS,
  centredOrigin,
  fittedFontSize,
  keyEnabled,
  keyboardKey,
  shownKey,
  spellAns,
  typeInto,
} from "../../src/model/calculator-keys";

const faces = (keys: readonly CalcKey[]): CalcKey[] =>
  keys.flatMap((k) => (k.shift ? [k, k.shift] : [k]));
const allKeys = faces([...SCIENTIFIC_ROWS.flat(), ...HEX_ROW, ...NUMBER_ROWS.flat()]);
const key = (label: string): CalcKey => {
  const found = allKeys.find((k) => k.label === label);
  if (!found) throw new Error(label);
  return found;
};

/** A complete expression using `k`'s text. */
function exercise(k: CalcKey): string {
  const text = k.insert ?? "";
  if (k.continues) return `4${text}2`;
  if (/^(root|mod|nCr|nPr|log)\($/.test(text)) return `${text}8,2)`;
  if (text === "d/dx(") return "d/dx(x^2,3)";
  if (text === "∫(") return "∫(x,0,1)";
  if (text === "Σ(") return "Σ(x,1,3)";
  if (text === "solve(") return "solve(x-1,0)";
  if (text === "E") return "2E3";
  if (text === "x") return "solve(x-2,0)";
  if (text === ",") return "log(8,2)";
  if (text === ")") return "(1)";
  if (text === "Ans") return "Ans+1";
  return `${text}1`;
}

describe("calculator keypad", () => {
  it("fills six columns a function row and five a number row", () => {
    for (const row of [...SCIENTIFIC_ROWS, HEX_ROW]) {
      expect(row.reduce((sum, k) => sum + (k.span ?? 1), 0)).toBe(6);
    }
    for (const row of NUMBER_ROWS) expect(row.reduce((sum, k) => sum + (k.span ?? 1), 0)).toBe(5);
  });

  it("gives every key, and every second meaning, either text or an action", () => {
    for (const k of allKeys) expect(Boolean(k.insert) !== Boolean(k.action), k.label).toBe(true);
  });

  it("types only what the engine reads", () => {
    for (const k of allKeys) {
      if (!k.insert) continue;
      const expr = exercise(k);
      // Hex digits are read as digits in base 16 only.
      const result = calculate(expr, { base: (k.digit ?? 0) >= 10 ? 16 : 10 });
      expect(result.ok, `${k.label}: ${expr} ${result.ok ? "" : result.error}`).toBe(true);
    }
  });

  it("shows second meanings while 2nd is on", () => {
    expect(shownKey(key("sin"), true).label).toBe("sin⁻¹");
    expect(shownKey(key("sin"), false).label).toBe("sin");
    expect(shownKey(key("π"), true).label).toBe("π");
  });

  it("switches keys off by base", () => {
    expect(keyEnabled(key("sin"), 16)).toBe(false);
    expect(keyEnabled(key("sin"), 10)).toBe(true);
    expect(keyEnabled(key("mod"), 2)).toBe(true);
    expect(keyEnabled(key("2"), 2)).toBe(false);
    expect(keyEnabled(key("1"), 2)).toBe(true);
    expect(keyEnabled(key("8"), 8)).toBe(false);
    expect(keyEnabled(key("F"), 16)).toBe(true);
    expect(keyEnabled(key("."), 16)).toBe(false);
    expect(keyEnabled(key("x"), 16)).toBe(false);
  });

  it("starts again after a result, or carries it on with an operator", () => {
    const shown = { expr: "", fresh: true };
    expect(typeInto(shown, "7", false)).toEqual({ expr: "7", fresh: false });
    expect(typeInto(shown, "×", true)).toEqual({ expr: "Ans×", fresh: false });
    expect(typeInto({ expr: "1+", fresh: false }, "2", false)).toEqual({
      expr: "1+2",
      fresh: false,
    });
  });

  it("maps a hardware keyboard", () => {
    expect(keyboardKey("Enter")).toEqual({ action: "equals" });
    expect(keyboardKey("=")).toEqual({ action: "equals" });
    expect(keyboardKey("Backspace")).toEqual({ action: "back" });
    expect(keyboardKey("Delete")).toEqual({ action: "clear" });
    expect(keyboardKey("*")).toEqual({ insert: "×", continues: true });
    expect(keyboardKey("/")).toEqual({ insert: "÷", continues: true });
    expect(keyboardKey("-")).toEqual({ insert: "−", continues: true });
    expect(keyboardKey("^")).toEqual({ insert: "^", continues: true });
    expect(keyboardKey("7")).toEqual({ insert: "7", continues: false });
    expect(keyboardKey("s")).toEqual({ insert: "s", continues: false });
    expect(keyboardKey("ArrowLeft")).toBeNull();
    expect(keyboardKey("#")).toBeNull();
  });

  it("spells out Ans", () => {
    expect(spellAns("Ans×2", "42")).toBe("42×2");
    expect(spellAns("Ans×2", "-3")).toBe("(-3)×2");
    expect(spellAns("Ans^2", "1/3")).toBe("(1/3)^2");
    expect(spellAns("1+1", "5")).toBe("1+1");
    expect(spellAns("Ans+1", "FF")).toBe("FF+1");
  });

  it("shrinks the result to fit, down to a floor", () => {
    expect(fittedFontSize(200, 300, 34, 16)).toBe(34);
    expect(fittedFontSize(600, 300, 34, 16)).toBe(17);
    expect(fittedFontSize(6000, 300, 34, 16)).toBe(16);
  });
});

describe("centredOrigin", () => {
  it("centres in the view and keeps the box on the page", () => {
    const page = { width: 800, height: 1000 };
    expect(centredOrigin({ x: 100, y: 200, w: 400, h: 400 }, page, 100, 20)).toEqual({
      x: 250,
      y: 390,
    });
    expect(centredOrigin(null, page, 200, 100)).toEqual({ x: 300, y: 450 });
    expect(centredOrigin({ x: 700, y: 950, w: 100, h: 50 }, page, 300, 100)).toEqual({
      x: 500,
      y: 900,
    });
    expect(centredOrigin(null, page, 1000, 20)).toEqual({ x: 0, y: 490 });
  });
});
