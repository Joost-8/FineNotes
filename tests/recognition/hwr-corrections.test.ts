import { describe, expect, it } from "vitest";
import {
  type Correction,
  addCorrection,
  answeredOn,
  correctionLines,
  emptyCorrections,
  flagWords,
  ignoredWords,
  parseCorrections,
  parseWordList,
  plainWord,
  readWords,
  serializeCorrections,
  strokeKey,
} from "../../src/recognition/hwr/corrections";
import type { PageLineReading } from "../../src/recognition/hwr/recognizer";

function correction(over: Partial<Correction> = {}): Correction {
  return {
    kind: "misread",
    read: "integets",
    text: "integers",
    note: "Maths/Maths.notebook.md",
    page: "p3",
    strokes: [
      { id: "s1", pts: [0, 0, 0.5, 4, 2, 0.5], t0: 10 },
      { id: "s2", pts: [6, 0, 0.5], t0: null },
    ],
    at: 1_700_000_000_000,
    ...over,
  };
}

function line(text: string, words: string[][]): PageLineReading {
  return {
    greedy: text,
    text,
    confidence: 0.9,
    frames: 10,
    timings: { features: 0, network: 0, greedy: 0, beam: 0 },
    strokeIds: words.flat(),
    words,
    box: [0, 0, 1, 1],
  };
}

describe("the corrections file", () => {
  it("round-trips, and an answer for the same ink replaces the last one", () => {
    let file = addCorrection(emptyCorrections(), correction());
    file = addCorrection(file, correction({ kind: "ignore", text: "integets" }));
    // Same strokes in another order: the same word.
    file = addCorrection(
      file,
      correction({ kind: "mistake", strokes: [...correction().strokes].reverse() }),
    );
    expect(file.corrections).toHaveLength(1);
    expect(file.corrections[0].kind).toBe("mistake");
    expect(parseCorrections(serializeCorrections(file))).toEqual(file);
  });

  it("keeps the good records and drops the bad ones", () => {
    const good = correction();
    const raw = JSON.stringify({
      version: 1,
      corrections: [
        good,
        { ...good, kind: "maybe" },
        { ...good, text: "  " },
        { ...good, text: "x".repeat(65) },
        { ...good, strokes: [] },
        { ...good, strokes: [{ id: "s", pts: [1, 2], t0: 0 }] },
        { ...good, strokes: [{ id: "s", pts: [1, 2, null], t0: 0 }] },
        { ...good, at: "yesterday" },
        "junk",
      ],
    });
    const parsed = parseCorrections(raw).corrections;
    expect(parsed).toHaveLength(2);
    expect(parsed[1].at).toBe(0);
    expect(parseCorrections(null).corrections).toEqual([]);
    expect(parseCorrections("{not json").corrections).toEqual([]);
    expect(parseCorrections('{"corrections": 3}').corrections).toEqual([]);
  });

  it("turns every answer into a labelled word with its ink", () => {
    const file = addCorrection(emptyCorrections(), correction());
    expect(correctionLines(file)).toEqual([
      {
        text: "integers",
        strokes: [
          { pts: [0, 0, 0.5, 4, 2, 0.5], t0: 10 },
          { pts: [6, 0, 0.5], t0: null },
        ],
      },
    ]);
  });
});

describe("readWords", () => {
  it("pairs each word's text with its ink, and skips lines whose counts differ", () => {
    const words = readWords([
      line("the prime factors", [["a"], ["b", "c"], ["d"]]),
      line("joined up", [["e"]]),
      line("  ", []),
    ]);
    expect(words).toEqual([
      { text: "the", strokeIds: ["a"] },
      { text: "prime", strokeIds: ["b", "c"] },
      { text: "factors", strokeIds: ["d"] },
    ]);
  });
});

describe("plainWord", () => {
  it("is the word as a list holds it, or null for what is not a word", () => {
    expect(plainWord("Hello,")).toBe("hello");
    expect(plainWord("(don't)")).toBe("don't");
    expect(plainWord("e-mail")).toBe("e-mail");
    expect(plainWord("Ärger")).toBe("ärger");
    expect(plainWord("x2")).toBeNull();
    expect(plainWord("a+b")).toBeNull();
    expect(plainWord("is")).toBeNull();
    expect(plainWord("--")).toBeNull();
  });
});

describe("flagWords", () => {
  const known = parseWordList("# common words\nthe\nPrime\n\nfactors\n");
  const words = [
    { text: "The", strokeIds: ["a"] },
    { text: "prime", strokeIds: ["b"] },
    { text: "integets", strokeIds: ["c", "d"] },
    { text: "Oskar", strokeIds: ["e"] },
    { text: "x2", strokeIds: ["f"] },
  ];

  it("underlines plain words the list does not know", () => {
    expect(flagWords(words, known, new Set()).map((w) => w.text)).toEqual(["integets", "Oskar"]);
  });

  it("leaves ignored words and answered ink alone", () => {
    const file = addCorrection(
      emptyCorrections(),
      correction({
        kind: "ignore",
        read: "Oskar",
        text: "Oskar",
        strokes: [{ id: "z", pts: [0, 0, 0], t0: null }],
      }),
    );
    const ignored = ignoredWords(file);
    expect([...ignored]).toEqual(["oskar"]);
    const answered = new Set([strokeKey(["d", "c"])]);
    expect(flagWords(words, known, ignored, answered)).toEqual([]);
  });

  it("finds the answered words of one page only", () => {
    let file = addCorrection(emptyCorrections(), correction());
    file = addCorrection(file, correction({ page: "p4" }));
    expect([...answeredOn(file, "Maths/Maths.notebook.md", "p3")]).toEqual(["s1,s2"]);
    // A misread is not a word to leave alone: its reading was wrong.
    expect(ignoredWords(file).size).toBe(0);
  });
});
