import { describe, expect, it } from "vitest";
import {
  gapAt,
  gapMark,
  movePenType,
  penTypeOrderOf,
  shownPenTypes,
} from "../../src/model/pen-type-order";

const ALL = ["fountain", "ball", "brush", "calligraphy", "highlighter"] as const;

describe("reading the stored order", () => {
  it("keeps a stored order", () => {
    const stored = ["brush", "highlighter", "fountain", "ball", "calligraphy"];
    expect(penTypeOrderOf(stored, ALL)).toEqual(stored);
  });

  it("is the pens' own order when nothing is stored", () => {
    for (const raw of [undefined, null, "fountain", 3, {}, []]) {
      expect(penTypeOrderOf(raw, ALL)).toEqual([...ALL]);
    }
  });

  it("appends a pen type the stored order lacks, as a new release would add one", () => {
    expect(penTypeOrderOf(["highlighter", "brush"], ALL)).toEqual([
      "highlighter",
      "brush",
      "fountain",
      "ball",
      "calligraphy",
    ]);
  });

  it("drops what is not a pen type, and repeats", () => {
    expect(penTypeOrderOf(["pencil", "ball", 7, "ball", null, "brush"], ALL)).toEqual([
      "ball",
      "brush",
      "fountain",
      "calligraphy",
      "highlighter",
    ]);
  });
});

describe("moving a pen in the row", () => {
  it("moves a pen to the gap it is let go in", () => {
    expect(movePenType(ALL, "highlighter", 0)).toEqual([
      "highlighter",
      "fountain",
      "ball",
      "brush",
      "calligraphy",
    ]);
    expect(movePenType(ALL, "fountain", 5)).toEqual([
      "ball",
      "brush",
      "calligraphy",
      "highlighter",
      "fountain",
    ]);
    // Between brush and calligraphy, counted as the row stood when it was lifted.
    expect(movePenType(ALL, "fountain", 3)).toEqual([
      "ball",
      "brush",
      "fountain",
      "calligraphy",
      "highlighter",
    ]);
    expect(movePenType(ALL, "highlighter", 2)).toEqual([
      "fountain",
      "ball",
      "highlighter",
      "brush",
      "calligraphy",
    ]);
  });

  it("leaves the order alone for a gap either side of the pen", () => {
    expect(movePenType(ALL, "brush", 2)).toEqual([...ALL]);
    expect(movePenType(ALL, "brush", 3)).toEqual([...ALL]);
  });

  it("never adds or loses a pen, whatever the gap", () => {
    for (const id of ALL) {
      for (const gap of [-3, 0, 1, 2.4, 4, 5, 99]) {
        const moved = movePenType(ALL, id, gap);
        expect([...moved].sort()).toEqual([...ALL].sort());
      }
    }
    expect(movePenType(ALL, "pencil" as never, 1)).toEqual([...ALL]);
  });
});

describe("where a held pen lands", () => {
  const centres = [20, 60, 100, 140, 180];

  it("is the gap before the first pen whose middle is past it", () => {
    expect(gapAt(centres, 5)).toBe(0);
    expect(gapAt(centres, 45)).toBe(1);
    expect(gapAt(centres, 101)).toBe(3);
    expect(gapAt(centres, 500)).toBe(5);
    expect(gapAt([], 10)).toBe(0);
  });

  it("is marked between the pens either side, or just outside the row's ends", () => {
    const spans = [
      { start: 0, end: 36 },
      { start: 40, end: 76 },
      { start: 80, end: 116 },
    ];
    expect(gapMark(spans, 0)).toBe(-2);
    expect(gapMark(spans, 1)).toBe(38);
    expect(gapMark(spans, 2)).toBe(78);
    expect(gapMark(spans, 3)).toBe(118);
    expect(gapMark([{ start: 10, end: 46 }], 1)).toBe(48);
    expect(gapMark([], 0)).toBe(0);
  });
});

describe("the pens the row shows", () => {
  it("is every pen, and no highlighter on a practice sheet", () => {
    expect(shownPenTypes(ALL, false, "highlighter")).toEqual([...ALL]);
    expect(shownPenTypes(ALL, true, "highlighter")).toEqual([
      "fountain",
      "ball",
      "brush",
      "calligraphy",
    ]);
  });
});
