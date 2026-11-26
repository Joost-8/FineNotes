import { describe, expect, it } from "vitest";
import {
  type Correction,
  addCorrection,
  correctionLines,
  emptyCorrections,
  ignoredWords,
  mergeCorrections,
  parseCorrections,
  serializeCorrections,
  shownAnswers,
  strokeKey,
} from "../../src/recognition/hwr/corrections";
import { answeredTexts } from "../../src/recognition/hwr/answered-reading";
import { correctionDrafts } from "../../src/recognition/hwr/sharing";

/** Grape's misreads and the writer's own mistakes, told apart (RESEARCH-LOG 2026-11-25). */

function correction(over: Partial<Correction> = {}): Correction {
  return {
    kind: "mistake",
    read: "recieve",
    text: "recieve",
    note: "Notes/Week 3.notebook.md",
    page: "p1",
    strokes: [{ id: "s1", pts: [0, 0, 0.5, 4, 2, 0.5], t0: 10 }],
    at: 1_700_000_000_000,
    ...over,
  };
}

describe("a word the writer wrote wrong (meant)", () => {
  it("survives writing and reading the file", () => {
    const file = addCorrection(emptyCorrections(), correction({ meant: "receive" }));
    const back = parseCorrections(serializeCorrections(file));
    expect(back.corrections[0].meant).toBe("receive");
    expect(back.corrections[0].text).toBe("recieve");
  });

  it("is kept only on a mistake, trimmed, and never equal to the text", () => {
    const raw = JSON.stringify({
      version: 1,
      corrections: [
        correction({ meant: "  receive  " }),
        correction({ kind: "misread", text: "simple", read: "single", meant: "simple!" }),
        correction({ meant: "recieve" }),
        correction({ meant: "x".repeat(65) }),
        { ...correction(), meant: 42 },
      ].map((c, i) => ({ ...c, strokes: [{ ...c.strokes[0], id: `s${i}` }] })),
    });
    const back = parseCorrections(raw).corrections;
    expect(back.map((c) => c.meant)).toEqual([
      "receive",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("what each answer teaches Grape and shares with Help improve Grape: what the ink says, never the meant word", () => {
    const ink = (id: string) => [{ id, pts: [1, 1, 0.5, 3, 4, 0.5], t0: 0 }];
    const answers: Correction[] = [
      // Grape misread it: the typed word.
      correction({ kind: "misread", read: "single", text: "simple", strokes: ink("a") }),
      // It says "…": the reading.
      correction({ read: "coprime", text: "coprime", strokes: ink("b") }),
      // Should be "receive" / I wrote it wrong: the reading, as the writer wrote it.
      correction({ meant: "receive", strokes: ink("c") }),
      // Add to dictionary: learned, never shared (mostly names).
      correction({ kind: "ignore", read: "Oskar", text: "Oskar", strokes: ink("d") }),
      // A piece of a calculation note's sum: an equation.
      correction({ kind: "misread", read: "3+4", text: "3+4=", source: "calc", strokes: ink("e") }),
    ];
    const file = answers.reduce(addCorrection, emptyCorrections());
    expect(correctionLines(file).map((l) => l.text)).toEqual([
      "simple",
      "coprime",
      "recieve",
      "Oskar",
      "3+4=",
    ]);
    const shared = correctionDrafts(file).map((d) => ({
      kind: d.kind,
      text: d.text,
      answer: d.answer,
    }));
    expect(shared).toEqual([
      { kind: "word", text: "simple", answer: "misread" },
      { kind: "word", text: "coprime", answer: "mistake" },
      { kind: "word", text: "recieve", answer: "mistake" },
      { kind: "equation", text: "3+4=", answer: "misread" },
    ]);
    // Only the ink and what it says leave the device: no meant word, note, page or ids.
    const sent = JSON.stringify(correctionDrafts(file));
    for (const secret of ["receive", "Week 3", "notebook.md", '"p1"', '"c"']) {
      expect(sent).not.toContain(secret);
    }
  });

  it("still stops the word being underlined, like any answer that the ink says the reading", () => {
    const file = addCorrection(emptyCorrections(), correction({ meant: "receive" }));
    expect(ignoredWords(file).has("recieve")).toBe(true);
  });

  it("is merged like any answer: the newer file wins for the same ink", () => {
    const newer = addCorrection(emptyCorrections(), correction({ meant: "receive" }));
    const older = addCorrection(emptyCorrections(), correction());
    expect(mergeCorrections(newer, older).corrections).toEqual(newer.corrections);
  });
});

describe("what the text shows (shownAnswers)", () => {
  it("shows the typed word for a misread and the meant word for a mistake, nothing for the rest", () => {
    let file = addCorrection(emptyCorrections(), correction({ meant: "receive" }));
    file = addCorrection(
      file,
      correction({
        kind: "misread",
        read: "single",
        text: "simple",
        strokes: [{ id: "s2", pts: [0, 0, 1], t0: 0 }],
      }),
    );
    file = addCorrection(
      file,
      correction({
        kind: "ignore",
        read: "Oskar",
        text: "Oskar",
        strokes: [{ id: "s3", pts: [0, 0, 1], t0: 0 }],
      }),
    );
    file = addCorrection(
      file,
      correction({
        read: "fermat",
        text: "fermat",
        strokes: [{ id: "s4", pts: [0, 0, 1], t0: 0 }],
      }),
    );
    const shown = shownAnswers(file, "Notes/Week 3.notebook.md", "p1");
    expect([...shown]).toEqual([
      ["s1", "receive"],
      ["s2", "simple"],
    ]);
    expect(shownAnswers(file, "Notes/Week 3.notebook.md", "p2").size).toBe(0);
    expect(shownAnswers(file, "Other.notebook.md", "p1").size).toBe(0);
  });
});

describe("a page's reading with the answers in it (answeredTexts)", () => {
  const lines = [
    { text: "I will recieve it", words: [["a"], ["b"], ["c", "d"], ["e"]] },
    { text: "a single  line,", words: [["f"], ["g"], ["h"]] },
  ];

  it("replaces each answered word by its strokes, keeping the spacing around it", () => {
    const shown = new Map([
      [strokeKey(["d", "c"]), "receive"],
      [strokeKey(["g"]), "simple"],
    ]);
    expect(answeredTexts(lines, shown)).toEqual(["I will receive it", "a simple  line,"]);
  });

  it("leaves a line whose words do not pair with its ink as it was read", () => {
    const shown = new Map([[strokeKey(["g"]), "simple"]]);
    const unpaired = [{ text: "a single line, more", words: [["f"], ["g"], ["h"]] }];
    expect(answeredTexts(unpaired, shown)).toEqual(["a single line, more"]);
  });

  it("changes nothing without answers, or for a word with no ink", () => {
    expect(answeredTexts(lines, new Map())).toEqual(lines.map((l) => l.text));
    const empty = [{ text: "x y", words: [[], ["y"]] }];
    expect(answeredTexts(empty, new Map([["", "boom"]]))).toEqual(["x y"]);
  });
});
