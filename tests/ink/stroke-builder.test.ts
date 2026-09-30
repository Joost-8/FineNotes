import { describe, expect, it } from "vitest";
import { FALLBACK_PRESSURE, MIN_SAMPLE_DISTANCE } from "../../src/constants";
import { StrokeBuilder, mapPressure } from "../../src/ink/stroke-builder";

describe("mapPressure on one reading", () => {
  const on = { minDistance: 1, pressureEnabled: true, fallbackPressure: 0.35 };

  it("stores a reading as it is, capped at 1", () => {
    expect(mapPressure(0.42, on)).toBe(0.42);
    expect(mapPressure(1, on)).toBe(1);
    expect(mapPressure(3, on)).toBe(1);
  });

  it("stores the fallback without a reading, or with pressure off", () => {
    expect(mapPressure(0, on)).toBe(0.35);
    expect(mapPressure(-0.1, on)).toBe(0.35);
    expect(mapPressure(Number.NaN, on)).toBe(0.35);
    expect(mapPressure(0.9, { ...on, pressureEnabled: false })).toBe(0.35);
  });
});

describe("StrokeBuilder spacing", () => {
  it("keeps the first sample, then those at least minDistance from the last one kept", () => {
    const pen = new StrokeBuilder({ minDistance: 5 });
    expect(pen.isEmpty).toBe(true);
    expect(pen.add({ x: 20, y: 30, pressure: 0.4 })).toBe(true);
    expect(pen.isEmpty).toBe(false);
    // Exactly 5 away is far enough.
    expect(pen.add({ x: 23, y: 34, pressure: 0.4 })).toBe(true);
    // 4.92 from (23, 34): dropped, and not a new reference either.
    expect(pen.add({ x: 26, y: 37.9, pressure: 0.4 })).toBe(false);
    expect(pen.add({ x: 23, y: 39.1, pressure: 0.4 })).toBe(true);
    expect(pen.length).toBe(3);
    expect(pen.points()).toEqual([20, 30, 0.4, 23, 34, 0.4, 23, 39.1, 0.4]);
  });

  it("keeps the pen-up sample however close it is", () => {
    const pen = new StrokeBuilder({ minDistance: 5 });
    pen.add({ x: 10, y: 10, pressure: 0.4 });
    expect(pen.addFinal({ x: 10, y: 10.5, pressure: 0.6 })).toBe(true);
    expect(pen.points()).toHaveLength(6);
  });

  it("spaces samples MIN_SAMPLE_DISTANCE apart by default", () => {
    const pen = new StrokeBuilder();
    pen.add({ x: 50, y: 0, pressure: 0.4 });
    expect(pen.add({ x: 50, y: MIN_SAMPLE_DISTANCE * 0.9, pressure: 0.4 })).toBe(false);
    expect(pen.add({ x: 50, y: MIN_SAMPLE_DISTANCE, pressure: 0.4 })).toBe(true);
  });

  it("hands out copies of its points", () => {
    const pen = new StrokeBuilder();
    pen.add({ x: 1, y: 2, pressure: 0.4 });
    pen.points().fill(7);
    expect(pen.points()).toEqual([1, 2, 0.4]);
  });

  it("stores the fallback everywhere with pressure off", () => {
    const pen = new StrokeBuilder({
      pressureEnabled: false,
      fallbackPressure: 0.7,
      minDistance: 0,
    });
    pen.add({ x: 0, y: 0, pressure: 0.2 });
    pen.add({ x: 1, y: 0, pressure: 0.9 });
    expect(pen.points()).toEqual([0, 0, 0.7, 1, 0, 0.7]);
  });
});

describe("StrokeBuilder: a pressure of 0 is no reading (2026-09-24)", () => {
  const pressures = (b: StrokeBuilder): number[] => b.points().filter((_, i) => i % 3 === 2);

  it("ends a stroke at its last pressure, not the 0.5 fallback, on a pen-up reading 0", () => {
    const b = new StrokeBuilder({ minDistance: 0 });
    b.add({ x: 0, y: 0, pressure: 0.2 });
    b.add({ x: 5, y: 0, pressure: 0.25 });
    b.addFinal({ x: 6, y: 0, pressure: 0 });
    expect(pressures(b)).toEqual([0.2, 0.25, 0.25]);
  });

  it("gives a pen-down reading 0 the first real pressure once it arrives", () => {
    const b = new StrokeBuilder({ minDistance: 0 });
    b.add({ x: 0, y: 0, pressure: 0 });
    b.add({ x: 2, y: 0, pressure: 0 });
    b.add({ x: 4, y: 0, pressure: 0.3 });
    expect(pressures(b)).toEqual([0.3, 0.3, 0.3]);
  });

  it("keeps the fallback for a device that never reads pressure (a mouse)", () => {
    const b = new StrokeBuilder({ minDistance: 0 });
    b.add({ x: 0, y: 0, pressure: 0 });
    b.addFinal({ x: 3, y: 0, pressure: 0 });
    expect(pressures(b)).toEqual([FALLBACK_PRESSURE, FALLBACK_PRESSURE]);
  });

  it("ignores readings entirely with pressure off", () => {
    const b = new StrokeBuilder({ minDistance: 0, pressureEnabled: false });
    b.add({ x: 0, y: 0, pressure: 0.9 });
    b.addFinal({ x: 3, y: 0, pressure: 0 });
    expect(pressures(b)).toEqual([FALLBACK_PRESSURE, FALLBACK_PRESSURE]);
  });
});

describe("StrokeBuilder: pressure for what the wet layer draws (2026-09-30)", () => {
  it("draws a guess without a reading at the last real pressure, and keeps nothing", () => {
    const pen = new StrokeBuilder({ minDistance: 1, fallbackPressure: 0.5 });
    expect(pen.peekPressure(0)).toBe(0.5);
    pen.add({ x: 0, y: 0, pressure: 0.22 });
    expect(pen.peekPressure(0)).toBe(0.22);
    expect(pen.peekPressure(0.3)).toBe(0.3);
    expect(pen.peekPressure(4)).toBe(1);
    // A peeked reading is not remembered.
    expect(pen.peekPressure(0)).toBe(0.22);
    expect(pen.length).toBe(1);
    expect(
      new StrokeBuilder({ pressureEnabled: false, fallbackPressure: 0.5 }).peekPressure(0.3),
    ).toBe(0.5);
  });

  it("reports the median reading, or null when the pen read none", () => {
    const pen = new StrokeBuilder({ minDistance: 1 });
    expect(pen.typicalPressure()).toBeNull();
    pen.add({ x: 0, y: 0, pressure: 0 });
    expect(pen.typicalPressure()).toBeNull();
    pen.add({ x: 5, y: 0, pressure: 0.2 });
    pen.add({ x: 10, y: 0, pressure: 0.6 });
    pen.add({ x: 15, y: 0, pressure: 0.3 });
    // 0.2 (backfilled), 0.2, 0.6, 0.3
    expect(pen.typicalPressure()).toBeCloseTo(0.25, 9);
    pen.addFinal({ x: 15, y: 1, pressure: 0.4 });
    expect(pen.typicalPressure()).toBe(0.3);
    const off = new StrokeBuilder({ pressureEnabled: false });
    off.add({ x: 0, y: 0, pressure: 0.4 });
    expect(off.typicalPressure()).toBeNull();
  });
});
