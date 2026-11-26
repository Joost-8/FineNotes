import { describe, expect, it } from "vitest";

import type { CharReading } from "../../../src/recognition/hwr/char-readings";
import {
  ASK_BELOW,
  SURE_BARS,
  applyAnswers,
  joinPunctuation,
  pickQuestions,
  sureWords,
  unsureCandidates,
  wordCore,
  wordSureness,
  wordsOf,
  writeUnasked,
} from "../../../src/recognition/writer/sure-words";

describe("applyAnswers when the card read a word otherwise than Beautify (the reviewer's case)", () => {
  // Beautify's own reading of the line says "testng"; the card showed the page's reading.
  const words = ["testng", "the", "new"];
  const ink = [["s1", "s2"], ["s3"], ["s4"]];

  it("writes what the writer answered, for every kind, not Beautify's own reading", () => {
    for (const kind of ["mistake", "ignore", "misread"] as const) {
      const got = applyAnswers(words, ink, [{ kind, text: "testing", ids: ["s1", "s2"] }]);
      expect(got.words[0]).toBe("testing");
      expect([...got.known]).toEqual([0]);
    }
  });

  it("knows a word only when an answer matched it: of several words, or other ink, none", () => {
    expect(
      applyAnswers(words, ink, [{ kind: "misread", text: "can not", ids: ["s1", "s2"] }]).known
        .size,
    ).toBe(0);
    expect(
      applyAnswers(words, ink, [{ kind: "mistake", text: "testing", ids: ["s1", "s9", "s8"] }])
        .known.size,
    ).toBe(0);
  });
});

describe("pickQuestions (Joost's iPad, 25 November: ten cards for two lines)", () => {
  const q = (line: number, word: number, sure: number) => ({ line, word, sure });

  it("asks on each line about its least sure word only (the reviewer's case: two on line 0, none on line 1)", () => {
    const got = pickQuestions([q(0, 1, 0.2), q(0, 3, 0.1), q(1, 0, 0.3), q(1, 2, 0.6)]);
    expect(got).toEqual([q(0, 3, 0.1), q(1, 0, 0.3)]);
  });

  it("never asks about a word read surely enough, nor with no room on a line", () => {
    expect(pickQuestions([q(0, 0, ASK_BELOW), q(0, 1, 0.97)])).toEqual([]);
    expect(pickQuestions([q(0, 0, 0.1)], 0)).toEqual([]);
  });
});

describe("unsureCandidates and writeUnasked: who is asked, who is written", () => {
  const line = {
    read: ["Meeting", "on", "Tusday", "-", "room"],
    words: [["a"], ["b"], ["c", "d"], ["e"], []],
    rewrite: [true, false, false, false, false],
    sure: [1, 0.95, 0.2, 0.1, 0.3],
  };

  it("offers the words not sure enough to write that have a letter or digit and ink", () => {
    expect(unsureCandidates([line])).toEqual([
      { line: 0, word: 1, sure: 0.95 },
      { line: 0, word: 2, sure: 0.2 },
    ]);
  });

  it("keeps a word asked and not answered as ink, writes an answered one, and every word not asked", () => {
    const asked = new Set(["c"]);
    // Not answered: still not sure after the question.
    expect(writeUnasked(line, asked)).toEqual({
      rewrite: [true, true, false, true, false],
      answered: [false, false, false, false, false],
    });
    // Answered: sure now, and marked answered.
    const after = { ...line, rewrite: [true, false, true, false, false] };
    expect(writeUnasked(after, asked)).toEqual({
      rewrite: [true, true, true, true, false],
      answered: [false, false, true, false, false],
    });
  });
});

describe("wordSureness", () => {
  it("is a word's least sure letter, halved when the list could hold it and does not", () => {
    const text = "Meeting on room xyzzy";
    const chars = readings(text, { 1: { confidence: 0.8 } });
    const list = (w: string) => ["meeting", "room"].includes(w.toLowerCase());
    const got = wordSureness(text, text, chars, list);
    expect(got[0]).toBeCloseTo(0.8, 6);
    // "on" is too short for the list (it keeps three letters or more): not halved.
    expect(got[1]).toBeCloseTo(0.99, 6);
    expect(got[2]).toBeCloseTo(0.99, 6);
    expect(got[3]).toBeCloseTo(0.495, 6);
  });

  it("is 0 where the text and the letters as written disagree", () => {
    const got = wordSureness(
      "Meeting on Tuesday",
      "Meeting en Tuesday",
      readings("Meeting en Tuesday"),
    );
    expect(got).toEqual([0.99, 0, 0.99]);
  });
});

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

describe("applyAnswers", () => {
  const words = ["from", "the", "Bezout", "lemma"];
  const ink = [["s1", "s2"], ["s3"], ["s4", "s5", "s6"], ["s7", "s8"]];

  it("gives a misread word the writer's text and makes it known", () => {
    const got = applyAnswers(words, ink, [{ kind: "misread", text: "form", ids: ["s2", "s1"] }]);
    expect(got.words).toEqual(["form", "the", "Bezout", "lemma"]);
    expect([...got.known]).toEqual([0]);
  });

  it("lists a word the writer said is as written (mistake, ignore), and knows it: they said what it is", () => {
    const got = applyAnswers(words, ink, [
      { kind: "ignore", text: "Bezout", ids: ["s4", "s5", "s6"] },
      { kind: "mistake", text: "lemma", ids: ["s7", "s8"] },
    ]);
    expect(got.words).toEqual(words);
    expect([...got.listed].sort()).toEqual(["bezout", "lemma"]);
    expect([...got.known].sort()).toEqual([2, 3]);
  });

  it("needs most of the word's strokes to be the answered word's", () => {
    const got = applyAnswers(words, ink, [{ kind: "misread", text: "Bezout", ids: ["s4"] }]);
    expect(got.words).toEqual(words);
    expect(got.known.size).toBe(0);
  });

  it("ignores a misread answer of several words", () => {
    const got = applyAnswers(words, ink, [{ kind: "misread", text: "for m", ids: ["s1", "s2"] }]);
    expect(got.words[0]).toBe("from");
  });
});

describe("joinPunctuation", () => {
  it("joins a comma read apart to the word before it, rewritten only if both were", () => {
    const got = joinPunctuation({
      words: ["April", ",", "May", ",", "June"],
      ink: [["a"], ["c1"], ["m"], ["c2"], ["j"]],
      rewrite: [true, true, true, false, true],
    });
    expect(got).toEqual({
      words: ["April,", "May,", "June"],
      ink: [["a", "c1"], ["m", "c2"], ["j"]],
      rewrite: [true, false, true],
    });
  });

  it("joins leading punctuation to the first word, and keeps a line of punctuation alone", () => {
    expect(
      joinPunctuation({
        words: ["(", "one", ")"],
        ink: [["o"], ["w"], ["c"]],
        rewrite: [true, true, true],
      }).words,
    ).toEqual(["(one)"]);
    expect(
      joinPunctuation({ words: ["-", "-"], ink: [["a"], ["b"]], rewrite: [false, true] }),
    ).toEqual({
      words: ["--"],
      ink: [["a", "b"]],
      rewrite: [false],
    });
  });

  it("leaves words with letters or digits as they are", () => {
    const line = {
      words: ["x2", "is", "4."],
      ink: [["a"], ["b"], ["c"]],
      rewrite: [true, false, true],
    };
    expect(joinPunctuation(line)).toEqual(line);
  });
});

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

  it("does not look up words the list cannot hold: under three letters, or with digits (Joost's iPad)", () => {
    const t = "Meeting on Tuesday at 10:30 in room B-214.";
    const list = new Set(["meeting", "tuesday", "room"]);
    const inList = (w: string): boolean => list.has(w.toLowerCase());
    const any = (): boolean => true;
    expect(sureWords(t, t, readings(t), any, SURE_BARS, new Set(), inList)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
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
