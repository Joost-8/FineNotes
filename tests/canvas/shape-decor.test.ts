/**
 * The geometry of a shape's style (`src/canvas/shape-decor.ts`): rounded
 * corners that never overlap, arrowheads sized to the line, dash patterns.
 */

import { describe, expect, it } from "vitest";
import {
  HEAD_MAX,
  type OutlineOp,
  arrowHead,
  cornerRadius,
  dashPattern,
  outlineOps,
  pathHeads,
  pointsOf,
} from "../../src/canvas/shape-decor";

const flat = (points: Array<[number, number]>): number[] => points.flatMap(([x, y]) => [x, y, 0.5]);

const square = flat([
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
  [0, 0],
]);

const ops = (list: OutlineOp[]): string[] => list.map((o) => o.op);

describe("cornerRadius", () => {
  it("takes the radius asked for where the edges are long enough", () => {
    expect(cornerRadius({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, 10)).toBeCloseTo(10);
  });

  it("never runs the curve past halfway along an edge", () => {
    // A right angle: the curve meets each edge `r` from the corner.
    expect(cornerRadius({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }, 50)).toBeCloseTo(10);
  });

  it("is 0 on a straight run, a reversal, or an edge of no length", () => {
    expect(cornerRadius({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, 10)).toBe(0);
    expect(cornerRadius({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 0 }, 10)).toBe(0);
    expect(cornerRadius({ x: 50, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 9 }, 10)).toBe(0);
    expect(cornerRadius({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 9 }, 0)).toBe(0);
  });

  it("rounds a sharp corner less, since its curve sits further from the corner", () => {
    const sharp = cornerRadius({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 20 }, 40);
    const right = cornerRadius({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, 40);
    expect(sharp).toBeLessThan(right);
    expect(sharp).toBeGreaterThan(0);
  });
});

describe("outlineOps", () => {
  it("rounds every corner of a closed loop, the seam included", () => {
    const out = outlineOps(square, 10, true);
    expect(ops(out)).toEqual(["M", "A", "A", "A", "A", "Z"]);
    // It starts halfway along the closing edge, so the first corner rounds too.
    expect(out[0]).toEqual({ op: "M", x: 0, y: 50 });
    for (const o of out) if (o.op === "A") expect(o.r).toBeCloseTo(10);
  });

  it("is the plain polyline at radius 0", () => {
    expect(ops(outlineOps(square, 0, true))).toEqual(["M", "L", "L", "L", "Z"]);
  });

  it("keeps an open polyline's ends sharp", () => {
    const open = flat([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    const out = outlineOps(open, 10, false);
    expect(out).toEqual([
      { op: "M", x: 0, y: 0 },
      { op: "A", x1: 100, y1: 0, x2: 100, y2: 100, r: expect.closeTo(10) as number },
      { op: "L", x: 100, y: 100 },
    ]);
  });

  it("skips repeated points, which have no direction", () => {
    const doubled = flat([
      [0, 0],
      [100, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]);
    expect(ops(outlineOps(doubled, 10, true))).toEqual(["M", "A", "A", "A", "A", "Z"]);
  });

  it("draws one point, or nothing, as it is", () => {
    expect(outlineOps([], 10, true)).toEqual([]);
    expect(outlineOps([5, 6, 0.5], 10, false)).toEqual([{ op: "M", x: 5, y: 6 }]);
  });

  it("ignores a ragged tail", () => {
    expect(pointsOf([1, 2, 0.5, 3])).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("arrowHead", () => {
  const tail = { x: 0, y: 0 };
  const tip = { x: 200, y: 0 };

  it("is an open V, symmetric about the line, ending at the tip", () => {
    const head = arrowHead(tail, tip, 2, "open", 200);
    expect(head?.filled).toBe(false);
    const [a, t, b] = head?.points ?? [];
    expect(t).toEqual(tip);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(-b.y);
    expect(a.x).toBeLessThan(tip.x);
    expect(head?.stop).toEqual(tip);
  });

  it("stops a line with a filled head at the middle of its base", () => {
    const head = arrowHead(tail, tip, 2, "filled", 200);
    expect(head?.filled).toBe(true);
    const [, a, b] = head?.points ?? [];
    expect(head?.stop.x).toBeCloseTo((a.x + b.x) / 2);
    expect(head?.stop.y).toBeCloseTo(0);
    expect(head?.stop.x).toBeLessThan(tip.x);
  });

  it("grows with the line but never past HEAD_MAX, nor past 45 % of a short line", () => {
    const side = (span: number): number => {
      const head = arrowHead({ x: tip.x - span, y: 0 }, tip, 2, "open", span);
      const a = head?.points[0];
      return a ? Math.hypot(a.x - tip.x, a.y - tip.y) : 0;
    };
    expect(side(1000)).toBeCloseTo(HEAD_MAX);
    expect(side(100)).toBeLessThan(HEAD_MAX);
    expect(side(20)).toBeCloseTo(9);
  });

  it("is nothing for a line of no length", () => {
    expect(arrowHead(tip, tip, 2, "open", 0)).toBeNull();
  });
});

describe("dashPattern", () => {
  it("scales with the width, leaving room for the round caps", () => {
    expect(dashPattern("dash", 2)).toEqual([4, 6]);
    expect(dashPattern("dot", 2)).toEqual([0, 4.4]);
  });

  it("keeps a usable pattern for a hairline", () => {
    expect(dashPattern("dash", 0)).toEqual([1, 1.5]);
  });
});

describe("pathHeads (discussion #107)", () => {
  // An S of runs: right, down, right.
  const s = flat([
    [0, 0],
    [200, 0],
    [200, 100],
    [400, 100],
  ]);

  it("points the head along the last run, not along the line between the ends", () => {
    const { pts, heads } = pathHeads(s, 2, { end: "open" });
    expect(pts).toEqual(s);
    expect(heads).toHaveLength(1);
    const [a, tip, b] = heads[0].points;
    expect(tip).toEqual({ x: 400, y: 100 });
    // Both barbs lie behind the tip, symmetric about the run (y = 100).
    expect(a.x).toBeLessThan(400);
    expect(b.x).toBeLessThan(400);
    expect(a.y - 100).toBeCloseTo(100 - b.y, 6);
    expect(Math.hypot(a.x - 400, a.y - 100)).toBeCloseTo(HEAD_MAX, 6);
  });

  it("cuts the path back to a filled head's base, and heads its start along the first run", () => {
    const { pts, heads } = pathHeads(s, 2, { start: "open", end: "filled" });
    expect(heads).toHaveLength(2);
    const filled = heads.find((h) => h.filled)!;
    const last = pts.slice(-3);
    expect(last[0]).toBeCloseTo(filled.stop.x, 6);
    expect(last[1]).toBeCloseTo(100, 6);
    expect(last[0]).toBeLessThan(400);
    // The corners are kept.
    expect(pts.slice(3, 9)).toEqual([200, 0, 0.5, 200, 100, 0.5]);
    const start = heads.find((h) => !h.filled)!;
    expect(start.points[1]).toEqual({ x: 0, y: 0 });
    expect(start.points[0].x).toBeGreaterThan(0);
  });

  it("on a curve, follows its last segment: the tangent at the tip", () => {
    const curve: Array<[number, number]> = [];
    for (let i = 0; i <= 40; i++) {
      const t = (Math.PI / 2) * (i / 40);
      curve.push([100 * Math.cos(t), 100 * Math.sin(t)]);
    }
    const { heads } = pathHeads(flat(curve), 2, { end: "open" });
    const [a, tip, b] = heads[0].points;
    // The quarter circle ends at (0, 100) heading in -x: barbs behind it, in +x.
    expect(tip.x).toBeCloseTo(0, 6);
    expect(a.x).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(0);
    expect(Math.abs(a.y - 100 - (100 - b.y))).toBeLessThan(2);
  });

  it("leaves a path too short for a head as it is", () => {
    expect(pathHeads(flat([[5, 5]]), 2, { end: "open" })).toEqual({
      pts: flat([[5, 5]]),
      heads: [],
    });
  });
});
