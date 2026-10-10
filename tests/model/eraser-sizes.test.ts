import { describe, expect, it } from "vitest";
import { DEFAULT_ERASER_SIZE, ERASER_SIZES } from "../../src/constants";
import {
  clampEraserSize,
  ERASER_MAX_SIZE,
  ERASER_MIN_SIZE,
  eraserGlyphRadius,
  eraserStops,
  quickEraserSizes,
} from "../../src/model/eraser-sizes";

describe("eraserStops", () => {
  const stops = eraserStops();

  it("runs from the smallest to the largest size, strictly increasing", () => {
    expect(stops[0]).toBe(ERASER_MIN_SIZE);
    expect(stops[stops.length - 1]).toBe(ERASER_MAX_SIZE);
    for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
  });

  it("contains every preset and the default, so they sit exactly on a stop", () => {
    for (const size of [...ERASER_SIZES, DEFAULT_ERASER_SIZE]) expect(stops).toContain(size);
  });

  it("steps finely at small sizes and coarsely at large ones", () => {
    expect(stops[1] - stops[0]).toBe(1);
    expect(stops[stops.length - 1] - stops[stops.length - 2]).toBe(5);
  });
});

describe("clampEraserSize", () => {
  it("keeps a size inside the range unchanged", () => {
    expect(clampEraserSize(37)).toBe(37);
    expect(clampEraserSize(ERASER_MIN_SIZE)).toBe(ERASER_MIN_SIZE);
    expect(clampEraserSize(ERASER_MAX_SIZE)).toBe(ERASER_MAX_SIZE);
  });

  it("pulls a size outside the range to its nearest end", () => {
    expect(clampEraserSize(1)).toBe(ERASER_MIN_SIZE);
    expect(clampEraserSize(500)).toBe(ERASER_MAX_SIZE);
  });

  it("treats a missing or nonsense size as the default, not as the smallest", () => {
    expect(clampEraserSize(Number.NaN)).toBe(DEFAULT_ERASER_SIZE);
    expect(clampEraserSize(Infinity)).toBe(DEFAULT_ERASER_SIZE);
    expect(clampEraserSize(0)).toBe(DEFAULT_ERASER_SIZE);
    expect(clampEraserSize(-5)).toBe(DEFAULT_ERASER_SIZE);
  });
});

describe("quickEraserSizes", () => {
  it("shows the presets when the live size is one of them", () => {
    expect(quickEraserSizes(24)).toEqual([...ERASER_SIZES]);
  });

  it("puts a slider size in place of the nearest preset, by ratio", () => {
    // 30 is nearer 24 than 48 by ratio (1.25x vs 1.6x).
    expect(quickEraserSizes(30)).toEqual([10, 30, 48]);
    // 6 replaces 10, 100 replaces 48.
    expect(quickEraserSizes(6)).toEqual([6, 24, 48]);
    expect(quickEraserSizes(100)).toEqual([10, 24, 100]);
  });

  it("stays sorted smallest first", () => {
    const quick = quickEraserSizes(17);
    expect([...quick].sort((a, b) => a - b)).toEqual(quick);
  });

  it("does not change the shared presets", () => {
    quickEraserSizes(100);
    expect([...ERASER_SIZES]).toEqual([10, 24, 48]);
  });

  it("ignores a nonsense live size", () => {
    expect(quickEraserSizes(Number.NaN)).toEqual([...ERASER_SIZES]);
  });
});

describe("eraserGlyphRadius", () => {
  it("grows with the size and spans the glyph box across the range", () => {
    expect(eraserGlyphRadius(ERASER_MIN_SIZE)).toBeCloseTo(3);
    expect(eraserGlyphRadius(ERASER_MAX_SIZE)).toBeCloseTo(12);
    const presets = ERASER_SIZES.map(eraserGlyphRadius);
    expect(presets[0]).toBeLessThan(presets[1]);
    expect(presets[1]).toBeLessThan(presets[2]);
  });

  it("keeps out-of-range sizes inside the box", () => {
    expect(eraserGlyphRadius(1)).toBeCloseTo(3);
    expect(eraserGlyphRadius(1000)).toBeCloseTo(12);
  });
});
