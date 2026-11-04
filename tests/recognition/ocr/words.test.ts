import { describe, expect, it } from "vitest";
import {
  layoutText,
  pdfToPage,
  rangeText,
  type Matrix,
  type PdfTextItem,
} from "../../../src/canvas/pdf-text";
import {
  OCR_TUNING,
  type OcrLine,
  type OcrPage,
  type OcrWord,
  dropCovered,
  invertMatrix,
  isSparse,
  keptLines,
  mergedItems,
  nativeCoverage,
  nativeRects,
  needsOcr,
  wordItems,
} from "../../../src/recognition/ocr/ocr-words";
import { layoutPlainText, pdfHitRects } from "../../../src/search/pdf-hits";

const word = (
  text: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  conf = 0.97,
  min = 0.9,
): OcrWord => ({
  text,
  box: [x0, y0, x1, y1],
  conf,
  min,
});
const line = (conf: number, ...words: OcrWord[]): OcrLine => ({ conf, words });
const page = (...lines: OcrLine[]): OcrPage => ({
  imageWidth: 1000,
  imageHeight: 1400,
  pageWidth: 400,
  pageHeight: 560,
  lines,
});

// pdf.js's viewport for an upright 400 x 560 page at scale 1: y flipped.
const VIEWPORT: Matrix = [1, 0, 0, -1, 0, 560];
const SOURCE = { width: 400, height: 560 };

describe("the confidence filter", () => {
  it("has its numbers in one constant", () => {
    expect(OCR_TUNING).toMatchObject({ wordMean: 0.9, wordMin: 0.5, lineMean: 0.9 });
  });

  it("keeps a word whose characters are sure on average and none is a guess", () => {
    const p = page(
      line(0.95, word("sure", 0, 0, 40, 10, 0.97, 0.9), word("meh", 50, 0, 80, 10, 0.89, 0.8)),
    );
    expect(keptLines(p).map((l) => l.map((w) => w.text))).toEqual([["sure"]]);
  });

  it("drops a word with one character below 0.5 whatever its mean", () => {
    const p = page(
      line(0.95, word("guess", 0, 0, 40, 10, 0.93, 0.49), word("fine", 50, 0, 80, 10, 0.93, 0.5)),
    );
    expect(keptLines(p)[0].map((w) => w.text)).toEqual(["fine"]);
  });

  it("drops a whole line whose mean is below 0.9, however sure some words are", () => {
    const p = page(
      line(0.89, word("scribble", 0, 0, 40, 10, 0.99, 0.99)),
      line(0.9, word("kept", 0, 20, 40, 30)),
    );
    expect(keptLines(p).map((l) => l[0].text)).toEqual(["kept"]);
  });

  it("is judged at read time: other numbers need no new reading", () => {
    const p = page(line(0.8, word("w", 0, 0, 10, 10, 0.8, 0.6)));
    expect(keptLines(p)).toEqual([]);
    expect(keptLines(p, { ...OCR_TUNING, wordMean: 0.7, lineMean: 0.7 })).toHaveLength(1);
  });
});

/** A native text item of `str` placed from (x, baseline) in PDF space: 10 pt font. */
function native(str: string, x: number, yUp: number, width = str.length * 5): PdfTextItem {
  return { str, transform: [10, 0, 0, 10, x, yUp], width, height: 10, ascent: 0.8, descent: -0.2 };
}

describe("a page with too little text of its own", () => {
  const layoutOf = (items: PdfTextItem[]) => layoutText(items, pdfToPage(VIEWPORT, SOURCE, SOURCE));

  it("is sparse with no text, with a page number, and not with a page of text", () => {
    expect(isSparse(layoutOf([]), 400, 560)).toBe(true);
    expect(isSparse(layoutOf([native("12", 200, 20)]), 400, 560)).toBe(true);
    const dense: PdfTextItem[] = [];
    for (let i = 0; i < 40; i++) {
      dense.push(
        native("The quick brown fox jumps over the lazy dog and runs", 20, 520 - i * 12, 355),
      );
    }
    expect(isSparse(layoutOf(dense), 400, 560)).toBe(false);
    expect(needsOcr(dense, VIEWPORT, SOURCE)).toBe(false);
    expect(needsOcr([], VIEWPORT, SOURCE)).toBe(true);
    expect(needsOcr([native("12", 200, 20)], VIEWPORT, SOURCE)).toBe(true);
  });

  it("is sparse by area even with many characters, and by count even with much area", () => {
    // 60 characters in one short line: enough characters, far too little of the page.
    const few = layoutOf([native("a".repeat(60), 20, 500, 300)]);
    expect(nativeCoverage(few).chars).toBe(60);
    expect(isSparse(few, 400, 560)).toBe(true);
    // The area share is the other test: one big word on a small page.
    const big = layoutOf([
      { ...native("x".repeat(45), 0, 0, 400), transform: [400, 0, 0, 400, 0, 80], height: 400 },
    ]);
    expect(isSparse(big, 400, 560)).toBe(false);
    expect(isSparse(big, 400, 560, { ...OCR_TUNING, sparseChars: 100 })).toBe(true);
    expect(isSparse(layoutOf([native("x".repeat(45), 20, 500, 300)]), 0, 0)).toBe(true);
  });
});

describe("OCR text beside a page's own", () => {
  it("drops an OCR word over the page's own text and keeps the rest", () => {
    const own = layoutText([native("7", 197, 20, 6)], pdfToPage(VIEWPORT, SOURCE, SOURCE));
    const rects = nativeRects(own);
    expect(rects).toHaveLength(1);
    const lines = [
      [word("Hello", 20, 20, 60, 34), word("world", 66, 20, 110, 34)],
      [word("7", 196, 526, 204, 540)],
    ];
    const kept = dropCovered(lines, rects);
    expect(kept.map((l) => l.map((w) => w.text))).toEqual([["Hello", "world"]]);
  });

  it("drops a word with 30 percent of it under native text, by overlap or IoU", () => {
    const rects = [{ x0: 0, y0: 0, x1: 10, y1: 10 }];
    expect(dropCovered([[word("a", 7, 0, 17, 10)]], rects)).toEqual([]);
    expect(dropCovered([[word("a", 8, 0, 18, 10)]], rects)).toHaveLength(1);
    expect(dropCovered([[word("a", 100, 0, 110, 10)]], [])).toHaveLength(1);
  });

  it("drops a word that several native words cover together, though none does alone", () => {
    const rects = [
      { x0: 0, y0: 0, x1: 10, y1: 10 },
      { x0: 12, y0: 0, x1: 22, y1: 10 },
      { x0: 24, y0: 0, x1: 34, y1: 10 },
    ];
    // 34 wide, 88 percent of it under the three words; each alone covers 29 percent.
    expect(dropCovered([[word("span", 0, 0, 34, 10)]], rects)).toEqual([]);
    expect(dropCovered([[word("span", 0, 0, 34, 10)]], rects.slice(0, 1))).toHaveLength(1);
  });

  it("changes nothing on a page with enough text of its own", () => {
    const items: PdfTextItem[] = [];
    for (let i = 0; i < 40; i++)
      items.push(
        native("The quick brown fox jumps over the lazy dog and runs", 20, 520 - i * 12, 355),
      );
    const ocr = page(line(0.99, word("extra", 20, 5, 60, 15)));
    expect(mergedItems(items, ocr, VIEWPORT, SOURCE)).toEqual(items);
    expect(mergedItems(items, null, VIEWPORT, SOURCE)).toEqual(items);
  });

  it("keeps all native items unchanged and adds OCR words that are not over them", () => {
    const own = [native("7", 197, 20, 6)];
    const ocr = page(
      line(0.97, word("Water", 40, 60, 90, 76), word("quality", 96, 60, 150, 76)),
      line(0.97, word("in", 40, 90, 52, 106), word("rivers", 58, 90, 110, 106)),
      line(0.97, word("7", 196.5, 526, 203.5, 540)),
      line(0.3, word("scribble", 40, 300, 100, 316, 0.99, 0.99)),
    );
    const merged = mergedItems(own, ocr, VIEWPORT, SOURCE);
    expect(merged.slice(0, 1)).toEqual(own);
    expect(merged.map((i) => i.str)).toEqual(["7", "Water", "quality", "in", "rivers"]);
  });
});

describe("OCR words as text items", () => {
  const lines = [
    [word("Water", 40, 60, 90, 76), word("quality", 96, 60, 150, 76)],
    [word("in", 40, 90, 52, 106), word("rivers", 58, 90, 110, 106)],
  ];
  const items = wordItems(lines, VIEWPORT);
  const layout = layoutText(items, pdfToPage(VIEWPORT, SOURCE, SOURCE));

  it("makes one item per word, in PDF space with y up", () => {
    expect(items).toHaveLength(4);
    // Baseline = bottom of the box less the 0.2 descent: 76 - 3.2 = 72.8 from the top.
    expect(items[0].transform[4]).toBeCloseTo(40, 5);
    expect(items[0].transform[5]).toBeCloseTo(560 - 72.8, 5);
    expect(items[0].height).toBeCloseTo(16, 5);
  });

  it("lays two lines out as two lines with a space between the words", () => {
    expect(layout.lines).toHaveLength(2);
    const text = (i: number) =>
      layout.chars
        .slice(layout.lines[i].start, layout.lines[i].end)
        .map((c) => c.ch)
        .join("");
    expect(text(0)).toBe("Water quality");
    expect(text(1)).toBe("in rivers");
    expect(layoutPlainText(layout)).toBe("Water quality\nin rivers");
    expect(rangeText(layout, { start: 0, end: layout.chars.length })).toBe(
      "Water quality\nin rivers",
    );
  });

  it("covers each word's box with its characters", () => {
    const first = layout.chars.slice(layout.lines[0].start, layout.lines[0].start + 5);
    expect(first[0].x0).toBeCloseTo(40, 3);
    expect(first[4].x1).toBeCloseTo(90, 3);
    expect(layout.lines[0].top).toBeCloseTo(60, 3);
    expect(layout.lines[0].bottom).toBeCloseTo(76, 3);
  });

  it("puts a search hit's rectangle on the word searched for", () => {
    const [hit] = pdfHitRects("rivers", layout);
    expect(hit.x).toBeCloseTo(58, 3);
    expect(hit.x + hit.w).toBeCloseTo(110, 3);
    expect(hit.y).toBeCloseTo(90, 3);
    expect(hit.h).toBeCloseTo(16, 3);
    // A phrase across a space lights both words, on their own line.
    const [phrase] = pdfHitRects("water quality", layout, true);
    expect(phrase.x).toBeCloseTo(40, 3);
    expect(phrase.x + phrase.w).toBeCloseTo(150, 3);
    // Across the line break, one rectangle per line (as for a PDF's own text).
    expect(pdfHitRects("quality in", layout, true)).toHaveLength(2);
    expect(pdfHitRects("quality rivers", layout, true)).toEqual([]);
  });

  it("still puts a space between words that touch", () => {
    const touching = wordItems(
      [[word("ab", 10, 10, 30, 26), word("cd", 30, 10, 50, 26)]],
      VIEWPORT,
    );
    const l = layoutText(touching, pdfToPage(VIEWPORT, SOURCE, SOURCE));
    expect(layoutPlainText(l)).toBe("ab cd");
  });

  it("follows a rotated page: the text matrix is turned back into the page's own space", () => {
    // A page turned a quarter: user (x, y) shows at view (y, x) of a 560 x 400 view.
    const turned: Matrix = [0, 1, 1, 0, 0, 0];
    const src = { width: 560, height: 400 };
    const out = wordItems([[word("up", 100, 50, 140, 66)]], turned);
    const l = layoutText(out, pdfToPage(turned, src, src));
    expect(layoutPlainText(l)).toBe("up");
    expect(l.lines[0].x0).toBeCloseTo(100, 3);
    expect(l.lines[0].top).toBeCloseTo(50, 3);
  });

  it("makes nothing from a singular viewport or an empty box", () => {
    expect(invertMatrix([0, 0, 0, 0, 0, 0])).toBeNull();
    expect(wordItems(lines, [0, 0, 0, 0, 0, 0])).toEqual([]);
    expect(wordItems([[word("x", 5, 5, 5, 20)], [word("", 1, 1, 9, 9)]], VIEWPORT)).toEqual([]);
  });
});

describe("OCR words from the figures of a page with text of its own", () => {
  const dense: PdfTextItem[] = [];
  for (let i = 0; i < 40; i++)
    dense.push(
      native("The quick brown fox jumps over the lazy dog and runs", 20, 520 - i * 12, 355),
    );
  const figures = (...lines: OcrLine[]): OcrPage => ({
    ...page(...lines),
    condition: "TEXT_WITH_FIGURES",
    regions: [{ x0: 0, y0: 0, x1: 400, y1: 560, dpi: null }],
  });

  it("adds the confident words, never the unsure ones nor those over the page's own text", () => {
    const ocr = figures(
      line(0.97, word("Bladder", 100, 505, 160, 517)), // over the first line of native text? y 505..517 -> native line 0
      line(0.97, word("Pubic", 100, 20, 140, 32), word("bone", 146, 20, 180, 32)),
      line(0.5, word("scribble", 200, 20, 260, 32, 0.99, 0.99)),
      line(0.97, word("maybe", 300, 20, 340, 32, 0.8, 0.7)),
    );
    const merged = mergedItems(dense, ocr, VIEWPORT, SOURCE);
    const added = merged.slice(dense.length).map((i) => i.str);
    expect(added).toEqual(["Pubic", "bone"]);
    expect(merged.slice(0, dense.length)).toEqual(dense);
  });

  it("is left out when the setting is off, and for TEXT_ONLY and BLANK pages", () => {
    const ocr = figures(line(0.97, word("Pubic", 100, 20, 140, 32)));
    expect(mergedItems(dense, ocr, VIEWPORT, SOURCE, OCR_TUNING, false)).toEqual(dense);
    expect(mergedItems(dense, { ...ocr, condition: "TEXT_ONLY" }, VIEWPORT, SOURCE)).toEqual(dense);
    expect(mergedItems(dense, { ...ocr, condition: "BLANK" }, VIEWPORT, SOURCE)).toEqual(dense);
  });

  it("a whole-page reading is still added only while the page's own text is sparse", () => {
    const ocr = {
      ...figures(line(0.97, word("Pubic", 100, 20, 140, 32))),
      condition: "SCANNED" as const,
    };
    expect(mergedItems(dense, ocr, VIEWPORT, SOURCE)).toEqual(dense);
    expect(mergedItems([], ocr, VIEWPORT, SOURCE).map((i) => i.str)).toEqual(["Pubic"]);
  });
});
