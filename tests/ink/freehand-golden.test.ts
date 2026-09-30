/**
 * Golden output of the ink tracer for real ink: every stroke's runs (their
 * widths and a hash of their polylines) for strokes from Joost's notes, at
 * the pen sizes and pressure settings the plugin uses. One setting per
 * stroke is kept verbatim, as SVG path data, so a change can be read as well
 * as caught.
 *
 * The runs are what every note is painted with, so this file guards the
 * look of all ink: a change here redraws every stroke ever written. It was
 * generated when the tracer replaced perfect-freehand (2026-09-30).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type InkRun,
  SvgPath,
  centrelinePath,
  inkRuns,
  penOptions,
  radiusAt,
  traceRun,
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

function svgOf(runs: readonly InkRun[]): string {
  return runs
    .map((run) => {
      const svg = new SvgPath();
      traceRun(svg, run);
      return `${run.width.toFixed(3)}: ${svg.toString()}`;
    })
    .join("\n    ");
}

function golden(): string {
  const lines: string[] = [];
  for (const sample of SAMPLES) {
    for (const size of [2, 3, 12]) {
      for (const pressure of [true, false]) {
        const runs = inkRuns(sample.pts, penOptions(size, pressure));
        const points = runs.reduce((sum, run) => sum + run.pts.length / 2, 0);
        const widths = runs.map((run) => run.width.toFixed(2));
        const shown = widths.length > 6 ? [...widths.slice(0, 6), "…"] : widths;
        lines.push(
          `${sample.name} size=${size} pressure=${pressure} runs=${runs.length} ` +
            `points=${points} widths=${shown.join(",")} #${digest(runs)}`,
        );
        // One setting in full, so a change can be read as well as detected.
        if (size === 3 && pressure) lines.push(`    ${svgOf(runs)}`);
      }
    }
    lines.push(
      `${sample.name} as a shape: ${svgOf(inkRuns(sample.pts, penOptions(3, true), true))}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

describe("the ink tracer on real ink", () => {
  it("matches the golden runs", async () => {
    await expect(golden()).toMatchFileSnapshot("./golden/freehand-runs.txt");
  });

  it("uses the plugin's pen tuning: thinning 0.6 with pressure, one width without", () => {
    expect(penOptions(4, true)).toEqual({ size: 4, thinning: 0.6 });
    expect(penOptions(7, false)).toEqual({ size: 7, thinning: 0 });
  });

  it("widens a line from 0.4 of the nib at no pressure to 1.6 at full", () => {
    const pen = penOptions(10, true);
    expect(2 * radiusAt(0, pen)).toBeCloseTo(4, 9);
    expect(2 * radiusAt(0.5, pen)).toBeCloseTo(10, 9);
    expect(2 * radiusAt(1, pen)).toBeCloseTo(16, 9);
    // Out of range and unreadable pressures are clamped, or read as 0.5.
    expect(radiusAt(7, pen)).toBeCloseTo(8, 9);
    expect(radiusAt(Number.NaN, pen)).toBeCloseTo(5, 9);
    // Without pressure, the nib whatever the reading.
    expect(2 * radiusAt(0.1, penOptions(10, false))).toBe(10);
  });

  it("draws nothing for fewer than one whole point", () => {
    expect(inkRuns([], penOptions(3, true))).toEqual([]);
    expect(inkRuns([1, 2], penOptions(3, true))).toEqual([]);
    expect(inkRuns([], penOptions(3, true), true)).toEqual([]);
    expect(centrelinePath([])).toBe("");
  });
});
