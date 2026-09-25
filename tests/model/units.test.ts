import { describe, expect, it } from "vitest";
import {
  CSS_PX_PER_MM,
  PAGE_PX_PER_MM,
  formatMm,
  mmToPage,
  pageToMm,
  zoomPercent,
} from "../../src/model/units";
import { DEFAULT_PAPER_WIDTH } from "../../src/constants";

describe("units", () => {
  it("A4's 210 mm is the default paper width", () => {
    expect(mmToPage(210)).toBeCloseTo(DEFAULT_PAPER_WIDTH, 9);
    expect(pageToMm(DEFAULT_PAPER_WIDTH)).toBeCloseTo(210, 9);
  });

  it("round-trips", () => {
    for (const mm of [0.1, 0.9, 3, 297]) expect(pageToMm(mmToPage(mm))).toBeCloseTo(mm, 9);
  });

  it("reads 100% when a page millimetre is a CSS millimetre", () => {
    expect(zoomPercent(CSS_PX_PER_MM / PAGE_PX_PER_MM)).toBe(100);
    expect(zoomPercent((2 * CSS_PX_PER_MM) / PAGE_PX_PER_MM)).toBe(200);
  });

  it("reads an A4 page fitted into an iPad's height about as GoodNotes does", () => {
    // A4 is 1448 page px tall; fitted into ~640 CSS px GoodNotes read 59%.
    expect(zoomPercent(641 / mmToPage(297))).toBeGreaterThanOrEqual(56);
    expect(zoomPercent(641 / mmToPage(297))).toBeLessThanOrEqual(59);
  });

  it("gives 0 for nonsense rather than NaN%", () => {
    expect(zoomPercent(0)).toBe(0);
    expect(zoomPercent(Number.NaN)).toBe(0);
    expect(zoomPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("formats a pen width as GoodNotes does", () => {
    expect(formatMm(mmToPage(0.9))).toBe("0.90 mm");
    expect(formatMm(mmToPage(2.5))).toBe("2.5 mm");
    expect(formatMm(0)).toBe("0 mm");
    expect(formatMm(Number.NaN)).toBe("0 mm");
  });
});
