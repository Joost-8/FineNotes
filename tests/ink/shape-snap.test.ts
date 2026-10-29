/**
 * Snapping to other shapes (src/ink/shape-snap.ts, FineNotes discussion
 * #51): what each shape offers, the nearest-target search through the
 * stroke index, and the exact pen position for a held shape.
 */

import { describe, expect, it } from "vitest";
import { MAX_CORNERS, ShapeSnapper, penForPoint, snapTargets } from "../../src/ink/shape-snap";
import { arrowPoints, presetGeometry, transformShape } from "../../src/ink/shape-geometry";
import type { ShapeKind, Stroke } from "../../src/model/document";
import { StrokeIndex } from "../../src/view/stroke-index";

let ids = 0;
function stroke(shape: ShapeKind | undefined, pts: number[]): Stroke {
  return { id: `s${ids++}`, color: "#000", size: 2, tool: "pen", pts, ...(shape ? { shape } : {}) };
}

function pairs(targets: Float64Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < targets.length; i += 2) out.push([targets[i], targets[i + 1]]);
  return out;
}

const from = { x: 100, y: 100 };
const to = { x: 300, y: 200 };

describe("snapTargets", () => {
  it("a rectangle: its four corners and the middle of each side", () => {
    const t = pairs(snapTargets(stroke("rect", presetGeometry("rect", from, to, 0.5))));
    expect(t).toHaveLength(8);
    for (const corner of [
      [100, 100],
      [300, 100],
      [300, 200],
      [100, 200],
    ]) {
      expect(t).toContainEqual(corner);
    }
    for (const mid of [
      [200, 100],
      [300, 150],
      [200, 200],
      [100, 150],
    ]) {
      expect(t).toContainEqual(mid);
    }
  });

  it("a line: both ends and its middle", () => {
    expect(pairs(snapTargets(stroke("line", [0, 0, 0.5, 100, 40, 0.5])))).toEqual([
      [0, 0],
      [100, 40],
      [50, 20],
    ]);
  });

  it("a whole arrow: tail, tip and the middle of the shaft, not the barbs", () => {
    const pts = arrowPoints({ x: 0, y: 0 }, { x: 200, y: 0 }).flatMap((p) => [p.x, p.y, 0.5]);
    expect(pairs(snapTargets(stroke("arrow", pts)))).toEqual([
      [0, 0],
      [200, 0],
      [100, 0],
    ]);
  });

  it("an ellipse: its centre and the points furthest out on each side", () => {
    const pts = presetGeometry("ellipse", from, to, 0.5);
    const t = pairs(snapTargets(stroke("ellipse", pts)));
    expect(t).toHaveLength(5);
    expect(t[0][0]).toBeCloseTo(200, 0);
    expect(t[0][1]).toBeCloseTo(150, 0);
    expect(t.slice(1).map(([x]) => Math.round(x))).toEqual([100, 300, 200, 200]);
    expect(t.slice(1).map(([, y]) => Math.round(y))).toEqual([150, 150, 100, 200]);
  });

  it("a rounded rectangle or a cloud: its centre; a curved piece: its two ends", () => {
    const rr = pairs(snapTargets(stroke("roundrect", presetGeometry("roundrect", from, to, 0.5))));
    expect(rr).toHaveLength(1);
    expect(rr[0][0]).toBeCloseTo(200, 0);
    const arc = presetGeometry("ellipse", from, to, 0.5).slice(0, 30);
    const ends = pairs(snapTargets(stroke("ellipse", arc)));
    expect(ends).toEqual([
      [arc[0], arc[1]],
      [arc[27], arc[28]],
    ]);
  });

  it("an erased piece of a rectangle by its own points", () => {
    const piece = [100, 100, 0.5, 300, 100, 0.5, 300, 160, 0.5];
    expect(pairs(snapTargets(stroke("rect", piece)))).toEqual([
      [100, 100],
      [300, 100],
      [300, 160],
      [200, 100],
      [300, 130],
    ]);
  });

  it("handwriting offers nothing; more corners than a star is a curve", () => {
    expect(snapTargets(stroke(undefined, [0, 0, 0.5, 9, 9, 0.5]))).toHaveLength(0);
    const many: number[] = [];
    for (let i = 0; i <= MAX_CORNERS; i++) many.push(i * 10, (i % 2) * 10, 0.5);
    expect(pairs(snapTargets(stroke("polygon", many)))).toHaveLength(2);
  });

  it("is computed once per points array, and again for a fresh one", () => {
    const s = stroke("line", [0, 0, 0.5, 100, 0, 0.5]);
    const first = snapTargets(s);
    expect(snapTargets(s)).toBe(first);
    s.pts = [0, 0, 0.5, 50, 50, 0.5];
    expect(snapTargets(s)).not.toBe(first);
    expect(pairs(snapTargets(s))[1]).toEqual([50, 50]);
  });
});

/** A page of `count` rectangles in a grid, 60 px apart, plus handwriting, indexed. */
function densePage(count: number): { index: StrokeIndex; strokes: Stroke[] } {
  const index = new StrokeIndex();
  const strokes: Stroke[] = [];
  const cols = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const x = 20 + (i % cols) * 60;
    const y = 20 + Math.floor(i / cols) * 60;
    strokes.push(stroke("rect", presetGeometry("rect", { x, y }, { x: x + 40, y: y + 30 }, 0.5)));
    const ink: number[] = [];
    for (let k = 0; k < 40; k++) ink.push(x + k, y + 45 + Math.sin(k), 0.5);
    strokes.push(stroke(undefined, ink));
  }
  for (const s of strokes) index.add("p", s);
  return { index, strokes };
}

function snapperOn(index: StrokeIndex): ShapeSnapper {
  return new ShapeSnapper((x, y, reach, visit) => index.forEachNear("p", x, y, reach, visit));
}

describe("ShapeSnapper", () => {
  it("snaps to the nearest target within the radius, and not past it", () => {
    const { index } = densePage(9);
    const snapper = snapperOn(index);
    expect(snapper.snap(23, 18, 12)).toBe(true);
    expect([snapper.hit.x, snapper.hit.y]).toEqual([20, 20]);
    // Between a corner (60, 20) and the side's middle (40, 20)? The nearer.
    expect(snapper.snap(44, 21, 12)).toBe(true);
    expect([snapper.hit.x, snapper.hit.y]).toEqual([40, 20]);
    expect(snapper.snap(30, 5, 6)).toBe(false);
    expect(snapper.hit.snapped).toBe(false);
  });

  it("leaves out the shape being edited", () => {
    const { index, strokes } = densePage(1);
    const snapper = snapperOn(index);
    snapper.exclude = strokes[0];
    expect(snapper.snap(20, 20, 12)).toBe(false);
  });

  it("never snaps to handwriting", () => {
    const { index } = densePage(1);
    // The ink starts at (20, 65); no shape is near it.
    expect(snapperOn(index).snap(20, 65, 6)).toBe(false);
  });

  it("measures only the strokes near the pen, on a page of hundreds of shapes", () => {
    const { index } = densePage(400);
    const snapper = snapperOn(index);
    snapper.snap(620, 620, 12);
    // A 256 px cell holds ~16 rectangles and their ink; never the page's 800 strokes.
    expect(snapper.visited).toBeLessThan(80);
  });

  it("refuses a radius of nothing or a point that is not one", () => {
    const snapper = snapperOn(densePage(1).index);
    expect(snapper.snap(20, 20, 0)).toBe(false);
    expect(snapper.snap(NaN, 20, 12)).toBe(false);
  });
});

describe("penForPoint", () => {
  it("puts the pen where the held shape's vertex lands exactly on the target", () => {
    const base = presetGeometry("rect", from, to, 0.5);
    const pivot = { x: 200, y: 150 };
    const grab = { x: 320, y: 220 };
    const target = { x: 90, y: 85 };
    // Corner 0 (100, 100) onto the target.
    const pen = penForPoint(pivot, grab, { x: 100, y: 100 }, target)!;
    const moved = transformShape(base, pivot, grab, pen);
    expect(moved[0]).toBeCloseTo(90, 1);
    expect(moved[1]).toBeCloseTo(85, 1);
  });

  it("has no answer for a vertex on the pivot", () => {
    expect(penForPoint({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
  });
});
