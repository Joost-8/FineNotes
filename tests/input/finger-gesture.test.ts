/**
 * `src/input/finger-gesture.ts` on its own. The controller's suite covers the
 * same rules end to end with pointer events; this one pins the module's own
 * contract: what each call reports, and what it returns.
 */

import { describe, expect, it } from "vitest";
import { FingerGesture, type FingerGestureListener } from "../../src/input/finger-gesture";

function gesture(): { g: FingerGesture; log: string[] } {
  const log: string[] = [];
  const listener: FingerGestureListener = {
    onPanStart: (x, y, t) => log.push(`panStart ${x},${y} t=${t}`),
    onPanMove: (x, y, t) => log.push(`panMove ${x},${y} t=${t}`),
    onPanEnd: (t) => log.push(`panEnd t=${t}`),
    onPanCancel: () => log.push("panCancel"),
    onPinchStart: (x, y) => log.push(`pinchStart ${x},${y}`),
    onPinch: (i) => log.push(`pinch x${i.scaleFactor} at ${i.centerX},${i.centerY}`),
    onPinchEnd: () => log.push("pinchEnd"),
  };
  return { g: new FingerGesture(listener), log };
}

describe("FingerGesture", () => {
  it("pans with one finger", () => {
    const { g, log } = gesture();
    expect(g.active).toBe(false);
    expect(g.down(1, 10, 20, 100)).toBe(true);
    expect(g.active).toBe(true);
    g.move(1, 15, 30, 116);
    expect(g.lift(1, 132)).toBe(true);
    expect(g.active).toBe(false);
    expect(log).toEqual(["panStart 10,20 t=100", "panMove 15,30 t=116", "panEnd t=132"]);
  });

  it("pinches with two, each step relative to the last, about the midpoint", () => {
    const { g, log } = gesture();
    g.down(1, 0, 0, 1);
    g.down(2, 0, 30, 2);
    g.move(2, 0, 40, 3);
    g.move(1, 0, -40, 4);
    expect(log).toEqual([
      "panStart 0,0 t=1",
      "pinchStart 0,15",
      "panStart 0,15 t=2",
      "pinch x1.3333333333333333 at 0,20",
      "panMove 0,20 t=3",
      "pinch x2 at 0,0",
      "panMove 0,0 t=4",
    ]);
  });

  it("measures the spread as a distance, whatever the direction", () => {
    const { g, log } = gesture();
    g.down(1, 0, 0, 1);
    g.down(2, 3, 4, 2);
    g.move(2, -6, -8, 3);
    expect(log[log.length - 2]).toBe("pinch x2 at -3,-4");
  });

  it("restarts the pan wherever the fingers are when one joins or leaves", () => {
    const { g, log } = gesture();
    g.down(1, 0, 0, 1);
    g.down(2, 100, 0, 2);
    log.length = 0;
    expect(g.lift(1, 3)).toBe(true);
    expect(g.lift(2, 4)).toBe(true);
    expect(log).toEqual(["pinchEnd", "panStart 100,0 t=3", "panEnd t=4"]);
  });

  it("starts a fresh pinch for the next pair after a cancel", () => {
    const { g, log } = gesture();
    g.down(1, 0, 0, 1);
    g.down(2, 100, 0, 2);
    g.cancel();
    g.down(3, 0, 0, 3);
    log.length = 0;
    g.down(4, 10, 0, 4);
    expect(log).toEqual(["pinchStart 5,0", "panStart 5,0 t=4"]);
  });

  it("leaves out a third finger, and says so", () => {
    const { g, log } = gesture();
    g.down(1, 0, 0, 1);
    g.down(2, 10, 0, 2);
    log.length = 0;
    expect(g.down(3, 50, 50, 3)).toBe(false);
    g.move(3, 60, 60, 4);
    expect(g.lift(3, 5)).toBe(false);
    expect(log).toEqual([]);
  });

  it("takes a finger reported down again as the same finger, even with two down", () => {
    const { g, log } = gesture();
    g.down(1, 0, 0, 1);
    g.down(2, 10, 0, 2);
    log.length = 0;
    expect(g.down(2, 20, 0, 3)).toBe(true);
    g.move(1, -20, 0, 4);
    expect(log).toEqual(["panStart 10,0 t=3", "pinch x2 at 0,0", "panMove 0,0 t=4"]);
  });

  it("holds back the first pinch step until the fingers have spread", () => {
    const { g, log } = gesture();
    g.down(1, 5, 5, 1);
    g.down(2, 5, 5, 2);
    g.move(2, 5, 15, 3);
    g.move(2, 5, 25, 4);
    expect(log.slice(3)).toEqual(["panMove 5,10 t=3", "pinch x2 at 5,15", "panMove 5,15 t=4"]);
  });

  it("cancels by dropping every finger and naming them", () => {
    const { g, log } = gesture();
    expect(g.cancel()).toEqual([]);
    expect(log).toEqual([]);
    g.down(7, 0, 0, 1);
    g.down(3, 1, 1, 2);
    log.length = 0;
    expect(g.cancel()).toEqual([7, 3]);
    expect(g.active).toBe(false);
    expect(log).toEqual(["panCancel"]);
    g.move(7, 5, 5, 3);
    expect(g.lift(3, 4)).toBe(false);
    expect(log).toEqual(["panCancel"]);
  });

  it("works with a listener that takes nothing", () => {
    const g = new FingerGesture({});
    g.down(1, 0, 0, 1);
    g.down(2, 10, 0, 2);
    g.move(2, 20, 0, 3);
    g.lift(1, 4);
    g.lift(2, 5);
    g.down(1, 0, 0, 6);
    expect(g.cancel()).toEqual([1]);
  });
});
