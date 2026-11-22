import { describe, expect, it } from "vitest";
import {
  NOTE_CONTENT_HEIGHT,
  NOTE_PAGE_HEIGHT,
  NOTE_PAGE_WIDTH,
  type MeasuredBlock,
  firstBlockOn,
  pageOfBlock,
  paginate,
  wrapRuns,
} from "../../src/model/note-pages";
import { BOLD, INK_WIDTH } from "../../src/model/text-note";

const text = (lines: number, h = 20, extra: Partial<MeasuredBlock> = {}): MeasuredBlock => ({
  before: 0,
  after: 0,
  lines: Array.from({ length: lines }, () => h),
  whole: false,
  ...extra,
});
const whole = (h: number, extra: Partial<MeasuredBlock> = {}): MeasuredBlock => ({
  before: 0,
  after: 0,
  lines: [h],
  whole: true,
  ...extra,
});

describe("the note page", () => {
  it("is the note's column with margins, in A4 proportions", () => {
    expect(NOTE_PAGE_WIDTH).toBeGreaterThan(INK_WIDTH);
    expect(NOTE_PAGE_HEIGHT / NOTE_PAGE_WIDTH).toBeCloseTo(297 / 210, 2);
    expect(NOTE_CONTENT_HEIGHT).toBeLessThan(NOTE_PAGE_HEIGHT);
  });
});

describe("paginate", () => {
  it("gives an empty note one empty page", () => {
    expect(paginate([], 100)).toEqual([[]]);
  });

  it("keeps blocks that fit on one page", () => {
    const pages = paginate([text(2), whole(30), text(1)], 100);
    expect(pages).toHaveLength(1);
    expect(pages[0].map((s) => s.y)).toEqual([0, 40, 70]);
  });

  it("breaks a paragraph between its lines", () => {
    const pages = paginate([text(7)], 100);
    expect(pages).toHaveLength(2);
    expect(pages[0][0]).toMatchObject({ from: 0, to: 5, height: 100 });
    expect(pages[1][0]).toMatchObject({ from: 5, to: 7, y: 0, height: 40 });
  });

  it("moves a section that does not fit to the next page, whole", () => {
    const pages = paginate([text(3), whole(60)], 100);
    expect(pages).toHaveLength(2);
    expect(pages[1][0]).toMatchObject({ block: 1, y: 0, offset: 0, height: 60 });
  });

  it("cuts only a section taller than a page, at page heights, from a page of its own", () => {
    const pages = paginate([text(1), whole(250), text(1)], 100);
    expect(pages.map((p) => p.map((s) => [s.block, s.offset, s.height]))).toEqual([
      [[0, 0, 20]],
      [[1, 0, 100]],
      [[1, 100, 100]],
      [
        [1, 200, 50],
        [2, 0, 20],
      ],
    ]);
  });

  it("drops the room above a block at the top of a page", () => {
    const pages = paginate([text(4), text(2, 20, { before: 30 })], 100);
    expect(pages[1][0].y).toBe(0);
    const same = paginate([text(1), text(1, 20, { before: 30 })], 100);
    expect(same[0][1].y).toBe(50);
  });

  it("does not leave a heading alone at a page's foot", () => {
    const blocks = [text(4), text(1, 20, { keepWithNext: true }), text(3)];
    const pages = paginate(blocks, 100);
    expect(pages[0].map((s) => s.block)).toEqual([0]);
    expect(pages[1][0].block).toBe(1);
  });

  it("keeps a heading with the start of a section under it", () => {
    const pages = paginate([text(3), text(1, 20, { keepWithNext: true }), whole(50)], 100);
    expect(pageOfBlock(pages, 1)).toBe(pageOfBlock(pages, 2));
  });

  it("places a line taller than a page anyway, once", () => {
    const pages = paginate([text(1, 150), text(1)], 100);
    expect(pages).toHaveLength(2);
    expect(pages[0][0].height).toBe(150);
  });

  it("survives a page with no height", () => {
    expect(paginate([text(2)], 0).length).toBeGreaterThan(0);
    expect(paginate([text(2)], Number.NaN).length).toBeGreaterThan(0);
  });

  it("skips blocks with no lines", () => {
    expect(paginate([{ before: 5, after: 5, lines: [], whole: false }], 100)).toEqual([[]]);
  });

  it("puts every line on exactly one page", () => {
    const blocks = Array.from({ length: 40 }, (_, i) =>
      i % 7 === 3
        ? whole(30 + i * 5, { before: 8, after: 8 })
        : text(1 + (i % 5), 22, { before: 4 }),
    );
    const pages = paginate(blocks, 300);
    blocks.forEach((block, b) => {
      const slices = pages.flat().filter((s) => s.block === b);
      if (block.whole) {
        expect(slices.reduce((n, s) => n + s.height, 0)).toBe(block.lines[0]);
      } else {
        const covered = slices.flatMap((s) =>
          Array.from({ length: s.to - s.from }, (_, k) => s.from + k),
        );
        expect(covered).toEqual(block.lines.map((_, k) => k));
      }
    });
    for (const page of pages)
      for (const slice of page)
        if (slice.height <= 300) expect(slice.y + slice.height).toBeLessThanOrEqual(300);
  });
});

describe("pageOfBlock and firstBlockOn", () => {
  const pages = paginate([text(4), text(4), text(4)], 100);

  it("finds the page a block starts on", () => {
    expect(pageOfBlock(pages, 1)).toBe(0);
    expect(pageOfBlock(pages, 2)).toBe(1);
    expect(pageOfBlock(pages, 9)).toBe(0);
  });

  it("names the first block a page starts", () => {
    expect(firstBlockOn(pages, 1)).toBe(2);
    expect(firstBlockOn([[{ block: 3, from: 2, to: 4, y: 0, offset: 0, height: 40 }]], 0)).toBe(3);
    expect(firstBlockOn([[]], 0)).toBeNull();
    expect(firstBlockOn(pages, 7)).toBeNull();
  });
});

describe("wrapRuns", () => {
  const measure = (s: string): number => s.length * 10;
  const plain = (lines: { text: string }[][]): string[] =>
    lines.map((l) => l.map((r) => r.text).join(""));

  it("breaks after spaces, dropping the space a line ends on", () => {
    const lines = wrapRuns([{ text: "one two three four", marks: 0 }], 90, measure);
    expect(plain(lines)).toEqual(["one two", "three", "four"]);
  });

  it("keeps a word that ends just at the edge on its line", () => {
    expect(plain(wrapRuns([{ text: "abcd efgh", marks: 0 }], 90, measure))).toEqual(["abcd efgh"]);
  });

  it("breaks a word wider than a line between letters", () => {
    expect(plain(wrapRuns([{ text: "abcdefghij", marks: 0 }], 40, measure))).toEqual([
      "abcd",
      "efgh",
      "ij",
    ]);
  });

  it("breaks at a newline", () => {
    expect(plain(wrapRuns([{ text: "a\nb", marks: 0 }], 400, measure))).toEqual(["a", "b"]);
  });

  it("keeps each run's marks, joining pieces of the same marks", () => {
    const lines = wrapRuns(
      [
        { text: "plain ", marks: 0 },
        { text: "bold words", marks: BOLD },
      ],
      400,
      measure,
    );
    expect(lines).toEqual([
      [
        { text: "plain ", marks: 0 },
        { text: "bold words", marks: BOLD },
      ],
    ]);
  });

  it("measures with the run's marks", () => {
    const wide = (s: string, marks: number): number => s.length * (marks & BOLD ? 20 : 10);
    const lines = wrapRuns([{ text: "aa bb", marks: BOLD }], 70, wide);
    expect(plain(lines)).toEqual(["aa", "bb"]);
  });

  it("gives an empty paragraph one empty line", () => {
    expect(wrapRuns([], 100, measure)).toEqual([[]]);
    expect(wrapRuns([{ text: "", marks: 0 }], 100, measure)).toEqual([[]]);
  });
});
