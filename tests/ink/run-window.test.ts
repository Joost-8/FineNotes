/**
 * The part of a stroke in progress that a frame repaints (src/ink/run-window.ts).
 * The promise: painting only the stretches that reach into the changed box
 * leaves out no ink that a whole repaint would have put there.
 */

import { describe, expect, it } from "vitest";
import { chiselPolygons } from "../../src/ink/chisel";
import { type InkRun, InkTracer, penOptions } from "../../src/ink/freehand";
import {
  type RunBox,
  boundsSince,
  markOf,
  stretchesWithin,
  unionBox,
} from "../../src/ink/run-window";

const line = (width: number, ...pts: number[]): InkRun => ({ width, pts });

describe("markOf and boundsSince", () => {
  it("bounds everything without a mark, widened by half the width", () => {
    const runs = [line(4, 10, 10, 30, 20)];
    expect(boundsSince(runs, null)).toEqual({ minX: 8, minY: 8, maxX: 32, maxY: 22 });
  });

  it("bounds only what came after the mark, joined to the point before it", () => {
    const runs = [line(2, 0, 0, 10, 0)];
    const mark = markOf(runs);
    runs[0].pts.push(20, 5, 30, 5);
    expect(boundsSince(runs, mark)).toEqual({ minX: 9, minY: -1, maxX: 31, maxY: 6 });
  });

  it("takes in runs started after the mark", () => {
    const runs = [line(2, 0, 0, 10, 0)];
    const mark = markOf(runs);
    runs.push(line(6, 10, 0, 10, 40));
    expect(boundsSince(runs, mark)).toEqual({ minX: 7, minY: -3, maxX: 13, maxY: 43 });
  });

  it("is null when there is nothing to bound", () => {
    expect(boundsSince([], null)).toBeNull();
    expect(boundsSince([], { runs: 0, open: 0 })).toBeNull();
  });

  it("skips points that are not finite", () => {
    expect(boundsSince([line(2, Number.NaN, 0, 5, 5)], null)).toEqual({
      minX: 4,
      minY: 4,
      maxX: 6,
      maxY: 6,
    });
  });

  it("bounds a chisel run like any other: its tip is no wider than its height", () => {
    const runs: InkRun[] = [{ width: 10, pts: [0, 0, 50, 0], chisel: true }];
    const mark = markOf(runs);
    runs[0].pts.push(100, 0);
    expect(boundsSince(runs, mark)).toEqual({ minX: 45, minY: -5, maxX: 105, maxY: 5 });
  });
});

describe("unionBox", () => {
  const a: RunBox = { minX: 0, minY: 0, maxX: 5, maxY: 5 };
  const b: RunBox = { minX: 3, minY: -2, maxX: 9, maxY: 4 };
  it("covers both, and passes a lone box through", () => {
    expect(unionBox(a, b)).toEqual({ minX: 0, minY: -2, maxX: 9, maxY: 5 });
    expect(unionBox(a, null)).toBe(a);
    expect(unionBox(null, b)).toBe(b);
    expect(unionBox(null, null)).toBeNull();
  });
});

describe("stretchesWithin", () => {
  const box: RunBox = { minX: 40, minY: -5, maxX: 60, maxY: 5 };

  it("keeps the consecutive points whose segments reach the box", () => {
    const run = line(2, 0, 0, 20, 0, 45, 0, 55, 0, 80, 0, 100, 0);
    expect(stretchesWithin(run, box)).toEqual([1, 4]);
  });

  it("gives a stretch for each time the line comes back", () => {
    // Out to the right along y = 0, round, and back along y = 3.
    const run = line(2, 0, 0, 50, 0, 100, 0, 100, 50, 100, 3, 50, 3, 0, 3);
    expect(stretchesWithin(run, box)).toEqual([0, 2, 4, 6]);
  });

  it("counts ink that only reaches the box by its width", () => {
    expect(stretchesWithin(line(2, 0, 20, 100, 20), box)).toEqual([]);
    expect(stretchesWithin(line(32, 0, 20, 100, 20), box)).toEqual([0, 1]);
  });

  it("takes a dot and a closed run whole or not at all, and cuts a chisel run", () => {
    expect(stretchesWithin(line(4, 50, 0), box)).toEqual([0, 0]);
    expect(stretchesWithin(line(4, 0, 0), box)).toEqual([]);
    expect(stretchesWithin({ width: 2, pts: [0, 0, 50, 0, 50, 90], closed: true }, box)).toEqual([
      0, 2,
    ]);
    expect(
      stretchesWithin({ width: 2, pts: [0, 0, 45, 0, 90, 0, 90, 90], chisel: true }, box),
    ).toEqual([0, 2]);
    expect(stretchesWithin(line(2), box)).toEqual([]);
  });
});

describe("a frame's changed box holds every difference from the frame before", () => {
  /** The points of `runs`, each with its run's width, as strings to compare. */
  const inked = (runs: readonly InkRun[]): string[] => {
    const out: string[] = [];
    runs.forEach((run, r) => {
      for (let i = 0; i + 1 < run.pts.length; i += 2) {
        out.push(`${r}:${i}:${run.pts[i]},${run.pts[i + 1]},${run.width}`);
      }
    });
    return out;
  };

  it("for a stroke whose width swells, frame by frame", () => {
    const tracer = new InkTracer(penOptions(3, true));
    let before: InkRun[] = [];
    let seen: { settled: ReturnType<typeof markOf>; tip: RunBox | null } | null = null;
    for (let i = 0; i < 160; i++) {
      tracer.push(40 + i * 1.7, 90 + 12 * Math.sin(i / 5), 0.15 + 0.7 * Math.abs(Math.sin(i / 23)));
      // A frame every third point, as when several samples arrive in one.
      if (i % 3 !== 0) continue;
      const settled = tracer.mark();
      const runs = tracer.runs().map((run) => ({ ...run, pts: [...run.pts] }));
      const tip = boundsSince(runs, settled);
      if (seen) {
        const changed = unionBox(boundsSince(runs, seen.settled), seen.tip);
        expect(changed).not.toBeNull();
        const inside = (entry: string): boolean => {
          const [x, y] = entry.split(":")[2].split(",").map(Number);
          return (
            changed !== null &&
            x >= changed.minX &&
            x <= changed.maxX &&
            y >= changed.minY &&
            y <= changed.maxY
          );
        };
        const now = new Set(inked(runs));
        const then = new Set(inked(before));
        // Every point that came or went lies in the box that is repainted.
        for (const entry of now) if (!then.has(entry)) expect(inside(entry)).toBe(true);
        for (const entry of then) if (!now.has(entry)) expect(inside(entry)).toBe(true);
      }
      seen = { settled, tip };
      before = runs;
    }
  });
});

describe("a stretch of a chisel run", () => {
  it("sweeps the same polygons as the whole run does over those segments", () => {
    const pts = [0, 0, 30, 4, 60, -3, 90, 10, 120, 0];
    const whole = chiselPolygons(pts, 12);
    const part = chiselPolygons(pts.slice(2, 8), 12);
    expect(part).toEqual(whole.slice(1, 3));
  });
});
