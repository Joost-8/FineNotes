import { describe, expect, it } from "vitest";
import {
  CALC_WINDOW_MIN,
  DEFAULT_CALC_PREFS,
  defaultCalcPlace,
  withCalcWindow,
  HISTORY_MAX,
  HISTORY_NOTEBOOKS_MAX,
  historyOf,
  parseCalculatorData,
  renameCalculatorHistory,
  withEntry,
  withPrefs,
  withoutHistory,
  WINDOW_MIN,
  WINDOW_PILL,
  clampPlace,
  defaultPlace,
  windowOf,
  withWindow,
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
      prefs: { angle: "rad", fractions: true, base: 16, tab: "trig" },
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
    expect(data.prefs).toEqual({ angle: "rad", fractions: true, base: 16, tab: "trig" });
    expect(historyOf(data, "a.notebook.md")).toEqual([{ expr: "1+1", result: "2" }]);
    expect(data.history["c.md"].at).toBe(0);
    expect(historyOf(data, "b.md")).toEqual([]);
    expect(historyOf(data, "d.md")).toEqual([]);
    expect(historyOf(data, "toString")).toEqual([{ expr: "1", result: "1" }]);
    expect(historyOf(data, "constructor")).toEqual([]);
  });

  it("ignores bad switches", () => {
    const data = parseCalculatorData({
      prefs: { angle: "grad", fractions: 1, base: 3, tab: "graph" },
    });
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

describe("graph window places", () => {
  it("keeps a place per notebook, through a rename and a reload", () => {
    let data = withWindow(parseCalculatorData(undefined), "a.md", {
      x: 10,
      y: 20,
      w: 300,
      h: 250,
      minimised: true,
    });
    expect(windowOf(data, "a.md")).toEqual({ x: 10, y: 20, w: 300, h: 250, minimised: true });
    expect(windowOf(data, "b.md")).toBeNull();
    const again = parseCalculatorData(JSON.parse(JSON.stringify(data)));
    expect(windowOf(again, "a.md")).toEqual(windowOf(data, "a.md"));
    data = renameCalculatorHistory(data, "a.md", "c.md")!;
    expect(windowOf(data, "c.md")?.w).toBe(300);
    expect(windowOf(data, "a.md")).toBeNull();
    expect(withPrefs(data, { base: 2 }).windows).toBe(data.windows);
  });

  it("drops a malformed place", () => {
    const data = parseCalculatorData({
      windows: {
        a: { x: 1, y: 2, w: 0, h: 5 },
        b: "x",
        c: { x: 1, y: "2", w: 3, h: 4 },
        d: { x: 1, y: 2, w: 300, h: 300, minimised: "no" },
      },
    });
    expect(Object.keys(data.windows)).toEqual(["d"]);
    expect(data.windows.d.minimised).toBeUndefined();
  });

  it("opens top right, and stays inside the view whatever happens to it", () => {
    const first = defaultPlace({ w: 1200, h: 800 });
    expect(first).toEqual({ x: 1200 - 400 - 16, y: 64, w: 400, h: 380 });
    // A split view narrower than the window: it shrinks to fit, never below its minimum.
    expect(clampPlace({ x: 900, y: 50, w: 400, h: 300 }, { w: 500, h: 800 })).toEqual({
      x: 92,
      y: 50,
      w: 400,
      h: 300,
    });
    expect(clampPlace({ x: 900, y: 50, w: 400, h: 300 }, { w: 300, h: 800 })).toEqual({
      x: 8,
      y: 50,
      w: 284,
      h: 300,
    });
    expect(clampPlace({ x: 0, y: 0, w: 100, h: 100 }, { w: 1000, h: 1000 })).toMatchObject({
      w: WINDOW_MIN.w,
      h: WINDOW_MIN.h,
    });
    // Rotated to portrait: dragged back inside.
    expect(clampPlace({ x: 1100, y: 700, w: 300, h: 300 }, { w: 820, h: 1180 })).toEqual({
      x: 512,
      y: 700,
      w: 300,
      h: 300,
    });
    // Off the top or left.
    expect(clampPlace({ x: -50, y: -50, w: 300, h: 300 }, { w: 800, h: 800 })).toMatchObject({
      x: 8,
      y: 8,
    });
    // A pill keeps its window size and needs only its own room.
    expect(
      clampPlace({ x: 790, y: 790, w: 300, h: 300, minimised: true }, { w: 800, h: 800 }),
    ).toEqual({
      x: 800 - WINDOW_PILL.w - 8,
      y: 800 - WINDOW_PILL.h - 8,
      w: 300,
      h: 300,
      minimised: true,
    });
  });
});

describe("the calculator's window", () => {
  const view = { w: 1180, h: 760 };

  it("opens top left, under the toolbar, at least its minimum and inside the view", () => {
    const place = defaultCalcPlace(view);
    expect(place.x).toBe(16);
    expect(place.y).toBe(64);
    expect(place.w).toBeGreaterThanOrEqual(CALC_WINDOW_MIN.w);
    expect(place.h).toBeGreaterThanOrEqual(CALC_WINDOW_MIN.h);
    expect(place.y + place.h).toBeLessThanOrEqual(view.h);
  });

  it("is never sized below its own minimum, larger than the graph window's", () => {
    const place = clampPlace({ x: 20, y: 20, w: 10, h: 10 }, view, CALC_WINDOW_MIN);
    expect([place.w, place.h]).toEqual([CALC_WINDOW_MIN.w, CALC_WINDOW_MIN.h]);
    expect(clampPlace({ x: 20, y: 20, w: 10, h: 10 }, view).h).toBe(WINDOW_MIN.h);
  });

  it("keeps one place for every notebook, through a save, a load and the other edits", () => {
    const place = { x: 40, y: 80, w: 420, h: 640 };
    let data = withCalcWindow(parseCalculatorData(null), place);
    data = withEntry(data, "a.notebook.md", { expr: "1+1", result: "2" }, 1);
    data = withoutHistory(data, "b.notebook.md");
    data = renameCalculatorHistory(data, "a.notebook.md", "c.notebook.md") ?? data;
    const loaded = parseCalculatorData(JSON.parse(JSON.stringify(data)));
    expect(loaded.calcWindow).toEqual(place);
    expect(parseCalculatorData({ calcWindow: { x: 1, y: 2, w: -5, h: 9 } }).calcWindow).toBe(
      undefined,
    );
  });
});
