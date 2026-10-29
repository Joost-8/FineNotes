/**
 * Pencil tilt (src/ink/tilt.ts): reading it, the missing-reading rule, the
 * look-back smoothing, the width curve, and carrying it into eraser pieces.
 */

import { describe, expect, it } from "vitest";
import {
  TILT_FULL,
  TILT_MAX_FACTOR,
  TILT_START,
  TiltFilter,
  altitudeOf,
  tiltAlong,
  tiltFactor,
  tiltShapes,
  widestTiltFactor,
} from "../../src/ink/tilt";
import { eraseCircleFromStroke, eraseRectsFromStroke } from "../../src/ink/stroke-eraser";
import type { Stroke } from "../../src/model/document";
import { pencilStroke, tiltsOf } from "./tilt-synth";

describe("tiltFactor", () => {
  it("leaves a writing grip alone and widens a flat pen up to the most", () => {
    for (const altitude of [90, 70, 55, TILT_START]) expect(tiltFactor(altitude)).toBe(1);
    for (const altitude of [TILT_FULL, 10, 0]) expect(tiltFactor(altitude)).toBe(TILT_MAX_FACTOR);
    expect(tiltFactor(30)).toBeCloseTo(2, 10);
  });

  it("rises smoothly as the pen leans: never down, never a jump", () => {
    let before = tiltFactor(90);
    for (let altitude = 90; altitude >= 0; altitude -= 0.1) {
      const now = tiltFactor(altitude);
      expect(now).toBeGreaterThanOrEqual(before);
      // At most 12% per degree on the steepest part.
      expect(now - before).toBeLessThan(0.013);
      before = now;
    }
  });

  it("reads anything not a number as upright", () => {
    expect(tiltFactor(Number.NaN)).toBe(1);
    expect(tiltFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("altitudeOf", () => {
  it("takes altitudeAngle when the browser gives it", () => {
    expect(altitudeOf({ altitudeAngle: Math.PI / 6, tiltX: 0, tiltY: 0 })).toBeCloseTo(30, 10);
  });

  it("works it out from tiltX and tiltY otherwise, for any lean and direction", () => {
    for (const altitude of [5, 20, 45, 60, 85]) {
      for (const azimuth of [0, 40, 135, 200, 300]) {
        expect(altitudeOf(tiltsOf(altitude, azimuth))).toBeCloseTo(altitude, 6);
      }
    }
  });

  it("is upright for 0/0, flat at ±90, and NaN when the event says nothing", () => {
    expect(altitudeOf({ tiltX: 0, tiltY: 0 })).toBe(90);
    expect(altitudeOf({ tiltX: 90, tiltY: 0 })).toBe(0);
    expect(altitudeOf({ tiltX: -12, tiltY: -90 })).toBe(0);
    expect(altitudeOf({})).toBeNaN();
    expect(altitudeOf({ tiltX: Number.NaN, tiltY: 3 })).toBeNaN();
    expect(altitudeOf({ altitudeAngle: Number.NaN })).toBeNaN();
  });
});

describe("TiltFilter", () => {
  it("has nothing before the first reading, and a missing one repeats the last", () => {
    const filter = new TiltFilter();
    expect(filter.next(Number.NaN, 0)).toBeNaN();
    expect(filter.next(40, 4)).toBe(40);
    expect(filter.next(Number.NaN, 8)).toBe(40);
  });

  it("takes an upright reading straight after a lean as a dropout, not a reading", () => {
    const filter = new TiltFilter();
    filter.next(30, 0);
    expect(filter.next(90, 4)).toBe(30);
    // π/2 radians, converted, is a hair under 90 and still a dropout.
    expect(filter.next(altitudeOf({ altitudeAngle: Math.PI / 2 }), 8)).toBe(30);
  });

  it("does take upright from a pen that was near upright already", () => {
    const filter = new TiltFilter();
    filter.next(88, 0);
    expect(filter.next(90, 1000)).toBeCloseTo(90, 6);
  });

  it("steadies whole-degree tilt (WebKit before Safari 18.2) and follows the hand", () => {
    const stroke = pencilStroke({ wholeDegrees: true, seed: 3 });
    const filter = new TiltFilter();
    let worstTrueStep = 0;
    let worstRawStep = 0;
    let worstStep = 0;
    let worstLag = 0;
    let trueBefore = Number.NaN;
    let rawBefore = Number.NaN;
    let before = Number.NaN;
    const step = (a: number, b: number): number => Math.abs(tiltFactor(a) / tiltFactor(b) - 1);
    for (const sample of stroke) {
      const raw = altitudeOf(sample);
      const stored = filter.next(raw, sample.t);
      if (Number.isFinite(before)) {
        worstTrueStep = Math.max(worstTrueStep, step(sample.trueAltitude, trueBefore));
        worstRawStep = Math.max(worstRawStep, step(raw, rawBefore));
        worstStep = Math.max(worstStep, step(stored, before));
      }
      worstLag = Math.max(worstLag, Math.abs(stored - sample.trueAltitude));
      trueBefore = sample.trueAltitude;
      rawBefore = raw;
      before = stored;
    }
    // The hand's own lean moves the width ~3% a sample at its fastest.
    // Unsmoothed, whole degrees add steps well past that.
    expect(worstRawStep).toBeGreaterThan(worstTrueStep + 0.02);
    // Smoothed, the width moves about as the hand does.
    expect(worstStep).toBeLessThan(worstTrueStep + 0.01);
    // And it keeps up: within a couple of degrees of the hand.
    expect(worstLag).toBeLessThan(2.5);
  });

  it("copies its state", () => {
    const filter = new TiltFilter();
    filter.next(40, 0);
    const copy = filter.copy();
    copy.next(20, 100);
    expect(filter.current).toBe(40);
    expect(copy.current).toBeLessThan(40);
  });
});

describe("which strokes keep their tilt", () => {
  it("keeps it only where it widened the stroke", () => {
    expect(tiltShapes([55, 60, 50])).toBe(false);
    expect(tiltShapes([55, TILT_START, 50])).toBe(false);
    expect(tiltShapes([55, 44.9, 50])).toBe(true);
    expect(tiltShapes([Number.NaN])).toBe(false);
  });

  it("knows the most a stroke's tilt widens it", () => {
    expect(widestTiltFactor(undefined)).toBe(1);
    expect(widestTiltFactor([])).toBe(1);
    expect(widestTiltFactor([60, 30, 50])).toBeCloseTo(2, 10);
    expect(widestTiltFactor([60, 10])).toBe(TILT_MAX_FACTOR);
  });
});

/** A brush stroke written with the synthetic Pencil, its altitudes kept as read. */
function tiltedStroke(): Stroke {
  const pts: number[] = [];
  const tilt: number[] = [];
  for (const sample of pencilStroke({ count: 120, seed: 11 })) {
    pts.push(sample.x, sample.y, sample.pressure);
    tilt.push(altitudeOf(sample));
  }
  return { id: "s1", color: "#000000", size: 5.4, tool: "pen", pts, tilt };
}

function ids(): () => string {
  let n = 0;
  return () => `p${++n}`;
}

describe("eraser pieces keep the tilt along them", () => {
  it("hands every piece one altitude per point, as the stroke had there", () => {
    const stroke = tiltedStroke();
    const mid = 60 * 3;
    const pieces = eraseCircleFromStroke(stroke, stroke.pts[mid], stroke.pts[mid + 1], 6, ids());
    expect(pieces?.length).toBe(2);
    for (const piece of pieces ?? []) {
      expect(piece.tilt?.length).toBe(piece.pts.length / 3);
      for (let i = 0; i < piece.pts.length; i += 3) {
        // A point the stroke had keeps its altitude exactly.
        for (let k = 0; k < stroke.pts.length; k += 3) {
          if (stroke.pts[k] === piece.pts[i] && stroke.pts[k + 1] === piece.pts[i + 1]) {
            expect(piece.tilt?.[i / 3]).toBe(stroke.tilt?.[k / 3]);
          }
        }
      }
    }
    // The cut ends lie between the altitudes on either side of them.
    const first = pieces?.[0];
    const end = first?.tilt?.[first.tilt.length - 1] ?? Number.NaN;
    const n = (first?.pts.length ?? 0) / 3;
    const a = stroke.tilt?.[n - 2] ?? Number.NaN;
    const b = stroke.tilt?.[n - 1] ?? Number.NaN;
    expect(end).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
    expect(end).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
  });

  it("walks a stroke that goes back over itself in order", () => {
    // Out along a line leaning flat, back along the same line upright.
    const pts: number[] = [];
    const tilt: number[] = [];
    for (let i = 0; i <= 40; i++) {
      pts.push(10 + i * 2, 50, 0.5);
      tilt.push(20);
    }
    for (let i = 39; i >= 0; i--) {
      pts.push(10 + i * 2, 50, 0.5);
      tilt.push(60);
    }
    const stroke: Stroke = { id: "s1", color: "#000000", size: 2, tool: "pen", pts, tilt };
    const pieces = eraseRectsFromStroke(
      stroke,
      [{ minX: 48, maxX: 52, minY: 40, maxY: 60 }],
      ids(),
    );
    expect(pieces?.length).toBe(3);
    // Out, the far end and back, then back: the first is flat, the last upright.
    expect(pieces?.[0].tilt?.every((altitude) => altitude === 20)).toBe(true);
    expect(pieces?.[2].tilt?.every((altitude) => altitude === 60)).toBe(true);
  });

  it("cuts a tilted stroke out to its widest edge", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 40; i++) pts.push(10 + i * 2, 50, 0.5);
    const flat: Stroke = { id: "s1", color: "#000000", size: 5.4, tool: "pen", pts };
    flat.tilt = new Array<number>(41).fill(15);
    const upright: Stroke = { ...flat, tilt: undefined };
    // A circle just past the upright stroke's edge, inside the flat one's.
    const x = 50;
    const y = 50 + 4.5;
    expect(eraseCircleFromStroke(upright, x, y, 1, ids())).toBeNull();
    expect(eraseCircleFromStroke(flat, x, y, 1, ids())).not.toBeNull();
  });

  it("leaves a stroke without tilt, and a shape, without it", () => {
    const stroke = { ...tiltedStroke(), tilt: undefined };
    const mid = 60 * 3;
    const pieces = eraseCircleFromStroke(stroke, stroke.pts[mid], stroke.pts[mid + 1], 6, ids());
    for (const piece of pieces ?? []) expect(piece.tilt).toBeUndefined();
    const shape: Stroke = { ...tiltedStroke(), shape: "line" };
    const cut = eraseCircleFromStroke(shape, shape.pts[mid], shape.pts[mid + 1], 6, ids());
    for (const piece of cut ?? []) expect(piece.tilt).toBeUndefined();
  });

  it("refuses a point that is not on the stroke", () => {
    expect(tiltAlong([0, 0, 0.5, 10, 0, 0.5], [30, 60], [5, 3, 0.5])).toBeNull();
    expect(tiltAlong([0, 0, 0.5, 10, 0, 0.5], [30, 60], [5, 0, 0.5])?.tilt).toEqual([45]);
  });
});
