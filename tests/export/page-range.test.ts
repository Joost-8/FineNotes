import { describe, expect, it } from "vitest";
import {
  allPages,
  exportBaseName,
  formatPageRange,
  parsePageRange,
  toggleSelection,
} from "../../src/export/page-range";

function pages(input: string, total = 10): number[] | string {
  const result = parsePageRange(input, total);
  return result.ok ? result.pages : result.error;
}

describe("parsePageRange", () => {
  it("reads single pages and spans, 1-based in, 0-based out", () => {
    expect(pages("3")).toEqual([2]);
    expect(pages("1-3, 5")).toEqual([0, 1, 2, 4]);
    expect(pages("1-3 5 7")).toEqual([0, 1, 2, 4, 6]);
    expect(pages("2;4")).toEqual([1, 3]);
  });

  it("runs an open span to the end or from the start", () => {
    expect(pages("8-")).toEqual([7, 8, 9]);
    expect(pages("-2")).toEqual([0, 1]);
  });

  it("accepts smart-punctuation dashes and spaces around a dash", () => {
    expect(pages("1–3")).toEqual([0, 1, 2]);
    expect(pages("4—5")).toEqual([3, 4]);
    expect(pages("1 - 3, 6")).toEqual([0, 1, 2, 5]);
  });

  it("keeps the order written, each page once where first named", () => {
    expect(pages("5, 1-3, 2, 3-1")).toEqual([4, 0, 1, 2]);
    expect(pages("3-1")).toEqual([2, 1, 0]);
    expect(pages("10-8, 1")).toEqual([9, 8, 7, 0]);
  });

  it("explains what is wrong", () => {
    expect(pages("")).toMatch(/Type the pages/);
    expect(pages(" , ")).toMatch(/Type the pages/);
    expect(pages("abc")).toMatch(/"abc" is not a page number/);
    expect(pages("-")).toMatch(/not a page range/);
    expect(pages("0")).toMatch(/numbered from 1/);
    expect(pages("9-12")).toMatch(/no page 12: this notebook has 10 pages/);
    expect(pages("2", 1)).toMatch(/has 1 page$/);
    expect(pages("1.5")).toMatch(/not a page number/);
  });
});

describe("allPages", () => {
  it("lists every page, and none of a notebook without any", () => {
    expect(allPages(3)).toEqual([0, 1, 2]);
    expect(allPages(0)).toEqual([]);
    expect(allPages(-1)).toEqual([]);
  });
});

describe("toggleSelection", () => {
  it("puts a ticked page last, so tapping order is the PDF's order", () => {
    expect(toggleSelection([4, 1], 2, null, false)).toEqual([4, 1, 2]);
  });

  it("unticks a page and keeps the others' order", () => {
    expect(toggleSelection([4, 2, 1], 2, 2, false)).toEqual([4, 1]);
  });

  it("adds a span on shift-click in the direction clicked, skipping ticked pages", () => {
    expect(toggleSelection([0], 4, 1, true)).toEqual([0, 1, 2, 3, 4]);
    expect(toggleSelection([6], 1, 4, true)).toEqual([6, 4, 3, 2, 1]);
    expect(toggleSelection([3], 1, 4, true)).toEqual([3, 4, 2, 1]);
  });

  it("toggles one page when there is no anchor to extend from", () => {
    expect(toggleSelection([], 3, null, true)).toEqual([3]);
  });

  it("does not change the selection it was given", () => {
    const before = [1, 2];
    toggleSelection(before, 3, null, false);
    expect(before).toEqual([1, 2]);
  });
});

describe("formatPageRange", () => {
  it("collapses runs", () => {
    expect(formatPageRange([0, 1, 2, 4, 6, 7])).toBe("1-3, 5, 7-8");
    expect(formatPageRange([3])).toBe("4");
    expect(formatPageRange([])).toBe("");
  });

  it("keeps the order, writing backward runs backwards", () => {
    expect(formatPageRange([4, 2, 1, 0])).toBe("5, 3-1");
    expect(formatPageRange([2, 0, 1])).toBe("3, 1-2");
  });

  it("round-trips through the parser", () => {
    for (const picked of [
      [0, 2, 3, 4, 9],
      [9, 3, 2, 1, 0, 5],
      [4, 5, 3],
    ]) {
      expect(pages(formatPageRange(picked))).toEqual(picked);
    }
  });
});

describe("exportBaseName", () => {
  it("names a whole-notebook export after the notebook", () => {
    expect(exportBaseName("Biology", [0, 1, 2], 3)).toBe("Biology");
    expect(exportBaseName("Biology.notebook", [0], 1)).toBe("Biology");
  });

  it("says which pages a partial export holds", () => {
    expect(exportBaseName("Biology", [2], 3)).toBe("Biology (page 3)");
    expect(exportBaseName("Biology", [0, 1, 3], 5)).toBe("Biology (pages 1-2,4)");
  });

  it("falls back to a count for a long scattered selection", () => {
    const scattered = Array.from({ length: 20 }, (_, i) => i * 2);
    expect(exportBaseName("Biology", scattered, 40)).toBe("Biology (20 pages)");
  });

  it("strips characters a file name cannot hold", () => {
    expect(exportBaseName('Lab: "week 3" / notes#1', [0], 1)).toBe("Lab week 3 notes 1");
    expect(exportBaseName("  ///  ", [0], 1)).toBe("Notebook");
  });
});
