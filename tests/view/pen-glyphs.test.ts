/**
 * `src/view/pen-glyphs.ts`: the pen icons, and the width buttons drawn in
 * each pen's character.
 */

import { describe, expect, it } from "vitest";
import {
  PREVIEW_HIGHLIGHTER_OPACITY,
  SWOOSH_HEIGHT,
  SWOOSH_WIDTH,
  glyphThickness,
  inkNeedsRim,
  penIconParts,
  sampleStroke,
  swoosh,
  widthMarkThickness,
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
    const pens = ["fountain", "ball", "brush", "calligraphy", "highlighter"];
    const icons = pens.map((pen) => JSON.stringify(penIconParts(pen)));
    expect(new Set(icons).size).toBe(5);
    for (const pen of pens) {
      expect(
        penIconParts(pen).some((part) => part.ink),
        pen,
      ).toBe(true);
    }
    expect(penIconParts("unknown")).toEqual(penIconParts("fountain"));
  });

  it("leans every pen the same way, and never outlines a filled tip in ink", () => {
    for (const pen of ["fountain", "ball", "brush", "calligraphy", "highlighter"]) {
      for (const part of penIconParts(pen)) {
        expect(part.attrs.transform, pen).toBe("rotate(45 12 12)");
        // A filled ink part is outlined in the icon's colour or not at all, never in ink.
        if (part.ink && part.fill)
          expect(["none", "currentColor"], pen).toContain(part.attrs.stroke);
      }
    }
  });
});

describe("ink that would vanish into the bar", () => {
  it("rims black ink on a dark theme and pale ink on a light one, nothing else", () => {
    expect(inkNeedsRim("#1a1a1a", true)).toBe(true);
    expect(inkNeedsRim("#000000", true)).toBe(true);
    expect(inkNeedsRim("#2f6fdf", true)).toBe(false);
    expect(inkNeedsRim("#d6453d", true)).toBe(false);
    expect(inkNeedsRim("#ffffff", false)).toBe(true);
    expect(inkNeedsRim("#fff176", false)).toBe(true);
    expect(inkNeedsRim("#1a1a1a", false)).toBe(false);
    expect(inkNeedsRim("#2f6fdf", false)).toBe(false);
  });
});

describe("width glyphs", () => {
  it("are as thick as the stroke on screen, up to the glyph's height", () => {
    expect(glyphThickness(0.5)).toBe(0.5);
    expect(glyphThickness(5.74)).toBe(5.74);
    expect(glyphThickness(0.01)).toBe(0.25);
    expect(glyphThickness(40)).toBe(SWOOSH_HEIGHT);
    expect(glyphThickness(Number.NaN)).toBe(1.5);
  });

  it("draw the ballpoint even and the highlighter as a flat, see-through band", () => {
    expect(swoosh("ball", 3)).toMatchObject({ strokeWidth: 3, cap: "round" });
    expect(swoosh("highlighter", 14)).toMatchObject({
      strokeWidth: 14,
      cap: "butt",
      opacity: 0.55,
    });
    expect(swoosh("highlighter", 40).strokeWidth).toBe(SWOOSH_HEIGHT);
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
    // The calligraphy pen's flat nib: thick and thin by turns along the curve.
    const nib = Array.from({ length: 21 }, (_, i) => widthAt(swoosh("calligraphy", 6).d, i));
    expect(Math.max(...nib)).toBeGreaterThan(3 * Math.min(...nib));
    // Wider pens draw wider glyphs.
    expect(widthAt(swoosh("fountain", 8).d, 10)).toBeGreaterThan(
      widthAt(swoosh("fountain", 2).d, 10),
    );
  });

  it("stay inside their box while they fit in it", () => {
    for (const pen of ["fountain", "ball", "brush", "highlighter"]) {
      for (const size of [0.5, 2, 5, 8]) {
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

describe("sampleStroke (the size preview)", () => {
  const W = 240;
  const H = 44;

  it("draws the ballpoint as one even line at the real thickness", () => {
    expect(sampleStroke("ball", 2.5, W, H)).toMatchObject({ strokeWidth: 2.5, cap: "round" });
  });

  it("draws the highlighter as a flat, translucent band at the real thickness", () => {
    expect(sampleStroke("highlighter", 18, W, H)).toMatchObject({
      strokeWidth: 18,
      cap: "butt",
      opacity: PREVIEW_HIGHLIGHTER_OPACITY,
    });
  });

  it("draws the fountain pen and the brush as filled, tapered outlines", () => {
    for (const pen of ["fountain", "brush"]) {
      const shape = sampleStroke(pen, 6, W, H);
      expect(shape.strokeWidth).toBeUndefined();
      expect(shape.d.endsWith("Z")).toBe(true);
    }
  });

  it("gives each pen a different shape at the same width", () => {
    const shapes = ["fountain", "ball", "brush", "highlighter"].map((pen) =>
      JSON.stringify(sampleStroke(pen, 4, W, H)),
    );
    expect(new Set(shapes).size).toBe(4);
  });

  it("is never fuller than the real thickness", () => {
    for (const pen of ["fountain", "brush"]) {
      const pts = points(sampleStroke(pen, 6, W, H).d);
      // The outline's two sides, matched point for point, are at most 6 apart.
      const half = pts.length / 2;
      for (let i = 0; i < half; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[pts.length - 1 - i];
        expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThanOrEqual(6.05);
      }
    }
  });

  it("keeps a stroke that fits inside the box", () => {
    for (const pen of ["fountain", "brush"]) {
      for (const [x, y] of points(sampleStroke(pen, 4, W, H).d)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(W);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(H);
      }
    }
  });

  it("still draws a stroke thicker than the box, centred on it", () => {
    const shape = sampleStroke("ball", 80, W, H);
    expect(shape.strokeWidth).toBe(80);
    const ys = points(shape.d).map(([, y]) => y);
    expect(Math.min(...ys)).toBeLessThanOrEqual(H / 2 + 1);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(H / 2 - 1);
  });

  it("draws a nonsense thickness as a hairline, not as nothing", () => {
    expect(sampleStroke("ball", Number.NaN, W, H).strokeWidth).toBe(1);
    expect(sampleStroke("ball", 0, W, H).strokeWidth).toBe(1);
  });
});

describe("the tool bar's width mark", () => {
  it("thickens with every preset width, the highlighter's included", () => {
    const widths = [0.5, 2, 3, 5, 8, 12, 20];
    const marks = widths.map(widthMarkThickness);
    for (let i = 1; i < marks.length; i++) expect(marks[i]).toBeGreaterThan(marks[i - 1]);
  });

  it("stays between 1 and 5 px, whatever it is given", () => {
    for (const width of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 0.01, 48, 400]) {
      const mark = widthMarkThickness(width);
      expect(mark).toBeGreaterThanOrEqual(1);
      expect(mark).toBeLessThanOrEqual(5);
    }
  });
});
