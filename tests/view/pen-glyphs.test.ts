/**
 * `src/view/pen-glyphs.ts`: the pen icons, and the width buttons drawn in
 * each pen's character.
 */

import { describe, expect, it } from "vitest";
import {
  SWOOSH_HEIGHT,
  SWOOSH_WIDTH,
  glyphThickness,
  penIconParts,
  swoosh,
} from "../../src/view/pen-glyphs";

/** Every number in a path, as x, y pairs. */
function points(d: string): Array<[number, number]> {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** The outline's width at sample i of 21: the distance between its two sides there. */
function widthAt(d: string, i: number): number {
  const p = points(d);
  const left = p[i];
  const right = p[p.length - 1 - i];
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

describe("pen icons", () => {
  it("has its own icon for each pen, its tip in ink", () => {
    const pens = ["fountain", "ball", "brush", "highlighter"];
    const icons = pens.map((pen) => JSON.stringify(penIconParts(pen)));
    expect(new Set(icons).size).toBe(4);
    for (const pen of pens) {
      expect(
        penIconParts(pen).some((part) => part.ink),
        pen,
      ).toBe(true);
    }
    expect(penIconParts("unknown")).toEqual(penIconParts("fountain"));
  });
});

describe("width glyphs", () => {
  it("grow with the width, within a range that fits the button", () => {
    expect(glyphThickness(0.5)).toBe(1.5);
    expect(glyphThickness(5)).toBe(5);
    expect(glyphThickness(40)).toBe(8);
    expect(glyphThickness(Number.NaN)).toBe(1.5);
  });

  it("draw the ballpoint even and the highlighter as a flat, see-through band", () => {
    expect(swoosh("ball", 3)).toMatchObject({ strokeWidth: 3, cap: "round" });
    expect(swoosh("highlighter", 3)).toMatchObject({ strokeWidth: 5, cap: "butt", opacity: 0.55 });
    expect(swoosh("highlighter", 40).strokeWidth).toBe(10);
  });

  it("taper the fountain pen at both ends and the brush toward its end", () => {
    const fountain = swoosh("fountain", 6).d;
    expect(swoosh("fountain", 6).strokeWidth).toBeUndefined();
    expect(widthAt(fountain, 10)).toBeCloseTo(6, 1);
    expect(widthAt(fountain, 0)).toBeLessThan(2);
    expect(widthAt(fountain, 20)).toBeLessThan(2);
    const brush = swoosh("brush", 6).d;
    expect(widthAt(brush, 3)).toBeGreaterThan(widthAt(brush, 10));
    expect(widthAt(brush, 10)).toBeGreaterThan(widthAt(brush, 20));
    expect(widthAt(brush, 20)).toBeLessThan(1);
    // Wider pens draw wider glyphs.
    expect(widthAt(swoosh("fountain", 8).d, 10)).toBeGreaterThan(
      widthAt(swoosh("fountain", 2).d, 10),
    );
  });

  it("stay inside their box", () => {
    for (const pen of ["fountain", "ball", "brush", "highlighter"]) {
      for (const size of [2, 5, 12]) {
        const shape = swoosh(pen, size);
        const pad = (shape.strokeWidth ?? 0) / 2;
        // A flat (butt) end stops where the line does; a round one reaches past it.
        const padX = shape.cap === "butt" ? 0 : pad;
        for (const [x, y] of points(shape.d)) {
          expect(x - padX, `${pen} ${size}`).toBeGreaterThanOrEqual(-0.5);
          expect(x + padX).toBeLessThanOrEqual(SWOOSH_WIDTH + 0.5);
          expect(y - pad).toBeGreaterThanOrEqual(-0.5);
          expect(y + pad).toBeLessThanOrEqual(SWOOSH_HEIGHT + 0.5);
        }
      }
    }
  });
});
