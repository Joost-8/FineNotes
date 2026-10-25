/**
 * `src/canvas/ruler-geometry.ts` — where the ruler lies, which edge a pen is
 * near, where the pen lands once it follows it, and how fingers move it.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULER_SNAP,
  PROTRACTOR_RADIUS,
  RULER_KINDS,
  RULER_MAX_LENGTH,
  RULER_MIN_LENGTH,
  RULER_REACH_PX,
  RULER_WIDTH,
  type RulerEdge,
  type RulerPose,
  type RulerPt,
  SQUARE_LEG,
  dragPose,
  edgeDistance,
  hitsRuler,
  keepInPane,
  nearestEdge,
  normalizeAngle,
  offsetEdge,
  openingPose,
  projectOntoEdge,
  protractorTicks,
  readoutAngle,
  rulerEdges,
  rulerMiddle,
  rulerSettingsOf,
  rulerSpecFor,
  rulerTicks,
  snapAngle,
  snapTolerance,
  squareCorners,
  stepTurn,
  swapKind,
  toRuler,
  toScreen,
  twoFingerPose,
} from "../../src/canvas/ruler-geometry";

const near = (a: RulerPt, b: RulerPt, eps = 1e-9): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(eps);
  expect(Math.abs(a.y - b.y)).toBeLessThan(eps);
};

/** How far the points stray from the straight line through the first and last, px. */
function straightness(points: readonly RulerPt[]): number {
  const a = points[0];
  const b = points[points.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.max(
    ...points.map((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len),
  );
}

describe("normalizeAngle", () => {
  it("folds any angle into (-180, 180] and never returns -0", () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(720)).toBe(0);
    expect(Object.is(normalizeAngle(-0), 0)).toBe(true);
    expect(Object.is(normalizeAngle(-360), 0)).toBe(true);
    expect(normalizeAngle(Number.NaN)).toBe(0);
  });
});

describe("frames", () => {
  it("toRuler undoes toScreen at any turn", () => {
    const pose = { x: 300, y: 200, angle: 37 };
    const p = { x: 12, y: -40 };
    near(toRuler(pose, toScreen(pose, p)), p);
  });

  it("turns clockwise on screen (y runs down)", () => {
    near(toScreen({ x: 0, y: 0, angle: 90 }, { x: 10, y: 0 }), { x: 0, y: 10 });
  });
});

describe("rulerSpecFor", () => {
  it("fits the straight ruler to the pane, within its bounds", () => {
    expect(rulerSpecFor("straight", 800).length).toBe(640);
    expect(rulerSpecFor("straight", 200).length).toBe(RULER_MIN_LENGTH);
    expect(rulerSpecFor("straight", 4000).length).toBe(RULER_MAX_LENGTH);
    expect(rulerSpecFor("straight", 0).length).toBe(RULER_MIN_LENGTH);
  });

  it("gives the set square and the protractor their fixed sizes", () => {
    expect(rulerSpecFor("square", 800).length).toBe(SQUARE_LEG);
    expect(rulerSpecFor("protractor", 800).length).toBe(PROTRACTOR_RADIUS);
  });
});

describe("following an edge", () => {
  const spec = { kind: "straight" as const, length: 600 };

  it("stores a wobbly line along a tilted edge perfectly straight", () => {
    const pose = { x: 400, y: 300, angle: -23 };
    const edges = rulerEdges(spec, pose);
    // A hand wobbling up to 7 px either side of the top edge, starting just outside it.
    const top = edges[0] as Extract<RulerEdge, { type: "line" }>;
    const dirX = (top.b.x - top.a.x) / 600;
    const dirY = (top.b.y - top.a.y) / 600;
    const nx = dirY;
    const ny = -dirX;
    const raw: RulerPt[] = [];
    for (let i = 0; i <= 120; i++) {
      const along = 40 + i * 4;
      const off = -6 + 7 * Math.sin(i * 0.37) + 2 * Math.sin(i * 1.9);
      raw.push({ x: top.a.x + dirX * along + nx * off, y: top.a.y + dirY * along + ny * off });
    }
    const edge = nearestEdge(edges, raw[0], RULER_REACH_PX);
    expect(edge).toBe(0);
    const followed = raw.map((p) => projectOntoEdge(edges[edge], p));
    expect(straightness(followed)).toBeLessThan(1e-9);
    // On the edge itself, at the ruler's angle.
    for (const p of followed) expect(edgeDistance(top, p)).toBeLessThan(1e-9);
    const angle = Math.atan2(
      followed[followed.length - 1].y - followed[0].y,
      followed[followed.length - 1].x - followed[0].x,
    );
    expect((angle * 180) / Math.PI).toBeCloseTo(-23, 9);
  });

  it("finds an edge from either side, within the reach only", () => {
    const pose = { x: 0, y: 0, angle: 0 };
    const edges = rulerEdges(spec, pose);
    const top = -RULER_WIDTH / 2;
    expect(nearestEdge(edges, { x: 0, y: top - 10 }, RULER_REACH_PX)).toBe(0);
    expect(nearestEdge(edges, { x: 0, y: top + 10 }, RULER_REACH_PX)).toBe(0);
    expect(nearestEdge(edges, { x: 0, y: -top + 3 }, RULER_REACH_PX)).toBe(1);
    expect(nearestEdge(edges, { x: 0, y: top - RULER_REACH_PX - 1 }, RULER_REACH_PX)).toBe(-1);
    // The middle of the ruler is beyond both edges' reach.
    expect(nearestEdge(edges, { x: 0, y: 0 }, RULER_REACH_PX)).toBe(-1);
  });

  it("does not count a pen beside the ruler's end as at its edge", () => {
    const edges = rulerEdges(spec, { x: 0, y: 0, angle: 0 });
    expect(edgeDistance(edges[0], { x: 310, y: -RULER_WIDTH / 2 })).toBe(Infinity);
    expect(nearestEdge(edges, { x: 310, y: -RULER_WIDTH / 2 }, RULER_REACH_PX)).toBe(-1);
  });

  it("keeps a line that runs on past the end at the end", () => {
    const edges = rulerEdges(spec, { x: 0, y: 0, angle: 0 });
    near(projectOntoEdge(edges[0], { x: 900, y: -50 }), { x: 300, y: -RULER_WIDTH / 2 });
    near(projectOntoEdge(edges[0], { x: -900, y: 0 }), { x: -300, y: -RULER_WIDTH / 2 });
  });

  it("degrades on a zero-length edge rather than dividing by zero", () => {
    const edge: RulerEdge = { type: "line", a: { x: 1, y: 1 }, b: { x: 1, y: 1 } };
    expect(edgeDistance(edge, { x: 2, y: 2 })).toBe(Infinity);
    near(projectOntoEdge(edge, { x: 5, y: 5 }), { x: 1, y: 1 });
  });

  it("follows the protractor's arc, and only across its top half", () => {
    const pose = { x: 200, y: 300, angle: 0 };
    const pspec = { kind: "protractor" as const, length: 100 };
    const edges = rulerEdges(pspec, pose);
    expect(edges.map((e) => e.type)).toEqual(["arc", "line"]);
    // Just outside the top of the arc.
    const p = { x: 200, y: 300 - 110 };
    expect(nearestEdge(edges, p, RULER_REACH_PX)).toBe(0);
    near(projectOntoEdge(edges[0], p), { x: 200, y: 200 });
    // Every point the arc gives is on the circle.
    for (let i = 0; i < 30; i++) {
      const q = projectOntoEdge(edges[0], {
        x: 200 + 130 * Math.cos(i),
        y: 300 + 90 * Math.sin(i),
      });
      expect(Math.hypot(q.x - 200, q.y - 300)).toBeCloseTo(100, 9);
      expect(q.y).toBeLessThanOrEqual(300 + 1e-9);
    }
    // Below the base, the arc is not there; a point there lands on its nearer end.
    expect(edgeDistance(edges[0], { x: 200, y: 400 })).toBe(Infinity);
    near(projectOntoEdge(edges[0], { x: 290, y: 320 }), { x: 300, y: 300 });
    near(projectOntoEdge(edges[0], { x: 110, y: 320 }), { x: 100, y: 300 });
  });

  it("turns the arc with the protractor", () => {
    const edges = rulerEdges({ kind: "protractor", length: 100 }, { x: 0, y: 0, angle: 90 });
    // Turned a quarter clockwise, the arc's top faces right.
    near(projectOntoEdge(edges[0], { x: 120, y: 0 }), { x: 100, y: 0 });
    expect(edgeDistance(edges[0], { x: -120, y: 0 })).toBe(Infinity);
  });

  it("gives the set square three edges meeting at its corners", () => {
    const pose = { x: 50, y: 60, angle: 30 };
    const edges = rulerEdges({ kind: "square", length: 240 }, pose);
    expect(edges).toHaveLength(3);
    const [right, foot, top] = squareCorners(240).map((p) => toScreen(pose, p));
    const lines = edges as Array<Extract<RulerEdge, { type: "line" }>>;
    near(lines[0].a, right, 1e-9);
    near(lines[0].b, foot, 1e-9);
    near(lines[1].a, top, 1e-9);
    near(lines[2].b, foot, 1e-9);
  });
});

describe("offsetEdge", () => {
  it("moves each edge outwards, away from the ruler's middle", () => {
    const straight = { kind: "straight" as const, length: 600 };
    const pose = { x: 0, y: 0, angle: 0 };
    const middle = rulerMiddle(straight, pose);
    const [top, bottom] = rulerEdges(straight, pose).map((e) => offsetEdge(e, 3, middle));
    expect(top).toEqual({ type: "line", a: { x: -300, y: -39 }, b: { x: 300, y: -39 } });
    expect(bottom).toEqual({ type: "line", a: { x: -300, y: 39 }, b: { x: 300, y: 39 } });
  });

  it("moves the protractor's arc out and its base down", () => {
    const spec = { kind: "protractor" as const, length: 100 };
    const pose = { x: 10, y: 20, angle: 0 };
    const [arc, base] = rulerEdges(spec, pose).map((e) =>
      offsetEdge(e, 2, rulerMiddle(spec, pose)),
    );
    expect(arc.type === "arc" && arc.r).toBe(102);
    near((base as Extract<RulerEdge, { type: "line" }>).a, { x: -90, y: 22 });
  });

  it("moves the set square's long edge away from its corner", () => {
    const spec = { kind: "square" as const, length: 240 };
    const pose = { x: 0, y: 0, angle: 0 };
    const long = offsetEdge(rulerEdges(spec, pose)[2], 4, rulerMiddle(spec, pose));
    // Up and to the right, square to the edge.
    const line = long as Extract<RulerEdge, { type: "line" }>;
    near(line.a, { x: -80 + 4 / Math.SQRT2, y: -160 - 4 / Math.SQRT2 }, 1e-9);
  });

  it("leaves an edge alone for no offset or no length", () => {
    const edge: RulerEdge = { type: "line", a: { x: 1, y: 1 }, b: { x: 1, y: 1 } };
    expect(offsetEdge(edge, 3, { x: 0, y: 0 })).toBe(edge);
    const real: RulerEdge = { type: "line", a: { x: 0, y: 0 }, b: { x: 5, y: 0 } };
    expect(offsetEdge(real, 0, { x: 0, y: 1 })).toBe(real);
  });
});

describe("hitsRuler", () => {
  it("takes a finger on the straight ruler, with a little slop", () => {
    const spec = { kind: "straight" as const, length: 400 };
    const pose = { x: 0, y: 0, angle: 45 };
    expect(hitsRuler(spec, pose, toScreen(pose, { x: 190, y: 30 }))).toBe(true);
    expect(hitsRuler(spec, pose, toScreen(pose, { x: 190, y: 40 }))).toBe(false);
    expect(hitsRuler(spec, pose, toScreen(pose, { x: 190, y: 40 }), 6)).toBe(true);
    expect(hitsRuler(spec, pose, toScreen(pose, { x: 210, y: 0 }))).toBe(false);
  });

  it("takes the protractor's half disc only", () => {
    const spec = { kind: "protractor" as const, length: 100 };
    const pose = { x: 0, y: 0, angle: 0 };
    expect(hitsRuler(spec, pose, { x: 0, y: -50 })).toBe(true);
    expect(hitsRuler(spec, pose, { x: 0, y: 20 })).toBe(false);
    expect(hitsRuler(spec, pose, { x: 80, y: -80 })).toBe(false);
  });

  it("takes the set square's triangle, not the corner beyond its long edge", () => {
    const spec = { kind: "square" as const, length: 240 };
    const pose = { x: 0, y: 0, angle: 0 };
    expect(hitsRuler(spec, pose, { x: 0, y: 0 })).toBe(true);
    expect(hitsRuler(spec, pose, { x: -70, y: 70 })).toBe(true);
    // Beyond the long edge (up and right of it).
    expect(hitsRuler(spec, pose, { x: 100, y: -100 })).toBe(false);
    expect(hitsRuler(spec, pose, { x: -90, y: 0 })).toBe(false);
    expect(hitsRuler(spec, pose, { x: 0, y: 90 })).toBe(false);
  });
});

describe("snapAngle", () => {
  it("settles near a step and turns freely between", () => {
    expect(snapAngle(13, 15)).toBe(15);
    expect(snapAngle(33, 15)).toBe(30);
    expect(snapAngle(22, 15)).toBe(22);
    expect(snapAngle(-47, 15)).toBe(-45);
  });

  it("pulls harder to level and upright", () => {
    expect(snapTolerance(15)).toEqual({ step: 5, cardinal: 10 });
    expect(snapAngle(9, 15)).toBe(0);
    expect(snapAngle(81, 15)).toBe(90);
    expect(snapAngle(-171, 15)).toBe(180);
    expect(snapAngle(268, 15)).toBe(-90);
    // But a step away from level still holds its own.
    expect(snapAngle(14, 15)).toBe(15);
  });

  it("never lets the pull to level swallow the neighbouring step", () => {
    const tol = snapTolerance(5);
    expect(tol.cardinal).toBeLessThan(5 - tol.step + 1e-9);
    expect(snapAngle(5, 5)).toBe(5);
    expect(snapAngle(3, 5)).toBe(0);
    expect(snapAngle(6.5, 5)).toBe(5);
    expect(snapAngle(7.5, 5)).toBe(7.5);
  });

  it("snaps a turn that rounding left a hair outside the pull", () => {
    expect(snapAngle(-20.000000000000018, 15)).toBe(-15);
  });

  it("does nothing with snapping off", () => {
    expect(snapAngle(1, 0)).toBe(1);
    expect(snapAngle(89.5, 0)).toBe(89.5);
    expect(snapTolerance(0)).toEqual({ step: 0, cardinal: 0 });
  });
});

describe("moving the ruler", () => {
  it("slides under one finger without turning", () => {
    expect(dragPose({ x: 1, y: 2, angle: 30 }, 10, -5)).toEqual({ x: 11, y: -3, angle: 30 });
  });

  it("turns about the fingers' midpoint, which stays under them", () => {
    const start: RulerPose = { x: 100, y: 100, angle: 0 };
    const from = [
      { x: 90, y: 100 },
      { x: 110, y: 100 },
    ] as const;
    // A quarter turn about (100, 100)'s right neighbour (130, 100).
    const pivot = { x: 130, y: 100 };
    const around = (p: RulerPt): RulerPt => ({
      x: pivot.x - (p.y - pivot.y),
      y: pivot.y + (p.x - pivot.x),
    });
    const fromAt = [
      { x: 120, y: 100 },
      { x: 140, y: 100 },
    ] as const;
    const to = [around(fromAt[0]), around(fromAt[1])] as const;
    const pose = twoFingerPose(start, fromAt, to, 0);
    expect(pose.angle).toBeCloseTo(90, 9);
    // The ruler's point under the midpoint stays under it.
    const under = toRuler(start, pivot);
    near(toScreen(pose, under), pivot, 1e-9);
    // Fingers that only move together slide it.
    const slid = twoFingerPose(
      start,
      from,
      [
        { x: 95, y: 110 },
        { x: 115, y: 110 },
      ],
      15,
    );
    expect(slid).toEqual({ x: 105, y: 110, angle: 0 });
  });

  it("snaps the turn, so a near-level turn lands level", () => {
    const start: RulerPose = { x: 0, y: 0, angle: 0 };
    const from = [
      { x: -50, y: 0 },
      { x: 50, y: 0 },
    ] as const;
    const turn = (deg: number): readonly [RulerPt, RulerPt] => {
      const r = (deg * Math.PI) / 180;
      return [
        { x: -50 * Math.cos(r), y: -50 * Math.sin(r) },
        { x: 50 * Math.cos(r), y: 50 * Math.sin(r) },
      ];
    };
    expect(twoFingerPose(start, from, turn(7), 15).angle).toBe(0);
    expect(twoFingerPose(start, from, turn(28), 15).angle).toBe(30);
    expect(twoFingerPose(start, from, turn(22), 15).angle).toBeCloseTo(22, 9);
  });

  it("only slides when the fingers sit on top of each other", () => {
    const pose = twoFingerPose(
      { x: 0, y: 0, angle: 10 },
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      [
        { x: 9, y: 5 },
        { x: 9, y: 5.2 },
      ],
      15,
    );
    expect(pose.angle).toBe(10);
  });

  it("steps a turn with the wheel, onto the snapping grid", () => {
    const pose = stepTurn({ x: 0, y: 0, angle: 7 }, { x: 0, y: 0 }, 1, 15);
    expect(pose.angle).toBe(15);
    expect(stepTurn({ x: 0, y: 0, angle: 7 }, { x: 0, y: 0 }, -1, 0).angle).toBe(6);
    // About the pivot: the pivot's point does not move.
    const turned = stepTurn({ x: 100, y: 0, angle: 0 }, { x: 0, y: 0 }, 1, 45);
    expect(turned.angle).toBe(45);
    expect(Math.hypot(turned.x, turned.y)).toBeCloseTo(100, 9);
  });
});

describe("opening and keeping it on screen", () => {
  it("comes out level in the middle of the pane", () => {
    expect(openingPose({ kind: "straight", length: 600 }, 800, 1000)).toEqual({
      x: 400,
      y: 500,
      angle: 0,
    });
    // The protractor's middle, not its base, at the middle.
    expect(openingPose({ kind: "protractor", length: 160 }, 800, 1000).y).toBe(580);
  });

  it("keeps the middle and the turn when the kind changes", () => {
    const from = { kind: "straight" as const, length: 600 };
    const to = { kind: "protractor" as const, length: 160 };
    const pose = { x: 300, y: 200, angle: 90 };
    const swapped = swapKind(pose, from, to);
    expect(swapped.angle).toBe(90);
    // The protractor's middle sits 80 px above its base; turned a quarter, 80 px to the right of it.
    near(toScreen(swapped, { x: 0, y: -80 }), { x: 300, y: 200 }, 1e-9);
    near(swapKind(swapped, to, from), pose, 1e-9);
  });

  it("brings a ruler left off screen back within reach", () => {
    const spec = { kind: "straight" as const, length: 600 };
    const kept = keepInPane(spec, { x: 2000, y: -50, angle: 30 }, 800, 600);
    expect(kept).toEqual({ x: 800, y: 0, angle: 30 });
    const inside = { x: 300, y: 300, angle: 0 };
    expect(keepInPane(spec, inside, 800, 600)).toBe(inside);
    expect(keepInPane(spec, inside, 0, 0)).toBe(inside);
  });
});

describe("rulerTicks", () => {
  it("marks millimetres, half centimetres and centimetres at a readable zoom", () => {
    const ticks = rulerTicks(100, 5);
    expect(ticks).toHaveLength(21);
    expect(ticks[0]).toEqual({ at: 0, mm: 0, level: 2, label: "0" });
    expect(ticks[1]).toEqual({ at: 5, mm: 1, level: 0 });
    expect(ticks[5]).toEqual({ at: 25, mm: 5, level: 1 });
    expect(ticks[10]).toEqual({ at: 50, mm: 10, level: 2, label: "1" });
  });

  it("drops the millimetres when they would run together, and spaces the numbers", () => {
    const ticks = rulerTicks(300, 1.5);
    // 1 mm is 1.5 px: half centimetres are the finest marks.
    expect(ticks[1].mm).toBe(5);
    expect(ticks[1].level).toBe(0);
    expect(ticks.find((t) => t.mm === 10)?.level).toBe(1);
    // 1 cm is 15 px, too close for numbers; 5 cm is 75 px.
    expect(ticks.filter((t) => t.label).map((t) => t.label)).toEqual(["0", "5", "10", "15", "20"]);
    expect(ticks.find((t) => t.mm === 50)?.level).toBe(2);
  });

  it("puts a mark on the end when the length is a whole number of them", () => {
    expect(rulerTicks(50, 5).at(-1)?.mm).toBe(10);
  });

  it("gives nothing for a zoom or a length that makes no sense", () => {
    expect(rulerTicks(0, 5)).toEqual([]);
    expect(rulerTicks(100, 0)).toEqual([]);
    expect(rulerTicks(100, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(rulerTicks(100, 0.001)).toEqual([]);
  });
});

describe("protractorTicks", () => {
  it("marks every degree and numbers every ten", () => {
    const ticks = protractorTicks();
    expect(ticks).toHaveLength(181);
    expect(ticks.filter((t) => t.label)).toHaveLength(19);
    expect(ticks[45].level).toBe(1);
    expect(ticks[90]).toEqual({ deg: 90, level: 2, label: "90" });
  });
});

describe("readoutAngle", () => {
  it("reads 0–90 from level, whichever way round the ruler lies", () => {
    expect(readoutAngle(0)).toBe(0);
    expect(readoutAngle(-30)).toBe(30);
    expect(readoutAngle(30)).toBe(30);
    expect(readoutAngle(150)).toBe(30);
    expect(readoutAngle(-150)).toBe(30);
    expect(readoutAngle(180)).toBe(0);
    expect(readoutAngle(90)).toBe(90);
    expect(readoutAngle(-90)).toBe(90);
    expect(readoutAngle(-0.2)).toBe(0);
    expect(readoutAngle(45.4)).toBe(45);
  });
});

describe("rulerSettingsOf", () => {
  it("keeps what it knows and falls back on the rest", () => {
    expect(rulerSettingsOf({ kind: "protractor", snap: 45 })).toEqual({
      kind: "protractor",
      snap: 45,
    });
    expect(rulerSettingsOf({ kind: "toString", snap: 7 })).toEqual({
      kind: "straight",
      snap: DEFAULT_RULER_SNAP,
    });
    expect(rulerSettingsOf(null)).toEqual({ kind: "straight", snap: DEFAULT_RULER_SNAP });
    expect(rulerSettingsOf("x")).toEqual({ kind: "straight", snap: DEFAULT_RULER_SNAP });
    expect(rulerSettingsOf({ snap: 0 }).snap).toBe(0);
    expect(RULER_KINDS).toEqual(["straight", "square", "protractor"]);
  });
});
