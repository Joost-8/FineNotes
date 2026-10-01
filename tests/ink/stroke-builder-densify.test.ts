/**
 * Sparse input (FineNotes#1): where WebKit has no `getCoalescedEvents`
 * (iPadOS before 18.2), a pen arrives once a frame and a quick letter is a
 * few samples far apart. `densify` fills the stroke in along a curve through
 * them. Off, the builder keeps samples exactly as before.
 */

import { describe, expect, it } from "vitest";
import { StrokeBuilder, fillCurve } from "../../src/ink/stroke-builder";

const SPACING = 1.4;

/** Samples round a circle of radius `r`, `n` of them over `turn` of a full turn. */
function arc(n: number, r = 30, turn = 0.75): Array<{ x: number; y: number; pressure: number }> {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * turn * 2 * Math.PI;
    return { x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a), pressure: 0.3 };
  });
}

function triples(flat: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

describe("StrokeBuilder with densify", () => {
  it("keeps samples exactly as before when off", () => {
    const off = new StrokeBuilder({ minDistance: SPACING });
    for (const s of arc(8)) off.add(s);
    expect(off.length).toBe(8);
    expect(off.pending).toBeNull();
    expect(triples(off.points()).map(([x, y]) => [x, y])).toEqual(arc(8).map((s) => [s.x, s.y]));
  });

  it("passes through every sample, in order, ending on the last", () => {
    const b = new StrokeBuilder({ minDistance: SPACING, densify: true });
    const samples = arc(9);
    for (const s of samples.slice(0, -1)) b.add(s);
    b.addFinal(samples[samples.length - 1]);
    const pts = triples(b.points());
    let from = 0;
    for (const s of samples) {
      const at = pts.findIndex((p, i) => i >= from && p[0] === s.x && p[1] === s.y);
      expect(at).toBeGreaterThanOrEqual(from);
      from = at;
    }
    expect(pts[pts.length - 1].slice(0, 2)).toEqual([samples[8].x, samples[8].y]);
  });

  it("fills the gaps to about the sample spacing, along the curve", () => {
    const b = new StrokeBuilder({ minDistance: SPACING, densify: true });
    const samples = arc(9);
    for (const s of samples) b.add(s);
    b.settle();
    const pts = triples(b.view);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toBeLessThan(
        SPACING * 1.3,
      );
    }
    // Nine samples over three quarters of a 30 px circle are 23 px apart; a
    // straight chord between them strays 1.29 px from the circle. The curve
    // strays 0.08 px between inner samples. The first and last gap have one
    // neighbour, so they bend less (0.79 px), still inside the chord's error.
    const error = pts.map(([x, y]) => Math.abs(Math.hypot(x - 100, y - 100) - 30));
    const perGap = Math.floor(error.length / 8);
    const inner = error.slice(perGap + 1, error.length - perGap - 1);
    expect(Math.max(...inner)).toBeLessThan(0.1);
    expect(Math.max(...error)).toBeLessThan(1.29 * 0.7);
  });

  it("only appends: what it has settled never changes", () => {
    const b = new StrokeBuilder({ minDistance: SPACING, densify: true });
    let before: number[] = [];
    for (const s of arc(12)) {
      b.add(s);
      const now = [...b.view];
      expect(now.slice(0, before.length)).toEqual(before);
      before = now;
    }
  });

  it("holds the newest sample back until the next one, and counts it", () => {
    const b = new StrokeBuilder({ minDistance: SPACING, densify: true });
    const [s0, s1, s2] = arc(3);
    b.add(s0);
    expect(b.pending).toBeNull();
    expect(b.length).toBe(1);
    b.add(s1);
    expect(b.pending).toEqual([s1.x, s1.y, 0.3]);
    expect(b.view).toHaveLength(3);
    expect(b.length).toBe(2);
    // The copy for a caller ends on it; the settled points do not yet.
    expect(b.points().slice(-3)).toEqual([s1.x, s1.y, 0.3]);
    b.add(s2);
    expect(b.pending).toEqual([s2.x, s2.y, 0.3]);
    expect(triples(b.view).at(-1)).toEqual([s1.x, s1.y, 0.3]);
    b.settle();
    expect(b.pending).toBeNull();
    expect(triples(b.view).at(-1)).toEqual([s2.x, s2.y, 0.3]);
    expect(b.length).toBe(b.view.length / 3);
  });

  it("drops a sample too close to the one waiting", () => {
    const b = new StrokeBuilder({ minDistance: SPACING, densify: true });
    b.add({ x: 0, y: 0, pressure: 0.3 });
    b.add({ x: 10, y: 0, pressure: 0.3 });
    expect(b.add({ x: 10.5, y: 0, pressure: 0.3 })).toBe(false);
    expect(b.add({ x: 20, y: 0, pressure: 0.3 })).toBe(true);
  });

  it("fills a straight line in on the line, with pressure running between samples", () => {
    const b = new StrokeBuilder({ minDistance: 1, densify: true });
    b.add({ x: 0, y: 0, pressure: 0.2 });
    b.add({ x: 10, y: 0, pressure: 0.4 });
    b.addFinal({ x: 20, y: 0, pressure: 0.4 });
    const pts = triples(b.view);
    for (const [, y] of pts) expect(Math.abs(y)).toBeLessThan(1e-9);
    const mid = pts.find(([x]) => Math.abs(x - 5) < 1e-6);
    expect(mid?.[2]).toBeCloseTo(0.3, 6);
  });

  it("gives the first pressure reading to the samples kept before it, waiting or not", () => {
    const b = new StrokeBuilder({ minDistance: 1, densify: true, fallbackPressure: 0.5 });
    b.add({ x: 0, y: 0, pressure: 0 });
    b.add({ x: 10, y: 0, pressure: 0 });
    b.add({ x: 20, y: 0, pressure: 0.25 });
    b.settle();
    for (const [, , p] of triples(b.view)) expect(p).toBe(0.25);
  });

  it("settles nothing when nothing waits", () => {
    const b = new StrokeBuilder({ densify: true });
    b.settle();
    expect(b.isEmpty).toBe(true);
    b.add({ x: 1, y: 1, pressure: 0.3 });
    b.settle();
    expect(b.view).toEqual([1, 1, 0.3]);
  });
});

describe("fillCurve", () => {
  it("ends exactly on the far sample, and adds only it for a short gap", () => {
    const out: number[] = [];
    fillCurve([0, 0, 0.5], [1, 0, 0.5], [2, 0, 0.5], [3, 0, 0.5], 1.4, out);
    expect(out).toEqual([2, 0, 0.5]);
  });

  it("never loops between two samples, even round a hairpin", () => {
    const out: number[] = [];
    // Up, a sharp turn, and back down beside itself.
    fillCurve([0, 0, 0.5], [0, 20, 0.5], [3, 20, 0.5], [3, 0, 0.5], 0.2, out);
    const xs = triples(out).map(([x]) => x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
    for (const [, y] of triples(out)) expect(y).toBeLessThanOrEqual(20 + 3);
  });

  it("copes with a repeated neighbour at either end", () => {
    const out: number[] = [];
    fillCurve([5, 5, 0.3], [5, 5, 0.3], [15, 5, 0.3], [15, 5, 0.3], 1, out);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(out.slice(-3)).toEqual([15, 5, 0.3]);
  });
});
