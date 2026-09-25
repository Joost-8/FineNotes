/**
 * Point-to-ink hit testing, as the eraser, tap-to-select and the circle
 * lasso's hold use it: a point hits a stroke when it lies within `radius` of
 * the polyline through its points (inclusive), or of the point itself for a
 * stroke of exactly one point.
 */

import { describe, expect, it } from "vitest";
import { distToSegmentSq, strokeHitByPoint } from "../../src/canvas/hit-test";
import type { Stroke } from "../../src/model/document";

function ink(pts: number[]): Stroke {
  return { id: "s", color: "#000000", size: 3, tool: "pen", pts };
}

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

/** Distance to a segment the long way round: the nearer end, or the foot of the perpendicular. */
function reference(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ends = Math.min(Math.hypot(px - ax, py - ay), Math.hypot(px - bx, py - by));
  const len = Math.hypot(bx - ax, by - ay);
  if (len === 0) return ends;
  const along = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len;
  if (along <= 0 || along >= len) return ends;
  const across = Math.abs((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / len;
  return Math.min(ends, across);
}

describe("distToSegmentSq", () => {
  it("measures to the foot of the perpendicular inside the segment", () => {
    expect(distToSegmentSq(3, -4, 0, 0, 8, 0)).toBe(16);
    expect(distToSegmentSq(0, 0, -5, 5, 5, -5)).toBe(0);
  });

  it("measures to the nearer end outside it", () => {
    expect(distToSegmentSq(12, 3, 0, 0, 8, 0)).toBe(25);
    expect(distToSegmentSq(-1, -1, 0, 0, 8, 0)).toBe(2);
  });

  it("treats a segment of no length as its point", () => {
    expect(distToSegmentSq(4, 7, 1, 3, 1, 3)).toBe(25);
  });

  it("agrees with the long way round on random segments", () => {
    const next = rng(4242);
    for (let i = 0; i < 2000; i++) {
      const v = (): number => next() * 400 - 200;
      const [px, py, ax, ay, bx, by] = [v(), v(), v(), v(), v(), v()];
      const d = reference(px, py, ax, ay, bx, by);
      expect(Math.sqrt(distToSegmentSq(px, py, ax, ay, bx, by))).toBeCloseTo(d, 7);
    }
  });

  it("is not a number when an input is not", () => {
    expect(distToSegmentSq(Number.NaN, 0, 0, 0, 1, 0)).toBeNaN();
    expect(distToSegmentSq(0, 0, 0, 0, Number.NaN, 0)).toBeNaN();
  });
});

describe("strokeHitByPoint", () => {
  const zigzag = ink([0, 0, 0.5, 100, 0, 0.5, 100, 80, 0.5, 20, 60, 0.5]);

  it("hits within the radius of any segment, the boundary included", () => {
    expect(strokeHitByPoint(zigzag, 50, 4, 4)).toBe(true);
    expect(strokeHitByPoint(zigzag, 104, 40, 4)).toBe(true);
    expect(strokeHitByPoint(zigzag, 60, 70, 3)).toBe(true);
    expect(strokeHitByPoint(zigzag, 50, 4.01, 4)).toBe(false);
    expect(strokeHitByPoint(zigzag, 50, 40, 10)).toBe(false);
  });

  it("does not close the polyline back to its start", () => {
    expect(strokeHitByPoint(zigzag, 10, 30, 3)).toBe(false);
  });

  it("hits a one-point stroke within the radius of the point", () => {
    const dot = ink([30, 40, 0.5]);
    expect(strokeHitByPoint(dot, 33, 44, 5)).toBe(true);
    expect(strokeHitByPoint(dot, 33, 44, 4.99)).toBe(false);
    expect(strokeHitByPoint(dot, 30, 40, 0)).toBe(true);
  });

  it("never hits a stroke without a whole point", () => {
    expect(strokeHitByPoint(ink([]), 0, 0, 50)).toBe(false);
    expect(strokeHitByPoint(ink([5, 5]), 5, 5, 50)).toBe(false);
  });

  it("uses whole points only: a trailing partial point adds no segment and makes no dot", () => {
    const ragged = ink([0, 0, 0.5, 50, 0, 0.5, 50]);
    expect(strokeHitByPoint(ragged, 25, 1, 2)).toBe(true);
    expect(strokeHitByPoint(ragged, 50, 20, 2)).toBe(false);
    // One whole point and a partial one: not a dot, and no segment either.
    expect(strokeHitByPoint(ink([10, 10, 0.5, 90]), 10, 10, 5)).toBe(false);
  });

  it("never hits with a coordinate that is not a number", () => {
    expect(strokeHitByPoint(zigzag, Number.NaN, 0, 5)).toBe(false);
    expect(strokeHitByPoint(ink([0, 0, 0.5, Number.NaN, 0, 0.5]), 0, 0, 5)).toBe(false);
  });

  it("agrees with the long way round on random strokes", () => {
    const next = rng(777);
    let hits = 0;
    for (let i = 0; i < 1500; i++) {
      const n = 1 + Math.floor(next() * 6);
      const pts: number[] = [];
      for (let k = 0; k < n; k++) pts.push(next() * 300, next() * 300, 0.5);
      const x = next() * 360 - 30;
      const y = next() * 360 - 30;
      const radius = next() * 40;
      let d = n === 1 ? Math.hypot(x - pts[0], y - pts[1]) : Infinity;
      for (let k = 0; k + 5 < pts.length; k += 3) {
        d = Math.min(d, reference(x, y, pts[k], pts[k + 1], pts[k + 3], pts[k + 4]));
      }
      if (Math.abs(d - radius) < 1e-6) continue;
      const hit = strokeHitByPoint(ink(pts), x, y, radius);
      expect(hit).toBe(d <= radius);
      if (hit) hits++;
    }
    expect(hits).toBeGreaterThan(100);
  });
});
