/**
 * `src/ink/stroke-eraser.ts` — the standard (partial) eraser's geometry.
 */

import { describe, expect, it } from "vitest";
import {
  ERASER_FILTERS,
  MIN_PIECE_LENGTH,
  eraseCircleFromPoints,
  eraseCircleFromStroke,
  eraserFilterOf,
  eraserTakes,
} from "../../src/ink/stroke-eraser";
import type { Stroke } from "../../src/model/document";
import { inkPath, penOptions } from "../../src/ink/freehand";
import { presetGeometry } from "../../src/ink/shape-geometry";

/** A horizontal line from x0 to x1 at y, as a two-point (snapped) polyline. */
function line(x0: number, x1: number, y = 0, p = 0.5): number[] {
  return [x0, y, p, x1, y, p];
}

/** The same line densely sampled, as real pencil input is. */
function sampled(x0: number, x1: number, step = 2, y = 0): number[] {
  const pts: number[] = [];
  for (let x = x0; x <= x1; x += step) pts.push(x, y, 0.5);
  return pts;
}

function xs(piece: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < piece.length; i += 3) out.push(piece[i]);
  return out;
}

describe("eraseCircleFromPoints", () => {
  it("returns null when the eraser misses the stroke", () => {
    expect(eraseCircleFromPoints(line(0, 100), 2, 50, 40, 10)).toBeNull();
    expect(eraseCircleFromPoints(line(0, 100), 2, 500, 0, 10)).toBeNull();
  });

  it("splits a two-point line into two pieces with exact cut points", () => {
    // size 0 so the cut is exactly the radius.
    const pieces = eraseCircleFromPoints(line(0, 100), 0, 50, 0, 10);
    expect(pieces).not.toBeNull();
    expect(pieces).toHaveLength(2);
    expect(xs(pieces![0])).toEqual([0, 40]);
    expect(xs(pieces![1])).toEqual([60, 100]);
  });

  it("widens the cut by half the stroke width so the round cap stays out", () => {
    const pieces = eraseCircleFromPoints(line(0, 100), 8, 50, 0, 10)!;
    expect(xs(pieces[0])[1]).toBeCloseTo(36);
    expect(xs(pieces[1])[0]).toBeCloseTo(64);
  });

  it("interpolates pressure at the cut", () => {
    const pts = [0, 0, 0, 100, 0, 1];
    const pieces = eraseCircleFromPoints(pts, 0, 50, 0, 10)!;
    expect(pieces[0][5]).toBeCloseTo(0.4);
    expect(pieces[1][2]).toBeCloseTo(0.6);
  });

  it("splits densely sampled ink and keeps every sample outside the eraser", () => {
    const pieces = eraseCircleFromPoints(sampled(0, 100), 0, 50, 0, 10)!;
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      for (const x of xs(piece)) expect(Math.abs(x - 50)).toBeGreaterThanOrEqual(10 - 1e-9);
    }
    expect(xs(pieces[0])[0]).toBe(0);
    expect(xs(pieces[1]).at(-1)).toBe(100);
  });

  it("trims only one end when the eraser covers it", () => {
    const pieces = eraseCircleFromPoints(line(0, 100), 0, 0, 0, 10)!;
    expect(pieces).toHaveLength(1);
    expect(xs(pieces[0])).toEqual([10, 100]);
  });

  it("returns an empty list when the whole stroke is covered", () => {
    expect(eraseCircleFromPoints(line(0, 10), 0, 5, 0, 20)).toEqual([]);
  });

  it("drops slivers shorter than MIN_PIECE_LENGTH", () => {
    const pieces = eraseCircleFromPoints(line(0, 20), 0, 10, 0, 9.6)!;
    // Each side would be 0.4 px long.
    expect(0.4).toBeLessThan(MIN_PIECE_LENGTH);
    expect(pieces).toEqual([]);
  });

  it("handles a single-point dot", () => {
    expect(eraseCircleFromPoints([5, 5, 0.5], 2, 5, 6, 3)).toEqual([]);
    expect(eraseCircleFromPoints([5, 5, 0.5], 2, 50, 50, 3)).toBeNull();
    expect(eraseCircleFromPoints([], 2, 0, 0, 3)).toBeNull();
  });

  it("cuts a stroke that passes through the eraser several times", () => {
    // A U-turn crossing x = 50 twice: left arm, the bend, and the return arm.
    const pts = [0, 0, 0.5, 100, 0, 0.5, 100, 4, 0.5, 0, 4, 0.5];
    const pieces = eraseCircleFromPoints(pts, 0, 50, 2, 6)!;
    expect(pieces).toHaveLength(3);
    expect(xs(pieces[1])).toContain(100);
  });

  it("does not read past the end of a ragged array", () => {
    const ragged = [...line(0, 100), 7];
    const pieces = eraseCircleFromPoints(ragged, 0, 50, 0, 10)!;
    for (const piece of pieces) {
      expect(piece.length % 3).toBe(0);
      expect(piece.every(Number.isFinite)).toBe(true);
    }
  });

  it("treats repeated points as one", () => {
    const pts = [0, 0, 0.5, 0, 0, 0.5, 100, 0, 0.5];
    expect(eraseCircleFromPoints(pts, 0, 0, 0, 10)).toHaveLength(1);
    expect(eraseCircleFromPoints(pts, 0, 50, 50, 10)).toBeNull();
  });
});

describe("eraseCircleFromStroke", () => {
  const stroke: Stroke = {
    id: "s1",
    color: "#112233",
    size: 0,
    tool: "pen",
    pts: line(0, 100),
    t0: 1234,
    shape: "line",
  };

  it("keeps style, t0 and the shape tag, and mints ids", () => {
    let n = 10;
    const pieces = eraseCircleFromStroke(stroke, 50, 0, 10, () => `s${++n}`)!;
    expect(pieces.map((p) => p.id)).toEqual(["s11", "s12"]);
    for (const piece of pieces) {
      expect(piece.color).toBe("#112233");
      expect(piece.tool).toBe("pen");
      expect(piece.t0).toBe(1234);
      expect(piece.shape).toBe("line");
    }
  });

  it("leaves freehand ink untagged", () => {
    const { shape: _shape, ...ink } = stroke;
    const pieces = eraseCircleFromStroke(ink, 50, 0, 10, () => "x")!;
    for (const piece of pieces) expect("shape" in piece).toBe(false);
  });

  it("keeps a cut rectangle's corners square when drawn", () => {
    // Regression: the pieces lost their tag, were drawn with streamline as
    // handwriting, and each corner's two arms merged into a curve.
    const rect: Stroke = {
      id: "r",
      color: "#000",
      size: 3,
      tool: "pen",
      shape: "rect",
      pts: presetGeometry("rect", { x: 0, y: 0 }, { x: 200, y: 120 }, 0.5),
    };
    // Rub out the middle of the top edge. The rectangle starts at a corner,
    // so this leaves two pieces, and three corners in the middle of a piece.
    const pieces = eraseCircleFromStroke(rect, 100, 0, 20, () => "p")!;
    expect(pieces.length).toBeGreaterThan(0);
    // Drawn as shapes are — the exact centreline, stroked — so the path runs
    // through each of those corners; drawn as handwriting it rounded them.
    const paths = pieces.map((piece) =>
      inkPath(piece.pts, penOptions(3, false), true, piece.shape !== undefined),
    );
    for (const ink of paths) expect(ink?.stroke).toBe(3);
    const d = paths.map((ink) => ink?.d ?? "").join(" ");
    for (const corner of ["0.00 120.00", "200.00 120.00", "200.00 0.00"]) {
      expect(d).toContain(`L ${corner}`);
    }
  });

  it("omits t0 when the original has none", () => {
    const { t0: _t0, ...noTime } = stroke;
    const pieces = eraseCircleFromStroke(noTime, 50, 0, 10, () => "x")!;
    expect("t0" in pieces[0]).toBe(false);
  });

  it("returns null and mints nothing on a miss", () => {
    let minted = 0;
    expect(eraseCircleFromStroke(stroke, 50, 50, 10, () => `s${++minted}`)).toBeNull();
    expect(minted).toBe(0);
  });
});

describe("eraser filter", () => {
  it("reads a stored filter, defaulting to everything", () => {
    expect(eraserFilterOf("highlighter")).toBe("highlighter");
    expect(eraserFilterOf("pen")).toBe("pen");
    expect(eraserFilterOf("all")).toBe("all");
    expect(eraserFilterOf(undefined)).toBe("all");
    expect(eraserFilterOf("shapes")).toBe("all");
    expect(ERASER_FILTERS).toEqual(["all", "highlighter", "pen"]);
  });

  it("keys on the stroke's tool: shapes and tables are pen ink", () => {
    const pen = { tool: "pen" as const };
    const highlighter = { tool: "highlighter" as const };
    expect(eraserTakes(pen, "all")).toBe(true);
    expect(eraserTakes(highlighter, "all")).toBe(true);
    expect(eraserTakes(pen, "highlighter")).toBe(false);
    expect(eraserTakes(highlighter, "highlighter")).toBe(true);
    expect(eraserTakes(pen, "pen")).toBe(true);
    expect(eraserTakes(highlighter, "pen")).toBe(false);
  });
});
