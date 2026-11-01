/**
 * `src/search/pdf-hits.ts` — a PDF page's printed text for the notebook
 * search, and where a query's words sit on the page (#112).
 */

import { describe, expect, it } from "vitest";
import { type Matrix, type PdfTextItem, layoutText, pdfToPage } from "../../src/canvas/pdf-text";
import { layoutPlainText, pdfHitRects } from "../../src/search/pdf-hits";

const VIEWPORT: Matrix = [1, 0, 0, -1, 0, 800];
const SOURCE = { width: 600, height: 800 };
const PAGE = pdfToPage(VIEWPORT, SOURCE, SOURCE);

/** Text at baseline `y` (from the top, y down), starting at `x`. */
function item(str: string, x: number, y: number, size = 20): PdfTextItem {
  return {
    str,
    transform: [size, 0, 0, size, x, 800 - y],
    width: str.length * size * 0.5,
    height: size,
  };
}

const slide = layoutText(
  [item("Fourier transform", 40, 100), item("of a Gaussian", 40, 160), item("Ünïcode", 40, 220)],
  PAGE,
);

describe("layoutPlainText", () => {
  it("gives the page's lines, one to a line", () => {
    expect(layoutPlainText(slide)).toBe("Fourier transform\nof a Gaussian\nÜnïcode");
  });

  it("is empty for a page without text (a scan)", () => {
    expect(layoutPlainText({ chars: [], lines: [] })).toBe("");
  });
});

describe("pdfHitRects", () => {
  it("lights only the matched letters, on their line", () => {
    const [rect, ...rest] = pdfHitRects("transform", slide);
    expect(rest).toEqual([]);
    const line = slide.lines[0];
    expect(rect.y).toBeCloseTo(line.top);
    expect(rect.h).toBeCloseTo(line.bottom - line.top);
    // Past "Fourier ", inside the line.
    expect(rect.x).toBeGreaterThan(line.x0 + 50);
    expect(rect.x + rect.w).toBeCloseTo(line.x1);
  });

  it("finds every word of the query, each time it occurs, in reading order", () => {
    const rects = pdfHitRects("of FOURIER", slide);
    expect(rects.map((r) => Math.round(r.y))).toEqual(
      [slide.lines[0].top, slide.lines[1].top].map(Math.round),
    );
  });

  it("ignores case and accents, as the search does", () => {
    expect(pdfHitRects("unicode", slide)).toHaveLength(1);
  });

  it("finds nothing for an empty query, a missing word or a scan", () => {
    expect(pdfHitRects("   ", slide)).toEqual([]);
    expect(pdfHitRects("laplace", slide)).toEqual([]);
    expect(pdfHitRects("fourier", { chars: [], lines: [] })).toEqual([]);
  });

  it("does not match across a line break", () => {
    expect(pdfHitRects("transformof", slide)).toEqual([]);
  });
});
