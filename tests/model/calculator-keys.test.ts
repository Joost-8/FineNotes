import { describe, expect, it } from "vitest";
import { calculate, deleteLast } from "../../src/model/calculator";
import {
  ACTIVE_BOX,
  CARET,
  type CalcKey,
  KEY_TABS,
  NUMBER_ROWS,
  TAB_ROWS,
  backspace,
  boxes,
  centredOrigin,
  fittedFontSize,
  hintFor,
  isKeyTab,
  keyEnabled,
  keyboardKey,
  moveCursor,
  nextBox,
  shownKey,
  spellAns,
  typeInto,
  withCursor,
} from "../../src/model/calculator-keys";

const faces = (keys: ReadonlyArray<CalcKey | null>): CalcKey[] =>
  keys.flatMap((k) => (k === null ? [] : k.shift ? [k, k.shift] : [k]));
const tabKeys = Object.values(TAB_ROWS).flatMap((rows) => faces(rows.flat()));
const allKeys = [...tabKeys, ...faces(NUMBER_ROWS.flat())];
const key = (label: string): CalcKey => {
  const found = allKeys.find((k) => k.label === label);
  if (!found) throw new Error(label);
  return found;
};

/** A key's text with its boxes filled, so it calculates. */
function exercise(k: CalcKey): string {
  const text = (k.insert ?? "").replace(/▢ = ▢/, "x = 2").replace(/▢/g, "2");
  if (k.continues) return `4${text}2`;
  if (text === "x") return "solve(x = 2, 0)";
  if (text === "E") return "2E3";
  if (text === ",") return "log(8,2)";
  if (text === ")") return "(1)";
  if (text === "Ans") return "Ans+1";
  if (text === "∞") return "lim(1/x, ∞)";
  if (/^(asec|acsc)\($/.test(text)) return `${text}2)`;
  if (
    /^(sin|cos|tan|sec|csc|cot|asin|acos|atan|asec|acsc|acot|sinh|cosh|tanh|asinh|atanh|ln|log|abs|√|e\^|10\^)\($/.test(
      text,
    )
  ) {
    return `${text}0.5)`;
  }
  if (text === "acosh(") return "acosh(2)";
  if (
    text.startsWith("d/dx(") ||
    text.startsWith("∫(") ||
    text.startsWith("Σ(") ||
    text.startsWith("Π(") ||
    text.startsWith("lim(")
  ) {
    return text.replace(/\(2/, "(x");
  }
  return text.endsWith("(") ? `${text}1)` : `${text}1`;
}

describe("calculator keypad", () => {
  it("fills six columns in every row of every tab, and five a number row", () => {
    for (const rows of Object.values(TAB_ROWS)) {
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row).toHaveLength(6);
    }
    for (const row of NUMBER_ROWS) expect(row.reduce((sum, k) => sum + (k.span ?? 1), 0)).toBe(5);
  });

  it("gives every key text or an action, and a help line", () => {
    for (const k of allKeys) {
      expect(Boolean(k.insert) !== Boolean(k.action), k.label).toBe(true);
      if (k.digit === undefined || k.digit >= 10) expect(k.help, k.label).toBeTruthy();
    }
  });

  it("types only what the engine reads", () => {
    for (const k of allKeys) {
      if (
        !k.insert ||
        ["y", "=", "<", ">", "≤", "≥", "t", "θ", "r", "{", "}", "a", "b", "k"].includes(k.insert)
      )
        continue;
      const expr = exercise(k);
      // Hex digits are read as digits in base 16 only.
      const base = (k.digit ?? 0) >= 10 ? 16 : 10;
      const result = calculate(expr, { base, angle: "rad" });
      expect(result.ok, `${k.label}: ${expr} ${result.ok ? "" : result.error}`).toBe(true);
    }
  });

  it("knows its tabs", () => {
    expect(KEY_TABS.map((t) => t.id)).toEqual([
      "basic",
      "trig",
      "calculus",
      "bases",
      "memory",
      "graph",
    ]);
    expect(isKeyTab("trig")).toBe(true);
    expect(isKeyTab("nope")).toBe(false);
  });

  it("shows second meanings while 2nd is on", () => {
    expect(shownKey(key("sin"), true).label).toBe("sin⁻¹");
    expect(shownKey(key("sin"), false).label).toBe("sin");
    expect(shownKey(key("π"), true).label).toBe("π");
  });

  it("switches keys off by base", () => {
    expect(keyEnabled(key("sin"), 16)).toBe(false);
    expect(keyEnabled(key("sin"), 10)).toBe(true);
    expect(keyEnabled(key("AND"), 2)).toBe(true);
    expect(keyEnabled(key("2"), 2)).toBe(false);
    expect(keyEnabled(key("1"), 2)).toBe(true);
    expect(keyEnabled(key("8"), 8)).toBe(false);
    expect(keyEnabled(key("F"), 16)).toBe(true);
    expect(keyEnabled(key("F"), 10)).toBe(false);
    expect(keyEnabled(key("."), 16)).toBe(false);
    expect(keyEnabled(key("x"), 16)).toBe(false);
  });
});

describe("typing", () => {
  it("starts again after a result, or carries it on with an operator", () => {
    const shown = { expr: "", fresh: true };
    expect(typeInto(shown, "7", false)).toEqual({ expr: "7", cursor: 1, fresh: false });
    expect(typeInto(shown, "×", true)).toEqual({ expr: "Ans×", cursor: 4, fresh: false });
    expect(typeInto({ expr: "1+", fresh: false }, "2", false)).toEqual({
      expr: "1+2",
      cursor: 3,
      fresh: false,
    });
  });

  it("puts the cursor in a template's first box, fills boxes, and moves on", () => {
    let e = typeInto({ expr: "", cursor: 0, fresh: false }, "solve(▢ = ▢, ▢)", false);
    expect(e.cursor).toBe(6);
    e = typeInto(e, "x²", false);
    expect(e.expr).toBe("solve(x² = ▢, ▢)");
    expect(e.cursor).toBe(8);
    e = nextBox(e);
    expect(e.expr[e.cursor!]).toBe("▢");
    e = typeInto(e, "2", false);
    e = nextBox(e);
    e = typeInto(e, "1", false);
    expect(e.expr).toBe("solve(x² = 2, 1)");
    expect(boxes(e.expr)).toEqual([]);
    expect(calculate(e.expr, { angle: "rad" })).toMatchObject({ ok: true, text: "1.41421356237" });
    expect(nextBox(e)).toBe(e);
  });

  it("types a template into a box, and at the cursor in the middle", () => {
    let e = typeInto({ expr: "", fresh: false }, "d/dx(▢, ▢)", false);
    e = typeInto(e, "sin(", false);
    expect(e.expr).toBe("d/dx(sin(, ▢)");
    e = { expr: "1+3", cursor: 2, fresh: false };
    expect(typeInto(e, "2", false)).toEqual({ expr: "1+23", cursor: 3, fresh: false });
  });

  it("marks the cursor for the display", () => {
    expect(withCursor({ expr: "1+2", fresh: false })).toBe(`1+2${CARET}`);
    expect(withCursor({ expr: "1+2", cursor: 1, fresh: false })).toBe(`1${CARET}+2`);
    expect(withCursor({ expr: "f(▢, ▢)", cursor: 5, fresh: false })).toBe(`f(▢, ${ACTIVE_BOX})`);
  });

  it("deletes at the cursor, giving a box back to an emptied input", () => {
    expect(backspace({ expr: "sin(", fresh: false }, deleteLast)).toEqual({
      expr: "",
      cursor: 0,
      fresh: false,
    });
    expect(backspace({ expr: "7", fresh: true }, deleteLast)).toEqual({
      expr: "",
      cursor: 0,
      fresh: false,
    });
    expect(backspace({ expr: "f(2, ▢)", cursor: 3, fresh: false }, deleteLast)).toEqual({
      expr: "f(▢, ▢)",
      cursor: 2,
      fresh: false,
    });
    // At a box, ⌫ steps back to the box before.
    expect(backspace({ expr: "f(▢, ▢)", cursor: 5, fresh: false }, deleteLast).cursor).toBe(2);
    expect(backspace({ expr: "12+3", cursor: 2, fresh: false }, deleteLast)).toEqual({
      expr: "1+3",
      cursor: 1,
      fresh: false,
    });
    expect(backspace({ expr: "solve(x = ▢, 1)", cursor: 7, fresh: false }, deleteLast).expr).toBe(
      "solve(▢ = ▢, 1)",
    );
    const start = { expr: "12", cursor: 0, fresh: false };
    expect(backspace(start, deleteLast)).toBe(start);
  });

  it("moves the cursor within bounds", () => {
    expect(moveCursor({ expr: "12", fresh: false }, -1).cursor).toBe(1);
    expect(moveCursor({ expr: "12", cursor: 0, fresh: false }, -1).cursor).toBe(0);
    expect(moveCursor({ expr: "12", cursor: 2, fresh: false }, 1).cursor).toBe(2);
    const fresh = { expr: "12", fresh: true };
    expect(moveCursor(fresh, 1)).toBe(fresh);
  });

  it("says what a function's inputs are while the cursor is in them", () => {
    const at = (expr: string, cursor?: number) => hintFor({ expr, cursor, fresh: false });
    expect(at("solve(▢ = ▢, ▢)", 6)).toMatch(/^solve\(f = g, near\)/);
    expect(at("d/dx(x², 3")).toMatch(/slope/);
    expect(at("∫(x, 0, 1")).toMatch(/area/);
    expect(at("2+log(8, ")).toMatch(/base b/);
    expect(at("lim(sin(x)/x, ")).toMatch(/tends/);
    expect(at("sin(30")).toBe("");
    expect(at("f(▢)")).toBe("Fill in the boxes; = goes to the next one");
    expect(hintFor({ expr: "solve(", fresh: true })).toBe("");
  });
});

describe("keyboard and the rest", () => {
  it("maps a hardware keyboard", () => {
    expect(keyboardKey("Enter")).toEqual({ action: "equals" });
    expect(keyboardKey("=")).toEqual({ insert: "=", continues: false });
    expect(keyboardKey("Backspace")).toEqual({ action: "back" });
    expect(keyboardKey("Delete")).toEqual({ action: "clear" });
    expect(keyboardKey("ArrowLeft")).toEqual({ move: -1 });
    expect(keyboardKey("Tab")).toEqual({ move: 1 });
    expect(keyboardKey("*")).toEqual({ insert: "×", continues: true });
    expect(keyboardKey("/")).toEqual({ insert: "÷", continues: true });
    expect(keyboardKey("-")).toEqual({ insert: "−", continues: true });
    expect(keyboardKey("^")).toEqual({ insert: "^", continues: true });
    expect(keyboardKey("<")).toEqual({ insert: "<", continues: false });
    expect(keyboardKey("7")).toEqual({ insert: "7", continues: false });
    expect(keyboardKey("s")).toEqual({ insert: "s", continues: false });
    expect(keyboardKey("Shift")).toBeNull();
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

  it("centres a box in the view and keeps it on the page", () => {
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
