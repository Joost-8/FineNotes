/**
 * Dots are drawn as wide as the line. perfect-freehand outlines a stroke of
 * a few page px as a blob that ignores pressure, up to twice the
 * line's width: an i-dot at a light Pencil pressure came out 1.9x the line
 * (Joost's recording against GoodNotes, 2026-09-30).
 */

import { describe, expect, it } from "vitest";
import {
  DOT_LENGTH,
  inkPath,
  isDot,
  lineRadius,
  penOptions,
  strokeOutline,
} from "../../src/ink/freehand";

/** A vertical stroke `length` px long at one pressure, sampled every `step` px. */
function vertical(length: number, pressure: number, step = 1.4): number[] {
  const pts = [20, 20, pressure];
  for (let y = step; y < length; y += step) pts.push(20, 20 + y, pressure);
  if (length > 0) pts.push(20, 20 + length, pressure);
  return pts;
}

/** How wide a vertical stroke is drawn: the dot's line width, or the outline's x extent. */
function drawnWidth(pts: number[], size: number, pressure: boolean): number {
  const pen = penOptions(size, pressure);
  const ink = inkPath(pts, pen);
  if (!ink) return 0;
  if (ink.stroke !== null) return ink.stroke;
  const xs = strokeOutline(pts, pen).map(([x]) => x);
  return Math.max(...xs) - Math.min(...xs);
}

describe("dots", () => {
  it("counts a stroke shorter than DOT_LENGTH as a dot, and a longer one as a line", () => {
    expect(isDot([5, 5, 0.3])).toBe(true);
    expect(isDot([5, 5, 0.3, 5, 5 + DOT_LENGTH - 0.01, 0.3])).toBe(true);
    expect(isDot([5, 5, 0.3, 5, 5 + DOT_LENGTH + 0.01, 0.3])).toBe(false);
    // Length is along the path: a stroke that doubles back is still long.
    expect(isDot([5, 5, 0.3, 5, 7, 0.3, 5, 5, 0.3])).toBe(false);
  });

  it("draws a dot as its centreline stroked at the line's width for its pressure", () => {
    const pen = penOptions(3, true);
    const ink = inkPath([25, 25, 0.25], pen);
    expect(ink?.stroke).toBeCloseTo(2 * 3 * (0.5 - 0.6 * 0.25), 6);
    expect(ink?.d).toBe("M 25.00 25.00 L 25.00 25.00");
    // Pressure off: the nib's width, as the line has.
    expect(inkPath([25, 25, 0.25], penOptions(3, false))?.stroke).toBe(3);
  });

  it("takes the mean pressure, and reads a bad one as nothing", () => {
    const pen = penOptions(4, true);
    expect(lineRadius([0, 0, 0.2, 1, 0, 0.4], pen)).toBeCloseTo(4 * (0.5 - 0.6 * 0.2), 6);
    expect(lineRadius([0, 0, Number.NaN, 1, 0, 0.3], pen)).toBeCloseTo(4 * (0.5 - 0.6 * 0.2), 6);
    expect(lineRadius([0, 0, 7], pen)).toBeCloseTo(4 * 0.8, 6);
    expect(lineRadius([0, 0], pen)).toBe(2);
  });

  it("never draws a short stroke wider than the same pen's line", () => {
    // Sample spacings from 5x zoom (0.28) to a fast stroke (2.5).
    for (const step of [0.28, 0.7, 1.4, 2.5]) {
      for (const size of [1, 2, 3, 6, 12, 24]) {
        for (const pressure of [0.05, 0.25, 0.5, 1]) {
          const line = drawnWidth(vertical(20 * size + 20, pressure, step), size, true);
          for (let length = 0; length <= 3 * size + 6; length += 0.1) {
            const width = drawnWidth(vertical(length, pressure, step), size, true);
            const label = `step ${step} size ${size} p ${pressure} length ${length.toFixed(1)}`;
            expect(width, label).toBeLessThanOrEqual(line * 1.1);
          }
        }
      }
    }
  });

  it("leaves shapes at the nib's width, dot or not", () => {
    expect(inkPath([25, 25, 0.1], penOptions(3, true), true, true)?.stroke).toBe(3);
  });
});
