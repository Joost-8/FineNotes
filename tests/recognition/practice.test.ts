/**
 * `src/recognition/practice.ts`: the practice notebook, and the lines read
 * back from it as exact labels.
 */

import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/model/document";
import {
  PRACTICE_LINES,
  buildPracticeNotebook,
  isPracticeNotebook,
  practiceLines,
} from "../../src/recognition/practice";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import { encodeLabel } from "../../src/recognition/hwr/tune";
import { readFileSync } from "node:fs";

const A4 = { width: 1024, height: 1448 };

/** A stroke across x0..x1 with its middle at y. */
const ink = (id: string, y: number, extra: Partial<Stroke> = {}): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen",
  pts: [100, y - 10, 0.5, 200, y + 10, 0.5],
  ...extra,
});

describe("the practice notebook", () => {
  const doc = buildPracticeNotebook(A4);

  it("has every line as a prompt, ten to a page, on ruled paper", () => {
    expect(doc.pages).toHaveLength(2);
    const prompts = doc.pages.flatMap((p) =>
      p.textBoxes.filter((b) => b.id.startsWith("practice-")),
    );
    expect(prompts.map((b) => b.text)).toEqual(PRACTICE_LINES);
    expect(doc.pages.every((p) => p.backdrop.kind === "ruled-wide")).toBe(true);
    // Every prompt is on the page, with room below for the copy.
    for (const p of doc.pages) {
      for (const b of p.textBoxes) expect(b.y + 2 * (b.h ?? 40)).toBeLessThan(A4.height);
    }
    expect(isPracticeNotebook(doc)).toBe(true);
  });

  it("asks only for characters the model can write", () => {
    const alphabet = parseBundle(readFileSync("models/finenotes-hwr-1.0.bin")).meta.alphabet;
    for (const line of PRACTICE_LINES) expect(encodeLabel(line, alphabet), line).not.toBeNull();
  });

  it("survives a save and a load", () => {
    const back = decodeDocument(encodeDocument(doc));
    expect(isPracticeNotebook(back)).toBe(true);
    expect(practiceLines(back)).toEqual([]);
  });
});

describe("practiceLines", () => {
  it("labels the ink written under each prompt with its text", () => {
    const doc = buildPracticeNotebook(A4);
    const page = doc.pages[0];
    const first = page.textBoxes.find((b) => b.id === "practice-1")!;
    const second = page.textBoxes.find((b) => b.id === "practice-2")!;
    const under = (box: typeof first) => box.y + 1.6 * (box.h ?? 40);
    page.strokes = [
      ink("a", under(first)),
      ink("b", under(first) + 5),
      ink("c", under(second)),
      ink("mark", under(second), { tool: "highlighter" }),
      ink("box", under(second), { shape: "rect" }),
      ink("on-prompt", first.y + 20),
    ];
    expect(practiceLines(doc).map((l) => [l.text, l.strokes.map((s) => s.id)])).toEqual([
      [PRACTICE_LINES[0], ["a", "b"]],
      [PRACTICE_LINES[1], ["c"]],
    ]);
  });

  it("finds nothing in a notebook without prompts", () => {
    const doc = buildPracticeNotebook(A4);
    for (const p of doc.pages) p.textBoxes = [];
    expect(isPracticeNotebook(doc)).toBe(false);
    expect(practiceLines(doc)).toEqual([]);
  });
});
