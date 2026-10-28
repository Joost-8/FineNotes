/**
 * Lines that snap level or upright (src/ink/level-line.ts, FineNotes
 * discussion #51), and every place a line is made: hold-to-snap lines and
 * arrows, the Shape tool's connectors, and the highlighter's straight line.
 *
 * A line is levelled when its ends are within `LINE_LEVEL_RISE` px of level
 * at fit-to-width zoom, and never more than `LINE_LEVEL_DEG` off: a rise is
 * what the eye sees, and it scales with the zoom (Joost, 2026-10-28: a flat
 * 5° caught far too much of a long line, at any zoom).
 */

import { describe, expect, it } from "vitest";
import { LINE_LEVEL_DEG, LINE_LEVEL_RISE, levelLine, levelTurn } from "../../src/ink/level-line";
import { recognizeAtZoom, recognizeShape } from "../../src/ink/shape-recognizer";
import { arrowPoints, presetGeometry } from "../../src/ink/shape-geometry";
import { lineOfHighlight } from "../../src/ink/straighten";
import realHighlights from "./fixtures/real-highlights-ipad.json";
import realArrows from "./fixtures/real-pencil-arrows-ipad.json";

const DEG = Math.PI / 180;

/** A pencil-ish line from (x, y), `len` long at `deg` (y down), with a little wobble. */
function drawnLine(x: number, y: number, len: number, deg: number, n = 40): number[] {
  const out: number[] = [];
  const ux = Math.cos(deg * DEG);
  const uy = Math.sin(deg * DEG);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * len;
    const wobble = Math.sin(i * 1.7) * 0.6;
    out.push(x + t * ux - wobble * uy, y + t * uy + wobble * ux, 0.5);
  }
  return out;
}

/** Degrees of the segment from the first point to the second, y down. */
function angleOf(pts: readonly number[]): number {
  return Math.atan2(pts[4] - pts[1], pts[3] - pts[0]) / DEG;
}

/** How far the segment is off the nearest axis, degrees. */
function offAxis(pts: readonly number[]): number {
  const a = angleOf(pts);
  return Math.abs(Math.round(a / 90) * 90 - a);
}

/** A segment `len` long at `deg`. */
const seg = (len: number, deg: number): [number, number] => [
  len * Math.cos(deg * DEG),
  len * Math.sin(deg * DEG),
];

describe("levelTurn", () => {
  it("levels a segment whose ends are within the rise of level, onto the nearest axis", () => {
    // 100 px at 3°: the ends are 5.2 px apart in height.
    expect(levelTurn(...seg(100, 3))).toBeCloseTo(-3 * DEG, 10);
    expect(levelTurn(...seg(100, 177))).toBeCloseTo(3 * DEG, 10);
    expect(levelTurn(...seg(100, 92))).toBeCloseTo(-2 * DEG, 10);
  });

  it("leaves a long line its slope: the rise is what the eye sees", () => {
    // 300 px at 2° rises 10.5 px: plainly drawn at a slope.
    expect(levelTurn(...seg(300, 2))).toBe(0);
    // 300 px at 1° rises 5.2 px: meant level.
    expect(levelTurn(...seg(300, 1))).not.toBe(0);
  });

  it("never levels more than a few degrees, however short the line", () => {
    expect(LINE_LEVEL_DEG).toBe(4);
    expect(LINE_LEVEL_RISE).toBe(8);
    expect(levelTurn(...seg(30, 3.9))).not.toBe(0);
    expect(levelTurn(...seg(30, 4.2))).toBe(0);
  });

  it("takes the rise it is given, as a caller scales it with the zoom", () => {
    expect(levelTurn(...seg(300, 2), 12)).not.toBe(0);
    expect(levelTurn(...seg(100, 3), 4)).toBe(0);
  });

  it("nothing for a segment already level, or of no length", () => {
    expect(levelTurn(100, 0)).toBe(0);
    expect(levelTurn(0, 0)).toBe(0);
  });
});

describe("levelLine", () => {
  it("levels a line about its middle, its ends exactly on one height, length and pressure kept", () => {
    const pts = [100, 100, 0.3, 300, 105, 0.7];
    const out = levelLine(pts, "middle");
    expect(out).not.toBe(pts);
    expect(out[1]).toBe(out[4]);
    expect(out[1]).toBeCloseTo(102.5, 1);
    expect(out[3] - out[0]).toBeCloseTo(Math.hypot(200, 5), 1);
    expect([out[2], out[5]]).toEqual([0.3, 0.7]);
  });

  it("levels about its start, which stays put", () => {
    const out = levelLine([100, 100, 0.5, 100.5, 200, 0.5], "start");
    expect(out.slice(0, 2)).toEqual([100, 100]);
    expect(out[3]).toBe(100);
    expect(out[4]).toBeCloseTo(200, 0);
  });

  it("turns an arrow's head with its shaft, every copy of the tip with it", () => {
    const pts = arrowPoints({ x: 100, y: 100 }, { x: 300, y: 106 }).flatMap((p) => [p.x, p.y, 0.5]);
    const out = levelLine(pts, "middle");
    const tipY = out[4];
    for (const i of [1, 2, 4]) expect([out[i * 3], out[i * 3 + 1]]).toEqual([out[3], tipY]);
    expect(out[1]).toBe(tipY);
    // The barbs stay mirror images about the levelled shaft.
    expect(out[10] - tipY).toBeCloseTo(-(out[16] - tipY), 1);
    expect(out[9]).toBeCloseTo(out[15], 1);
  });

  it("returns the same array when there is nothing to level", () => {
    for (const pts of [
      [0, 0, 0.5, 100, 0, 0.5],
      [0, 0, 0.5, 100, 30, 0.5],
      [0, 0, 0.5, 300, 12, 0.5],
      [0, 0, 0.5],
      [5, 5, 0.5, 5, 5, 0.5],
    ]) {
      expect(levelLine(pts, "middle")).toBe(pts);
    }
  });
});

describe("hold-to-snap levels lines and arrows", () => {
  it.each([1, 2, 3, -3, 178, 183, 88, 92, 271])(
    "a 140 px line drawn at %s° comes out level or upright",
    (deg) => {
      const shape = recognizeShape(drawnLine(200, 300, 140, deg));
      expect(shape?.kind).toBe("line");
      expect(offAxis(shape!.pts)).toBe(0);
    },
  );

  it.each([4.5, 7, 12, 30, 45, 80])("a 140 px line drawn at %s° keeps its slope", (deg) => {
    const shape = recognizeShape(drawnLine(200, 300, 140, deg));
    expect(shape?.kind).toBe("line");
    expect(angleOf(shape!.pts)).toBeCloseTo(deg, 0);
  });

  it("a long line drawn 2° off keeps its slope; a short one is levelled", () => {
    expect(angleOf(recognizeShape(drawnLine(100, 100, 400, 2))!.pts)).toBeCloseTo(2, 0);
    expect(offAxis(recognizeShape(drawnLine(100, 100, 120, 2))!.pts)).toBe(0);
  });

  it("scores the ink, not the levelled line: the confidence is the same either side of the rise", () => {
    // The same stroke, turned from just inside the rise to just outside:
    // levelling moves the output, never the score.
    const inside = recognizeShape(drawnLine(200, 300, 140, 3.2));
    const outside = recognizeShape(drawnLine(200, 300, 140, 3.5));
    expect(offAxis(inside!.pts)).toBe(0);
    expect(offAxis(outside!.pts)).toBeGreaterThan(3);
    expect(inside?.confidence).toBe(outside?.confidence);
  });

  it("levels the real Pencil arrows drawn nearly level, and only those", () => {
    // Joost's arrows (2026-09-22): 80–140 px shafts drawn 1.5–3.5° off level.
    let levelled = 0;
    for (const stroke of realArrows.strokes) {
      const pts = stroke.points.flatMap((p) => [p[0], p[1], 0.5]);
      for (const held of [false, true]) {
        const shape = recognizeShape(pts, { held });
        if (!shape) continue;
        expect(["line", "arrow"]).toContain(shape.kind);
        const off = offAxis(shape.pts);
        if (off === 0) {
          levelled++;
          continue;
        }
        const length = Math.hypot(shape.pts[3] - shape.pts[0], shape.pts[4] - shape.pts[1]);
        const rise = length * Math.sin(off * DEG);
        expect(rise > LINE_LEVEL_RISE || off > LINE_LEVEL_DEG).toBe(true);
      }
    }
    expect(levelled).toBeGreaterThanOrEqual(4);
  });

  it("is idempotent: a levelled line or arrow reads back as itself, unmoved", () => {
    for (const deg of [2, -2, 91]) {
      const first = recognizeShape(drawnLine(100, 100, 140, deg))!;
      const again = recognizeShape(first.pts.slice())!;
      expect(again.kind).toBe(first.kind);
      expect(again.pts).toEqual(first.pts);
    }
    const arrow = presetGeometry("arrow", { x: 100, y: 100 }, { x: 400, y: 100 }, 0.5);
    const read = recognizeShape(arrow)!;
    expect(read.kind).toBe("arrow");
    expect(read.pts[1]).toBe(read.pts[4]);
  });

  it("measures the rise on screen: the same line seen twice as big is levelled less", () => {
    // 100 page px at 3°: 5.2 px of rise at fit, 10.5 px at 2x.
    const pts = drawnLine(40, 60, 100, 3);
    expect(offAxis(recognizeAtZoom(pts, 1)!.pts)).toBe(0);
    expect(offAxis(recognizeAtZoom(pts, 2)!.pts)).toBeGreaterThan(2);
    // And a short line at 5x, small on the page, is levelled as at fit.
    const small = drawnLine(40, 60, 28, 2);
    expect(offAxis(recognizeAtZoom(small, 5)!.pts)).toBe(0);
  });
});

describe("the Shape tool's connectors level about where the pen went down", () => {
  it("a line or arrow dragged with its end within the rise is level, its start where the pen went down", () => {
    const from = { x: 100, y: 200 };
    for (const preset of ["line", "arrow"] as const) {
      const pts = presetGeometry(preset, from, { x: 300, y: 206 }, 0.5);
      expect(pts.slice(0, 2)).toEqual([100, 200]);
      expect(pts[4]).toBe(200);
      expect(pts[3]).toBeCloseTo(100 + Math.hypot(200, 6), 1);
    }
    // Upright, dragged upwards.
    const up = presetGeometry("line", from, { x: 104, y: 60 }, 0.5);
    expect(up[3]).toBe(100);
    expect(up[4]).toBeLessThan(200);
  });

  it("an end that snapped to another shape's point stays on it: a rise of 0 levels nothing", () => {
    // d51-shapes-all: the Shape tool passes 0 once its end has snapped to a
    // shape (src/ink/shape-snap.ts).
    expect(presetGeometry("line", { x: 100, y: 200 }, { x: 300, y: 203 }, 0.5, 0)).toEqual([
      100, 200, 0.5, 300, 203, 0.5,
    ]);
  });

  it("past the rise the connector goes where it was dragged; the caller's rise scales it", () => {
    expect(presetGeometry("line", { x: 0, y: 0 }, { x: 200, y: 12 }, 0.5)).toEqual([
      0, 0, 0.5, 200, 12, 0.5,
    ]);
    // Zoomed out to half, 12 page px is 6 px on screen: levelled.
    expect(presetGeometry("line", { x: 0, y: 0 }, { x: 200, y: 12 }, 0.5, 16)[4]).toBe(0);
  });
});

describe("the highlighter's straight line levels too", () => {
  it("levels the real highlights drawn nearly level, and keeps the ones drawn at a slope", () => {
    // Joost's five highlights across lines of text (2026-10-15), ~185 px:
    // 1.2°, 1.7°, 0.7° off (rises 3.7, 5.4, 2.2 px) and 3.5°, 3.2° (11 px).
    const level = realHighlights.strokes.map((pts) => {
      const line = lineOfHighlight(pts, 20)!;
      return line[1] === line[4];
    });
    expect(level).toEqual([true, true, true, false, false]);
  });

  it("a highlight drawn at a slope keeps it", () => {
    const line = lineOfHighlight(drawnLine(100, 100, 300, 15), 20)!;
    expect(angleOf(line)).toBeCloseTo(15, 0);
  });
});
