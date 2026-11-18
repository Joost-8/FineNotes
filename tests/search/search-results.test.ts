/**
 * `src/search/search-results.ts` — the notebook search's results list,
 * a row per match, stepped through with Next and Previous (discussion #112).
 */

import { describe, expect, it } from "vitest";
import type { PageText } from "../../src/search/notebook-search";
import {
  type SearchResult,
  keepCurrent,
  listResults,
  matchesOfKind,
  readingOrder,
  sameResult,
  stepResult,
} from "../../src/search/search-results";

const index: PageText[] = [
  {
    pageIndex: 0,
    sources: [
      { kind: "handwriting", text: "DNA polymerase copies DNA" },
      { kind: "text", text: "polymerase", boxId: "t1" },
    ],
  },
  { pageIndex: 1, sources: [{ kind: "pdf", text: "Nothing here" }] },
  {
    pageIndex: 2,
    sources: [
      { kind: "pdf", text: "Makes RNA primer for DNA polymerase III to\nDNA polymerase I" },
    ],
  },
];

describe("listResults", () => {
  it("lists every match, a row each, page by page", () => {
    const { results, total } = listResults(index, "polymerase");
    expect(total).toBe(4);
    expect(results.map((r) => [r.pageIndex, r.kind, r.nth])).toEqual([
      [0, "handwriting", 0],
      [0, "text", 0],
      [2, "pdf", 0],
      [2, "pdf", 1],
    ]);
  });

  it("marks the match in each row's snippet, in its own spelling", () => {
    const [first] = listResults(index, "POLYMERASE").results;
    expect(first.snippet).toEqual({
      kind: "handwriting",
      before: "DNA ",
      match: "polymerase",
      after: " copies DNA",
    });
  });

  it("names the text box a text box's match is in", () => {
    const text = listResults(index, "polymerase").results.find((r) => r.kind === "text");
    expect(text?.boxId).toBe("t1");
    expect(listResults(index, "polymerase").results[0].boxId).toBeUndefined();
  });

  it("counts each kind on its own page, so the nth lines up with the lit words", () => {
    const results = listResults(index, "dna").results;
    expect(results.map((r) => `${r.pageIndex}${r.kind[0]}${r.nth}`)).toEqual([
      "0h0",
      "0h1",
      "2p0",
      "2p1",
    ]);
  });

  it("lists only the phrase on a page that holds it", () => {
    const { results } = listResults(index, "dna polymerase");
    // Page 2 holds the phrase twice, and comes first; page 0 holds it once.
    expect(results.map((r) => [r.pageIndex, r.snippet.match])).toEqual([
      [0, "DNA polymerase"],
      [2, "DNA polymerase"],
      [2, "DNA polymerase"],
    ]);
  });

  it("stops listing at the cap, and still counts every match", () => {
    const { results, total } = listResults(index, "polymerase", 3);
    expect(results).toHaveLength(3);
    expect(total).toBe(4);
  });

  it("finds nothing for an empty query", () => {
    expect(listResults(index, "  ")).toEqual({ results: [], total: 0 });
  });
});

describe("stepResult", () => {
  it("goes to the first on Next and the last on Previous from none", () => {
    expect(stepResult(null, 5, 1)).toBe(0);
    expect(stepResult(null, 5, -1)).toBe(4);
  });

  it("steps and wraps round at either end", () => {
    expect(stepResult(1, 5, 1)).toBe(2);
    expect(stepResult(4, 5, 1)).toBe(0);
    expect(stepResult(0, 5, -1)).toBe(4);
  });

  it("starts over when the current one is past a shorter list", () => {
    expect(stepResult(9, 3, 1)).toBe(0);
  });

  it("has nowhere to go without results", () => {
    expect(stepResult(null, 0, 1)).toBeNull();
    expect(stepResult(2, 0, -1)).toBeNull();
  });
});

describe("keepCurrent", () => {
  const result = (pageIndex: number, nth: number): SearchResult => ({
    pageIndex,
    kind: "pdf",
    nth,
    snippet: { kind: "pdf", before: "", match: "x", after: "" },
  });

  it("finds the same match in a list that grew", () => {
    const grown = [result(0, 0), result(1, 0), result(2, 0), result(2, 1)];
    expect(keepCurrent(result(2, 1), grown)).toBe(3);
  });

  it("is null when the match is gone, or none was current", () => {
    expect(keepCurrent(result(5, 0), [result(0, 0)])).toBeNull();
    expect(keepCurrent(null, [result(0, 0)])).toBeNull();
  });

  it("tells matches apart by page, kind and place", () => {
    expect(sameResult(result(1, 0), result(1, 0))).toBe(true);
    expect(sameResult(result(1, 0), result(1, 1))).toBe(false);
    expect(sameResult(result(1, 0), { ...result(1, 0), kind: "text" })).toBe(false);
  });
});

describe("readingOrder", () => {
  const spot = (
    x: number,
    y: number,
    h = 10,
  ): { minX: number; minY: number; maxX: number; maxY: number } => ({
    minX: x,
    minY: y,
    maxX: x + 20,
    maxY: y + h,
  });

  it("reads lines top to bottom and each line left to right", () => {
    // A word on the second line, then two on the first (the second a little higher).
    expect(readingOrder([spot(10, 50), spot(80, 2), spot(10, 0)])).toEqual([2, 1, 0]);
  });

  it("keeps words apart that overlap by less than half a line", () => {
    expect(readingOrder([spot(80, 0), spot(10, 7)])).toEqual([0, 1]);
  });

  it("is empty for no spots", () => {
    expect(readingOrder([])).toEqual([]);
  });
});

describe("matchesOfKind", () => {
  it("counts a page's matches of one kind, as its results do", () => {
    expect(matchesOfKind(index[0], "dna", false, "handwriting")).toBe(2);
    expect(matchesOfKind(index[0], "polymerase", false, "text")).toBe(1);
    expect(matchesOfKind(index[0], "polymerase", false, "pdf")).toBe(0);
    expect(matchesOfKind(undefined, "dna", false, "pdf")).toBe(0);
  });
});
