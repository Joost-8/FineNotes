/**
 * The highlighter's chisel tip (`src/ink/chisel.ts`): a level highlight is
 * a band of one height with square ends, the sweep has no gaps between its
 * pieces, the tracer marks its runs, and the tip survives a save, the
 * eraser and the renderer's path cache.
 */

import { describe, expect, it } from "vitest";
import { CHISEL_ASPECT, chiselPolygons } from "../../src/ink/chisel";
import { InkTracer, inkRuns, penOptions, traceRun } from "../../src/ink/freehand";
import { eraseCircleFromStroke } from "../../src/ink/stroke-eraser";
import { type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

/** Whether `x, y` lies inside the convex polygon `poly` (flat), edges included. */
function insideConvex(poly: readonly number[], x: number, y: number): boolean {
  let sign = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[2 * i];
    const ay = poly[2 * i + 1];
    const bx = poly[(2 * ((i + 1) % n)) % poly.length];
    const by = poly[(2 * ((i + 1) % n) + 1) % poly.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function covered(polys: readonly number[][], x: number, y: number): boolean {
  return polys.some((poly) => insideConvex(poly, x, y));
}

/** The polygons' bounds. */
function boundsOf(polys: readonly number[][]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const xs = polys.flatMap((p) => p.filter((_, i) => i % 2 === 0));
  const ys = polys.flatMap((p) => p.filter((_, i) => i % 2 === 1));
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

describe("chiselPolygons", () => {
  it("draws a level line as a band of the tip's height with square ends", () => {
    const polys = chiselPolygons([10, 50, 110, 50], 20);
    expect(polys).toHaveLength(1);
    const half = (20 / 2) * CHISEL_ASPECT;
    expect(boundsOf(polys)).toEqual({ minX: 10 - half, minY: 40, maxX: 110 + half, maxY: 60 });
    // A rectangle: its four corners are the band's.
    expect(polys[0]).toHaveLength(8);
    for (const [x, y] of [
      [10 - half, 40],
      [110 + half, 60],
    ]) {
      expect(covered(polys, x, y)).toBe(true);
    }
  });

  it("draws an upright line narrower: the chisel's edge", () => {
    const b = boundsOf(chiselPolygons([50, 10, 50, 110], 20));
    expect(b.maxX - b.minX).toBeCloseTo(20 * CHISEL_ASPECT);
    expect(b.maxY - b.minY).toBeCloseTo(120);
  });

  it("covers the whole sweep of a diagonal piece, as a hexagon", () => {
    const polys = chiselPolygons([0, 0, 40, 30], 10);
    expect(polys[0]).toHaveLength(12);
    // Every point of the tip, anywhere along the way, is inside.
    for (let t = 0; t <= 1; t += 0.1) {
      for (const [ox, oy] of [
        [-2.5, -5],
        [2.5, 5],
        [-2.5, 5],
        [2.5, -5],
      ]) {
        expect(covered(polys, 40 * t + ox * 0.999, 30 * t + oy * 0.999)).toBe(true);
      }
    }
  });

  it("leaves no gap where the pieces of a wavy line meet", () => {
    const xy: number[] = [];
    for (let i = 0; i <= 40; i++) xy.push(i * 5, 100 + 3 * Math.sin(i / 3));
    const polys = chiselPolygons(xy, 16);
    // Along the centreline and up to just inside the band's edge: all inside.
    for (let x = 0; x <= 200; x += 0.37) {
      const y = 100 + 3 * Math.sin(x / 15);
      for (const dy of [-7.5, -4, 0, 4, 7.5]) expect(covered(polys, x, y + dy)).toBe(true);
    }
  });

  it("draws one point as the tip's rectangle, and skips repeats and junk", () => {
    expect(chiselPolygons([5, 5], 4)).toEqual([[4, 3, 4, 7, 6, 7, 6, 3]]);
    expect(chiselPolygons([5, 5, 5, 5, Number.NaN, 2], 4)).toEqual([[4, 3, 4, 7, 6, 7, 6, 3]]);
    expect(chiselPolygons([], 4)).toEqual([]);
    expect(chiselPolygons([1, 2, 3, 4], Number.NaN)).toHaveLength(1);
  });
});

describe("a chisel highlight's runs", () => {
  const line = [10, 50, 0.5, 60, 51, 0.5, 120, 50, 0.5, 180, 52, 0.5];

  it("are marked chisel, settled or open, and only for the chisel tip", () => {
    const tracer = new InkTracer(penOptions(20, false, undefined, "chisel"));
    for (let i = 0; i < line.length; i += 3) tracer.push(line[i], line[i + 1], line[i + 2]);
    expect(tracer.runs().every((run) => run.chisel === true)).toBe(true);
    expect(tracer.settled().every((run) => run.chisel === true)).toBe(true);
    expect(inkRuns(line, penOptions(20, false)).some((run) => run.chisel)).toBe(false);
    expect(penOptions(20, false, undefined, "round" as never).chisel).toBeUndefined();
  });

  it("trace as closed polygons, not a line", () => {
    const ops: string[] = [];
    const sink = {
      moveTo: () => ops.push("M"),
      lineTo: () => ops.push("L"),
      closePath: () => ops.push("Z"),
    };
    for (const run of inkRuns(line, penOptions(20, false, undefined, "chisel"))) {
      traceRun(sink, run);
    }
    expect(ops.filter((op) => op === "M").length).toBe(ops.filter((op) => op === "Z").length);
    expect(ops.length).toBeGreaterThan(0);
  });
});

describe("a chisel highlight's tip", () => {
  const stroke: Stroke = {
    id: "h1",
    color: "#fab005",
    size: 20,
    tool: "highlighter",
    tip: "chisel",
    pts: [10, 50, 0.5, 60, 50, 0.5, 110, 50, 0.5, 160, 50, 0.5],
  };

  it("is saved, and an unknown tip reads as round", () => {
    const doc = emptyDocument();
    const page = blankPage();
    page.strokes.push(structuredClone(stroke), {
      ...structuredClone(stroke),
      id: "h2",
      tip: "felt" as never,
    });
    doc.pages = [page];
    const read = decodeDocument(encodeDocument(doc));
    expect(read.pages[0].strokes[0].tip).toBe("chisel");
    expect(read.pages[0].strokes[1].tip).toBeUndefined();
  });

  it("stays with the pieces the eraser leaves", () => {
    const pieces = eraseCircleFromStroke(stroke, 85, 50, 6, () => "p") ?? [];
    expect(pieces.length).toBe(2);
    expect(pieces.every((piece) => piece.tip === "chisel")).toBe(true);
  });
});
