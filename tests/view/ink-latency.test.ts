/**
 * The HUD's pen-to-ink latency (FineNotes#287): each wet paint timed from
 * the newest sample it shows, the input rate, and the stroke start's dot.
 */

import { describe, expect, it } from "vitest";
import { inkRuns, penOptions } from "../../src/ink/freehand";
import { StrokeBuilder } from "../../src/ink/stroke-builder";
import { InkLatency, LATENCY_WINDOW, paintsPenDown, percentile } from "../../src/view/ink-latency";

describe("InkLatency", () => {
  it("says nothing before the first paint", () => {
    expect(new InkLatency().line()).toBe("lat -");
  });

  it("times a paint from the newest sample it shows, and the frame after it", () => {
    const lat = new InkLatency();
    lat.input([100, 104, 102], 106);
    const shown = lat.painted(110);
    expect(shown).toBe(104);
    lat.framed(shown as number, 118);
    expect(lat.line()).toBe("lat ink 6/6ms frame 14/14ms in 0Hz -n/ev");
  });

  it("does not time a paint with no new sample in it", () => {
    const lat = new InkLatency();
    lat.input([100], 101);
    expect(lat.painted(105)).toBe(100);
    // The next frame redraws the tip with nothing new: not a latency.
    expect(lat.painted(113)).toBeNull();
    expect(lat.line()).toContain("ink 5/5ms");
  });

  it("skips samples without a time, and still counts them for the rate", () => {
    const lat = new InkLatency();
    lat.input([undefined], 0);
    expect(lat.painted(5)).toBeNull();
    lat.input([undefined, 8], 8);
    expect(lat.painted(10)).toBe(8);
    // Two samples over the 8 ms since the last event: 250 a second, 2 an event.
    expect(lat.line()).toContain("in 250Hz 2.0n/ev");
  });

  it("leaves pauses between strokes out of the input rate", () => {
    const lat = new InkLatency();
    for (let t = 0; t <= 40; t += 4) lat.input([t], t);
    // The pen lifts for half a second.
    for (let t = 540; t <= 580; t += 4) lat.input([t], t);
    lat.painted(582);
    expect(lat.line()).toContain("in 250Hz 1.0n/ev");
  });

  it("keeps the last paints only, and forgets on reset", () => {
    const lat = new InkLatency();
    for (let i = 0; i < LATENCY_WINDOW; i++) {
      lat.input([i * 10], i * 10);
      lat.painted(i * 10 + 50);
    }
    for (let i = 0; i < LATENCY_WINDOW; i++) {
      const t = 100_000 + i * 10;
      lat.input([t], t);
      lat.painted(t + 5);
    }
    expect(lat.line()).toContain("ink 5/5ms");
    lat.reset();
    expect(lat.line()).toBe("lat -");
  });

  it("takes the median and the 95th percentile", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
  });
});

describe("the dot at pen-down (FineNotes#287)", () => {
  it("paints, unless a reading still to come rewrites the start", () => {
    expect(paintsPenDown(false)).toBe(true);
    expect(paintsPenDown(true)).toBe(false);
  });

  it("awaits a reading only where one would rewrite what is kept", () => {
    const plain = new StrokeBuilder({ minDistance: 1, pressureEnabled: false });
    plain.add({ x: 0, y: 0, pressure: 0 });
    expect(plain.awaitingReading).toBe(false);

    const pressure = new StrokeBuilder({ minDistance: 1, pressureEnabled: true });
    pressure.add({ x: 0, y: 0, pressure: 0 });
    expect(pressure.awaitingReading).toBe(true);
    const revision = pressure.revision;
    pressure.add({ x: 5, y: 0, pressure: 0.3 });
    expect(pressure.revision).not.toBe(revision);
    expect(pressure.awaitingReading).toBe(false);

    const read = new StrokeBuilder({ minDistance: 1, pressureEnabled: true });
    read.add({ x: 0, y: 0, pressure: 0.4 });
    expect(read.awaitingReading).toBe(false);

    const tilt = new StrokeBuilder({ minDistance: 1, tilt: true });
    tilt.add({ x: 0, y: 0, pressure: 0.5 });
    expect(tilt.awaitingReading).toBe(true);
    const tilted = new StrokeBuilder({ minDistance: 1, tilt: true });
    tilted.add({ x: 0, y: 0, pressure: 0.5, altitude: 60 });
    expect(tilted.awaitingReading).toBe(false);
  });

  it("is covered by the stroke it starts: what was drawn stays", () => {
    for (const pressure of [false, true]) {
      const builder = new StrokeBuilder({ minDistance: 1, pressureEnabled: pressure });
      builder.add({ x: 10, y: 10, pressure: 0.35 });
      expect(builder.awaitingReading).toBe(false);
      const dot = inkRuns(builder.points(), penOptions(3, pressure));
      builder.add({ x: 14, y: 11, pressure: 0.4 });
      builder.add({ x: 18, y: 13, pressure: 0.45 });
      const line = inkRuns(builder.points(), penOptions(3, pressure));
      // The dot is the line's first run begun: same width, its points a prefix.
      expect(dot).toHaveLength(1);
      expect(line[0].width).toBe(dot[0].width);
      expect(line[0].pts.slice(0, dot[0].pts.length)).toEqual(dot[0].pts);
    }
  });
});
