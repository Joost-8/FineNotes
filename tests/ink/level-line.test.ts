/**
 * Lines that snap level or upright (src/ink/level-line.ts, FineNotes
 * discussion #51), and every place a line is made: hold-to-snap lines and
 * arrows, the Shape tool's connectors, and the highlighter's straight line.
 */

import { describe, expect, it } from "vitest";
import { LINE_LEVEL_DEG, levelLine, levelTurn } from "../../src/ink/level-line";
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

describe("levelTurn", () => {
  it("turns onto the nearest of level or upright within the band, and only there", () => {
    expect(levelTurn(100, Math.tan(4 * DEG) * 100)).toBeCloseTo(-4 * DEG, 10);
    expect(levelTurn(-100, Math.tan(3 * DEG) * 100)).toBeCloseTo(3 * DEG, 10);
    expect(levelTurn(Math.tan(2 * DEG) * 100, 100)).toBeCloseTo(2 * DEG, 10);
    expect(levelTurn(100, Math.tan(6 * DEG) * 100)).toBe(0);
    expect(levelTurn(100, 100)).toBe(0);
    expect(levelTurn(0, 0)).toBe(0);
    expect(levelTurn(100, 0)).toBe(0);
  });

  it("uses Xournal's ±5°", () => {
    expect(LINE_LEVEL_DEG).toBe(5);
    expect(levelTurn(100, Math.tan(4.9 * DEG) * 100)).not.toBe(0);
    expect(levelTurn(100, Math.tan(5.1 * DEG) * 100)).toBe(0);
  });
});

describe("levelLine", () => {
  it("levels a line about its middle, its ends exactly on one height, length and pressure kept", () => {
    const pts = [100, 100, 0.3, 300, 110, 0.7];
    const out = levelLine(pts, "middle");
    expect(out).not.toBe(pts);
    expect(out[1]).toBe(out[4]);
    expect(out[1]).toBeCloseTo(105, 1);
    expect(out[3] - out[0]).toBeCloseTo(Math.hypot(200, 10), 1);
    expect([out[2], out[5]]).toEqual([0.3, 0.7]);
  });

  it("levels about its start, which stays put", () => {
    const out = levelLine([100, 100, 0.5, 100.5, 300, 0.5], "start");
    expect(out.slice(0, 2)).toEqual([100, 100]);
    expect(out[3]).toBe(100);
    expect(out[4]).toBeCloseTo(300, 0);
  });

  it("turns an arrow's head with its shaft, every copy of the tip with it", () => {
    const pts = arrowPoints({ x: 100, y: 100 }, { x: 300, y: 112 }).flatMap((p) => [p.x, p.y, 0.5]);
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
      [0, 0, 0.5],
      [5, 5, 0.5, 5, 5, 0.5],
    ]) {
      expect(levelLine(pts, "middle")).toBe(pts);
    }
  });
});

describe("hold-to-snap levels lines and arrows", () => {
  it.each([1, 2, 3, 4.5, -3, 178, 183, 88, 92, 271])(
    "a line drawn at %s° comes out level or upright",
    (deg) => {
      const shape = recognizeShape(drawnLine(200, 300, 260, deg));
      expect(shape?.kind).toBe("line");
      const a = angleOf(shape!.pts);
      expect(Math.abs(Math.round(a / 90) * 90 - a)).toBe(0);
    },
  );

  it.each([7, 12, 30, 45, 80])("a line drawn at %s° keeps its slope", (deg) => {
    const shape = recognizeShape(drawnLine(200, 300, 260, deg));
    expect(shape?.kind).toBe("line");
    expect(angleOf(shape!.pts)).toBeCloseTo(deg, 0);
  });

  it("scores the ink, not the levelled line: the confidence is the same either side of the band", () => {
    // The same stroke, turned from just inside the band to just outside:
    // levelling moves the output, never the score.
    const inside = recognizeShape(drawnLine(200, 300, 260, 4.9));
    const outside = recognizeShape(drawnLine(200, 300, 260, 5.1));
    expect(inside?.confidence).toBe(outside?.confidence);
  });

  it("levels the real Pencil arrows drawn within the band, and only those", () => {
    // Joost's arrows (2026-09-22): four of the nine were drawn 1.5–3.5° off
    // level and come out level; the rest were drawn at a slope and keep it.
    let levelled = 0;
    for (const stroke of realArrows.strokes) {
      const pts = stroke.points.flatMap((p) => [p[0], p[1], 0.5]);
      for (const held of [false, true]) {
        const shape = recognizeShape(pts, { held });
        if (!shape) continue;
        expect(["line", "arrow"]).toContain(shape.kind);
        const a = angleOf(shape.pts);
        const off = Math.abs(Math.round(a / 90) * 90 - a);
        if (off === 0) levelled++;
        else expect(off).toBeGreaterThan(LINE_LEVEL_DEG);
      }
    }
    expect(levelled).toBeGreaterThanOrEqual(6);
  });

  it("is idempotent: a levelled line or arrow reads back as itself, unmoved", () => {
    for (const deg of [2, -4, 91]) {
      for (const pts of [drawnLine(100, 100, 300, deg)]) {
        const first = recognizeShape(pts)!;
        const again = recognizeShape(first.pts.slice())!;
        expect(again.kind).toBe(first.kind);
        expect(again.pts).toEqual(first.pts);
      }
    }
    const arrow = presetGeometry("arrow", { x: 100, y: 100 }, { x: 400, y: 100 }, 0.5);
    const read = recognizeShape(arrow)!;
    expect(read.kind).toBe("arrow");
    expect(read.pts[1]).toBe(read.pts[4]);
  });

  it("levels at 5x zoom as at fit", () => {
    // 52 page px is 260 screen px at 5x: a line the hand drew full size.
    const pts = drawnLine(40, 60, 52, 3);
    const shape = recognizeAtZoom(pts, 5);
    expect(shape?.kind).toBe("line");
    expect(shape!.pts[1]).toBe(shape!.pts[4]);
  });
});

describe("the Shape tool's connectors level about where the pen went down", () => {
  it("a line or arrow dragged within the band is level, its start where the pen went down", () => {
    const from = { x: 100, y: 200 };
    for (const preset of ["line", "arrow"] as const) {
      const pts = presetGeometry(preset, from, { x: 300, y: 212 }, 0.5);
      expect(pts.slice(0, 2)).toEqual([100, 200]);
      expect(pts[4]).toBe(200);
      expect(pts[3]).toBeCloseTo(100 + Math.hypot(200, 12), 1);
    }
    // Upright, dragged upwards.
    const up = presetGeometry("line", from, { x: 108, y: 20 }, 0.5);
    expect(up[3]).toBe(100);
    expect(up[4]).toBeLessThan(200);
  });

  it("outside the band the connector goes where it was dragged", () => {
    expect(presetGeometry("line", { x: 0, y: 0 }, { x: 200, y: 40 }, 0.5)).toEqual([
      0, 0, 0.5, 200, 40, 0.5,
    ]);
  });
});

describe("the highlighter's straight line levels too", () => {
  it("every real highlight Joost drew across a line of text comes out level", () => {
    for (const pts of realHighlights.strokes) {
      const line = lineOfHighlight(pts, 20)!;
      expect(line[1]).toBe(line[4]);
    }
  });

  it("a highlight drawn at a slope keeps it", () => {
    const line = lineOfHighlight(drawnLine(100, 100, 300, 15), 20)!;
    expect(angleOf(line)).toBeCloseTo(15, 0);
  });
});
