/**
 * Cover tape (`model/cover-tape`): a strip over the page, stored as a stroke
 * with `tool: "tape"`, shown through only in the view.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAPE_COLOR,
  DEFAULT_TAPE_HEIGHT,
  TAPE_HEIGHTS,
  allRevealed,
  isTape,
  tapeColorOf,
  tapeContains,
  tapeCorners,
  tapeEnds,
  tapeHeightOf,
  tapePoints,
  tapesLast,
  toggleRevealed,
  topTapeAt,
} from "../../src/model/cover-tape";
import type { Stroke } from "../../src/model/document";

function tape(id: string, pts: number[], size = 20): Stroke {
  return { id, color: "#e6d3a3", size, tool: "tape", pts };
}

function ink(id: string): Stroke {
  return { id, color: "#000000", size: 2, tool: "pen", pts: [0, 0, 0.5, 10, 10, 0.5] };
}

describe("a tape's geometry", () => {
  it("is the band between its first and last points, `size` tall", () => {
    const corners = tapeCorners([0, 0, 0.5, 100, 0, 0.5], 20);
    expect(corners).toEqual([
      { x: 0, y: -10 },
      { x: 100, y: -10 },
      { x: 100, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("turns with its ends", () => {
    const corners = tapeCorners([0, 0, 0.5, 0, 100, 0.5], 20) ?? [];
    expect(corners[0].x).toBeCloseTo(10);
    expect(corners[2].x).toBeCloseTo(-10);
    expect(corners[1].y).toBeCloseTo(100);
  });

  it("takes the last whole point as its far end, and ignores a ragged tail", () => {
    expect(tapeEnds([0, 0, 0.5, 5, 5, 0.5, 40, 0, 0.5, 99])).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 40, y: 0 },
    });
    expect(tapeEnds([1, 2])).toBeNull();
    expect(tapeEnds([Number.NaN, 0, 0.5])).toBeNull();
  });

  it("is a square when both ends are one point, and nothing without a height", () => {
    expect(tapeCorners([50, 50, 0.5], 20)).toEqual([
      { x: 40, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 60 },
      { x: 40, y: 60 },
    ]);
    expect(tapeCorners([0, 0, 0.5, 10, 0, 0.5], 0)).toBeNull();
  });
});

describe("finding a tape", () => {
  const a = tape("a", [0, 0, 0.5, 100, 0, 0.5]);
  const b = tape("b", [50, 0, 0.5, 50, 100, 0.5]);

  it("holds a point inside its band, not past its ends or edges", () => {
    expect(tapeContains(a, 50, 9)).toBe(true);
    expect(tapeContains(a, 50, 11)).toBe(false);
    expect(tapeContains(a, 50, 11, 2)).toBe(true);
    expect(tapeContains(a, -1, 0)).toBe(false);
    expect(tapeContains(a, 101, 0, 2)).toBe(true);
    expect(tapeContains(tape("dot", [0, 0, 0.5]), 9, -9)).toBe(true);
    expect(tapeContains(tape("dot", [0, 0, 0.5]), 11, 0)).toBe(false);
    expect(tapeContains(tape("none", []), 0, 0)).toBe(false);
  });

  it("picks the one on top, and never ink", () => {
    expect(topTapeAt([a, b], 50, 0)?.id).toBe("b");
    expect(topTapeAt([b, a], 50, 0)?.id).toBe("a");
    expect(topTapeAt([a, ink("i")], 5, 5)?.id).toBe("a");
    expect(topTapeAt([ink("i")], 5, 5)).toBeNull();
    expect(isTape(a)).toBe(true);
    expect(isTape(ink("i"))).toBe(false);
  });
});

describe("laying a tape", () => {
  it("runs from where the drag started to where it lifted", () => {
    expect(tapePoints({ x: 0, y: 0 }, { x: 100, y: 40 }, 8)).toEqual([0, 0, 0.5, 100, 40, 0.5]);
  });

  it("comes out level when nearly so", () => {
    const pts = tapePoints({ x: 0, y: 0 }, { x: 200, y: 3 }, 8) ?? [];
    expect(pts[4]).toBe(0);
    expect(pts[3]).toBeCloseTo(200, 1);
  });

  it("lays nothing for a tap, or for a point that is not a number", () => {
    expect(tapePoints({ x: 0, y: 0 }, { x: 3, y: 2 }, 8)).toBeNull();
    expect(tapePoints({ x: 0, y: 0 }, { x: Number.NaN, y: 2 }, 8)).toBeNull();
  });
});

describe("painting order", () => {
  it("puts the tapes after the ink, each in its own order", () => {
    const list = [tape("t1", [0, 0, 0.5]), ink("i1"), tape("t2", [0, 0, 0.5]), ink("i2")];
    expect(tapesLast(list).map((s) => s.id)).toEqual(["i1", "i2", "t1", "t2"]);
  });

  it("hands back the list itself when nothing moves", () => {
    const list = [ink("i1"), tape("t1", [0, 0, 0.5])];
    expect(tapesLast(list)).toBe(list);
    const none = [ink("i1")];
    expect(tapesLast(none)).toBe(none);
  });
});

describe("showing tapes through", () => {
  it("toggles one id, leaving the set it was given alone", () => {
    const before = new Set(["x"]);
    const after = toggleRevealed(before, "a");
    expect([...after].sort()).toEqual(["a", "x"]);
    expect([...toggleRevealed(after, "x")]).toEqual(["a"]);
    expect([...before]).toEqual(["x"]);
  });

  it("knows when every tape is shown, and that a page without one is not", () => {
    const strokes = [tape("a", [0, 0, 0.5]), tape("b", [0, 0, 0.5]), ink("i")];
    expect(allRevealed(strokes, new Set(["a"]))).toBe(false);
    expect(allRevealed(strokes, new Set(["a", "b"]))).toBe(true);
    expect(allRevealed([ink("i")], new Set(["i"]))).toBe(false);
  });
});

describe("the tool's settings", () => {
  it("snaps a stored height to the nearest offered one", () => {
    expect(tapeHeightOf(TAPE_HEIGHTS[0] + 1)).toBe(TAPE_HEIGHTS[0]);
    expect(tapeHeightOf(1000)).toBe(TAPE_HEIGHTS[TAPE_HEIGHTS.length - 1]);
    expect(tapeHeightOf(-3)).toBe(DEFAULT_TAPE_HEIGHT);
    expect(tapeHeightOf("wide")).toBe(DEFAULT_TAPE_HEIGHT);
  });

  it("keeps a hex colour and falls back to masking tape", () => {
    expect(tapeColorOf("#AABBCC")).toBe("#aabbcc");
    expect(tapeColorOf("red")).toBe(DEFAULT_TAPE_COLOR);
    expect(tapeColorOf(undefined)).toBe(DEFAULT_TAPE_COLOR);
  });
});
