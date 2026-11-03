import { describe, expect, it } from "vitest";
import {
  NO_PILL_ROW,
  followTopShift,
  pageTopShift,
  parsePillRowOn,
  pillRow,
  pillRowEdge,
} from "../../src/view/pill-row-model";

describe("parsePillRowOn", () => {
  it("is on only when it was saved on", () => {
    expect(parsePillRowOn("on")).toBe(true);
    expect(parsePillRowOn(true)).toBe(true);
    for (const raw of [null, undefined, "off", "", 1, "true", {}]) {
      expect(parsePillRowOn(raw)).toBe(false);
    }
  });
});

describe("pillRowEdge", () => {
  it("is off when docking is off, wherever the pill rests", () => {
    expect(pillRowEdge(false, "top", "top")).toBeNull();
    expect(pillRowEdge(false, "bottom", "bottom")).toBeNull();
  });

  it("takes the bar's edge when the pill rests by a bar along the top or bottom", () => {
    expect(pillRowEdge(true, "top", "top")).toBe("top");
    expect(pillRowEdge(true, "bottom", "bottom")).toBe("bottom");
  });

  it("leaves an upright bar's pill and a pill carried to another edge floating", () => {
    expect(pillRowEdge(true, "left", "left")).toBeNull();
    expect(pillRowEdge(true, "right", "right")).toBeNull();
    expect(pillRowEdge(true, "bottom", "top")).toBeNull();
    expect(pillRowEdge(true, "top", "bottom")).toBeNull();
    expect(pillRowEdge(true, "top", "left")).toBeNull();
  });
});

describe("pillRow", () => {
  const base = { edge: "top" as const, shown: true, anchored: false, height: 44, gap: 8 };

  it("holds the pill and a gap either side", () => {
    expect(pillRow({ ...base, previous: NO_PILL_ROW })).toEqual({ edge: "top", room: 60 });
    expect(pillRow({ ...base, edge: "bottom", previous: NO_PILL_ROW })).toEqual({
      edge: "bottom",
      room: 60,
    });
  });

  it("follows the pill's height and rounds to whole px", () => {
    expect(pillRow({ ...base, height: 50.4, previous: NO_PILL_ROW }).room).toBe(66);
  });

  it("collapses while the pill is tucked away or has nothing to show", () => {
    expect(pillRow({ ...base, shown: false, previous: NO_PILL_ROW })).toEqual(NO_PILL_ROW);
    expect(pillRow({ ...base, height: 0, previous: NO_PILL_ROW })).toEqual(NO_PILL_ROW);
    expect(pillRow({ ...base, height: Number.NaN, previous: NO_PILL_ROW })).toEqual(NO_PILL_ROW);
  });

  it("is nothing without an edge, whatever came before", () => {
    const previous = { edge: "top" as const, room: 60 };
    expect(pillRow({ ...base, edge: null, previous })).toEqual(NO_PILL_ROW);
    expect(pillRow({ ...base, edge: null, anchored: true, previous })).toEqual(NO_PILL_ROW);
  });

  it("keeps its room while the pill floats by a text box", () => {
    const previous = { edge: "top" as const, room: 60 };
    expect(pillRow({ ...base, anchored: true, height: 30, previous })).toBe(previous);
    expect(pillRow({ ...base, anchored: true, shown: false, previous })).toBe(previous);
    // A row that was on the other edge is not carried over.
    expect(pillRow({ ...base, edge: "bottom", anchored: true, previous })).toEqual(NO_PILL_ROW);
  });

  it("never takes room for a negative gap", () => {
    expect(pillRow({ ...base, gap: -5, previous: NO_PILL_ROW }).room).toBe(44);
  });
});

describe("pageTopShift", () => {
  const top = { edge: "top" as const, room: 60 };
  const bottom = { edge: "bottom" as const, room: 60 };

  it("moves the page's top only for a row along the top", () => {
    expect(pageTopShift(NO_PILL_ROW, top)).toBe(60);
    expect(pageTopShift(top, NO_PILL_ROW)).toBe(-60);
    expect(pageTopShift(top, { edge: "top", room: 66 })).toBe(6);
    expect(pageTopShift(NO_PILL_ROW, bottom)).toBe(0);
    expect(pageTopShift(bottom, NO_PILL_ROW)).toBe(0);
    expect(pageTopShift(top, bottom)).toBe(-60);
  });
});

describe("followTopShift", () => {
  it("moves the offset with the page's top, so the spot read stays still", () => {
    expect(followTopShift(500, 60, 0)).toBe(560);
    expect(followTopShift(500, -60, 0)).toBe(440);
  });

  it("leaves the start of the notebook where it starts, clear of the row", () => {
    expect(followTopShift(0, 60, 0)).toBe(0);
    expect(followTopShift(0.3, 60, 0)).toBe(0.3);
    expect(followTopShift(-40, 60, -40)).toBe(-40);
  });

  it("never scrolls before the start", () => {
    expect(followTopShift(30, -60, 0)).toBe(0);
  });

  it("does nothing for no shift", () => {
    expect(followTopShift(123, 0, 0)).toBe(123);
  });
});
