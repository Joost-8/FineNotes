/**
 * Rounded input (FineNotes#1): WebKit before iPadOS 26.2 hands over every pen
 * position rounded to a whole screen px, and a stroke drawn through those
 * samples wobbles. `smoothing: "centred"` places each one from the samples
 * on both sides of it (`CENTRED_HALF`). Off, the builder keeps samples
 * exactly.
 */

import { describe, expect, it } from "vitest";
import { CENTRED_HALF, type Smoothing, StrokeBuilder } from "../../src/ink/stroke-builder";

type Sample = { x: number; y: number; pressure: number };

/** A straight line as the reporter's iPad gave it: ~2-4 px steps, rounded to whole px. */
function roundedLine(n = 40, step = 3, angle = 0.62): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(10.3 + i * step * Math.cos(angle)),
    y: Math.round(20.6 + i * step * Math.sin(angle)),
    pressure: 0.3,
  }));
}

/** An arc of radius `r` with exact (unrounded) samples `step` px apart. */
function arc(n: number, r = 20, step = 2): Sample[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i * step) / r;
    return { x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a), pressure: 0.3 };
  });
}

function triples(flat: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/** Distance of each point from the true line through (10.3, 20.6) at `angle`. */
function offLine(pts: number[][], angle = 0.62): number[] {
  const [nx, ny] = [-Math.sin(angle), Math.cos(angle)];
  return pts.map(([x, y]) => Math.abs((x - 10.3) * nx + (y - 20.6) * ny));
}

/** How much the heading changes from one point to the next, degrees, summed. */
function turning(pts: number[][]): number {
  let total = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
    const b = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += Math.abs(d);
  }
  return (total * 180) / Math.PI;
}

const rms = (v: number[]): number => Math.sqrt(v.reduce((s, d) => s + d * d, 0) / v.length);
/** Leave out the ends: the start and the pen-up are taken as they are. */
const mid = (pts: number[][]): number[][] => pts.slice(pts.length / 5, (pts.length * 4) / 5);

function build(
  samples: Sample[],
  options: { smoothing?: Smoothing; densify?: boolean; minDistance?: number },
): number[][] {
  const b = new StrokeBuilder({ minDistance: 1.4, ...options });
  for (const s of samples.slice(0, -1)) b.add(s);
  b.addFinal(samples[samples.length - 1]);
  return triples(b.points());
}

describe("StrokeBuilder smoothing", () => {
  it("is off unless asked for: samples are kept exactly", () => {
    const samples = roundedLine();
    const pts = build(samples, {});
    expect(pts.map(([x, y]) => [x, y])).toEqual(samples.map((s) => [s.x, s.y]));
  });

  describe("centred", () => {
    const smoothing = "centred";
    it("draws a rounded straight line straighter", () => {
      const samples = roundedLine();
      for (const densify of [false, true]) {
        const raw = build(samples, { densify });
        const smooth = build(samples, { densify, smoothing });
        expect(rms(offLine(mid(smooth)))).toBeLessThan(rms(offLine(mid(raw))) * 0.75);
        expect(turning(mid(smooth))).toBeLessThan(turning(mid(raw)) * 0.75);
      }
    });

    it("starts where the pen touched and ends where it lifted", () => {
      const samples = roundedLine(12);
      for (const densify of [false, true]) {
        const pts = build(samples, { densify, smoothing });
        expect(pts[0].slice(0, 2)).toEqual([samples[0].x, samples[0].y]);
        expect(pts[pts.length - 1].slice(0, 2)).toEqual([samples[11].x, samples[11].y]);
      }
    });

    it("only ever appends: points already kept never move", () => {
      for (const densify of [false, true]) {
        const b = new StrokeBuilder({ minDistance: 1.4, smoothing, densify });
        let before: number[] = [];
        for (const s of roundedLine(30)) {
          b.add(s);
          const now = [...b.view];
          expect(now.slice(0, before.length)).toEqual(before);
          before = now;
        }
      }
    });

    it("keeps the pen's pressure: only positions are smoothed", () => {
      const b = new StrokeBuilder({ minDistance: 0.1, smoothing });
      const pressures = [0.2, 0.6, 0.3, 0.7, 0.4, 0.5, 0.25, 0.65, 0.35];
      pressures.forEach((p, i) => b.add({ x: i * 3, y: (i % 2) * 1, pressure: p }));
      b.settle();
      expect(triples(b.view).map((p) => p[2])).toEqual(pressures);
    });
  });

  it("centred keeps a curve's shape: exact samples on an arc stay on it", () => {
    // Away from the ends, where the window is the full quadratic one; the
    // second sample from each end is a 3-point average, 0.07 px inside here.
    const pts = build(arc(40), { smoothing: "centred", minDistance: 0.1 }).slice(2, -2);
    const off = pts.map(([x, y]) => Math.abs(Math.hypot(x - 100, y - 100) - 20));
    expect(Math.max(...off)).toBeLessThan(0.01);
  });

  it("centred holds back the newest samples as the tail, and settles them on lift", () => {
    const b = new StrokeBuilder({ minDistance: 0.1, smoothing: "centred" });
    const samples = roundedLine(10);
    for (const s of samples) b.add(s);
    // Sample i passes once CENTRED_HALF samples follow it (fewer near the start).
    expect(b.view.length / 3).toBe(samples.length - CENTRED_HALF);
    expect(b.tail.map(([x, y]) => [x, y])).toEqual(
      samples.slice(-CENTRED_HALF).map((s) => [s.x, s.y]),
    );
    expect(b.length).toBe(samples.length);
    b.settle();
    expect(b.tail).toEqual([]);
    expect(b.view.length / 3).toBe(samples.length);
  });

  it("centred: points() is what settling would give, and changes nothing", () => {
    for (const densify of [false, true]) {
      const b = new StrokeBuilder({ minDistance: 1.4, smoothing: "centred", densify });
      for (const s of roundedLine(20)) b.add(s);
      const view = [...b.view];
      const tail = b.tail.map((s) => [...s]);
      const settled = b.points();
      expect(b.points()).toEqual(settled);
      expect([...b.view]).toEqual(view);
      expect(b.tail.map((s) => [...s])).toEqual(tail);
      b.settle();
      expect([...b.view]).toEqual(settled);
    }
  });

  it("centred: the pen's first pressure reading reaches the samples still held", () => {
    const b = new StrokeBuilder({
      minDistance: 0.1,
      smoothing: "centred",
      fallbackPressure: 0.5,
    });
    for (let i = 0; i < 5; i++) b.add({ x: i * 3, y: 0, pressure: 0 });
    const before = b.revision;
    b.add({ x: 15, y: 0, pressure: 0.3 });
    expect(b.revision).toBe(before + 1);
    b.settle();
    expect(triples(b.view).every((p) => p[2] === 0.3)).toBe(true);
  });

  it("centred: drops a sample too close to the last one held", () => {
    const b = new StrokeBuilder({ minDistance: 1.4, smoothing: "centred" });
    expect(b.add({ x: 0, y: 0, pressure: 0.3 })).toBe(true);
    expect(b.add({ x: 1, y: 0, pressure: 0.3 })).toBe(false);
    expect(b.add({ x: 2, y: 0, pressure: 0.3 })).toBe(true);
    expect(b.addFinal({ x: 2.5, y: 0, pressure: 0.3 })).toBe(true);
    expect(b.length).toBe(3);
  });
});
