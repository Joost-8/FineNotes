/**
 * `src/view/pen-glyphs.ts`: the pen icons, and the width buttons drawn in
 * each pen's character.
 */

import { describe, expect, it } from "vitest";
import {
  PREVIEW_HIGHLIGHTER_OPACITY,
  SWOOSH_HEIGHT,
  SWOOSH_WIDTH,
  WIDTH_BAR,
  WIDTH_MARK_LIMIT,
  fitMarks,
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

const PENS = ["fountain", "ball", "brush", "calligraphy", "highlighter"];

/** A path's corners, for paths of M, L, H and Z. */
function vertices(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [, cmd, args] of d.matchAll(/([MLHZ])([^MLHZ]*)/g)) {
    const nums = (args.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    if (cmd === "H") for (const x of nums) out.push([x, out[out.length - 1][1]]);
    else for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  }
  return out;
}

/** The outline's full height: its lowest point less its highest. */
function height(d: string): number {
  const ys = vertices(d).map(([, y]) => y);
  return Math.max(...ys) - Math.min(...ys);
}

/** The ink a mark covers, glyph px: a stroked line's caps and width included. */
function extent(shape: { d: string; strokeWidth?: number; cap?: string }): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const p = vertices(shape.d);
  const half = (shape.strokeWidth ?? 0) / 2;
  const capX = shape.cap === "round" ? half : 0;
  return {
    left: Math.min(...p.map(([x]) => x)) - capX,
    right: Math.max(...p.map(([x]) => x)) + capX,
    top: Math.min(...p.map(([, y]) => y)) - half,
    bottom: Math.max(...p.map(([, y]) => y)) + half,
  };
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
  it("are as thick as the stroke on screen, up to the bar's limit", () => {
    expect(glyphThickness(0.5)).toBe(0.5);
    expect(glyphThickness(5.74)).toBe(5.74);
    expect(glyphThickness(0.01)).toBe(0.25);
    expect(glyphThickness(40)).toBe(WIDTH_MARK_LIMIT);
    expect(glyphThickness(Number.NaN)).toBe(1.5);
  });

  it("are true size while a control's largest fits, else shrink together", () => {
    // The pill's eraser at fit zoom: every ring fits its 28 px box.
    expect(fitMarks([9.6, 23, 27.5], 28)).toEqual({ sizes: [9.6, 23, 27.5], scaled: false });
    // At 5x (measured 2026-10-29: 48 / 115 / 230 px, all drawn as 28 before).
    const zoomed = fitMarks([48, 115, 230], 28);
    expect(zoomed.scaled).toBe(true);
    expect(Math.max(...zoomed.sizes)).toBeCloseTo(28);
    expect(zoomed.sizes[1] / zoomed.sizes[0]).toBeCloseTo(115 / 48);
    expect(zoomed.sizes[2] / zoomed.sizes[1]).toBeCloseTo(230 / 115);
    // A bad size is passed through, not let to scale the rest.
    expect(fitMarks([Number.NaN, 12], 24)).toEqual({ sizes: [Number.NaN, 12], scaled: false });
    expect(fitMarks([], 24)).toEqual({ sizes: [], scaled: false });
  });

  it("draw a shrunk mark as solid ink, at its fitted size", () => {
    const [, , largest] = fitMarks([30, 60, 120], WIDTH_MARK_LIMIT).sizes;
    expect(swoosh("ball", largest)).toMatchObject({ strokeWidth: WIDTH_MARK_LIMIT, cap: "round" });
    expect(swoosh("highlighter", largest)).toMatchObject({
      strokeWidth: WIDTH_MARK_LIMIT,
      cap: "butt",
    });
    expect(height(swoosh("fountain", largest).d)).toBeCloseTo(WIDTH_MARK_LIMIT, 1);
  });

  it("are level bars of one length at every width, as Goodnotes draws them", () => {
    for (const pen of PENS) {
      for (const size of [0.5, 3, 12, WIDTH_MARK_LIMIT]) {
        const { left, right } = extent(swoosh(pen, size));
        expect(right - left, `${pen} ${size}`).toBeCloseTo(WIDTH_BAR, 1);
        expect((left + right) / 2).toBeCloseTo(SWOOSH_WIDTH / 2, 1);
      }
    }
  });

  it("are as tall as the stroke is wide", () => {
    expect(swoosh("ball", 3)).toMatchObject({ strokeWidth: 3, cap: "round" });
    expect(swoosh("highlighter", 14)).toMatchObject({
      strokeWidth: 14,
      cap: "butt",
      opacity: 0.55,
    });
    for (const pen of ["fountain", "brush", "calligraphy"]) {
      expect(height(swoosh(pen, 6).d), pen).toBeCloseTo(6, 1);
      expect(height(swoosh(pen, 12).d), pen).toBeCloseTo(12, 1);
    }
  });

  it("end in the pen's character", () => {
    // The fountain pen: fine at both ends, the nib's width in the middle.
    const fountain = swoosh("fountain", 6).d;
    expect(widthAt(fountain, 10)).toBeCloseTo(6, 1);
    expect(widthAt(fountain, 0)).toBeLessThan(1.5);
    expect(widthAt(fountain, 20)).toBeLessThan(1.5);
    // The brush: full near the start, lifting off to a point.
    const brush = swoosh("brush", 6).d;
    expect(widthAt(brush, 3)).toBeGreaterThan(widthAt(brush, 10));
    expect(widthAt(brush, 10)).toBeGreaterThan(widthAt(brush, 20));
    expect(widthAt(brush, 20)).toBeLessThan(1);
    // The calligraphy pen: a band whose ends are cut along the nib's 40° edge,
    // down and to the right as the engine's nib lies (`nibFactor`).
    // Corners: top left, top right, bottom right, bottom left.
    const [tl, tr, br, bl] = vertices(swoosh("calligraphy", 6).d);
    expect(tr[1]).toBe(tl[1]);
    expect(br[1]).toBe(bl[1]);
    const cut = (top: number, bottom: number): number =>
      Math.atan2(br[1] - tr[1], bottom - top) * (180 / Math.PI);
    expect(cut(tl[0], bl[0])).toBeCloseTo(40, 0);
    expect(cut(tr[0], br[0])).toBeCloseTo(40, 0);
  });

  it("stay inside their box", () => {
    for (const pen of PENS) {
      for (const size of [0.5, 2, 5, 8, WIDTH_MARK_LIMIT]) {
        const shape = swoosh(pen, size);
        const { left, right, top, bottom } = extent(shape);
        expect(left, `${pen} ${size}`).toBeGreaterThanOrEqual(-0.01);
        expect(right).toBeLessThanOrEqual(SWOOSH_WIDTH + 0.01);
        expect(top).toBeGreaterThanOrEqual(-0.01);
        expect(bottom).toBeLessThanOrEqual(SWOOSH_HEIGHT + 0.01);
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
