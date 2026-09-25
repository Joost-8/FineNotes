/**
 * Golden output of the perfect-freehand wrapper for real ink: the outline
 * polygon and the SVG path data built from it, for strokes from Joost's
 * notes at the pen sizes and pressure settings the plugin uses, finished and
 * still wet. Both are hashed at full precision; one pen setting per stroke
 * keeps its path data verbatim, so a change can be read as well as caught.
 *
 * The path data is what every note is painted with, so this file is the
 * guard on "the rewrite looks the same": it was generated before
 * `src/ink/freehand.ts` was rewritten (2026-09-25) and must not change. A
 * perfect-freehand upgrade that moves the ink shows up here first.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  centrelinePath,
  inkPath,
  outlineToSvgPath,
  penOptions,
  strokeOutline,
  toInputPoints,
} from "../../src/ink/freehand";
import mouse from "./fixtures/real-mouse-triangles.json";
import squiggles from "./fixtures/real-handwriting-squiggles.json";
import scribbles from "./fixtures/real-scribbles-ipad.json";

interface Sample {
  name: string;
  pts: number[];
}

/** At most `n` points of a stroke: enough to show its shape, few enough to read the golden. */
function head(pts: readonly number[], n: number): number[] {
  return pts.slice(0, n * 3);
}

/** A wavy line with a pressure that swells and fades, for the pressure-driven width. */
function swell(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(40 + i * 3.1, 90 + 9 * Math.sin(i / 4), 0.15 + 0.7 * Math.sin((Math.PI * i) / n));
  }
  return out;
}

const SAMPLES: Sample[] = [
  { name: "squiggle 0", pts: head(squiggles.strokes[0].pts, 40) },
  { name: "squiggle 3", pts: head(squiggles.strokes[3].pts, 40) },
  { name: "squiggle 6", pts: head(squiggles.strokes[6].pts, 60) },
  { name: "mouse triangle", pts: head(mouse[0], 50) },
  { name: "scribble 1", pts: head(scribbles.strokes[1].pts, 50) },
  { name: "swell", pts: swell(45) },
  { name: "two points", pts: [10, 10, 0.3, 60, 35, 0.8] },
  { name: "one point", pts: [25, 25, 0.5] },
];

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function golden(): string {
  const lines: string[] = [];
  for (const sample of SAMPLES) {
    for (const size of [2, 3, 12]) {
      for (const pressure of [true, false]) {
        for (const complete of [true, false]) {
          const options = penOptions(size, pressure);
          const outline = strokeOutline(sample.pts, options, complete);
          const d = outlineToSvgPath(outline);
          lines.push(
            `${sample.name} size=${size} pressure=${pressure} complete=${complete} ` +
              `outline=${outline.length}#${digest(outline)} path=${d.length}#${digest(d)}`,
          );
          // One setting in full, so a change can be read as well as detected.
          if (size === 3 && pressure && complete) lines.push(`  ${d}`);
        }
      }
    }
    lines.push(
      `${sample.name} as a shape: ${inkPath(sample.pts, penOptions(3, true), true, true)?.d}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

describe("freehand output for real ink", () => {
  it("matches the golden outlines and path data", async () => {
    await expect(golden()).toMatchFileSnapshot("./golden/freehand-paths.txt");
  });

  it("uses the plugin's pen tuning: thinning 0.6 with pressure, smoothing and streamline 0.5", () => {
    expect(penOptions(4, true)).toEqual({
      size: 4,
      thinning: 0.6,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: false,
    });
    expect(penOptions(7, false)).toEqual({
      size: 7,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: true,
    });
  });

  it("hands perfect-freehand whole points only, as [x, y, pressure]", () => {
    expect(toInputPoints([1, 2, 0.3, 4, 5, 0.6, 7, 8])).toEqual([
      [1, 2, 0.3],
      [4, 5, 0.6],
    ]);
    expect(toInputPoints([])).toEqual([]);
  });

  it("gives no path data for an outline of fewer than two points", () => {
    expect(outlineToSvgPath([])).toBe("");
    expect(outlineToSvgPath([[3, 4]])).toBe("");
  });

  it("builds path data from quadratic curves through the outline's edge midpoints", () => {
    expect(
      outlineToSvgPath([
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
    ).toBe("M 0.00 0.00 Q 0.00 0.00 5.00 0.00 10.00 0.00 10.00 5.00 10.00 10.00 5.00 5.00 Z");
  });

  it("draws nothing for fewer than one whole point", () => {
    expect(inkPath([], penOptions(3, true))).toBeNull();
    expect(inkPath([1, 2], penOptions(3, true))).toBeNull();
    expect(centrelinePath([])).toBe("");
  });
});
