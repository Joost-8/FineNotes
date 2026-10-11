/**
 * `src/recognition/handwritten-links.ts`: `[[links]]` written by hand, found
 * in a line's words as read on the device.
 */

import { describe, expect, it } from "vitest";
import { type ReadWord, findHandwrittenLinks } from "../../src/recognition/handwritten-links";

/** Words from text, one stroke each, named after their index. */
const words = (...texts: string[]): ReadWord[] =>
  texts.map((text, i) => ({ text, strokeIds: [`s${i}`] }));

describe("findHandwrittenLinks", () => {
  it("finds a one-word link and its strokes", () => {
    expect(findHandwrittenLinks(words("see", "[[Signals]]", "for"))).toEqual([
      { target: "Signals", strokeIds: ["s1"] },
    ]);
  });

  it("finds a link over several words, with punctuation after it", () => {
    expect(findHandwrittenLinks(words("read", "[[Fourier", "series]],", "too"))).toEqual([
      { target: "Fourier series", strokeIds: ["s1", "s2"] },
    ]);
  });

  it("takes brackets written as words of their own", () => {
    expect(findHandwrittenLinks(words("[[", "Signals", "]]"))).toEqual([
      { target: "Signals", strokeIds: ["s0", "s1", "s2"] },
    ]);
  });

  it("drops an alias, and keeps a heading", () => {
    expect(findHandwrittenLinks(words("[[Signals#FIR|the", "FIR", "part]]"))).toEqual([
      { target: "Signals#FIR", strokeIds: ["s0", "s1", "s2"] },
    ]);
  });

  it("finds two links on one line", () => {
    const found = findHandwrittenLinks(words("[[A]]", "and", "[[B]]"));
    expect(found.map((l) => l.target)).toEqual(["A", "B"]);
  });

  it("uses the letters as written when the language model dropped the brackets", () => {
    const line: ReadWord[] = [
      { text: "Signals", greedy: "[[Signals]]", strokeIds: ["a"] },
      { text: "more", strokeIds: ["b"] },
    ];
    expect(findHandwrittenLinks(line)).toEqual([{ target: "Signals", strokeIds: ["a"] }]);
  });

  it("finds nothing in plain words, single brackets, an empty or unclosed link", () => {
    expect(findHandwrittenLinks(words("plain", "words"))).toEqual([]);
    expect(findHandwrittenLinks(words("see", "[1]", "and", "[note]"))).toEqual([]);
    expect(findHandwrittenLinks(words("[[]]"))).toEqual([]);
    expect(findHandwrittenLinks(words("[[", "]]"))).toEqual([]);
    expect(findHandwrittenLinks(words("[[Signals", "never", "closes"))).toEqual([]);
    expect(findHandwrittenLinks(words("[[a[b]]"))).toEqual([]);
  });
});
