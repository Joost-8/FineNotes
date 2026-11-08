/**
 * A shape's point handles (src/ink/shape-points.ts, FineNotes discussion
 * #51): which corners and ends get one, what dragging one does, and which
 * handle a press takes.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_POINT_HANDLES,
  levelAnchor,
  movePoint,
  pickPointHandle,
  pointHandles,
  snapsToShapes,
} from "../../src/ink/shape-points";
import { arcPoints, arrowPoints, presetGeometry } from "../../src/ink/shape-geometry";
import { recognizeShape } from "../../src/ink/shape-recognizer";
import { eraseCircleFromStroke } from "../../src/ink/stroke-eraser";
import type { ShapeKind, Stroke } from "../../src/model/document";

const from = { x: 100, y: 100 };
const to = { x: 300, y: 220 };

function xy(pts: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < pts.length; i += 3) out.push([pts[i], pts[i + 1]]);
  return out;
}

const flat = (points: Array<{ x: number; y: number }>): number[] =>
  points.flatMap((p) => [p.x, p.y, 0.5]);

describe("pointHandles", () => {
  it("puts one handle on each corner of a closed shape, the closing copy with the first", () => {
    for (const [preset, corners] of [
      ["rect", 4],
      ["triangle", 3],
      ["diamond", 4],
      ["star", 10],
    ] as const) {
      const pts = presetGeometry(preset, from, to, 0.5);
      const handles = pointHandles(preset, pts)!;
      expect(handles.points).toHaveLength(corners);
      expect(handles.points[0]).toEqual([0, corners]);
      expect(handles.arrow).toBe(false);
    }
  });

  it("a line's two ends, and a dot between them that bends it", () => {
    const handles = pointHandles("line", [10, 20, 0.5, 90, 20, 0.5])!;
    expect(handles.at).toEqual([10, 20, 50, 20, 90, 20]);
    expect(handles.looks).toEqual(["ring", "dot", "ring"]);
    expect(handles.connector?.kind).toBe("curve");
    const bent = movePoint("line", [10, 20, 0.5, 90, 20, 0.5], handles, 1, { x: 50, y: 60 })!;
    expect(bent.kind).toBe("path");
  });

  it("an elbow's ends and a pill on each run", () => {
    const elbow = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
    const handles = pointHandles("path", elbow)!;
    expect(handles.looks).toEqual(["ring", "pill-x", "pill-y", "ring"]);
    expect(xy(movePoint("path", elbow, handles, 2, { x: 140, y: 40 })!.pts)).toEqual([
      [0, 0],
      [140, 0],
      [140, 80],
      [100, 80],
    ]);
  });

  it("an arrow's tail and tip only, the tip's three copies as one", () => {
    const pts = flat(arrowPoints({ x: 10, y: 10 }, { x: 210, y: 10 }));
    const handles = pointHandles("arrow", pts)!;
    expect(handles.arrow).toBe(true);
    expect(handles.at).toEqual([10, 10, 210, 10]);
    expect(handles.points).toEqual([[0], [1, 2, 4]]);
  });

  it("a curve gets handles along its outline, and a drag bends it smoothly", () => {
    for (const kind of ["ellipse", "roundrect", "heart"] as const) {
      const pts = presetGeometry(kind, from, to, 0.5);
      const handles = pointHandles(kind, pts);
      expect(handles, kind).not.toBeNull();
      expect(handles!.curve).toBeDefined();
      expect(handles!.points.length).toBeGreaterThanOrEqual(3);
      const moved = movePoint(kind, pts, handles!, 1, {
        x: handles!.at[2] + 20,
        y: handles!.at[3] - 10,
      });
      expect(moved?.kind).toBe(kind);
      // The dragged sample went where the pen is; a far one did not move.
      const i = handles!.points[1][0];
      expect(moved!.pts[i * 3]).toBeCloseTo(handles!.at[2] + 20, 1);
      expect(moved!.pts[i * 3 + 1]).toBeCloseTo(handles!.at[3] - 10, 1);
      const opposite = (1 + Math.floor(handles!.points.length / 2)) % handles!.points.length;
      const far = handles!.points[opposite][0];
      expect(moved!.pts[far * 3]).toBe(pts[far * 3]);
      // A new array, so the renderer traces it again; a closed outline stays closed.
      expect(moved!.pts).not.toBe(pts);
      const n = pts.length / 3;
      expect(moved!.pts[(n - 1) * 3]).toBe(moved!.pts[0]);
      expect(moved!.pts[(n - 1) * 3 + 1]).toBe(moved!.pts[1]);
    }
  });

  it("an open arc is bent at its middle without moving its ends", () => {
    const arc = flat(arcPoints(100, 100, 80, 0, Math.PI));
    const handles = pointHandles("arc", arc)!;
    const middle = Math.floor(handles.points.length / 2);
    const moved = movePoint("arc", arc, handles, middle, {
      x: handles.at[middle * 2],
      y: handles.at[middle * 2 + 1] + 30,
    })!;
    expect(moved.pts.slice(0, 2)).toEqual(arc.slice(0, 2));
    expect(moved.pts.slice(-3, -1)).toEqual(arc.slice(-3, -1));
  });

  it("none for handwriting, a dot, or more corners than a star", () => {
    expect(pointHandles(undefined, [0, 0, 0.5, 10, 10, 0.5])).toBeNull();
    expect(pointHandles("line", [5, 5, 0.5, 5, 5, 0.5])).toBeNull();
    const many: number[] = [];
    for (let i = 0; i <= MAX_POINT_HANDLES; i++) many.push(i * 10, (i % 2) * 10, 0.5);
    expect(pointHandles("polygon", many)).toBeNull();
    expect(pointHandles("polygon", many.slice(0, -3))).not.toBeNull();
  });

  it("reads an erased piece by its own points, not its kind's layout", () => {
    // contracts/api.md §2: a piece keeps `shape` but not the layout. Half a
    // rectangle is three or four points, each its own handle; a piece of an
    // arrow is just ink-like vertices, with no head to carry.
    const rect: Stroke = {
      id: "r",
      color: "#000",
      size: 2,
      tool: "pen",
      shape: "rect",
      pts: presetGeometry("rect", from, to, 0.5),
    };
    let n = 0;
    const pieces = eraseCircleFromStroke(rect, 300, 160, 15, () => `p${n++}`) ?? [];
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      const handles = pointHandles(piece.shape, piece.pts)!;
      expect(handles.arrow).toBe(false);
      expect(handles.points.flat().sort((a, b) => a - b)).toEqual(
        Array.from({ length: piece.pts.length / 3 }, (_, i) => i),
      );
    }
    const brokenArrow = flat(arrowPoints({ x: 10, y: 10 }, { x: 210, y: 10 })).slice(0, 12);
    expect(pointHandles("arrow", brokenArrow)?.arrow).toBe(false);
  });
});

describe("movePoint", () => {
  it("moves one corner of a rectangle alone, and makes it a quad", () => {
    const pts = presetGeometry("rect", from, to, 0.5);
    const handles = pointHandles("rect", pts)!;
    const moved = movePoint("rect", pts, handles, 2, { x: 340, y: 260 })!;
    expect(moved.kind).toBe("polygon");
    expect(moved.pts).not.toBe(pts);
    const before = xy(pts);
    const after = xy(moved.pts);
    expect(after[2]).toEqual([340, 260]);
    for (const i of [0, 1, 3, 4]) expect(after[i]).toEqual(before[i]);
    // Still four corners, closed.
    expect(after[0]).toEqual(after[4]);
  });

  it("moves the closing copy with the first corner", () => {
    const pts = presetGeometry("triangle", from, to, 0.5);
    const handles = pointHandles("triangle", pts)!;
    const moved = movePoint("triangle", pts, handles, 0, { x: 150, y: 50 })!;
    expect(moved.kind).toBe("triangle");
    const after = xy(moved.pts);
    expect(after[0]).toEqual([150, 50]);
    expect(after[3]).toEqual([150, 50]);
  });

  it("keeps every other kind", () => {
    const cases: Array<[ShapeKind, number[]]> = [
      ["star", presetGeometry("star", from, to, 0.5)],
      ["polygon", presetGeometry("diamond", from, to, 0.5)],
    ];
    for (const [kind, pts] of cases) {
      const moved = movePoint(kind, pts, pointHandles(kind, pts)!, 1, { x: 50, y: 60 })!;
      expect(moved.kind).toBe(kind);
    }
    const diamond = presetGeometry("diamond", from, to, 0.5);
    expect(movePoint("diamond", diamond, pointHandles("diamond", diamond)!, 1, from)!.kind).toBe(
      "polygon",
    );
  });

  it("a piece of a rectangle stays a rect piece when one of its points moves", () => {
    const piece = [100, 100, 0.5, 300, 100, 0.5, 300, 180, 0.5];
    const moved = movePoint("rect", piece, pointHandles("rect", piece)!, 2, { x: 320, y: 200 })!;
    expect(moved.kind).toBe("rect");
  });

  it("carries an arrow's head round with its shaft, barbs the same size and angle", () => {
    const pts = flat(arrowPoints({ x: 100, y: 100 }, { x: 300, y: 100 }));
    const handles = pointHandles("arrow", pts)!;
    // The tip swung up to point straight down from the tail.
    const moved = movePoint("arrow", pts, handles, 1, { x: 100, y: 300 })!;
    const p = xy(moved.pts);
    expect(p[1]).toEqual([100, 300]);
    expect(p[2]).toEqual([100, 300]);
    expect(p[4]).toEqual([100, 300]);
    const barb = (i: number): number => Math.hypot(p[i][0] - 100, p[i][1] - 300);
    const old = xy(pts);
    const oldBarb = Math.hypot(old[3][0] - 300, old[3][1] - 100);
    expect(barb(3)).toBeCloseTo(oldBarb, 1);
    expect(barb(5)).toBeCloseTo(oldBarb, 1);
    // Both barbs point back up the shaft, one either side of it.
    expect(p[3][1]).toBeLessThan(300);
    expect(p[5][1]).toBeLessThan(300);
    expect(Math.sign(p[3][0] - 100)).toBe(-Math.sign(p[5][0] - 100));
    expect(recognizeShape(moved.pts)?.kind).toBe("arrow");
  });

  it("moving an arrow's tail turns the head with the shaft too", () => {
    const pts = flat(arrowPoints({ x: 100, y: 100 }, { x: 300, y: 100 }));
    const moved = movePoint("arrow", pts, pointHandles("arrow", pts)!, 0, { x: 300, y: -100 })!;
    const p = xy(moved.pts);
    // The shaft now runs straight down to the tip; the barbs sit above it.
    expect(p[0]).toEqual([300, -100]);
    expect(p[3][1]).toBeLessThan(100);
    expect(p[5][1]).toBeLessThan(100);
    expect(p[3][0] + p[5][0]).toBeCloseTo(600, 1);
  });

  it("refuses to shrink a line or a shaft to nothing, or to go nowhere", () => {
    const line = [0, 0, 0.5, 100, 0, 0.5];
    expect(movePoint("line", line, pointHandles("line", line)!, 2, { x: 0.2, y: 0.3 })).toBeNull();
    const arrow = flat(arrowPoints({ x: 0, y: 0 }, { x: 100, y: 0 }));
    expect(movePoint("arrow", arrow, pointHandles("arrow", arrow)!, 1, { x: 0, y: 0 })).toBeNull();
    expect(movePoint("line", line, pointHandles("line", line)!, 0, { x: NaN, y: 0 })).toBeNull();
    expect(movePoint("line", line, pointHandles("line", line)!, 7, { x: 5, y: 5 })).toBeNull();
  });

  it("rounds to the 1/100 px the file keeps, and keeps the pressure", () => {
    const line = [0, 0, 0.3, 100, 0, 0.7];
    const moved = movePoint("line", line, pointHandles("line", line)!, 2, { x: 50.123, y: 9.876 })!;
    expect(moved).toEqual({ kind: "line", pts: [0, 0, 0.3, 50.12, 9.88, 0.7] });
  });
});

describe("pickPointHandle", () => {
  const at = [100, 100, 200, 100];

  it("takes the nearest handle within reach", () => {
    expect(pickPointHandle(at, { x: 105, y: 102 }, 18)).toBe(0);
    expect(pickPointHandle(at, { x: 190, y: 95 }, 18)).toBe(1);
    expect(pickPointHandle(at, { x: 150, y: 100 }, 18)).toBe(-1);
  });

  it("leaves a press nearer one of the frame's own handles to the frame", () => {
    const frameCorner = { x: 92, y: 92 };
    expect(pickPointHandle(at, { x: 99, y: 99 }, 18, [frameCorner])).toBe(0);
    expect(pickPointHandle(at, { x: 94, y: 94 }, 18, [frameCorner])).toBe(-1);
  });
});

describe("levelAnchor and snapsToShapes", () => {
  it("a straight line's end levels with its other end; a bend point does neither", () => {
    const line = pointHandles("line", [0, 0, 0.5, 100, 0, 0.5])!;
    expect(levelAnchor(line, 0)).toEqual({ x: 100, y: 0 });
    expect(levelAnchor(line, 2)).toEqual({ x: 0, y: 0 });
    expect(levelAnchor(line, 1)).toBeNull();
    expect(snapsToShapes(line, 0)).toBe(true);
    expect(snapsToShapes(line, 1)).toBe(false);
  });

  it("a whole arrow's ends level with each other; a rectangle's corners snap but do not level", () => {
    const arrow = pointHandles("arrow", flat(arrowPoints({ x: 0, y: 0 }, { x: 100, y: 0 })))!;
    expect(levelAnchor(arrow, 1)).toEqual({ x: 0, y: 0 });
    const rect = pointHandles("rect", presetGeometry("rect", from, to, 0.5))!;
    expect(levelAnchor(rect, 0)).toBeNull();
    expect(snapsToShapes(rect, 0)).toBe(true);
  });

  it("an elbow's runs never snap, its ends do; a curve's ends do not level", () => {
    const elbow = pointHandles(
      "path",
      flat([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
      ]),
    )!;
    expect(snapsToShapes(elbow, 1)).toBe(false);
    expect(snapsToShapes(elbow, 3)).toBe(true);
    expect(levelAnchor(elbow, 0)).toBeNull();
  });
});
