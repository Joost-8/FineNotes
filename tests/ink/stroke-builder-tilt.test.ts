/**
 * The Pencil's tilt through the stroke builder and the ink tracer: one
 * altitude per point in every sampling mode, the missing-reading rules, and
 * the tracer's promise that ink already drawn never changes.
 */

import { describe, expect, it } from "vitest";
import { type InkRun, InkTracer, penOptions } from "../../src/ink/freehand";
import { type StrokeBuilderOptions, StrokeBuilder } from "../../src/ink/stroke-builder";
import { altitudeOf, tiltFactor } from "../../src/ink/tilt";
import { type PencilSample, pencilStroke } from "./tilt-synth";

const MODES: Array<[string, Partial<StrokeBuilderOptions>]> = [
  ["as sampled", {}],
  ["densified", { densify: true }],
  ["centred", { smoothing: "centred" }],
  ["stabilized", { stabilize: 4 }],
];

function feed(builder: StrokeBuilder, stream: readonly PencilSample[]): void {
  stream.forEach((sample, i) => {
    const input = { ...sample, altitude: altitudeOf(sample) };
    if (i === stream.length - 1) builder.addFinal({ ...input, pressure: 0 });
    else builder.add(input);
  });
}

describe("StrokeBuilder with tilt", () => {
  for (const [name, mode] of MODES) {
    it(`keeps one altitude per point (${name})`, () => {
      const builder = new StrokeBuilder({ minDistance: 1, tilt: true, ...mode });
      const stream = pencilStroke({ count: 160, seed: 5 });
      stream.slice(0, -1).forEach((sample) => {
        builder.add({ ...sample, altitude: altitudeOf(sample) });
        // What is drawn wet has an altitude for every point drawn.
        expect(builder.tiltView.length * 3).toBe(builder.view.length);
      });
      const last = stream[stream.length - 1];
      builder.addFinal({ ...last, altitude: altitudeOf(last) });
      const tilt = builder.tilts();
      expect(tilt).not.toBeNull();
      expect((tilt ?? []).length * 3).toBe(builder.points().length);
      expect(tilt?.every((altitude) => altitude > 10 && altitude < 60)).toBe(true);
    });

    it(`changes nothing with tilt off (${name})`, () => {
      const stream = pencilStroke({ count: 160, seed: 5 });
      const plain = new StrokeBuilder({ minDistance: 1, ...mode });
      const off = new StrokeBuilder({ minDistance: 1, tilt: false, ...mode });
      feed(plain, stream);
      feed(off, stream);
      expect(off.points()).toEqual(plain.points());
      expect(off.tilts()).toBeNull();
    });

    it(`keeps the points the same with tilt on (${name})`, () => {
      const stream = pencilStroke({ count: 160, seed: 9 });
      const plain = new StrokeBuilder({ minDistance: 1, ...mode });
      const on = new StrokeBuilder({ minDistance: 1, tilt: true, ...mode });
      feed(plain, stream);
      feed(on, stream);
      expect(on.points()).toEqual(plain.points());
    });
  }

  it("gives the pen-up the altitude before it: a lift is no reading", () => {
    const builder = new StrokeBuilder({ minDistance: 1, tilt: true });
    builder.add({ x: 0, y: 0, pressure: 0.3, altitude: 30, t: 0 });
    builder.add({ x: 5, y: 0, pressure: 0.3, altitude: 30, t: 4 });
    builder.addFinal({ x: 10, y: 0, pressure: 0, altitude: 90, t: 8 });
    expect(builder.tilts()).toEqual([30, 30, 30]);
  });

  it("fills the points before the first reading in when it comes", () => {
    const builder = new StrokeBuilder({ minDistance: 1, tilt: true });
    builder.add({ x: 0, y: 0, pressure: 0.3, t: 0 });
    builder.add({ x: 5, y: 0, pressure: 0.3, altitude: Number.NaN, t: 4 });
    const revision = builder.revision;
    expect(builder.tiltView.every(Number.isNaN)).toBe(true);
    builder.add({ x: 10, y: 0, pressure: 0.3, altitude: 25, t: 8 });
    expect(builder.revision).toBe(revision + 1);
    expect([...builder.tiltView]).toEqual([25, 25, 25]);
  });

  it("has no tilt for a pen that never gave one", () => {
    const builder = new StrokeBuilder({ minDistance: 1, tilt: true });
    builder.add({ x: 0, y: 0, pressure: 0.3 });
    builder.addFinal({ x: 5, y: 0, pressure: 0 });
    expect(builder.tilts()).toBeNull();
  });
});

/** The settled runs and the drawn ones, traced as the wet layer does, frame by frame. */
function frames(stream: readonly PencilSample[], tilted: boolean, every = 2): InkRun[][] {
  const builder = new StrokeBuilder({ minDistance: 0.5, tilt: tilted });
  const tracer = new InkTracer(penOptions(5.4, false));
  const out: InkRun[][] = [];
  stream.forEach((sample, i) => {
    builder.add({ ...sample, altitude: altitudeOf(sample) });
    const pts = builder.view;
    const tilt = builder.tiltView;
    for (let k = tracer.length * 3; k + 2 < pts.length; k += 3) {
      tracer.push(pts[k], pts[k + 1], pts[k + 2], tilted ? tiltFactor(tilt[k / 3]) : 1);
    }
    if (i % every === 0) out.push(tracer.runs().map((run) => ({ ...run, pts: [...run.pts] })));
  });
  return out;
}

const GRID_W = 320;
const GRID_H = 220;

/** The runs stamped onto a 1 px grid as discs, which is what a round-capped stroke covers. */
function raster(runs: readonly InkRun[]): Uint8Array {
  const grid = new Uint8Array(GRID_W * GRID_H);
  const stamp = (x: number, y: number, r: number): void => {
    for (let gy = Math.floor(y - r); gy <= Math.ceil(y + r); gy++) {
      for (let gx = Math.floor(x - r); gx <= Math.ceil(x + r); gx++) {
        if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) continue;
        if ((gx + 0.5 - x) ** 2 + (gy + 0.5 - y) ** 2 <= r * r) grid[gy * GRID_W + gx] = 1;
      }
    }
  };
  for (const run of runs) {
    const r = run.width / 2;
    for (let i = 0; i + 1 < run.pts.length; i += 2) {
      const x = run.pts[i];
      const y = run.pts[i + 1];
      const nx = i + 3 < run.pts.length ? run.pts[i + 2] : x;
      const ny = i + 3 < run.pts.length ? run.pts[i + 3] : y;
      const steps = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / 0.5));
      for (let s = 0; s < steps; s++)
        stamp(x + ((nx - x) * s) / steps, y + ((ny - y) * s) / steps, r);
    }
  }
  return grid;
}

/** Ink pixels removed over ink pixels added, frame to frame (ledger: Goodnotes 1.5%). */
function redrawRatio(all: readonly InkRun[][]): number {
  let removed = 0;
  let added = 0;
  let before: Uint8Array = new Uint8Array(GRID_W * GRID_H);
  for (const runs of all) {
    const now = raster(runs);
    for (let i = 0; i < now.length; i++) {
      if (before[i] && !now[i]) removed++;
      if (!before[i] && now[i]) added++;
    }
    before = now;
  }
  return removed / added;
}

describe("the tracer with tilt never changes ink it has drawn", () => {
  it("keeps every settled run as it was while tilted points are added", () => {
    const builder = new StrokeBuilder({ minDistance: 0.5, tilt: true });
    const tracer = new InkTracer(penOptions(5.4, true));
    let before: InkRun[] = [];
    for (const sample of pencilStroke({ count: 200, seed: 21 })) {
      builder.add({ ...sample, altitude: altitudeOf(sample) });
      const pts = builder.view;
      const tilt = builder.tiltView;
      for (let k = tracer.length * 3; k + 2 < pts.length; k += 3) {
        tracer.push(pts[k], pts[k + 1], pts[k + 2], tiltFactor(tilt[k / 3]));
      }
      const after = tracer.settled();
      expect(after.length).toBeGreaterThanOrEqual(before.length);
      before.forEach((run, k) => {
        expect(after[k].width).toBe(run.width);
        if (k < before.length - 1) expect(after[k].pts).toEqual(run.pts);
        else expect(after[k].pts.slice(0, run.pts.length)).toEqual(run.pts);
      });
      before = after;
    }
    // It did widen: the widest run is well over twice the narrowest.
    const widths = before.map((run) => run.width);
    expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(2);
  });

  it("redraws about as little ink as without tilt", () => {
    const stream = pencilStroke({ count: 240, seed: 13, flat: 18 });
    const without = redrawRatio(frames(stream, false));
    const withTilt = redrawRatio(frames(stream, true));
    expect(withTilt).toBeLessThan(Math.max(0.03, without * 1.5));
  });
});
