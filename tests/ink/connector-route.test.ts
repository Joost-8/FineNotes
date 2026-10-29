/**
 * Where a connector between two shapes runs (src/ink/connector-route.ts,
 * discussion #51): anchors on the outline, right-angled routes with as few
 * bends as will do, never back through either shape, and where a linked
 * copy goes.
 */

import { describe, expect, it } from "vitest";
import {
  besideOffset,
  boundsOfPts,
  CONNECTOR_STUB,
  connectorRoute,
  draggedOffset,
  facingSide,
  nearestSide,
  oppositeSide,
  routeBounds,
  routeElbow,
  sideAnchor,
  sideMiddle,
  sideNormal,
} from "../../src/ink/connector-route";
import { presetGeometry } from "../../src/ink/shape-geometry";
import type { Bounds } from "../../src/model/document";

const box = (x: number, y: number, w: number, h: number): number[] =>
  presetGeometry("rect", { x, y }, { x: x + w, y: y + h }, 0.5);

function pairs(route: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < route.length; i += 2) out.push([route[i], route[i + 1]]);
  return out;
}

/** Every run is level or upright. */
function orthogonal(route: readonly number[]): boolean {
  const p = pairs(route);
  for (let i = 1; i < p.length; i++) {
    if (Math.abs(p[i][0] - p[i - 1][0]) > 1e-6 && Math.abs(p[i][1] - p[i - 1][1]) > 1e-6) {
      return false;
    }
  }
  return true;
}

/** Whether any run goes through the inside of `b`, the first and last (out of the anchors) aside. */
function throughInside(route: readonly number[], b: Bounds, skipEnds: boolean): boolean {
  const p = pairs(route);
  for (let i = 1; i < p.length; i++) {
    if (skipEnds && (i === 1 || i === p.length - 1)) continue;
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    if (
      Math.min(x0, x1) < b.maxX - 1 &&
      Math.max(x0, x1) > b.minX + 1 &&
      Math.min(y0, y1) < b.maxY - 1 &&
      Math.max(y0, y1) > b.minY + 1
    ) {
      return true;
    }
  }
  return false;
}

const bends = (route: readonly number[]): number => pairs(route).length - 2;

describe("anchors", () => {
  it("meets a rectangle at the middle of its sides", () => {
    const r = box(100, 100, 200, 100);
    expect(sideAnchor(r, "right")).toEqual({ x: 300, y: 150 });
    expect(sideAnchor(r, "top")).toEqual({ x: 200, y: 100 });
  });

  it("meets a triangle's slanted side half way up, not the empty corner of its box", () => {
    const tri = presetGeometry("triangle", { x: 0, y: 0 }, { x: 200, y: 200 }, 0.5);
    const right = sideAnchor(tri, "right")!;
    expect(right.y).toBe(100);
    expect(right.x).toBeCloseTo(150, 5);
    expect(sideAnchor(tri, "top")).toEqual({ x: 100, y: 0 });
  });

  it("meets an ellipse at its extreme point", () => {
    const e = presetGeometry("ellipse", { x: 0, y: 0 }, { x: 200, y: 100 }, 0.5);
    const left = sideAnchor(e, "left")!;
    expect(left.x).toBeCloseTo(0, 0);
    expect(left.y).toBeCloseTo(50, 5);
  });

  it("falls back to the middle of the side for a dot, and has nothing for no point", () => {
    expect(sideAnchor([5, 5, 0.5], "left")).toEqual({ x: 5, y: 5 });
    expect(sideAnchor([], "left")).toBeNull();
    expect(boundsOfPts([NaN, 1, 0.5])).toBeNull();
  });

  it("knows each side's middle, normal and opposite", () => {
    const b = { minX: 0, minY: 0, maxX: 10, maxY: 20 };
    expect(sideMiddle(b, "bottom")).toEqual({ x: 5, y: 20 });
    expect(sideMiddle(b, "left")).toEqual({ x: 0, y: 10 });
    expect(sideNormal("left")).toEqual({ x: -1, y: 0 });
    expect(["top", "right", "bottom", "left"].map((s) => oppositeSide(s as "top"))).toEqual([
      "bottom",
      "left",
      "top",
      "right",
    ]);
  });
});

describe("routes", () => {
  it("runs straight across between two shapes side by side", () => {
    const route = connectorRoute(box(0, 0, 100, 60), "right", box(300, 0, 100, 60), "left")!;
    expect(pairs(route)).toEqual([
      [100, 30],
      [300, 30],
    ]);
  });

  it("bends twice (a Z) between shapes side by side at different heights", () => {
    const route = connectorRoute(box(0, 0, 100, 60), "right", box(300, 200, 100, 60), "left")!;
    expect(orthogonal(route)).toBe(true);
    expect(bends(route)).toBe(2);
    expect(pairs(route)[0]).toEqual([100, 30]);
    expect(pairs(route).at(-1)).toEqual([300, 230]);
  });

  it("bends once (an L) from a side into a top", () => {
    // Goodnotes' second linked copy: out of the left side, down into the copy's top.
    const route = connectorRoute(box(300, 0, 100, 60), "left", box(0, 200, 100, 60), "top")!;
    expect(orthogonal(route)).toBe(true);
    expect(bends(route)).toBe(1);
    expect(pairs(route)).toEqual([
      [300, 30],
      [50, 30],
      [50, 200],
    ]);
  });

  it("goes round when the copy is behind the side it leaves, never through either shape", () => {
    // Out of the right side of A, into the right side of B, which is to A's left and below.
    const a = box(300, 0, 100, 60);
    const b = box(0, 0, 100, 60);
    const route = connectorRoute(a, "right", b, "right")!;
    expect(orthogonal(route)).toBe(true);
    expect(throughInside(route, boundsOfPts(a)!, true)).toBe(false);
    expect(throughInside(route, boundsOfPts(b)!, true)).toBe(false);
    // Leaves rightwards, arrives leftwards into B's right side.
    const p = pairs(route);
    expect(p[1][0]).toBeGreaterThan(p[0][0]);
    expect(p.at(-2)![0]).toBeGreaterThan(p.at(-1)![0]);
  });

  it("never goes back through a shape, across a sweep of placements", () => {
    const a = box(400, 400, 120, 80);
    const A = boundsOfPts(a)!;
    for (const [x, y] of [
      [700, 400],
      [700, 700],
      [400, 700],
      [100, 700],
      [100, 400],
      [100, 100],
      [400, 100],
      [700, 100],
      [430, 420],
    ]) {
      const b = box(x, y, 120, 80);
      const B = boundsOfPts(b)!;
      for (const sa of ["top", "right", "bottom", "left"] as const) {
        const sb = facingSide(A, B);
        const route = connectorRoute(a, sa, b, sb)!;
        expect(orthogonal(route)).toBe(true);
        const overlapping = !(
          B.minX > A.maxX ||
          B.maxX < A.minX ||
          B.minY > A.maxY ||
          B.maxY < A.minY
        );
        if (!overlapping) {
          expect(throughInside(route, A, true)).toBe(false);
          expect(throughInside(route, B, true)).toBe(false);
        }
        expect(bends(route)).toBeLessThanOrEqual(4);
      }
    }
  });

  it("has a route even when nothing clean exists (one shape inside the other)", () => {
    const route = routeElbow(
      { x: 50, y: 50 },
      "right",
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { x: 40, y: 50 },
      "left",
      { minX: 40, minY: 40, maxX: 60, maxY: 60 },
    );
    expect(route.length).toBeGreaterThanOrEqual(2);
  });

  it("has nothing for a shape without points; bounds grow by the pad", () => {
    expect(connectorRoute([], "left", box(0, 0, 10, 10), "right")).toBeNull();
    expect(routeBounds([0, 0, 10, 20], 3)).toEqual({ minX: -3, minY: -3, maxX: 13, maxY: 23 });
    expect(routeBounds([], 3)).toBeNull();
  });

  it("clears each shape by the stub before its first bend", () => {
    const route = connectorRoute(box(0, 0, 100, 60), "bottom", box(300, 200, 100, 60), "left")!;
    const p = pairs(route);
    // Down out of the bottom, at least the stub past the shape, before turning.
    expect(p[1][1]).toBeGreaterThanOrEqual(60 + CONNECTOR_STUB - 1e-9);
  });
});

describe("which side faces", () => {
  it("picks the side towards the other shape, along the axis they are further apart on", () => {
    const a = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
    expect(facingSide(a, { minX: 300, minY: 10, maxX: 400, maxY: 70 })).toBe("left");
    expect(facingSide(a, { minX: -300, minY: 10, maxX: -200, maxY: 70 })).toBe("right");
    expect(facingSide(a, { minX: 20, minY: 200, maxX: 120, maxY: 260 })).toBe("top");
    expect(facingSide(a, { minX: 20, minY: -200, maxX: 120, maxY: -140 })).toBe("bottom");
  });
});

describe("where a linked copy goes", () => {
  const b = { minX: 100, minY: 100, maxX: 200, maxY: 160 };

  it("a tap: beside the original on that side, a gap away", () => {
    expect(besideOffset(b, "right", 40)).toEqual({ x: 140, y: 0 });
    expect(besideOffset(b, "top", 40)).toEqual({ x: 0, y: -100 });
  });

  it("a drag: its near edge at the pen, centred across the drag", () => {
    // Dragged out of the right side to (400, 300): the copy's left edge at x 400, its middle at y 300.
    const d = draggedOffset(b, "right", { x: 400, y: 300 });
    expect(b.minX + d.x).toBe(400);
    expect((b.minY + b.maxY) / 2 + d.y).toBe(300);
  });
});

describe("nearestSide", () => {
  // Joost, 2026-10-29: an arrow dropped on a shape meets it where it was dropped.
  const b = { minX: 100, minY: 100, maxX: 300, maxY: 200 };

  it("outside the box: the edge nearest the drop", () => {
    expect(nearestSide(b, { x: 200, y: 60 })).toBe("top");
    expect(nearestSide(b, { x: 200, y: 260 })).toBe("bottom");
    expect(nearestSide(b, { x: 40, y: 150 })).toBe("left");
    expect(nearestSide(b, { x: 360, y: 150 })).toBe("right");
    // Off a corner: whichever edge is nearer.
    expect(nearestSide(b, { x: 320, y: 90 })).toBe("top");
    expect(nearestSide(b, { x: 330, y: 105 })).toBe("right");
  });

  it("inside the box: the edge it is closest to", () => {
    expect(nearestSide(b, { x: 200, y: 110 })).toBe("top");
    expect(nearestSide(b, { x: 290, y: 150 })).toBe("right");
    expect(nearestSide(b, { x: 110, y: 160 })).toBe("left");
    expect(nearestSide(b, { x: 180, y: 195 })).toBe("bottom");
  });
});
