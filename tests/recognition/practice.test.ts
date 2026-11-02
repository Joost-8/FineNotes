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
  SYMBOL_LINES,
  SYMBOL_SET,
  buildPracticeFile,
  isPracticeNotebook,
  isSymbolSet,
  missingSymbols,
  practiceLines,
  practicePrompts,
  practiceSetOfDoc,
  promptCount,
  symbolSamples,
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
    // The way on is the sheet's own button, not a settings path.
    expect(words).toMatch(/Tap Learn my handwriting at the top/);
    expect(words).not.toMatch(/Settings/);
    expect(words).toMatch(/set 1 of 3/i);
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
    // Its prompts are no set's lines: no set.
    doc.pages = [doc.pages[0], page];
    expect(practiceSetOfDoc(doc)).toBeNull();
    expect(promptCount(doc)).toBe(1);
    // The first notebooks had set 1's first lines: that set, with as many lines as it asks.
    page.textBoxes[0].text = PRACTICE_LINES[3];
    expect(practiceSetOfDoc(doc)).toBe(1);
    page.textBoxes = [];
    expect(isPracticeNotebook(doc)).toBe(false);
    expect(practiceSetOfDoc(doc)).toBeNull();
    expect(practiceSetOfDoc(buildPracticeFile(2, A4))).toBe(2);
    expect(promptCount(buildPracticeFile(2, A4))).toBe(PRACTICE_SETS[1].length);
  });
});

describe("wrapPrinted", () => {
  it("breaks at words to fit, and keeps paragraphs", () => {
    expect(wrapPrinted("one two three four", 100, 20)).toEqual(["one two", "three four"]);
    expect(wrapPrinted("a\nb", 1000, 20)).toEqual(["a", "b"]);
    expect(wrapPrinted("unbreakablewordthatislong", 40, 20)).toEqual(["unbreakablewordthatislong"]);
  });
});

describe("the symbol sheet", () => {
  const doc = buildPracticeFile(SYMBOL_SET, A4);
  // Symbol i (0-based) on a page sits on rule 3 + 2i; it is written on the line below.
  const symbolY = (i: number) => 40 * (3 + 2 * i) + 20;

  it("has one symbol a line, each named beside it, after a cover of its own", () => {
    expect(isSymbolSet(SYMBOL_SET)).toBe(true);
    expect(isSymbolSet(1)).toBe(false);
    expect(isSymbolSet(null)).toBe(false);
    expect(doc.practice).toEqual({ format: PRACTICE_FORMAT, set: SYMBOL_SET });
    expect(isPracticeNotebook(doc)).toBe(true);
    const [cover, ...pages] = doc.pages;
    const words = printedOf(cover)
      .map((line) => line.text)
      .join(" ");
    expect(words).toMatch(/Symbol practice/);
    expect(words).toMatch(/Tap Learn my handwriting at the top/);
    expect(words).not.toMatch(/set \d of/);
    const prompts = pages.flatMap(promptsOf);
    expect(prompts.map((line) => line.text)).toEqual(SYMBOL_LINES.map((line) => line.symbol));
    expect(practicePrompts(SYMBOL_SET)).toEqual(prompts.map((line) => line.text));
    // Every prompt is one character (a link's bracket pair two), and its
    // name is printed text that is no prompt.
    for (const p of pages) {
      const printed = printedOf(p);
      for (const prompt of promptsOf(p)) {
        expect(Array.from(prompt.text).length).toBe(/^(\[\[|\]\])$/.test(prompt.text) ? 2 : 1);
        const name = printed.find((line) => !line.prompt && line.y === prompt.y);
        expect(name?.text.length, prompt.text).toBeGreaterThan(1);
        // The line to write on is on the page.
        expect(prompt.y + 40).toBeLessThan(A4.height);
      }
    }
  });

  it("asks for digits twice, then every sign the model can write, then the signs beyond it", () => {
    const alphabet = parseBundle(readFileSync("models/grape-2.0.bin")).meta.alphabet;
    // The lines marked beyond the alphabet are exactly the ones it cannot spell.
    for (const { symbol, beyond } of SYMBOL_LINES) {
      expect(encodeLabel(symbol, alphabet) === null, symbol).toBe(beyond === true);
    }
    // They come last, so no line written before them changed its id.
    const first = SYMBOL_LINES.findIndex((line) => line.beyond);
    expect(SYMBOL_LINES.slice(first).every((line) => line.beyond)).toBe(true);
    expect(SYMBOL_LINES.slice(0, 53).map((line) => line.symbol)).toContain("6");
    expect(SYMBOL_LINES[52].name).toBe("six, again");
    for (const sign of ["[[", "]]", "∑", "∫"]) {
      expect(
        SYMBOL_LINES.map((line) => line.symbol),
        sign,
      ).toContain(sign);
    }
    const symbols = SYMBOL_LINES.filter((line) => !line.beyond).map((line) => line.symbol);
    for (const digit of "0123456789") {
      expect(
        symbols.filter((s) => s === digit),
        digit,
      ).toHaveLength(2);
    }
    for (const sign of "+-*/=().^%x<>") expect(symbols, sign).toContain(sign);
    // Each sign once.
    const signs = symbols.filter((s) => !/[0-9]/.test(s));
    expect(new Set(signs).size).toBe(signs.length);
    // Every character of the alphabet but letters and space is on the sheet.
    for (const c of alphabet) {
      if (/[A-Za-z ]/.test(c)) continue;
      expect(symbols, JSON.stringify(c)).toContain(c);
    }
  });

  it("labels what is written under each symbol with it, for learning", () => {
    const sheet = buildPracticeFile(SYMBOL_SET, A4);
    const page = sheet.pages[1];
    page.strokes = [ink("zero", symbolY(0)), ink("one", symbolY(1)), ink("one-b", symbolY(1) + 4)];
    expect(practiceLines(sheet).map((l) => [l.text, l.strokes.map((s) => s.id)])).toEqual([
      ["0", ["zero"]],
      ["1", ["one", "one-b"]],
    ]);
    const back = decodeDocument(encodeDocument(sheet));
    expect(back.practice?.set).toBe(SYMBOL_SET);
    expect(practiceLines(back).map((l) => l.text)).toEqual(["0", "1"]);
  });

  it("gives each written symbol with the rule it sits on, as glyph samples", () => {
    const sheet = buildPracticeFile(SYMBOL_SET, A4);
    sheet.pages[1].strokes = [ink("zero", symbolY(0)), ink("plus", symbolY(10))];
    const samples = symbolSamples(sheet);
    expect(samples.map((s) => [s.symbol, s.baseline])).toEqual([
      ["0", 40 * 4],
      ["+", 40 * 24],
    ]);
    expect(samples[0].strokes).toEqual([sheet.pages[1].strokes[0].pts]);
    // Any other practice file has none.
    const text = buildPracticeFile(1, A4);
    text.pages[1].strokes = [ink("a", 40 * 4 + 20)];
    expect(symbolSamples(text)).toEqual([]);
  });

  it("labels a link's brackets and a sum sign as written, for a reader that can spell them", () => {
    const sheet = buildPracticeFile(SYMBOL_SET, A4);
    const at = (symbol: string) => SYMBOL_LINES.findIndex((line) => line.symbol === symbol);
    const page = (i: number) => sheet.pages[1 + Math.floor(i / 15)];
    const y = (i: number) => symbolY(i % 15);
    page(at("[[")).strokes.push(ink("open", y(at("[["))));
    page(at("∑")).strokes.push(ink("sum", y(at("∑"))));
    expect(practiceLines(sheet).map((l) => [l.text, l.strokes.map((s) => s.id)])).toEqual([
      ["[[", ["open"]],
      ["∑", ["sum"]],
    ]);
    // A glyph sample is one character: the bracket pair is none.
    expect(symbolSamples(sheet).map((s) => s.symbol)).toEqual(["∑"]);
  });

  it("makes a sheet of only the symbols added since a sheet was written, ids kept", () => {
    const old = buildPracticeFile(SYMBOL_SET, A4);
    // A sheet from before 2026-10-29: its first 53 lines.
    for (const p of old.pages.slice(1)) {
      const printed = printedOf(p);
      (p.backdrop as SyntheticBackdrop).printed = printed.filter(
        (line) => !line.prompt || Number(line.prompt.split("-")[2]) <= 53,
      );
    }
    const missing = missingSymbols([old]);
    expect(missing.map((i) => SYMBOL_LINES[i].symbol)).toEqual(
      SYMBOL_LINES.slice(53).map((line) => line.symbol),
    );
    expect(missingSymbols([buildPracticeFile(SYMBOL_SET, A4)])).toEqual([]);
    const top = buildPracticeFile(SYMBOL_SET, A4, missing);
    const prompts = top.pages.slice(1).flatMap(promptsOf);
    expect(prompts.map((line) => line.text)).toEqual(missing.map((i) => SYMBOL_LINES[i].symbol));
    expect(prompts[0].prompt).toBe(`practice-${SYMBOL_SET}-54`);
    expect(promptCount(top)).toBe(missing.length);
    expect(missingSymbols([old, top])).toEqual([]);
  });

  it("a text set's prompts are its lines, the nearest set when out of range", () => {
    expect(practicePrompts(2)).toBe(PRACTICE_SETS[1]);
    expect(practicePrompts(9)).toBe(PRACTICE_SETS[2]);
    expect(practicePrompts(0)).toBe(PRACTICE_SETS[0]);
  });
});
