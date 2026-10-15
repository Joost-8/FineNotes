/**
 * `lineOfHighlight` (src/ink/straighten.ts): a highlight drawn as a line
 * becomes a straight line on lift; curves, corners, zigzags and dabs do not.
 * The real strokes are five highlights traced from Joost's iPad recording.
 */

import { describe, expect, it } from "vitest";
import { LINE_MAX_DEVIATION, lineOfHighlight } from "../../src/ink/straighten";
import real from "./fixtures/real-highlights-ipad.json";
import goodnotes from "./fixtures/goodnotes-highlights-ipad.json";

/** Flat samples along `f(t)` for t in [0, 1], `n` of them, pressure 0.5. */
function along(f: (t: number) => [number, number], n = 60): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(...f(i / (n - 1)), 0.5);
  return out;
}

describe("lineOfHighlight", () => {
  it("snaps every real highlight Joost drew as a line, to its ends", () => {
    for (const pts of real.strokes) {
      const line = lineOfHighlight(pts, 20);
      expect(line).not.toBeNull();
      expect(line).toHaveLength(6);
      // The ends land near where the stroke began and ended.
      const n = pts.length / 3;
      expect(Math.abs(line![0] - pts[0])).toBeLessThan(3);
      expect(Math.abs(line![3] - pts[(n - 1) * 3])).toBeLessThan(3);
    }
  });

  it("snaps as Goodnotes does: its two highlights meant as lines, never its S curve", () => {
    // Traced from Joost's recording of Goodnotes just before each lift: the
    // wobbly bands Goodnotes then made straight, and a curve it left alone.
    for (const pts of goodnotes.lines) expect(lineOfHighlight(pts, 20)).not.toBeNull();
    for (const pts of goodnotes.curves) expect(lineOfHighlight(pts, 20)).toBeNull();
  });

  it("puts a clean line's ends exactly where it started and ended, with their pressure", () => {
    const pts = [10, 20, 0.3, 50, 40, 0.5, 90, 60, 0.7];
    const line = lineOfHighlight(pts, 20)!;
    expect(line.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 20, 0.3, 90, 60, 0.7]);
  });

  it("snaps a wavy line within the limit, steep or level", () => {
    const amp = 0.05 * 200;
    const level = along((t) => [100 + 200 * t, 300 + amp * Math.sin(t * 12)]);
    expect(lineOfHighlight(level, 20)).not.toBeNull();
    const steep = along((t) => [300 + amp * Math.sin(t * 12), 100 + 200 * t]);
    expect(lineOfHighlight(steep, 20)).not.toBeNull();
    // Drawn right to left, the ends follow the pen.
    const back = along((t) => [300 - 200 * t, 300]);
    const line = lineOfHighlight(back, 20)!;
    expect(line[0]).toBeCloseTo(300, 6);
    expect(line[3]).toBeCloseTo(100, 6);
  });

  it("leaves a curve, a corner, a zigzag over several lines and a wide wave alone", () => {
    const arc = along((t) => [
      200 + 100 * Math.cos(t * Math.PI),
      200 - 100 * Math.sin(t * Math.PI),
    ]);
    const corner = [
      ...along((t) => [100 + 150 * t, 100], 30),
      ...along((t) => [250, 100 + 100 * t], 30),
    ];
    const zigzag = [
      ...along((t) => [100 + 200 * t, 100], 20),
      ...along((t) => [300 - 200 * t, 100 + 30 * t], 20),
      ...along((t) => [100 + 200 * t, 130], 20),
    ];
    const wave = along((t) => [
      100 + 200 * t,
      300 + 2 * LINE_MAX_DEVIATION * 200 * Math.sin(t * 9),
    ]);
    for (const pts of [arc, corner, zigzag, wave]) expect(lineOfHighlight(pts, 20)).toBeNull();
  });

  it("leaves a dab shorter than the minimum, and a stroke that doubles back", () => {
    expect(
      lineOfHighlight(
        along((t) => [100 + 10 * t, 100]),
        20,
      ),
    ).toBeNull();
    const there = along((t) => [100 + 200 * t, 100], 30);
    const halfBack = along((t) => [300 - 100 * t, 101], 30);
    expect(lineOfHighlight([...there, ...halfBack], 20)).toBeNull();
    expect(lineOfHighlight([1, 2, 0.5], 0)).toBeNull();
    expect(lineOfHighlight([], 0)).toBeNull();
  });

  it("ignores a ragged tail and refuses non-finite samples", () => {
    expect(lineOfHighlight([10, 20, 0.5, 90, 20, 0.5, 7], 20)).toEqual([10, 20, 0.5, 90, 20, 0.5]);
    expect(lineOfHighlight([10, 20, 0.5, Number.NaN, 20, 0.5, 90, 20, 0.5], 20)).toBeNull();
  });
});
