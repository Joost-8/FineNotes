/**
 * How a turn settles (src/canvas/turn-snap.ts, FineNotes discussion #51,
 * Joost's rule on PR #59): onto every 45° of the page, whatever angle the
 * item started at, free in between, and no flicker at a detent's edge.
 */

import { describe, expect, it } from "vitest";
import { STEP_DEG, TurnSnap, shapeAngleOf } from "../../src/canvas/turn-snap";

const DEG = Math.PI / 180;
const deg = (radians: number): number => Math.round((radians / DEG) * 100) / 100;

/** Feed a sweep of angles (degrees) through one turn; the turns shown, in degrees. */
function sweep(snap: TurnSnap, degrees: number[]): number[] {
  return degrees.map((d) => deg(snap.turn(d * DEG)));
}

/** A rectangle's outline, `w` by `h`, turned `angle` degrees about its first corner. */
function rect(w: number, h: number, angle: number): number[] {
  const c = Math.cos(angle * DEG);
  const s = Math.sin(angle * DEG);
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
    [0, 0],
  ].flatMap(([x, y]) => [x * c - y * s, x * s + y * c, 0.5]);
}

describe("TurnSnap", () => {
  it("snaps every 45° of the page and nothing between", () => {
    expect(STEP_DEG).toBe(45);
    // A turn circle 80 px across: 14 px of arc is 10°, clamped to 8°.
    const snap = new TurnSnap(80);
    expect(sweep(snap, [20, 30, 40, 44, 50, 60, 70, 88, 105, 120, 135.5])).toEqual([
      20, 30, 45, 45, 45, 60, 70, 90, 105, 120, 135,
    ]);
    // The old 15° steps are gone.
    expect(deg(new TurnSnap(200).turn(30.8 * DEG))).toBe(30.8);
  });

  it("lands a crooked shape on clean page angles, never 89° or 179°", () => {
    // A rectangle drawn 2° off level, its page angle 2°.
    const snap = new TurnSnap(80, 2 * DEG);
    // Near its start the turn is caught at −2°: level on the page.
    expect(deg(snap.turn(-1 * DEG))).toBe(-2);
    expect(deg(snap.pageAngle(snap.turn(-1 * DEG)))).toBe(0);
    // A quarter turn lands at 88° of turn: 90° on the page.
    expect(deg(snap.turn(89 * DEG))).toBe(88);
    expect(deg(snap.pageAngle(snap.turn(89 * DEG)))).toBe(90);
    expect(deg(snap.pageAngle(snap.turn(178 * DEG)))).toBe(180);
    expect(deg(snap.pageAngle(snap.turn(44 * DEG)))).toBe(45);
  });

  it("holds the start when the item already sits on a page step, so a tap or wobble turns nothing", () => {
    const snap = new TurnSnap(80);
    expect(sweep(snap, [0, 1.5, -2, 4, -3.5, 6])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(snap.snapped).toBe(true);
    // A picture already turned 45°: its start is a page step too.
    expect(deg(new TurnSnap(80, 45 * DEG).turn(3 * DEG))).toBe(0);
  });

  it("does not hold an item off the page steps where it started", () => {
    // 20° on the page: 0 is no detent, so a small turn shows as it is.
    const snap = new TurnSnap(80, 20 * DEG);
    expect(snap.snapped).toBe(false);
    expect(deg(snap.turn(5 * DEG))).toBe(5);
    // And 25° of turn brings it to 45° on the page.
    expect(deg(snap.turn(22 * DEG))).toBe(25);
  });

  it("lets go only a little past where it caught: no flicker at the edge", () => {
    const snap = new TurnSnap(80);
    sweep(snap, [60, 70]);
    expect(deg(snap.turn(82.5 * DEG))).toBe(90);
    expect(sweep(snap, [81.5, 82.5, 81, 82, 79])).toEqual([90, 90, 90, 90, 90]);
    // Well past it (8° × 1.5): free.
    expect(deg(snap.turn(77 * DEG))).toBe(77);
  });

  it("measures the detents along the turn's circle on screen: a large circle catches less of an angle", () => {
    const near = new TurnSnap(60);
    const far = new TurnSnap(600);
    for (const s of [near, far]) s.turn(60 * DEG);
    expect(deg(near.turn(85 * DEG))).toBe(90);
    expect(deg(far.turn(85 * DEG))).toBe(85);
    // But even a large circle keeps a 3° detent.
    expect(deg(far.turn(87.5 * DEG))).toBe(90);
  });

  it("wraps a turn past a half turn, and ignores what is not a number", () => {
    const snap = new TurnSnap(80);
    snap.turn(60 * DEG);
    expect(deg(snap.turn(200 * DEG))).toBe(-160);
    expect(deg(snap.turn(NaN))).toBe(-160);
    expect(deg(snap.turn(181 * DEG))).toBe(180);
    expect(deg(snap.pageAngle(181 * DEG))).toBe(-179);
    expect(deg(new TurnSnap(80, NaN).pageAngle(10 * DEG))).toBe(10);
  });
});

describe("shapeAngleOf", () => {
  it("is the direction of the longest edge, an edge having no direction", () => {
    expect(deg(shapeAngleOf(rect(200, 100, 7))!)).toBe(7);
    expect(deg(shapeAngleOf(rect(100, 200, 7))!)).toBe(-83);
    // Drawn the other way round, the same line.
    expect(deg(shapeAngleOf([100, 0, 0.5, 0, 0, 0.5])!)).toBe(0);
    expect(deg(shapeAngleOf([0, 0, 0.5, -100, -100, 0.5])!)).toBe(45);
  });

  it("is the long axis of a curve, and nothing for a round one", () => {
    const ellipse = (tilt: number, rx: number, ry: number): number[] => {
      const pts: number[] = [];
      const c = Math.cos(tilt * DEG);
      const s = Math.sin(tilt * DEG);
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * 2 * Math.PI;
        const x = rx * Math.cos(t);
        const y = ry * Math.sin(t);
        pts.push(x * c - y * s, x * s + y * c, 0.5);
      }
      return pts;
    };
    expect(deg(shapeAngleOf(ellipse(30, 100, 40))!)).toBeCloseTo(30, 1);
    expect(shapeAngleOf(ellipse(30, 50, 48))).toBeNull();
  });

  it("nothing for a dot or a stroke that never moved", () => {
    expect(shapeAngleOf([5, 5, 0.5])).toBeNull();
    expect(shapeAngleOf([5, 5, 0.5, 5, 5, 0.5])).toBeNull();
    expect(shapeAngleOf([])).toBeNull();
  });
});
