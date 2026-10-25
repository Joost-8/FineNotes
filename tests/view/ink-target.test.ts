import { describe, expect, it, vi } from "vitest";
import type { Bounds } from "../../src/model/document";
import { hitsInk, inkTargetAt } from "../../src/view/ink-target";

const REACH = { tolerance: 2, below: 7 };

/** Bounds by the entry's first stroke id, as a page would give them. */
function boundsFrom(table: Record<string, Bounds>) {
  return (strokes: readonly string[]): Bounds | null => table[strokes[0]] ?? null;
}

describe("hitsInk", () => {
  const word: Bounds = { minX: 10, minY: 10, maxX: 50, maxY: 30 };

  it("takes a point on the ink, and within the tolerance round it", () => {
    expect(hitsInk(word, { x: 30, y: 20 }, REACH)).toBe(true);
    expect(hitsInk(word, { x: 8, y: 8 }, REACH)).toBe(true);
    expect(hitsInk(word, { x: 52, y: 20 }, REACH)).toBe(true);
  });

  it("reaches down to the underline, but not up or sideways as far", () => {
    expect(hitsInk(word, { x: 30, y: 39 }, REACH)).toBe(true);
    expect(hitsInk(word, { x: 30, y: 40 }, REACH)).toBe(false);
    expect(hitsInk(word, { x: 30, y: 7 }, REACH)).toBe(false);
    expect(hitsInk(word, { x: 53, y: 20 }, REACH)).toBe(false);
  });
});

describe("inkTargetAt", () => {
  const bounds = boundsFrom({
    a: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
    b: { minX: 100, minY: 0, maxX: 140, maxY: 20 },
    c: { minX: 200, minY: 0, maxX: 240, maxY: 20 },
  });

  it("finds an underlined word, with its index among the flags", () => {
    const targets = { links: [], suggestions: [], flags: [["a"], ["b"]] };
    expect(inkTargetAt(targets, bounds, { x: 120, y: 24 }, REACH)).toEqual({
      kind: "flag",
      index: 1,
    });
  });

  it("is null beside every mark, so the press menu opens there instead", () => {
    const targets = { links: [["a"]], suggestions: [["b"]], flags: [["c"]] };
    expect(inkTargetAt(targets, bounds, { x: 70, y: 10 }, REACH)).toBeNull();
    expect(inkTargetAt(targets, bounds, { x: 120, y: 60 }, REACH)).toBeNull();
  });

  it("puts a link before a suggestion, and a suggestion before a flag, on the same ink", () => {
    const point = { x: 20, y: 10 };
    expect(
      inkTargetAt({ links: [["a"]], suggestions: [["a"]], flags: [["a"]] }, bounds, point, REACH),
    ).toEqual({
      kind: "link",
      index: 0,
    });
    expect(
      inkTargetAt({ links: [], suggestions: [["a"]], flags: [["a"]] }, bounds, point, REACH),
    ).toEqual({
      kind: "suggestion",
      index: 0,
    });
  });

  it("skips an entry whose ink is gone", () => {
    const targets = { links: [], suggestions: [], flags: [["erased"], ["a"]] };
    expect(inkTargetAt(targets, bounds, { x: 20, y: 10 }, REACH)).toEqual({
      kind: "flag",
      index: 1,
    });
  });

  it("stops measuring at the first hit", () => {
    const boundsOf = vi.fn(bounds);
    inkTargetAt(
      { links: [["a"], ["b"]], suggestions: [], flags: [["c"]] },
      boundsOf,
      { x: 20, y: 10 },
      REACH,
    );
    expect(boundsOf).toHaveBeenCalledTimes(1);
  });
});
