import { describe, expect, it } from "vitest";
import { fitAnswer } from "../../src/model/answer-glyphs";

const PAGE = { width: 600, height: 800 };

/** A row of strokes from x0, `w` wide, digits `h` tall on baseline `b`. */
function answer(x0: number, w: number, b: number, h: number): number[][] {
  const out: number[][] = [];
  for (let x = x0; x < x0 + w; x += h * 0.6) {
    out.push([x, b - h, 0.5, x + h * 0.4, b, 0.5]);
  }
  out.push([x0 + w - h * 0.4, b - h, 0.5, x0 + w, b, 0.5]);
  return out;
}

function bounds(strokes: number[][]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = strokes.flatMap((p) => p.filter((_, i) => i % 3 === 0));
  const ys = strokes.flatMap((p) => p.filter((_, i) => i % 3 === 1));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe("fitAnswer", () => {
  it("leaves an answer that fits where it is", () => {
    const at = { x: 300, baseline: 200, height: 24 };
    const ink = answer(300, 120, 200, 24);
    expect(fitAnswer(ink, at, 50, PAGE)).toBe(ink);
  });

  it("shrinks an answer a little over the edge, keeping it after the =", () => {
    const at = { x: 450, baseline: 200, height: 24 };
    const got = bounds(fitAnswer(answer(450, 150, 200, 24), at, 50, PAGE));
    expect(got.maxX).toBeLessThanOrEqual(PAGE.width - 6);
    expect(got.minX).toBeCloseTo(450, 5);
    expect(got.maxY).toBeCloseTo(200, 5);
  });

  it("moves a long answer to the next line, from the sum's left end", () => {
    const at = { x: 500, baseline: 200, height: 24 };
    const got = bounds(fitAnswer(answer(500, 240, 200, 24), at, 60, PAGE));
    expect(got.minX).toBeCloseTo(60, 5);
    expect(got.maxX - got.minX).toBeCloseTo(240, 5);
    expect(got.maxY).toBeGreaterThan(200 + 24);
    expect(got.maxX).toBeLessThanOrEqual(PAGE.width - 6);
  });

  it("moves left of the sum when the answer would still run off from there", () => {
    const at = { x: 520, baseline: 200, height: 24 };
    const got = bounds(fitAnswer(answer(520, 300, 200, 24), at, 400, PAGE));
    expect(got.maxX).toBeLessThanOrEqual(PAGE.width - 6 + 1e-9);
    expect(got.maxX - got.minX).toBeCloseTo(300, 5);
  });

  it("shrinks an answer wider than the page to the page", () => {
    const at = { x: 500, baseline: 200, height: 24 };
    const got = bounds(fitAnswer(answer(500, 900, 200, 24), at, 60, PAGE));
    expect(got.minX).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(got.maxX).toBeLessThanOrEqual(PAGE.width - 6 + 1e-9);
  });

  it("stays on the last line and shrinks when there is no line below", () => {
    const at = { x: 500, baseline: 780, height: 24 };
    const got = bounds(fitAnswer(answer(500, 240, 780, 24), at, 60, PAGE));
    expect(got.maxY).toBeLessThanOrEqual(780 + 1e-9);
    expect(got.minX).toBeCloseTo(500, 5);
    expect(got.maxX).toBeLessThanOrEqual(PAGE.width - 6 + 1e-9);
  });

  it("keeps every stroke's points aligned in threes", () => {
    const at = { x: 500, baseline: 200, height: 24 };
    for (const pts of fitAnswer(answer(500, 240, 200, 24), at, 60, PAGE)) {
      expect(pts.length % 3).toBe(0);
      expect(pts.every(Number.isFinite)).toBe(true);
    }
  });
});
