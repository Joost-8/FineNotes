import { describe, expect, it } from "vitest";
import {
  type Box,
  WRITE_UNASKED_FROM,
  keepOwnInk,
  mayHoldExponent,
  ownInkReason,
  ownInkRewrite,
  raisedTail,
  raisedWords,
  strokeBox,
} from "../../../src/recognition/writer/own-ink";

const word = (over: Partial<Parameters<typeof ownInkReason>[0]> = {}) => ({
  text: "hello",
  sure: 0.9,
  answered: false,
  raised: false,
  ...over,
});

describe("ownInkReason", () => {
  it("lets a sure ordinary word be written", () => {
    expect(ownInkReason(word())).toBeNull();
  });

  it("keeps lone letters and digits", () => {
    for (const text of ["I", "a", "5", "x,", "(a)"]) {
      expect(ownInkReason(word({ text }))).toBe("lone");
    }
    expect(ownInkReason(word({ text: "It" }))).toBeNull();
    expect(ownInkReason(word({ text: "10" }))).toBeNull();
  });

  it("does not keep a lone word when the writer asked for exactly it", () => {
    expect(ownInkReason(word({ text: "I" }), { alone: true })).toBeNull();
    expect(ownInkReason(word({ text: "I", sure: 0.2 }), { alone: true })).toBe("unsure");
  });

  it("keeps a raised word and an unsure one", () => {
    expect(ownInkReason(word({ raised: true }))).toBe("raised");
    expect(ownInkReason(word({ sure: WRITE_UNASKED_FROM - 0.01 }))).toBe("unsure");
    expect(ownInkReason(word({ sure: WRITE_UNASKED_FROM }))).toBeNull();
  });

  it("gives the reasons in order: lone, raised, unsure", () => {
    expect(ownInkReason(word({ text: "a", raised: true, sure: 0 }))).toBe("lone");
    expect(ownInkReason(word({ raised: true, sure: 0 }))).toBe("raised");
  });

  it("never keeps an answered word", () => {
    expect(ownInkReason(word({ text: "a", raised: true, sure: 0, answered: true }))).toBeNull();
  });
});

describe("keepOwnInk", () => {
  it("sets false only the words with a reason, and never turns one on", () => {
    const words = [word(), word({ sure: 0.1 }), word({ text: "I" }), word({ sure: 0.1 })];
    expect(keepOwnInk(words, [true, true, true, false])).toEqual([true, false, false, false]);
    expect(keepOwnInk(words, [true, true, true, false], { alone: true })).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});

describe("mayHoldExponent", () => {
  it("excludes words ending in a quote, apostrophe, asterisk or degree sign", () => {
    for (const t of ['said"', "don'", "it’", "“x”", "note*", "90°", 'said".', "90°,)"]) {
      expect(mayHoldExponent(t)).toBe(false);
    }
    for (const t of ["x2", "word.", "(n)", "hello,"]) expect(mayHoldExponent(t)).toBe(true);
  });
});

describe("raisedTail", () => {
  // Line foot at y = 100, x-height 10; y grows downward.
  const base = () => 100;
  const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
  const n = box(0, 90, 10, 100);

  it("sees an n with a raised 2", () => {
    expect(raisedTail([n, box(12, 80, 18, 87)], base, 10)).toBe(true);
  });

  it("ignores a t-bar (flat)", () => {
    expect(raisedTail([box(0, 80, 10, 100), box(2, 84, 12, 86)], base, 10)).toBe(false);
  });

  it("ignores an i-dot (tiny)", () => {
    expect(raisedTail([box(0, 90, 6, 100), box(2, 82, 4, 84)], base, 10)).toBe(false);
  });

  it("ignores an apostrophe in the middle of a word", () => {
    const apostrophe = box(14, 78, 15.5, 86);
    expect(raisedTail([box(0, 80, 12, 100), apostrophe, box(16, 90, 26, 100)], base, 10)).toBe(
      false,
    );
  });

  it("sees closing quote ticks at the end by geometry (the text rule excludes them)", () => {
    expect(raisedTail([box(0, 85, 20, 100), box(23, 78, 30, 86)], base, 10)).toBe(true);
    expect(mayHoldExponent('word"')).toBe(false);
  });

  it("ignores the top bar of a 5", () => {
    expect(raisedTail([box(0, 85, 8, 100), box(0, 83, 8, 84)], base, 10)).toBe(false);
  });

  it("ignores a raised stroke in the left half", () => {
    expect(raisedTail([box(0, 78, 6, 86), box(7, 90, 30, 100)], base, 10)).toBe(false);
  });

  it("needs an x-height", () => {
    expect(raisedTail([n, box(12, 80, 18, 87)], base, 0)).toBe(false);
  });

  it("follows a tilted foot line", () => {
    const tilt = (x: number) => 100 - x * 0.5;
    // The n and the 2 both rise with the line: the 2 is still raised above it.
    expect(raisedTail([box(0, 87, 10, 97), box(12, 74, 18, 81)], tilt, 10)).toBe(true);
  });
});

describe("strokeBox", () => {
  it("reads x and y from triples", () => {
    expect(strokeBox([1, 5, 0.5, 4, 2, 0.5, 3, 9, 0.5])).toEqual({ x0: 1, y0: 2, x1: 4, y1: 9 });
    expect(strokeBox([])).toBeNull();
  });
});

describe("ownInkRewrite", () => {
  const boxes = new Map<string, Box>([
    ["a", { x0: 0, y0: 90, x1: 10, y1: 100 }],
    ["b", { x0: 12, y0: 80, x1: 18, y1: 87 }],
    ["c", { x0: 40, y0: 90, x1: 50, y1: 100 }],
  ]);
  const line = {
    read: ["n2", "I", "fine"],
    words: [["a", "b"], ["c"], []],
    sure: [0.9, 0.9, 0.2],
    rewrite: [true, true, true],
    xHeight: 10,
  };

  it("keeps raised, lone and unsure words", () => {
    expect(ownInkRewrite(line, boxes, () => 100)).toEqual([false, false, false]);
    expect(raisedWords(line, boxes, () => 100)).toEqual([true, false, false]);
  });

  it("does not look for exponents without a line or an x-height", () => {
    expect(raisedWords(line, boxes, null)).toEqual([false, false, false]);
    expect(raisedWords({ ...line, xHeight: null }, boxes, () => 100)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("lets an answered word through", () => {
    expect(ownInkRewrite({ ...line, answered: [true, true, true] }, boxes, () => 100)).toEqual([
      true,
      true,
      true,
    ]);
  });
});
