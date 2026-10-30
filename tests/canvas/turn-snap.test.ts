/**
 * How a turn settles (src/canvas/turn-snap.ts, FineNotes discussion #51,
 * Joost's rule on PR #59): onto every 45° of the page, whatever angle the
 * item started at, free in between, and no flicker at a detent's edge.
 */

import { describe, expect, it } from "vitest";
import { STEP_DEG, TurnSnap, shapeAngleOf } from "../../src/canvas/turn-snap";

const DEG = Math.PI / 180;
const deg = (radians: number): number => Math.round((radians / DEG) * 100) / 100;

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
  it("draws the turn gently toward the page's 45° steps", () => {
    expect(STEP_DEG).toBe(45);
    // A circle 80 px across pulls within 9° (16 px of arc, clamped).
    const snap = new TurnSnap(80);
    // 2° past 45°: shown 0.9° past it, pulled but not held.
    expect(deg(snap.turn(47 * DEG))).toBeCloseTo(45.91, 1);
    // At the step itself, exactly there.
    expect(deg(snap.turn(45 * DEG))).toBe(45);
    // Outside the pull, as the hand has it.
    expect(deg(snap.turn(30 * DEG))).toBe(30);
    expect(deg(snap.turn(54 * DEG))).toBe(54);
  });

  it("never stops: sweeping through a step, the turn keeps moving, and has no jump at the pull's edge", () => {
    const snap = new TurnSnap(80);
    let previous = -Infinity;
    for (let d = 20; d <= 70; d += 0.25) {
      const shown = snap.turn(d * DEG);
      // Always onward, and at least 0.3 of the hand's quarter degree.
      expect(shown - previous).toBeGreaterThan(0.3 * 0.25 * DEG - 1e-9);
      // And never more than twice it: no jump.
      if (previous > -Infinity) expect(shown - previous).toBeLessThan(2 * 0.25 * DEG);
      previous = shown;
    }
  });

  it("lands on the step exactly on the lift when the turn ends close to it", () => {
    const snap = new TurnSnap(80);
    snap.turn(48 * DEG);
    expect(deg(snap.settled())).toBe(45);
    snap.turn(50 * DEG);
    // 5° off, past the inner half of the 9° pull: kept as shown.
    expect(deg(snap.settled())).toBeCloseTo(deg(snap.turn(50 * DEG)), 9);
    expect(deg(snap.settled())).not.toBe(45);
  });

  it("is page-absolute: a shape drawn 2° off lands on 90° of the page, never 89°", () => {
    const snap = new TurnSnap(80, 2 * DEG);
    snap.turn(89 * DEG);
    expect(deg(snap.settled())).toBe(88);
    expect(deg(snap.pageAngle(snap.settled()))).toBe(90);
    snap.turn(-1 * DEG);
    expect(deg(snap.pageAngle(snap.settled()))).toBe(0);
    snap.turn(178.5 * DEG);
    expect(deg(snap.pageAngle(snap.settled()))).toBe(180);
  });

  it("marks the readout only on a step", () => {
    const snap = new TurnSnap(80);
    snap.turn(45.4 * DEG);
    expect(snap.snapped).toBe(true);
    snap.turn(48 * DEG);
    expect(snap.snapped).toBe(false);
  });

  it("measures the pull along the turn's circle on screen: a large circle pulls a smaller angle", () => {
    const near = new TurnSnap(60);
    const far = new TurnSnap(600);
    // 5° short of a quarter turn: inside the near circle's 9° pull, outside the far one's 3°.
    expect(deg(near.turn(85 * DEG))).not.toBe(85);
    expect(deg(far.turn(85 * DEG))).toBe(85);
    far.turn(89 * DEG);
    expect(deg(far.settled())).toBe(90);
  });

  it("wraps a turn past a half turn, and ignores what is not a number", () => {
    const snap = new TurnSnap(80);
    expect(deg(snap.turn(200 * DEG))).toBe(-160);
    expect(deg(snap.turn(NaN))).toBe(-160);
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
