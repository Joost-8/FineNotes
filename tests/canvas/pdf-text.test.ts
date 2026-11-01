/**
 * `src/canvas/pdf-text.ts` — a PDF page's text laid out in page space, what
 * a highlighter drag over it covers, and the text under highlighter ink.
 *
 * The items are shaped as pdf.js's `getTextContent` gives them: a matrix in
 * PDF user space (y up), an advance width and a font height.
 */

import { describe, expect, it } from "vitest";
import {
  type Matrix,
  type PdfTextItem,
  layoutText,
  lineAt,
  multiply,
  pdfToPage,
  rangeRects,
  rangeText,
  selectText,
  textMarkNote,
  textUnder,
} from "../../src/canvas/pdf-text";

/** A 600x800 pt page, as `getViewport({ scale: 1 })` maps it: y flipped. */
const VIEWPORT: Matrix = [1, 0, 0, -1, 0, 800];
const SOURCE = { width: 600, height: 800 };
/** The page drawn 1:1, so page px are PDF points with y down. */
const IDENTITY_PAGE = pdfToPage(VIEWPORT, SOURCE, SOURCE);

/** Text at baseline `y` (from the page's top, y down), starting at `x`. */
function item(str: string, x: number, y: number, size = 20, width?: number): PdfTextItem {
  return {
    str,
    transform: [size, 0, 0, size, x, 800 - y],
    // About Helvetica's average advance.
    width: width ?? str.length * size * 0.5,
    height: size,
  };
}

describe("pdfToPage", () => {
  it("fits the page inside its geometry and centres it, as the backdrop draws it", () => {
    // A 4:3 slide on a taller page: scaled to the width, centred down the page.
    const m = pdfToPage(
      [1, 0, 0, -1, 0, 600],
      { width: 800, height: 600 },
      { width: 400, height: 600 },
    );
    expect(m).toEqual([0.5, 0, 0, -0.5, 0, 450]);
    // The slide's top-left corner (0, 600 in PDF space) lands 150 px down.
    expect(m[0] * 0 + m[2] * 600 + m[4]).toBe(0);
    expect(m[1] * 0 + m[3] * 600 + m[5]).toBe(150);
  });

  it("composes matrices as apply-the-right-one-first", () => {
    const scale: Matrix = [2, 0, 0, 2, 0, 0];
    const shift: Matrix = [1, 0, 0, 1, 10, 0];
    expect(multiply(scale, shift)).toEqual([2, 0, 0, 2, 20, 0]);
    expect(multiply(shift, scale)).toEqual([2, 0, 0, 2, 10, 0]);
  });
});

describe("layoutText", () => {
  it("places an item's characters across its exact width, in page space", () => {
    const layout = layoutText([item("Hi", 100, 200, 20, 30)], IDENTITY_PAGE);
    expect(layout.lines).toHaveLength(1);
    const [line] = layout.lines;
    expect(line.x0).toBe(100);
    expect(line.x1).toBe(130);
    // Ascent 0.8 above the baseline, descent 0.2 below.
    expect(line.top).toBeCloseTo(184);
    expect(line.bottom).toBeCloseTo(204);
    // "H" is wider than "i" (722 against 222 thousandths).
    const [h, i] = layout.chars;
    expect(h.x1 - h.x0).toBeGreaterThan(i.x1 - i.x0);
    expect(i.x1).toBeCloseTo(130);
  });

  it("uses the font's own ascent and descent when pdf.js knows them", () => {
    const layout = layoutText(
      [{ ...item("x", 0, 100, 10), ascent: 0.9, descent: -0.3 }],
      IDENTITY_PAGE,
    );
    expect(layout.lines[0].top).toBeCloseTo(91);
    expect(layout.lines[0].bottom).toBeCloseTo(103);
  });

  it("joins items on one baseline into a line, with a space where they part", () => {
    const layout = layoutText(
      [item("Signal", 100, 200, 20, 60), item("processing", 170, 200, 20, 100)],
      IDENTITY_PAGE,
    );
    expect(layout.lines).toHaveLength(1);
    expect(rangeText(layout, { start: 0, end: layout.chars.length })).toBe("Signal processing");
    const space = layout.chars[6];
    expect(space).toMatchObject({ ch: " ", x0: 160, x1: 170, virtual: true });
  });

  it("adds no space between pieces of one word that touch, nor next to a space item", () => {
    const glued = layoutText(
      [item("Fou", 0, 50, 20, 30), item("rier", 30, 50, 20, 40)],
      IDENTITY_PAGE,
    );
    expect(rangeText(glued, { start: 0, end: glued.chars.length })).toBe("Fourier");
    const spaced = layoutText(
      [item("a", 0, 50, 20, 10), item(" ", 12, 50, 20, 6), item("b", 30, 50, 20, 10)],
      IDENTITY_PAGE,
    );
    expect(spaced.chars.map((c) => c.ch).join("")).toBe("a b");
  });

  it("starts a new line on a new baseline, far along the same one, or back over it", () => {
    const layout = layoutText(
      [
        item("first", 100, 100),
        item("second", 100, 130),
        // A column far to the right on the same baseline.
        item("right", 450, 130),
        // Drawn back over the line's start: a new line.
        item("over", 100, 130),
      ],
      IDENTITY_PAGE,
    );
    expect(layout.lines).toHaveLength(4);
  });

  it("skips what cannot be snapped to: empty, rotated, vertical, mirrored and broken items", () => {
    const layout = layoutText(
      [
        item("", 0, 100),
        { ...item("rotated", 0, 100), transform: [0, 20, -20, 0, 300, 300] },
        { ...item("vertical", 0, 100), vertical: true },
        { ...item("mirrored", 0, 100), transform: [-20, 0, 0, 20, 300, 300] },
        { ...item("nan", 0, 100), transform: [20, 0, 0, 20, Number.NaN, 0] },
        { ...item("short", 0, 100), transform: [20, 0, 0] },
        { ...item("zero", 0, 100), width: 0 },
        { ...item("flat", 0, 100), transform: [0, 0, 0, 20, 0, 0] },
        item("kept", 0, 100),
      ],
      IDENTITY_PAGE,
    );
    expect(layout.lines).toHaveLength(1);
    expect(rangeText(layout, { start: 0, end: layout.chars.length })).toBe("kept");
  });

  it("reads a page turned 90 degrees, whose text runs across the page once turned", () => {
    // `getViewport` of a /Rotate 90 page: x' = y, y' = x.
    const turned: Matrix = [0, 1, 1, 0, 0, 0];
    const layout = layoutText(
      [{ str: "ab", transform: [0, 10, -10, 0, 100, 300], width: 20, height: 10 }],
      pdfToPage(turned, { width: 800, height: 600 }, { width: 800, height: 600 }),
    );
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].x0).toBe(300);
    expect(layout.lines[0].x1).toBe(320);
  });

  it("gives ideographs a full width each", () => {
    const layout = layoutText([item("日本a", 0, 50, 10, 25)], IDENTITY_PAGE);
    const widths = layout.chars.map((c) => c.x1 - c.x0);
    expect(widths[0]).toBeCloseTo(widths[1]);
    expect(widths[0]).toBeGreaterThan(widths[2]);
  });

  it("is empty for a scanned page: nothing ever snaps", () => {
    const layout = layoutText([], IDENTITY_PAGE);
    expect(layout).toEqual({ chars: [], lines: [] });
    expect(lineAt(layout, 10, 10, 50)).toBe(-1);
    expect(selectText(layout, { x: 10, y: 10 }, { x: 50, y: 10 }, 50)).toBeNull();
  });
});

/** Three lines of a slide, 20 pt type, 40 pt apart. */
function slide() {
  return layoutText(
    [
      item("The quick brown fox", 100, 100, 20, 190),
      item("jumps over the", 100, 140, 20, 140),
      item("lazy dog", 100, 180, 20, 80),
    ],
    IDENTITY_PAGE,
  );
}

/** The x of the middle of the first `ch` in the layout, from character `after` on. */
function middleOf(layout: ReturnType<typeof slide>, ch: string, after = 0): number {
  const index = layout.chars.findIndex((c, i) => i >= after && c.ch === ch);
  const c = layout.chars[index];
  return (c.x0 + c.x1) / 2;
}

describe("lineAt", () => {
  it("finds the line under the pen, with a margin, and none away from text", () => {
    const layout = slide();
    expect(lineAt(layout, 150, 95)).toBe(0);
    expect(lineAt(layout, 150, 135)).toBe(1);
    // Just above the first line's band: only within the slop.
    expect(lineAt(layout, 150, 80)).toBe(-1);
    expect(lineAt(layout, 150, 80, 6)).toBe(0);
    // Off to the side of the text.
    expect(lineAt(layout, 400, 95, 6)).toBe(-1);
  });
});

describe("selectText", () => {
  it("does not snap when the drag starts away from text", () => {
    expect(selectText(slide(), { x: 400, y: 400 }, { x: 150, y: 95 }, 6)).toBeNull();
  });

  it("takes whole words along a line, whatever letter the pen lands on", () => {
    const layout = slide();
    // From inside "quick" to inside "brown".
    const from = { x: middleOf(layout, "u"), y: 95 };
    const to = { x: middleOf(layout, "o"), y: 96 };
    const sel = selectText(layout, from, to, 6);
    expect(sel?.text).toBe("quick brown");
    expect(sel?.rects).toHaveLength(1);
    const rect = sel?.rects[0];
    const q = layout.chars[sel?.start ?? 0];
    expect(rect?.x).toBe(q.x0);
    expect(rect?.y).toBeCloseTo(84);
    expect(rect?.h).toBeCloseTo(20);
  });

  it("takes the same words dragged right to left", () => {
    const layout = slide();
    const a = { x: middleOf(layout, "u"), y: 95 };
    const b = { x: middleOf(layout, "o"), y: 96 };
    expect(selectText(layout, b, a, 6)?.text).toBe(selectText(layout, a, b, 6)?.text);
  });

  it("takes the word under the pen for a drag too short to cross a letter", () => {
    const layout = slide();
    const x = middleOf(layout, "b");
    expect(selectText(layout, { x, y: 95 }, { x: x + 0.5, y: 95 }, 6)?.text).toBe("brown");
    // Landing on the space before a word, still: the word nearest.
    const space = layout.chars[3];
    const sel = selectText(layout, { x: space.x0 + 0.1, y: 95 }, { x: space.x0 + 0.2, y: 95 }, 6);
    expect(sel?.text).toBe("The");
  });

  it("runs on from line to line in reading order, one rectangle a line", () => {
    const layout = slide();
    const from = { x: middleOf(layout, "b"), y: 95 };
    const to = { x: middleOf(layout, "z"), y: 175 };
    const sel = selectText(layout, from, to, 6);
    expect(sel?.text).toBe("brown fox\njumps over the\nlazy");
    expect(sel?.rects).toHaveLength(3);
    // The middle line is covered from end to end.
    expect(sel?.rects[1].x).toBe(100);
    expect((sel?.rects[1].x ?? 0) + (sel?.rects[1].w ?? 0)).toBeCloseTo(240);
  });

  it("follows the pen past the end of the text to the nearest line", () => {
    const layout = slide();
    const sel = selectText(layout, { x: middleOf(layout, "j"), y: 135 }, { x: 590, y: 790 }, 6);
    expect(sel?.text).toBe("jumps over the\nlazy dog");
  });

  it("keeps ideographs one word each", () => {
    const layout = layoutText([item("日本語", 0, 50, 10, 30)], IDENTITY_PAGE);
    const sel = selectText(layout, { x: 15, y: 46 }, { x: 15.2, y: 46 }, 2);
    expect(sel?.text).toBe("本");
  });

  it("returns null when the words under the pen are only space", () => {
    const layout = layoutText([item("   ", 0, 50, 10, 30)], IDENTITY_PAGE);
    expect(selectText(layout, { x: 5, y: 46 }, { x: 25, y: 46 }, 2)).toBeNull();
  });
});

describe("rangeRects", () => {
  it("leaves out lines the range only touches with spaces", () => {
    const layout = layoutText(
      [item("ab ", 0, 50, 10, 30), item("cd", 0, 80, 10, 20)],
      IDENTITY_PAGE,
    );
    expect(rangeRects(layout, { start: 2, end: 3 })).toEqual([]);
    expect(rangeRects(layout, { start: 0, end: 5 })).toHaveLength(2);
  });
});

describe("textUnder", () => {
  it("reads the text under a snapped highlight's stroke", () => {
    const layout = slide();
    const sel = selectText(
      layout,
      { x: middleOf(layout, "q"), y: 95 },
      { x: middleOf(layout, "f"), y: 95 },
      6,
    );
    const rect = sel?.rects[0];
    if (!rect) throw new Error("no selection");
    const y = rect.y + rect.h / 2;
    const band = { pts: [rect.x + 6, y, 0.5, rect.x + rect.w - 6, y, 0.5], size: rect.h };
    expect(textUnder(layout, [band])).toBe("quick brown fox");
  });

  it("reads freehand highlighter ink over two lines, and skips uncovered words", () => {
    const layout = slide();
    const theEnd = middleOf(layout, "T");
    const quickEnd = layout.chars[8].x1;
    const fox = middleOf(layout, "f");
    const bands = [
      // Over "The quick" on the first line, wobbling.
      { pts: [theEnd, 94, 0.5, (theEnd + quickEnd) / 2, 96, 0.5, quickEnd - 2, 93, 0.5], size: 16 },
      // A dab on "fox", skipping "brown".
      { pts: [fox, 94, 0.5, fox + 20, 94, 0.5], size: 16 },
      // A dot on "lazy".
      { pts: [middleOf(layout, "z"), 174, 0.5], size: 50 },
    ];
    expect(textUnder(layout, bands)).toBe("The quick fox\nlazy");
  });

  it("is empty for ink that covers no text, or has no points", () => {
    const layout = slide();
    expect(textUnder(layout, [{ pts: [400, 400, 0.5, 500, 400, 0.5], size: 20 }])).toBe("");
    expect(textUnder(layout, [{ pts: [], size: 20 }])).toBe("");
  });
});

describe("what the highlighter did, for the debug overlay", () => {
  const layout = layoutText(
    [item("Insulin resistance and hyperandrogenism", 50, 100)],
    IDENTITY_PAGE,
  );

  it("says what it snapped to", () => {
    const word = selectText(layout, { x: 60, y: 95 }, { x: 200, y: 95 });
    expect(textMarkNote(layout, word)).toBe('snapped "Insulin resistance"');
    // A long one is cut at 24 characters.
    const line = selectText(layout, { x: 60, y: 95 }, { x: 900, y: 95 });
    expect(textMarkNote(layout, line)).toBe('snapped "Insulin resistance and h…"');
  });

  it("tells the reasons it drew freehand apart", () => {
    expect(textMarkNote(null, null)).toBe("text not read yet");
    expect(textMarkNote(layoutText([], IDENTITY_PAGE), null)).toBe("page has no text");
    expect(textMarkNote(layout, selectText(layout, { x: 60, y: 600 }, { x: 60, y: 600 }))).toBe(
      "off the text (1 lines)",
    );
  });
});
