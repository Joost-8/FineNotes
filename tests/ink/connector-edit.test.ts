import { describe, expect, it } from "vitest";
import {
  FIT_TOLERANCE,
  connectorHandles,
  dragConnector,
  isEndHandle,
  runSamples,
  splinePoints,
  tidyElbow,
} from "../../src/ink/connector-edit";
import { POINT_STRIDE } from "../../src/model/document";

type P = { x: number; y: number };

function flat(points: P[], p = 0.5): number[] {
  return points.flatMap((q) => [q.x, q.y, p]);
}

function pointsOf(pts: number[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pts.length; i += POINT_STRIDE) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

function nearestDistance(p: P, pts: number[]): number {
  return Math.min(...pointsOf(pts).map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
}

describe("a straight line", () => {
  const line = flat([
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ]);

  it("gets a ring on each end and a dot in the middle", () => {
    const h = connectorHandles("line", line);
    expect(h?.kind).toBe("curve");
    expect(h?.at).toEqual([0, 0, 100, 0, 200, 0]);
    expect(h?.looks).toEqual(["ring", "dot", "ring"]);
    expect(isEndHandle(h!, 0)).toBe(true);
    expect(isEndHandle(h!, 1)).toBe(false);
    expect(isEndHandle(h!, 2)).toBe(true);
  });

  it("dragging the middle dot bends it into a curve through the dot", () => {
    const h = connectorHandles("line", line)!;
    const bent = dragConnector("line", h, 1, { x: 100, y: 60 })!;
    expect(bent.kind).toBe("path");
    const pts = pointsOf(bent.pts);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 0 });
    expect(nearestDistance({ x: 100, y: 60 }, bent.pts)).toBe(0);
    // Smooth: no sample turns sharply from the one before.
    for (let i = 2; i < pts.length; i++) {
      const a = Math.atan2(pts[i - 1].y - pts[i - 2].y, pts[i - 1].x - pts[i - 2].x);
      const b = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
      expect(Math.abs(b - a)).toBeLessThan(0.3);
    }
    // At least the contract's 25 points of a curve, and the pressure kept.
    expect(pts.length).toBeGreaterThanOrEqual(25);
    expect(bent.pts[2]).toBe(0.5);
  });

  it("moving an end keeps it a straight line", () => {
    const h = connectorHandles("line", line)!;
    const moved = dragConnector("line", h, 2, { x: 150, y: 80 })!;
    expect(moved).toEqual({ kind: "line", pts: [0, 0, 0.5, 150, 80, 0.5] });
  });

  it("refuses an end dragged onto the other", () => {
    const h = connectorHandles("line", line)!;
    expect(dragConnector("line", h, 2, { x: 0.2, y: 0 })).toBeNull();
    expect(dragConnector("line", h, 2, { x: NaN, y: 0 })).toBeNull();
  });
});

describe("a curve", () => {
  const knots = [
    { x: 0, y: 0 },
    { x: 100, y: 60 },
    { x: 200, y: 0 },
  ];

  it("is read back from its samples: its bend point is a ring, with a dot either side", () => {
    const pts = splinePoints(knots, 0.5);
    const h = connectorHandles("path", pts)!;
    expect(h.kind).toBe("curve");
    expect(h.knots).toEqual(knots);
    expect(h.looks).toEqual(["ring", "dot", "ring", "dot", "ring"]);
    // The dots lie on the curve.
    for (const i of [1, 3]) {
      expect(nearestDistance({ x: h.at[i * 2], y: h.at[i * 2 + 1] }, pts)).toBeLessThan(2);
    }
  });

  it("a half-way dot adds a bend point, and the curve passes through all of them", () => {
    const h = connectorHandles("path", splinePoints(knots, 0.5))!;
    const more = dragConnector("path", h, 3, { x: 160, y: 80 })!;
    const again = connectorHandles("path", more.pts)!;
    expect(again.knots).toEqual([...knots.slice(0, 2), { x: 160, y: 80 }, knots[2]]);
    for (const k of again.knots) expect(nearestDistance(k, more.pts)).toBe(0);
  });

  it("moving a bend point moves the curve through it, the ends staying", () => {
    const h = connectorHandles("path", splinePoints(knots, 0.5))!;
    const moved = dragConnector("path", h, 2, { x: 100, y: -40 })!;
    const again = connectorHandles("path", moved.pts)!;
    expect(again.knots).toEqual([knots[0], { x: 100, y: -40 }, knots[2]]);
  });

  it("samples every run alike, more of them on a long one", () => {
    expect(runSamples(knots)).toBe(20);
    expect(
      runSamples([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(16);
    const pts = splinePoints(knots, 0.5);
    expect(pts.length / POINT_STRIDE).toBe(2 * 20 + 1);
  });

  it("stops adding dots at the most bend points", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ x: i * 40, y: i % 2 ? 30 : 0 }));
    const h = connectorHandles("path", splinePoints(many, 0.5))!;
    expect(h.looks.every((look) => look === "ring")).toBe(true);
  });

  it("fits a smooth path made elsewhere, within the tolerance", () => {
    // An arc of a circle, sampled as a held arrow's curve is.
    const arc: P[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * (i / 40);
      arc.push({ x: 100 - 100 * Math.cos(a), y: -60 * Math.sin(a) });
    }
    const h = connectorHandles("path", flat(arc))!;
    expect(h.kind).toBe("curve");
    expect(h.knots[0]).toEqual(arc[0]);
    const line = splinePoints(h.knots, 0.5);
    for (const p of arc) expect(nearestDistance(p, line)).toBeLessThan(FIT_TOLERANCE + 2);
  });

  it("leaves a path of slanted straight runs to its corner handles", () => {
    const zig = flat([
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ]);
    expect(connectorHandles("path", zig)).toBeNull();
  });

  it("is only for lines and paths", () => {
    expect(connectorHandles("rect", flat(knots))).toBeNull();
    expect(connectorHandles(undefined, flat(knots))).toBeNull();
    expect(connectorHandles("path", [0, 0, 0.5])).toBeNull();
  });
});

describe("an elbow", () => {
  // Across, then down: an L.
  const L = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
  ];

  it("gets a ring on each end and a pill on each run", () => {
    const h = connectorHandles("path", flat(L))!;
    expect(h.kind).toBe("elbow");
    expect(h.at).toEqual([0, 0, 100, 0, 200, 50, 200, 100]);
    expect(h.looks).toEqual(["ring", "pill-x", "pill-y", "ring"]);
  });

  it("sliding the upright run out makes a U, in makes a Z, the ends staying", () => {
    const h = connectorHandles("path", flat(L))!;
    const u = dragConnector("path", h, 2, { x: 260, y: 30 })!;
    expect(pointsOf(u.pts)).toEqual([
      { x: 0, y: 0 },
      { x: 260, y: 0 },
      { x: 260, y: 100 },
      { x: 200, y: 100 },
    ]);
    const z = dragConnector("path", h, 2, { x: 80, y: 30 })!;
    expect(pointsOf(z.pts)).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it("sliding the first run moves it off its end and adds a run back", () => {
    const h = connectorHandles("path", flat(L))!;
    const moved = dragConnector("path", h, 1, { x: 120, y: -40 })!;
    expect(pointsOf(moved.pts)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -40 },
      { x: 200, y: -40 },
      { x: 200, y: 100 },
    ]);
  });

  it("a middle run slides its corners with it, and every run stays square", () => {
    const z = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 100 },
      { x: 200, y: 100 },
    ];
    const h = connectorHandles("path", flat(z))!;
    const moved = dragConnector("path", h, 2, { x: 150, y: 10 })!;
    expect(pointsOf(moved.pts)).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 100 },
      { x: 200, y: 100 },
    ]);
    // Slid onto the end's line, the last run goes: an L again.
    const back = dragConnector("path", h, 2, { x: 200, y: 10 })!;
    expect(pointsOf(back.pts)).toEqual(L);
  });

  it("moving an end slides its run along, so it stays level", () => {
    const h = connectorHandles("path", flat(L))!;
    const moved = dragConnector("path", h, 0, { x: -20, y: 30 })!;
    expect(pointsOf(moved.pts)).toEqual([
      { x: -20, y: 30 },
      { x: 200, y: 30 },
      { x: 200, y: 100 },
    ]);
    expect(moved.kind).toBe("path");
  });

  it("tidies runs of no length and corners on a straight run", () => {
    expect(
      tidyElbow([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
  });
});
