import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALC_PREFS,
  HISTORY_MAX,
  HISTORY_NOTEBOOKS_MAX,
  historyOf,
  parseCalculatorData,
  renameCalculatorHistory,
  withEntry,
  withPrefs,
  withoutHistory,
} from "../../src/model/calculator-store";

describe("calculator store", () => {
  it("starts empty with the default switches", () => {
    for (const raw of [undefined, null, 3, "x", [], {}]) {
      const data = parseCalculatorData(raw);
      expect(data.prefs).toEqual(DEFAULT_CALC_PREFS);
      expect(Object.keys(data.history)).toEqual([]);
    }
  });

  it("keeps well-formed data and drops the rest", () => {
    const data = parseCalculatorData({
      prefs: { angle: "rad", fractions: true, base: 16 },
      history: {
        "a.notebook.md": {
          entries: [
            { expr: "1+1", result: "2" },
            { expr: "", result: "2" },
            { expr: "x", result: 3 },
            "junk",
            { expr: "y".repeat(600), result: "1" },
          ],
          at: 5,
        },
        "b.md": { entries: "nope" },
        "c.md": { entries: [{ expr: "2", result: "2" }], at: "late" },
        "d.md": { entries: [] },
        "": { entries: [{ expr: "1", result: "1" }] },
        toString: { entries: [{ expr: "1", result: "1" }], at: 1 },
      },
    });
    expect(data.prefs).toEqual({ angle: "rad", fractions: true, base: 16 });
    expect(historyOf(data, "a.notebook.md")).toEqual([{ expr: "1+1", result: "2" }]);
    expect(data.history["c.md"].at).toBe(0);
    expect(historyOf(data, "b.md")).toEqual([]);
    expect(historyOf(data, "d.md")).toEqual([]);
    expect(historyOf(data, "toString")).toEqual([{ expr: "1", result: "1" }]);
    expect(historyOf(data, "constructor")).toEqual([]);
  });

  it("ignores bad switches", () => {
    const data = parseCalculatorData({ prefs: { angle: "grad", fractions: 1, base: 3 } });
    expect(data.prefs).toEqual(DEFAULT_CALC_PREFS);
  });

  it("adds newest first, without repeating the top line, up to the cap", () => {
    let data = parseCalculatorData(undefined);
    data = withEntry(data, "n", { expr: "1+1", result: "2" }, 1);
    data = withEntry(data, "n", { expr: "1+1", result: "2" }, 2);
    expect(historyOf(data, "n")).toHaveLength(1);
    data = withEntry(data, "n", { expr: "2+2", result: "4" }, 3);
    expect(historyOf(data, "n")[0].expr).toBe("2+2");
    for (let i = 0; i < HISTORY_MAX + 5; i++) {
      data = withEntry(data, "n", { expr: `${i}`, result: `${i}` }, 10 + i);
    }
    expect(historyOf(data, "n")).toHaveLength(HISTORY_MAX);
  });

  it("does not change the data it was given", () => {
    const before = parseCalculatorData(undefined);
    withEntry(before, "n", { expr: "1", result: "1" }, 1);
    expect(historyOf(before, "n")).toEqual([]);
  });

  it("forgets the notebooks used longest ago", () => {
    let data = parseCalculatorData(undefined);
    for (let i = 0; i <= HISTORY_NOTEBOOKS_MAX; i++) {
      data = withEntry(data, `n${i}`, { expr: "1", result: "1" }, i);
    }
    expect(Object.keys(data.history)).toHaveLength(HISTORY_NOTEBOOKS_MAX);
    expect(historyOf(data, "n0")).toEqual([]);
    expect(historyOf(data, `n${HISTORY_NOTEBOOKS_MAX}`)).toHaveLength(1);
  });

  it("clears, renames and changes switches", () => {
    let data = withEntry(parseCalculatorData(undefined), "a", { expr: "1", result: "1" }, 1);
    expect(renameCalculatorHistory(data, "x", "y")).toBeNull();
    expect(renameCalculatorHistory(data, "a", "a")).toBeNull();
    const moved = renameCalculatorHistory(data, "a", "b");
    expect(moved && historyOf(moved, "b")).toHaveLength(1);
    expect(moved && historyOf(moved, "a")).toEqual([]);
    data = withoutHistory(data, "a");
    expect(historyOf(data, "a")).toEqual([]);
    data = withPrefs(data, { base: 2 });
    expect(data.prefs).toEqual({ ...DEFAULT_CALC_PREFS, base: 2 });
  });
});
