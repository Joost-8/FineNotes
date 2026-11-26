import { describe, expect, it } from "vitest";
import {
  WRITE_UNASKED_FROM,
  keepOwnInk,
  ownInkReason,
  ownInkRewrite,
} from "../../../src/recognition/writer/own-ink";

const word = (over: Partial<Parameters<typeof ownInkReason>[0]> = {}) => ({
  text: "hello",
  sure: 0.9,
  answered: false,
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

  it("keeps an unsure word", () => {
    expect(ownInkReason(word({ sure: WRITE_UNASKED_FROM - 0.01 }))).toBe("unsure");
    expect(ownInkReason(word({ sure: WRITE_UNASKED_FROM }))).toBeNull();
  });

  it("gives lone before unsure", () => {
    expect(ownInkReason(word({ text: "a", sure: 0 }))).toBe("lone");
  });

  it("never keeps an answered word", () => {
    expect(ownInkReason(word({ text: "a", sure: 0, answered: true }))).toBeNull();
  });
});

describe("keepOwnInk", () => {
  it("sets false only the words with a reason, and never turns one on", () => {
    const words = [word(), word({ sure: 0.1 }), word({ text: "I" }), word({ sure: 0.1 })];
    expect(keepOwnInk(words, [true, true, true, false])).toEqual([true, false, false, false]);
  });
});

describe("ownInkRewrite", () => {
  const line = {
    read: ["fine", "I", "odd"],
    sure: [0.9, 0.9, 0.2],
    rewrite: [true, true, true],
  };

  it("keeps lone and unsure words", () => {
    expect(ownInkRewrite(line)).toEqual([true, false, false]);
  });

  it("lets an answered word through", () => {
    expect(ownInkRewrite({ ...line, answered: [true, true, true] })).toEqual([true, true, true]);
  });
});
