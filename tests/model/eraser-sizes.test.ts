import { describe, expect, it } from "vitest";
import { DEFAULT_ERASER_SIZE, ERASER_SIZES } from "../../src/constants";
import {
  clampEraserSize,
  ERASER_MAX_SIZE,
  ERASER_MIN_SIZE,
  eraserStops,
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
