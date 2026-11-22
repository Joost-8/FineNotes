import { describe, expect, it } from "vitest";
import {
  type MeasuredBlock,
  blocksOnPages,
  noteOnPages,
  paginate,
} from "../../src/model/note-pages";
import { textBlock, type TextNote } from "../../src/model/text-note";

const text = (lines: number): MeasuredBlock => ({
  before: 0,
  after: 0,
  lines: Array.from({ length: lines }, () => 20),
  whole: false,
});
const whole = (h: number): MeasuredBlock => ({ before: 0, after: 0, lines: [h], whole: true });

// Pages 100 high: [a, b (2 lines)] [b (3 lines), c] [d (a tall section)] [d (its rest), e]
const measured = [text(3), text(5), text(2), whole(150), text(1)];
const pages = paginate(measured, 100);

const note: TextNote = {
  blocks: ["a", "b", "c", "d", "e"].map((id) => textBlock(id, "body", [{ text: id, marks: 0 }])),
};

describe("blocksOnPages", () => {
  it("lays the fixture out as the test expects", () => {
    expect(pages.map((page) => page.map((slice) => slice.block))).toEqual([
      [0, 1],
      [1, 2],
      [3],
      [3, 4],
    ]);
  });

  it("takes every block a ticked page shows any part of", () => {
    expect([...blocksOnPages(pages, [0])].sort()).toEqual([0, 1]);
    expect([...blocksOnPages(pages, [1])].sort()).toEqual([1, 2]);
    // Either half of a section taller than a page takes the whole section.
    expect([...blocksOnPages(pages, [2])]).toEqual([3]);
    expect([...blocksOnPages(pages, [3])].sort()).toEqual([3, 4]);
  });

  it("takes nothing for no page, and ignores pages that do not exist", () => {
    expect(blocksOnPages(pages, []).size).toBe(0);
    expect(blocksOnPages(pages, [9, -1]).size).toBe(0);
  });
});

describe("noteOnPages", () => {
  it("keeps the ticked pages' blocks in the note's order", () => {
    const ids = (n: TextNote): string[] => n.blocks.map((b) => b.id);
    expect(ids(noteOnPages(note, pages, [3, 0]))).toEqual(["a", "b", "d", "e"]);
    expect(ids(noteOnPages(note, pages, [0, 1, 2, 3]))).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids(noteOnPages(note, pages, []))).toEqual([]);
  });
});
