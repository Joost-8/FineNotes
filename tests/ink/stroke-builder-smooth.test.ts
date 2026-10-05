/**
 * Rounded input (FineNotes#1): WebKit before iPadOS 26.2 hands over every pen
 * position rounded to a whole screen px, and a stroke drawn through those
 * samples wobbles. `smooth` lets each sample follow the pen part of the way
 * (`ROUNDED_FOLLOW`), as 1.0.1 drew. Off, the builder keeps samples exactly.
 */

import { describe, expect, it } from "vitest";
import { ROUNDED_FOLLOW, StrokeBuilder } from "../../src/ink/stroke-builder";

type Sample = { x: number; y: number; pressure: number };

/** A straight line as a 60 Hz pen gives it: ~4 px steps, rounded to whole px. */
function roundedLine(n = 40, step = 4, angle = 0.62): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(10.3 + i * step * Math.cos(angle)),
    y: Math.round(20.6 + i * step * Math.sin(angle)),
    pressure: 0.3,
  }));
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

function build(samples: Sample[], options: { smooth?: boolean; densify?: boolean }): number[][] {
  const b = new StrokeBuilder({ minDistance: 1.4, ...options });
  for (const s of samples.slice(0, -1)) b.add(s);
  b.addFinal(samples[samples.length - 1]);
  return triples(b.points());
}

describe("StrokeBuilder with smooth", () => {
  it("is off unless asked for: samples are kept exactly", () => {
    const samples = roundedLine();
    const pts = build(samples, {});
    expect(pts.map(([x, y]) => [x, y])).toEqual(samples.map((s) => [s.x, s.y]));
  });

  it("moves each sample part of the way from the last smoothed point", () => {
    const b = new StrokeBuilder({ minDistance: 0.1, smooth: true });
    b.add({ x: 0, y: 0, pressure: 0.3 });
    b.add({ x: 10, y: 0, pressure: 0.3 });
    b.add({ x: 10, y: 10, pressure: 0.3 });
    const pts = triples(b.view);
    expect(pts[0]).toEqual([0, 0, 0.3]);
    expect(pts[1][0]).toBeCloseTo(10 * ROUNDED_FOLLOW, 10);
    expect(pts[2][0]).toBeCloseTo(
      10 * ROUNDED_FOLLOW + (10 - 10 * ROUNDED_FOLLOW) * ROUNDED_FOLLOW,
      10,
    );
    expect(pts[2][1]).toBeCloseTo(10 * ROUNDED_FOLLOW, 10);
  });

  it("draws a rounded straight line straighter", () => {
    const samples = roundedLine();
    for (const densify of [false, true]) {
      const raw = build(samples, { densify });
      const smooth = build(samples, { densify, smooth: true });
      // Leave out the ends: the start and the pen-up are taken as they are.
      const mid = (pts: number[][]): number[][] => pts.slice(pts.length / 5, (pts.length * 4) / 5);
      const rms = (v: number[]): number => Math.sqrt(v.reduce((s, d) => s + d * d, 0) / v.length);
      expect(rms(offLine(mid(smooth)))).toBeLessThan(rms(offLine(mid(raw))) * 0.75);
      expect(turning(mid(smooth))).toBeLessThan(turning(mid(raw)) * 0.75);
    }
  });

  it("starts where the pen touched and ends where it lifted", () => {
    const samples = roundedLine(12);
    for (const densify of [false, true]) {
      const pts = build(samples, { densify, smooth: true });
      expect(pts[0].slice(0, 2)).toEqual([samples[0].x, samples[0].y]);
      expect(pts[pts.length - 1].slice(0, 2)).toEqual([samples[11].x, samples[11].y]);
    }
  });

  it("only ever appends: points already kept never move", () => {
    for (const densify of [false, true]) {
      const b = new StrokeBuilder({ minDistance: 1.4, smooth: true, densify });
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
    const b = new StrokeBuilder({ minDistance: 0.1, smooth: true });
    b.add({ x: 0, y: 0, pressure: 0.2 });
    b.add({ x: 10, y: 0, pressure: 0.6 });
    expect(triples(b.view)[1][2]).toBe(0.6);
  });
});
