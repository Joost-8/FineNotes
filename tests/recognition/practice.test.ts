/**
 * `src/recognition/practice.ts`: the practice file, and the lines read back
 * from it as exact labels.
 */

import { describe, expect, it } from "vitest";
import type { PrintedText, Stroke, SyntheticBackdrop } from "../../src/model/document";
import {
  PRACTICE_FORMAT,
  PRACTICE_LINES,
  PRACTICE_SETS,
  buildPracticeFile,
  isPracticeNotebook,
  practiceLines,
  wrapPrinted,
} from "../../src/recognition/practice";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import { encodeLabel } from "../../src/recognition/hwr/tune";
import { readFileSync } from "node:fs";

const A4 = { width: 1024, height: 1448 };

/** A stroke across x 100..200 with its middle at y, 20 px tall. */
const ink = (id: string, y: number, extra: Partial<Stroke> = {}): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen",
  pts: [100, y - 10, 0.5, 200, y + 10, 0.5],
  ...extra,
});

const printedOf = (page: { backdrop: unknown }): PrintedText[] =>
  (page.backdrop as SyntheticBackdrop).printed ?? [];
const promptsOf = (page: { backdrop: unknown }): PrintedText[] =>
  printedOf(page).filter((line) => line.prompt);

describe("the practice file", () => {
  const doc = buildPracticeFile(1, A4);

  it("opens on a cover, then has every line printed as a prompt, ten to a page", () => {
    expect(doc.practice).toEqual({ format: PRACTICE_FORMAT, set: 1 });
    expect(doc.pages).toHaveLength(4);
    const [cover, ...pages] = doc.pages;
    expect(cover.backdrop.kind).toBe("blank");
    const words = printedOf(cover)
      .map((line) => line.text)
      .join(" ");
    expect(words).toMatch(/Handwriting practice/);
    expect(words).toMatch(/Learn now/);
    expect(words).toMatch(/delete this file/);
    expect(words).toMatch(/set 1 of 3/);
    expect(promptsOf(cover)).toEqual([]);
    expect(pages.flatMap(promptsOf).map((line) => line.text)).toEqual(PRACTICE_LINES);
    expect(pages.every((p) => p.backdrop.kind === "ruled-wide")).toBe(true);
    // No text boxes: nothing to edit, and no [[link]] to render.
    expect(doc.pages.every((p) => p.textBoxes.length === 0)).toBe(true);
    // Each prompt has its line to write on and a spare one below it, on the page.
    for (const p of pages)
      for (const line of promptsOf(p)) expect(line.y + 80).toBeLessThan(A4.height);
    expect(isPracticeNotebook(doc)).toBe(true);
  });

  it("has three different sets, each asking only for characters the model can write", () => {
    expect(PRACTICE_SETS).toHaveLength(3);
    const alphabet = parseBundle(readFileSync("models/grape-2.0.bin")).meta.alphabet;
    const all = PRACTICE_SETS.flat();
    expect(new Set(all).size).toBe(all.length);
    for (const line of all) expect(encodeLabel(line, alphabet), line).not.toBeNull();
    for (const [i, set] of PRACTICE_SETS.entries()) {
      expect(set, `set ${i + 1}`).toHaveLength(30);
      // Every letter of the alphabet, in both cases, somewhere in the set.
      const text = set.join(" ");
      for (const letter of "abcdefghijklmnopqrstuvwxyz") {
        expect(text.toLowerCase(), `set ${i + 1}: ${letter}`).toContain(letter);
      }
      for (const digit of "0123456789") expect(text, `set ${i + 1}: ${digit}`).toContain(digit);
    }
    const third = buildPracticeFile(3, A4);
    expect(third.practice?.set).toBe(3);
    expect(third.pages.slice(1).flatMap(promptsOf)[0].text).toBe(PRACTICE_SETS[2][0]);
    // Out of range: the nearest set.
    expect(buildPracticeFile(9, A4).practice?.set).toBe(3);
  });

  it("survives a save and a load, raw samples and all", () => {
    const written = buildPracticeFile(2, A4);
    written.practice = { ...written.practice!, device: "ipad", input: "pen" };
    const k = 3;
    written.pages[1].strokes = [
      ink("a", 40 * k + 20, {
        samples: [100.25, 110, 0.31, 0, 150, 120.5, 0.4, 8, 200, 130, 0, 16],
      }),
    ];
    const back = decodeDocument(encodeDocument(written));
    expect(back.practice).toEqual({ format: 1, set: 2, device: "ipad", input: "pen" });
    expect(isPracticeNotebook(back)).toBe(true);
    expect(back.pages[1].backdrop).toEqual(written.pages[1].backdrop);
    expect(back.pages[1].strokes[0].samples).toEqual([
      100.25, 110, 0.31, 0, 150, 120.5, 0.4, 8, 200, 130, 0, 16,
    ]);
    expect(practiceLines(back).map((l) => l.text)).toEqual([PRACTICE_SETS[1][0]]);
  });
});

describe("practiceLines", () => {
  // Prompt i (0-based) on a page sits on rule 3 + 3i; it is copied on the
  // line below that rule, with a spare line after it.
  const writingY = (i: number) => 40 * (3 + 3 * i) + 20;

  it("labels the ink written under each prompt with its text", () => {
    const doc = buildPracticeFile(1, A4);
    const page = doc.pages[1];
    page.strokes = [
      ink("a", writingY(0)),
      ink("b", writingY(0) + 5),
      // Large writing that drifted onto the spare line still belongs to it.
      ink("drift", writingY(0) + 40),
      ink("c", writingY(1)),
      ink("mark", writingY(1), { tool: "highlighter" }),
      ink("box", writingY(1), { shape: "rect" }),
      // On the prompt's own line: not the copy.
      ink("on-prompt", 40 * 6 - 20),
    ];
    expect(practiceLines(doc).map((l) => [l.text, l.strokes.map((s) => s.id)])).toEqual([
      [PRACTICE_LINES[0], ["a", "b", "drift"]],
      [PRACTICE_LINES[1], ["c"]],
    ]);
  });

  it("finds nothing on the cover, or in a file nobody has written in", () => {
    const doc = buildPracticeFile(1, A4);
    doc.pages[0].strokes = [ink("doodle", 300)];
    expect(practiceLines(doc)).toEqual([]);
  });

  it("still reads a practice notebook from before practice files", () => {
    const doc = buildPracticeFile(1, A4);
    delete doc.practice;
    const page = doc.pages[1];
    page.backdrop = { kind: "ruled-wide" };
    page.textBoxes = [
      {
        id: "practice-1",
        x: 60,
        y: 120,
        w: 900,
        h: 40,
        text: "Old prompt",
        color: "#777",
        fontSize: 20,
      },
    ];
    page.strokes = [ink("old", 120 + 1.6 * 40)];
    expect(isPracticeNotebook(doc)).toBe(true);
    expect(practiceLines(doc).map((l) => [l.text, l.strokes.map((s) => s.id)])).toEqual([
      ["Old prompt", ["old"]],
    ]);
    page.textBoxes = [];
    expect(isPracticeNotebook(doc)).toBe(false);
  });
});

describe("wrapPrinted", () => {
  it("breaks at words to fit, and keeps paragraphs", () => {
    expect(wrapPrinted("one two three four", 100, 20)).toEqual(["one two", "three four"]);
    expect(wrapPrinted("a\nb", 1000, 20)).toEqual(["a", "b"]);
    expect(wrapPrinted("unbreakablewordthatislong", 40, 20)).toEqual(["unbreakablewordthatislong"]);
  });
});
