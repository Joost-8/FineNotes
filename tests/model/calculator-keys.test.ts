import { describe, expect, it } from "vitest";
import { calculate } from "../../src/model/calculator";
import {
  HEX_ROW,
  MEMORY_ROW,
  NUMBER_ROWS,
  SCIENTIFIC_ROWS,
  centredOrigin,
  keyEnabled,
  keyboardKey,
  spellAns,
  typeInto,
} from "../../src/model/calculator-keys";

const allKeys = [...SCIENTIFIC_ROWS.flat(), ...HEX_ROW, ...MEMORY_ROW, ...NUMBER_ROWS.flat()];

describe("calculator keypad", () => {
  it("fills six columns in every row", () => {
    for (const row of [...SCIENTIFIC_ROWS, HEX_ROW, MEMORY_ROW, ...NUMBER_ROWS]) {
      expect(row.reduce((sum, key) => sum + (key.span ?? 1), 0)).toBe(6);
    }
  });

  it("gives every key either text or an action", () => {
    for (const key of allKeys) expect(Boolean(key.insert) !== Boolean(key.action)).toBe(true);
  });

  it("types only what the engine reads", () => {
    // Each key's text, closed off with a 1 where it opens something, must calculate.
    for (const key of SCIENTIFIC_ROWS.flat()) {
      if (!key.insert || key.insert === "," || key.insert === "E") continue;
      const expr = key.continues ? `4${key.insert}2` : `${key.insert}1`;
      const twoArgs = /^(root|mod|nCr|nPr)\(/.test(key.insert);
      const result = calculate(twoArgs ? `${key.insert}4,2)` : expr);
      expect(result.ok, `${key.label}: ${expr}`).toBe(true);
    }
    expect(calculate("2E3").ok).toBe(true);
    expect(calculate("round(2.25,1)").ok).toBe(true);
  });

  it("switches keys off by base", () => {
    const key = (label: string) => allKeys.find((k) => k.label === label)!;
    expect(keyEnabled(key("sin"), 16)).toBe(false);
    expect(keyEnabled(key("sin"), 10)).toBe(true);
    expect(keyEnabled(key("mod"), 2)).toBe(true);
    expect(keyEnabled(key("2"), 2)).toBe(false);
    expect(keyEnabled(key("1"), 2)).toBe(true);
    expect(keyEnabled(key("8"), 8)).toBe(false);
    expect(keyEnabled(key("F"), 16)).toBe(true);
    expect(keyEnabled(key("."), 16)).toBe(false);
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
