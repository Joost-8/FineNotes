import { describe, expect, it } from "vitest";
import type { ReadWord } from "../../src/recognition/hwr/corrections";
import {
  editedPhrase,
  editedWords,
  matchCase,
  replaceToken,
  selectionWords,
  wordToCorrect,
  wordsByLine,
} from "../../src/recognition/hwr/selection-words";

const words: ReadWord[] = [
  { text: "The", strokeIds: ["a"] },
  { text: "rationals", strokeIds: ["b", "c"] },
  { text: "are", strokeIds: ["d"] },
  { text: "dense.", strokeIds: ["e", "f"] },
];
// Every stroke on the read lines, "g" being one the reading paired with no word.
const read = new Set(["a", "b", "c", "d", "e", "f", "g"]);

describe("selectionWords", () => {
  it("gives the whole words a selection is made of, in reading order", () => {
    expect(selectionWords(words, read, ["c", "b"])?.map((w) => w.text)).toEqual(["rationals"]);
    expect(selectionWords(words, read, ["f", "e", "a", "b", "c"])?.map((w) => w.text)).toEqual([
      "The",
      "rationals",
      "dense.",
    ]);
  });

  it("ignores selected ink the reading never read (shapes, highlighter)", () => {
    expect(selectionWords(words, read, ["b", "c", "box"])?.map((w) => w.text)).toEqual([
      "rationals",
    ]);
  });

  it("takes a word the selection only touches whole", () => {
    expect(selectionWords(words, read, ["b"])?.map((w) => w.text)).toEqual(["rationals"]);
    expect(selectionWords(words, read, ["c", "e"])?.map((w) => w.text)).toEqual([
      "rationals",
      "dense.",
    ]);
  });

  it("refuses a selection that holds read ink in no word", () => {
    expect(selectionWords(words, read, ["b", "c", "g"])).toBeNull();
    expect(selectionWords(words, read, ["box"])).toBeNull();
    expect(selectionWords(words, read, [])).toBeNull();
  });
});

describe("matchCase", () => {
  it("cases a list word like the word it replaces", () => {
    expect(matchCase("Fationals", "rationals")).toBe("Rationals");
    expect(matchCase("fationals", "rationals")).toBe("rationals");
    expect(matchCase("EEA,", "eea")).toBe("EEA");
    expect(matchCase("(Fationals)", "rationals")).toBe("Rationals");
    expect(matchCase("I", "a")).toBe("A");
    expect(matchCase("42", "rationals")).toBe("rationals");
  });
});

describe("replaceToken", () => {
  it("replaces the first whole token equal to the word, nothing else", () => {
    expect(replaceToken("The Fationals", "Fationals", "Rationals")).toBe("The Rationals");
    expect(replaceToken("aFationals Fationals", "Fationals", "Rationals")).toBe(
      "aFationals Rationals",
    );
    expect(replaceToken("Other title", "Fationals", "Rationals")).toBe("Other title");
  });
});

describe("wordsByLine", () => {
  it("puts each reading line's words on a line of their own", () => {
    const placed: ReadWord[] = [
      { text: "Buy", strokeIds: ["a"], at: { line: 0, start: 0, end: 3 } },
      { text: "milk", strokeIds: ["b"], at: { line: 0, start: 4, end: 8 } },
      { text: "and", strokeIds: ["c"], at: { line: 2, start: 0, end: 3 } },
      // No place: it stays on the line before it.
      { text: "eggs", strokeIds: ["d"] },
    ];
    expect(wordsByLine(placed)).toBe("Buy milk\nand eggs");
    expect(wordsByLine(words)).toBe("The rationals are dense.");
    expect(wordsByLine([])).toBe("");
  });
});

describe("editedWords", () => {
  const ink: ReadWord[] = [
    { text: "The", strokeIds: ["a"] },
    { text: "Fationals", strokeIds: ["b"] },
  ];

  it("pairs words by position and keeps close corrections", () => {
    expect(editedWords(ink, "The Rationals")).toEqual([{ word: ink[1], text: "Rationals" }]);
    expect(editedWords(ink, " the   rationals ")).toEqual([{ word: ink[1], text: "rationals" }]);
  });

  it("records nothing for the reading as it is, a change of case, or punctuation", () => {
    expect(editedWords(ink, "The Fationals")).toEqual([]);
    expect(editedWords(ink, "THE fationals")).toEqual([]);
    expect(editedWords(ink, "The Fationals:")).toEqual([]);
  });

  it("records nothing for a rename to another word or another word count", () => {
    expect(editedWords(ink, "The Integers")).toEqual([]);
    expect(editedWords(ink, "Rational numbers here")).toEqual([]);
    expect(editedWords(ink, "")).toEqual([]);
    // Not a plain word: no label.
    expect(editedWords([{ text: "x2", strokeIds: ["z"] }], "x3")).toEqual([]);
  });
});

describe("correcting (Correct on a lassoed sentence)", () => {
  const ink: ReadWord[] = [
    { text: "Soft", strokeIds: ["a"] },
    { text: "ware", strokeIds: ["b"] },
    { text: "katatsuon", strokeIds: ["c"] },
  ];

  it("labels every word changed, however far from the reading", () => {
    expect(editedWords(ink, "Soft ware Karatsuba", true)).toEqual([
      { word: ink[2], text: "Karatsuba" },
    ]);
    expect(editedWords(ink, "soft ware x2", true)).toEqual([
      { word: ink[0], text: "soft" },
      { word: ink[2], text: "x2" },
    ]);
  });

  it("labels a split or joined word as one line of the whole selection", () => {
    expect(editedPhrase(ink, "Software Karatsuba")).toEqual({
      strokeIds: ["a", "b", "c"],
      read: "Soft ware katatsuon",
      text: "Software Karatsuba",
    });
    expect(editedPhrase(ink, "Soft ware Karatsuba")).toBeNull();
    expect(editedPhrase(ink, "")).toBeNull();
  });
});

describe("wordToCorrect", () => {
  it("takes the word whose ink was picked, a clipped word whole", () => {
    expect(wordToCorrect(words, ["c"])?.text).toBe("rationals");
  });

  it("of several words, the first the word check underlines, else the first", () => {
    expect(wordToCorrect(words, ["a", "b", "e"])?.text).toBe("The");
    expect(wordToCorrect(words, ["a", "b", "e"], new Set(["e,f"]))?.text).toBe("dense.");
  });

  it("is null for ink in no read word", () => {
    expect(wordToCorrect(words, ["g"])).toBeNull();
    expect(wordToCorrect(words, [])).toBeNull();
  });
});
