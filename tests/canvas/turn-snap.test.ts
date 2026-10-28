/**
 * How a knob's turn settles (src/canvas/turn-snap.ts, FineNotes discussion
 * #51): held where it started, detents at quarter turns, level and every
 * 15°, free between them, and no flicker at a detent's edge.
 */

import { describe, expect, it } from "vitest";
import { STEP_DEG, TurnSnap, levelTurnOf } from "../../src/canvas/turn-snap";

const DEG = Math.PI / 180;
const deg = (radians: number): number => Math.round((radians / DEG) * 100) / 100;

/** Feed a sweep of angles (degrees) through one turn; the turns shown, in degrees. */
function sweep(snap: TurnSnap, degrees: number[]): number[] {
  return degrees.map((d) => deg(snap.turn(d * DEG)));
}

describe("TurnSnap", () => {
  it("turns nothing for a tap or a wobble at the start", () => {
    // A knob 80 px from the middle: 9 px of arc is 6.4°.
    const snap = new TurnSnap(80);
    expect(sweep(snap, [0, 1.5, -2, 4, -3.5, 6])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(snap.snapped).toBe(true);
  });

  it("lets go of the start once the pen has really moved, then turns freely", () => {
    const snap = new TurnSnap(80);
    const shown = sweep(snap, [5, 10, 22, 37]);
    expect(shown[0]).toBe(0);
    expect(shown[1]).toBe(10);
    expect(shown[2]).toBe(22);
    expect(shown[3]).toBe(37);
    expect(snap.snapped).toBe(false);
  });

  it("lands on quarter turns from several degrees away", () => {
    const snap = new TurnSnap(80);
    expect(sweep(snap, [40, 70, 84, 88, 93, 96])).toEqual([40, 70, 90, 90, 90, 90]);
  });

  it("holds a 15° step lightly: caught within a degree or two, free just past", () => {
    const snap = new TurnSnap(200);
    // At 200 px, a light detent catches within 6 px of arc (1.7°).
    expect(sweep(snap, [25, 29, 30, 31.5, 34])).toEqual([25, 30, 30, 30, 34]);
  });

  it("lets a 15° step go soon after sweeping through it, so free angles stay easy", () => {
    // Measured in the rig at 5x (knob 133 px out): a turn swept through 30°
    // to 33° stayed at 30° with the first release band. Now it lets go.
    const snap = new TurnSnap(133);
    expect(sweep(snap, [20, 26, 29, 30, 31, 33])).toEqual([20, 26, 30, 30, 30, 33]);
  });

  it("lets go only a little past where it caught: no flicker at the edge", () => {
    const snap = new TurnSnap(80);
    sweep(snap, [40, 60]);
    // The quarter turn catches within 8° here (14 px at 80 px, clamped).
    expect(deg(snap.turn(82.5 * DEG))).toBe(90);
    // Back and forth around where it caught: still held.
    expect(sweep(snap, [81.5, 82.5, 81, 82])).toEqual([90, 90, 90, 90]);
    // Well past it: free.
    expect(deg(snap.turn(72 * DEG))).toBe(72);
  });

  it("measures the detents along the knob's arc on screen: a far knob catches less of an angle", () => {
    const near = new TurnSnap(60);
    const far = new TurnSnap(600);
    for (const s of [near, far]) s.turn(50 * DEG);
    // 85°: 5° short of a quarter turn.
    expect(deg(near.turn(85 * DEG))).toBe(90);
    expect(deg(far.turn(85 * DEG))).toBe(85);
    // But even a far knob keeps a 3° detent at quarter turns.
    expect(deg(far.turn(87.5 * DEG))).toBe(90);
  });

  it("lands a tilted shape level: the turn that levels its main edge is a strong detent", () => {
    // A rectangle drawn 7° off: turning it back by 7° levels it.
    const snap = new TurnSnap(80, -7 * DEG);
    expect(sweep(snap, [-20, -11, -9])).toEqual([-20, -7, -7]);
    // And so are the quarter turns from there.
    expect(deg(snap.turn(80 * DEG))).toBe(83);
  });

  it("keeps any angle between the detents", () => {
    const snap = new TurnSnap(120);
    for (const d of [-170, -52, -21, 8, 21, 52, 67, 112, 141, 172]) {
      const shown = deg(snap.turn(d * DEG));
      const nearStep = Math.abs(d / STEP_DEG - Math.round(d / STEP_DEG)) * STEP_DEG;
      if (nearStep > 3) expect(shown).toBe(d);
    }
  });

  it("wraps a turn past a half turn, and ignores what is not a number", () => {
    const snap = new TurnSnap(80);
    snap.turn(60 * DEG);
    expect(deg(snap.turn(200 * DEG))).toBe(-160);
    expect(deg(snap.turn(NaN))).toBe(-160);
    expect(deg(snap.turn(181 * DEG))).toBe(180);
  });
});

describe("levelTurnOf", () => {
  it("the turn that brings the longest edge level or upright", () => {
    // A rectangle 7° off level: its long edge first.
    const c = Math.cos(7 * DEG);
    const s = Math.sin(7 * DEG);
    const corners = [
      [0, 0],
      [200 * c, 200 * s],
      [200 * c - 100 * s, 200 * s + 100 * c],
      [-100 * s, 100 * c],
      [0, 0],
    ].flatMap(([x, y]) => [x, y, 0.5]);
    expect(deg(levelTurnOf(corners)!)).toBe(-7);
    // A line 80° off level: upright is nearer.
    expect(
      deg(levelTurnOf([0, 0, 0.5, Math.cos(80 * DEG) * 100, Math.sin(80 * DEG) * 100, 0.5])!),
    ).toBe(10);
  });

  it("nothing for a level edge, a dot or a curve", () => {
    expect(levelTurnOf([0, 0, 0.5, 100, 0, 0.5])).toBeNull();
    expect(levelTurnOf([5, 5, 0.5, 5, 5, 0.5])).toBeNull();
    expect(levelTurnOf([5, 5, 0.5])).toBeNull();
    const curve: number[] = [];
    for (let i = 0; i <= 64; i++) curve.push(Math.cos(i / 10) * 50, Math.sin(i / 10) * 30, 0.5);
    expect(levelTurnOf(curve)).toBeNull();
  });
});
