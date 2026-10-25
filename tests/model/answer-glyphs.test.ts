/**
 * `src/model/answer-glyphs.ts`: the letters a calculation's answer is written
 * in, clean or the writer's own from their symbol sheet.
 */

import { describe, expect, it } from "vitest";
import {
  CLEAN_GLYPHS,
  type Glyph,
  glyphsFor,
  glyphsFromSamples,
  writeText,
} from "../../src/model/answer-glyphs";

function boxOf(strokes: number[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of strokes) {
    for (let i = 0; i < s.length; i += 3) {
      xs.push(s[i]);
      ys.push(s[i + 1]);
    }
  }
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

describe("the clean glyphs", () => {
  it("cover every character an answer can hold, inside their box", () => {
    for (const c of "0123456789.,-/E") {
      const glyph = CLEAN_GLYPHS.get(c);
      expect(glyph, c).toBeDefined();
      for (const stroke of glyph!.strokes) {
        for (const [x, y] of stroke) {
          expect(x, c).toBeGreaterThanOrEqual(-0.01);
          expect(x, c).toBeLessThanOrEqual(glyph!.width + 0.01);
          expect(y, c).toBeGreaterThanOrEqual(-0.01);
          expect(y, c).toBeLessThanOrEqual(1.15);
        }
      }
    }
  });

  it("are drawn with curves, not seven segments", () => {
    for (const c of "0235689") {
      const longest = Math.max(...CLEAN_GLYPHS.get(c)!.strokes.map((s) => s.length));
      expect(longest, c).toBeGreaterThanOrEqual(12);
    }
    // Digits reach from the top to the baseline.
    for (const c of "0123456789") {
      const ys = CLEAN_GLYPHS.get(c)!
        .strokes.flat()
        .map(([, y]) => y);
      expect(Math.min(...ys), c).toBeLessThan(0.08);
      expect(Math.max(...ys), c).toBeGreaterThan(0.93);
    }
  });
});

describe("writeText", () => {
  it("writes from x, its digits on the baseline and as tall as asked", () => {
    const strokes = writeText("48", CLEAN_GLYPHS, { x: 100, baseline: 300, height: 20 });
    const box = boxOf(strokes);
    expect(box.minX).toBeGreaterThanOrEqual(100);
    expect(box.maxY).toBeCloseTo(300, 0);
    expect(box.minY).toBeCloseTo(280, 0);
    // Two digits, side by side.
    expect(box.maxX - box.minX).toBeGreaterThan(20);
    expect(box.maxX - box.minX).toBeLessThan(30);
    for (const s of strokes) for (let i = 2; i < s.length; i += 3) expect(s[i]).toBe(0.5);
  });

  it("gives a dot two points so it draws, and skips a character it has no glyph for", () => {
    const one: Map<string, Glyph> = new Map([[".", { strokes: [[[0, 1]]], width: 0.1 }]]);
    const [dot] = writeText(".", one, { x: 0, baseline: 10, height: 10 });
    expect(dot).toHaveLength(6);
    expect(writeText("?", CLEAN_GLYPHS, { x: 0, baseline: 10, height: 10 })).toEqual([]);
  });

  it("gets longer with every character", () => {
    const at = { x: 0, baseline: 50, height: 30 };
    const short = boxOf(writeText("1", CLEAN_GLYPHS, at));
    const long = boxOf(writeText("1.25", CLEAN_GLYPHS, at));
    expect(long.maxX).toBeGreaterThan(short.maxX + 30);
  });
});

describe("the writer's own glyphs", () => {
  /** A sample: a vertical stroke for a digit, `h` tall, ending `lift` above the rule. */
  const sample = (symbol: string, x: number, rule: number, h: number, lift = 2) => ({
    symbol,
    baseline: rule,
    strokes: [[x, rule - lift - h, 0.5, x + 1, rule - lift - h / 2, 0.5, x, rule - lift, 0.5]],
  });

  it("scales digits to one unit and keeps a point at the digits' baseline", () => {
    const glyphs = glyphsFromSamples([
      sample("1", 60, 160, 30),
      sample("7", 60, 240, 28),
      sample("4", 60, 320, 32),
      {
        symbol: ".",
        baseline: 400,
        strokes: [[62, 398, 0.5, 63, 398, 0.5]],
      },
    ]);
    expect([...glyphs.keys()].sort()).toEqual([".", "1", "4", "7"]);
    const one = glyphs.get("1")!;
    const ys = one.strokes.flat().map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(1, 5);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    const point = glyphs.get(".")!.strokes.flat();
    // 2 px above the rule, as the digits end: on the baseline.
    expect(point[0][1]).toBeCloseTo(1, 5);
  });

  it("is empty without a digit to measure by, and the last sample of a character wins", () => {
    expect(glyphsFromSamples([{ symbol: "+", baseline: 100, strokes: [[1, 2, 0.5]] }]).size).toBe(
      0,
    );
    expect(glyphsFromSamples([]).size).toBe(0);
    const twice = glyphsFromSamples([sample("1", 60, 160, 30), sample("1", 200, 160, 15)]);
    expect(twice.size).toBe(1);
  });

  it("is used only when it has every character of the answer", () => {
    const own = glyphsFromSamples([sample("1", 60, 160, 30), sample("4", 60, 240, 30)]);
    expect(glyphsFor("14", own)).toBe(own);
    expect(glyphsFor("15", own)).toBe(CLEAN_GLYPHS);
    expect(glyphsFor("15", null)).toBe(CLEAN_GLYPHS);
    expect(glyphsFor("1?", null)).toBeNull();
  });
});
