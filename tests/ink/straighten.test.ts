/** `src/ink/straighten.ts`: the highlighter's straight runs. */

import { describe, expect, it } from "vitest";
import { straightenRuns } from "../../src/ink/straighten";

/** A stroke from `[x, y]` points, each with pressure 0.5. */
function stroke(points: Array<[number, number]>): number[] {
  return points.flatMap(([x, y]) => [x, y, 0.5]);
}

/** A hand-drawn horizontal line: a slow wave of ±2 px, a sample every 2 px. */
function wobblyLine(from: number, to: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = from; x <= to; x += 2) out.push([x, y + 2 * Math.sin(x / 9)]);
  return out;
}

describe("straightenRuns", () => {
  it("draws a wobbly line as one straight run, from where the pen landed to where it lifted", () => {
    const pts = stroke(wobblyLine(0, 300, 50));
    const out = straightenRuns(pts, 6);
    expect(out).toHaveLength(6);
    expect(out.slice(0, 2)).toEqual(pts.slice(0, 2));
    expect(out.slice(3, 5)).toEqual(pts.slice(-3, -1));
  });

  it("keeps a real step, as GoodNotes does", () => {
    // Right, up 30 px, right again.
    const pts = stroke([...wobblyLine(0, 200, 100), ...wobblyLine(202, 400, 70)]);
    const out = straightenRuns(pts, 6);
    const count = out.length / 3;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(6);
    // Every kept sample lies on one of the two levels, give or take the wobble.
    for (let i = 1; i < out.length; i += 3) {
      const y = out[i];
      expect(Math.min(Math.abs(y - 100), Math.abs(y - 70))).toBeLessThanOrEqual(2.5);
    }
  });

  it("keeps each kept sample's own pressure", () => {
    const pts = [0, 0, 0.2, 50, 1, 0.4, 100, 0, 0.9];
    expect(straightenRuns(pts, 5)).toEqual([0, 0, 0.2, 100, 0, 0.9]);
  });

  it("leaves short strokes and a tolerance of nothing alone, and drops a ragged tail", () => {
    expect(straightenRuns([1, 2, 0.5], 6)).toEqual([1, 2, 0.5]);
    expect(straightenRuns([1, 2, 0.5, 3, 4, 0.5, 7], 6)).toEqual([1, 2, 0.5, 3, 4, 0.5]);
    const pts = stroke(wobblyLine(0, 40, 0));
    expect(straightenRuns(pts, 0)).toEqual(pts);
    expect(straightenRuns(pts, Number.NaN)).toEqual(pts);
  });

  it("measures from the start when the chord has no length (a loop back to where it began)", () => {
    const pts = stroke([
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 0],
    ]);
    const out = straightenRuns(pts, 5);
    // The far corner of the loop is kept, so the band does not collapse to a dot.
    expect(out.length / 3).toBeGreaterThanOrEqual(3);
  });
});
