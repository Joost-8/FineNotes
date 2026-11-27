/**
 * Spelling questions apart from reading questions (spelling-flags.ts), and
 * the letters Grape's second look changed (corrections.ts `writtenTokens`).
 */
import { describe, expect, it } from "vitest";
import { SPELLING_FIXES, spellingFixes } from "../../src/recognition/hwr/spelling-flags";
import { readWords, shownAnswers, writtenTokens } from "../../src/recognition/hwr/corrections";
import type { PageLineReading } from "../../src/recognition/hwr/recognizer";

const LIST = new Set(["receive", "revive", "recite", "the", "word", "relieve"]);
const listed = (w: string) => LIST.has(w);

describe("writtenTokens", () => {
  it("pairs each changed token with what was written", () => {
    expect(writtenTokens("the revive word", "the recive word")).toEqual([null, "recive", null]);
  });

  it("pairs nothing without a second look, or when the token counts differ", () => {
    expect(writtenTokens("the revive", undefined)).toEqual([null, null]);
    expect(writtenTokens("the revive", "the re cive")).toEqual([null, null]);
  });
});

describe("readWords carries what was written", () => {
  it("onto the changed word only", () => {
    const line = {
      text: "the revive",
      asWritten: "the recive",
      words: [["a"], ["b", "c"]],
    } as unknown as PageLineReading;
    const words = readWords([line]);
    expect(words.map((w) => w.wrote)).toEqual([undefined, "recive"]);
  });
});

describe("spellingFixes", () => {
  it("a changed word: the reading first, then the list words its ink fits, at most three", () => {
    const fixes = spellingFixes(
      { text: "revive", wrote: "recive" },
      { words: ["revive", "receive", "recite", "relieve"], margin: 0.1 },
      listed,
      true,
      1,
    );
    expect(fixes).toEqual(["revive", "receive", "recite"]);
    expect(fixes.length).toBeLessThanOrEqual(SPELLING_FIXES);
  });

  it("keeps the punctuation the ink has", () => {
    expect(spellingFixes({ text: "revive,", wrote: "recive," }, null, listed, true, 1)).toEqual([
      "revive,",
    ]);
  });

  it("a word read as written: only when the ink fits it clearly better than any list word", () => {
    const word = { text: "recieve" };
    expect(spellingFixes(word, { words: ["receive"], margin: 2 }, listed, true, 1)).toEqual([
      "receive",
    ]);
    expect(spellingFixes(word, { words: ["receive"], margin: 0.4 }, listed, true, 1)).toEqual([]);
    expect(spellingFixes(word, null, listed, true, 1)).toEqual([]);
  });

  it("none for a listed word, or a fix more than two letters away", () => {
    expect(
      spellingFixes({ text: "word" }, { words: ["ward"], margin: 3 }, listed, true, 1),
    ).toEqual([]);
    expect(
      spellingFixes({ text: "recxyzve" }, { words: ["receive"], margin: 3 }, listed, true, 1),
    ).toEqual([]);
  });
});

describe("shownAnswers for a word the second look changed", () => {
  it("shows the word as written when it was answered as right", () => {
    const file = {
      version: 1 as const,
      corrections: [
        {
          kind: "ignore" as const,
          read: "revive",
          text: "recive",
          note: "n",
          page: "p",
          strokes: [{ id: "s", pts: [0, 0, 0.5], t0: null }],
          at: 1,
        },
      ],
    };
    expect([...shownAnswers(file, "n", "p")]).toEqual([["s", "recive"]]);
  });
});
