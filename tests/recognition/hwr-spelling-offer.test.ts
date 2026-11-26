import { describe, expect, it } from "vitest";
import { MAX_SPELLING_EDITS, offersSpelling } from "../../src/recognition/hwr/spelling-offer";

/** The card's "Should be" (Joost's iPad test and his own pages, 2026-11-25). */
const list = new Set([
  "on",
  "tuesday",
  "thursday",
  "room",
  "soon",
  "accept",
  "search",
  "receive",
  "alphabet",
  "exception",
  "dusting",
]);
const listed = (w: string) => list.has(w);

describe("offersSpelling", () => {
  it("never for a word written and read right: listed, short, a number, a code or maths", () => {
    for (const [read, suggested] of [
      ["Tuesday", "Thursday"],
      ["room", "soon"],
      ["on", "an"],
      ["at", "as"],
      ["B-214", "Be-234"],
      ["O(log", "clog"],
      ["n)", "no)"],
      ["10:30", "10:00"],
      ["DFA", "AFA"],
      ["Qxz->", "Oxz->"],
      ["f(x)=", "fix"],
      ["NFA", "AFA"],
    ]) {
      expect(offersSpelling(read, suggested, listed, true), read).toBe(false);
    }
  });

  it("never for an English list word with a common ending", () => {
    expect(offersSpelling("accepts", "accept", listed, true)).toBe(false);
    expect(offersSpelling("searched", "search", listed, true)).toBe(false);
    // In another language endings are not English ones.
    expect(offersSpelling("accepts", "accept", listed, false)).toBe(true);
  });

  it("never for a far word: only a likely misspelling", () => {
    expect(offersSpelling("Encryption", "Exception", listed, true)).toBe(false);
    expect(offersSpelling("judstrings", "dusting", listed, true)).toBe(false);
    expect(MAX_SPELLING_EDITS).toBe(2);
  });

  it("for a plain unlisted word a letter or two from a list word", () => {
    expect(offersSpelling("recieve", "receive", listed, true)).toBe(true);
    expect(offersSpelling("alphalet", "alphabet", listed, true)).toBe(true);
    expect(offersSpelling("Recieve,", "Receive,", listed, true)).toBe(true);
  });

  it("never without a suggestion, or when it is the reading", () => {
    expect(offersSpelling("recieve", null, listed, true)).toBe(false);
    expect(offersSpelling("recieve", "recieve", listed, true)).toBe(false);
  });
});
