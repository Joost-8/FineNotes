import { describe, expect, it } from "vitest";

import type { CharReading } from "../../../src/recognition/hwr/char-readings";
import {
  SURE_BARS,
  sureWords,
  wordCore,
  wordsOf,
} from "../../../src/recognition/writer/sure-words";

/** Readings of `greedy`, letter by letter; `over` changes single letters by index. */
function readings(
  greedy: string,
  over: Record<number, Partial<CharReading>> = {},
  confidence = 0.99,
): CharReading[] {
  return Array.from(greedy, (char, i) => ({
    char,
    strokes: [],
    confidence,
    alternatives: [],
    ...over[i],
  }));
}

const writable = (ch: string): boolean => /[a-z,.\s0-9]/i.test(ch);

describe("wordCore", () => {
  it("strips the punctuation around a word, not inside it", () => {
    expect(wordCore("May,")).toBe("May");
    expect(wordCore("(don't)!")).toBe("don't");
    expect(wordCore("...")).toBe("");
    expect(wordCore("42")).toBe("42");
  });
});

describe("wordsOf", () => {
  it("splits on runs of white space", () => {
    expect(wordsOf("  a  b\tc ")).toEqual(["a", "b", "c"]);
    expect(wordsOf("")).toEqual([]);
  });
});

describe("sureWords", () => {
  const text = "the cat sat";

  it("is true for words the text and the greedy reading agree on, read with confidence", () => {
    expect(sureWords(text, text, readings(text), writable)).toEqual([true, true, true]);
  });

  it("is false where the text and the greedy reading differ", () => {
    const greedy = "the cot sat";
    expect(sureWords(text, greedy, readings(greedy), writable)).toEqual([true, false, true]);
  });

  it("is false for a word with a letter below the confidence bar", () => {
    const chars = readings(text, { 5: { confidence: 0.5 } });
    expect(sureWords(text, text, chars, writable)).toEqual([true, false, true]);
    // Exactly the bar passes.
    const edge = readings(text, { 5: { confidence: SURE_BARS.minConfidence } });
    expect(sureWords(text, text, edge, writable)).toEqual([true, true, true]);
  });

  it("is false for a word with a letter whose runner-up is over the rival bar", () => {
    const chars = readings(text, { 9: { alternatives: [{ char: "r", p: 0.5 }] } });
    const bars = { minConfidence: 0.9, maxRival: 0.3 };
    expect(sureWords(text, text, chars, writable, bars)).toEqual([true, true, false]);
    // The default bars do not look at runner-ups.
    expect(sureWords(text, text, chars, writable)).toEqual([true, true, true]);
    // A runner-up at the bar passes.
    const near = readings(text, { 9: { alternatives: [{ char: "r", p: 0.3 }] } });
    expect(sureWords(text, text, near, writable, bars)).toEqual([true, true, true]);
  });

  it("is false for a word with a letter the writer cannot write", () => {
    const only = (ch: string): boolean => ch !== "c";
    expect(sureWords(text, text, readings(text), only)).toEqual([true, false, true]);
  });

  it("checks the word list on the word's core when one is given", () => {
    const t = "the cat, sat 42";
    const seen: string[] = [];
    const inList = (w: string): boolean => {
      seen.push(w);
      return w !== "sat";
    };
    const out = sureWords(t, t, readings(t), writable, SURE_BARS, new Set(), inList);
    // "cat," is looked up as "cat"; "42" has no letter and is not looked up.
    expect(out).toEqual([true, true, false, true]);
    expect(seen).toEqual(["the", "cat", "sat"]);
  });

  it("does not need the list when none is given", () => {
    expect(sureWords("qzx", "qzx", readings("qzx"), writable, SURE_BARS, new Set(), null)).toEqual([
      true,
    ]);
  });

  it("counts known words as sure when the writer can write them, whatever the reading", () => {
    const greedy = "the cot sat";
    const chars = readings(greedy, { 5: { confidence: 0.1 } });
    expect(sureWords(text, greedy, chars, writable, SURE_BARS, new Set([1]))).toEqual([
      true,
      true,
      true,
    ]);
    const only = (ch: string): boolean => ch !== "c";
    expect(sureWords(text, greedy, chars, only, SURE_BARS, new Set([1]))).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("makes only known words sure when the readings do not line up with the greedy text", () => {
    const chars = readings("the ca");
    expect(sureWords(text, text, chars, writable)).toEqual([false, false, false]);
    expect(sureWords(text, text, chars, writable, SURE_BARS, new Set([0, 2]))).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("keeps an unreadable word unsure when words were added or lost in the greedy text", () => {
    const greedy = "the sat";
    expect(sureWords(text, greedy, readings(greedy), writable)).toEqual([true, false, true]);
  });

  it("is empty for no text", () => {
    expect(sureWords("", "", [], writable)).toEqual([]);
  });
});
