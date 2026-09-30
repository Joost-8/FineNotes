/**
 * The ink tracer's promises (src/ink/freehand.ts). The one that matters
 * most: ink already drawn never changes while the pen goes on. The old
 * outline (perfect-freehand) re-derived its whole tail every frame, and ink
 * on the page bent into new curves as Joost wrote (recording, 2026-09-30).
 */

import { describe, expect, it } from "vitest";
import {
  type InkRun,
  InkTracer,
  SvgPath,
  TOLERANCE,
  WIDTH_STEP,
  inkRuns,
  penOptions,
  radiusAt,
  traceRun,
} from "../../src/ink/freehand";
import squiggles from "./fixtures/real-handwriting-squiggles.json";

const REAL = squiggles.strokes.map((stroke) => stroke.pts);

/** A wavy stroke whose pressure swells and fades. */
function swell(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(40 + i * 1.6, 90 + 9 * Math.sin(i / 4), 0.15 + 0.7 * Math.sin((Math.PI * i) / n));
  }
  return out;
}

function pointsOf(runs: readonly InkRun[]): number[][] {
  const out: number[][] = [];
  for (const run of runs)
    for (let i = 0; i + 1 < run.pts.length; i += 2) out.push([run.pts[i], run.pts[i + 1]]);
  return out;
}

describe("the tracer never changes ink it has drawn", () => {
  for (const [name, pressure] of [
    ["one width", false],
    ["with pressure", true],
  ] as const) {
    it(`keeps every settled run as it was while points are added (${name})`, () => {
      for (const pts of [...REAL, swell(80)]) {
        const tracer = new InkTracer(penOptions(3, pressure));
        let before: InkRun[] = [];
        for (let i = 0; i + 2 < pts.length; i += 3) {
          tracer.push(pts[i], pts[i + 1], pts[i + 2]);
          const after = tracer.settled();
          // Every run but the open one is untouched; the open one only grew.
          expect(after.length).toBeGreaterThanOrEqual(before.length);
          before.forEach((run, k) => {
            const now = after[k];
            expect(now.width).toBe(run.width);
            if (k < before.length - 1) expect(now.pts).toEqual(run.pts);
            else expect(now.pts.slice(0, run.pts.length)).toEqual(run.pts);
          });
          before = after;
        }
      }
    });
  }

  it("draws a finished stroke exactly as it was drawn wet, whenever it was looked at", () => {
    for (const pts of [...REAL, swell(60)]) {
      for (const pressure of [false, true]) {
        const pen = penOptions(3, pressure);
        const tracer = new InkTracer(pen);
        for (let i = 0; i + 2 < pts.length; i += 3) {
          tracer.push(pts[i], pts[i + 1], pts[i + 2]);
          tracer.runs(); // looking changes nothing
        }
        expect(tracer.runs()).toEqual(inkRuns(pts, pen));
      }
    }
  });

  it("only ever redraws the half segment to the pen's last point", () => {
    const pts = REAL[2];
    const tracer = new InkTracer(penOptions(3, false));
    for (let i = 0; i + 2 < pts.length; i += 3) {
      tracer.push(pts[i], pts[i + 1], pts[i + 2]);
      const settled = pointsOf(tracer.settled());
      const drawn = pointsOf(tracer.runs());
      // What is drawn is what is settled, plus at most the last point.
      expect(drawn.slice(0, settled.length)).toEqual(settled);
      expect(drawn.length - settled.length).toBeLessThanOrEqual(1);
      expect(drawn[drawn.length - 1]).toEqual([pts[i], pts[i + 1]]);
    }
  });
});

describe("the traced line", () => {
  it("starts at the first point, ends at the last, and runs through every midpoint", () => {
    for (const pts of REAL) {
      const line = pointsOf(inkRuns(pts, penOptions(3, false)));
      const n = pts.length / 3;
      expect(line[0]).toEqual([pts[0], pts[1]]);
      expect(line[line.length - 1]).toEqual([pts[(n - 1) * 3], pts[(n - 1) * 3 + 1]]);
      for (let i = 1; i < n; i++) {
        const mx = (pts[(i - 1) * 3] + pts[i * 3]) / 2;
        const my = (pts[(i - 1) * 3 + 1] + pts[i * 3 + 1]) / 2;
        const hit = line.some(([x, y]) => Math.hypot(x - mx, y - my) < 1e-9);
        expect(hit, `midpoint ${i}`).toBe(true);
      }
    }
  });

  it("stays within the tolerance of the smoothed curve between the points", () => {
    for (const raw of REAL) {
      const line = pointsOf(inkRuns(raw, penOptions(3, false)));
      // A point on top of the last one is no point: the tracer skips it too.
      const pts: number[] = [];
      for (let i = 0; i + 2 < raw.length; i += 3) {
        const k = pts.length;
        if (k === 0 || raw[i] !== pts[k - 3] || raw[i + 1] !== pts[k - 2]) {
          pts.push(raw[i], raw[i + 1], raw[i + 2]);
        }
      }
      const n = pts.length / 3;
      const mid = (i: number): number[] => [
        (pts[(i - 1) * 3] + pts[i * 3]) / 2,
        (pts[(i - 1) * 3 + 1] + pts[i * 3 + 1]) / 2,
      ];
      // Where a point of the line sits, searching on from `from`.
      const indexOf = ([x, y]: number[], from: number): number => {
        for (let k = from; k < line.length; k++) {
          if (Math.hypot(line[k][0] - x, line[k][1] - y) < 1e-9) return k;
        }
        throw new Error(`${x},${y} is not on the line`);
      };
      // Each quadratic, from midpoint to midpoint and bending at a point, is
      // drawn by the pieces of the line between those two midpoints.
      let from = 0;
      for (let i = 1; i < n - 1; i++) {
        const [ax, ay] = mid(i);
        const [bx, by] = mid(i + 1);
        const [cx, cy] = [pts[i * 3], pts[i * 3 + 1]];
        const first = indexOf([ax, ay], from);
        const last = indexOf([bx, by], first);
        from = last;
        for (let t = 0; t <= 1; t += 1 / 32) {
          const u = 1 - t;
          const px = u * u * ax + 2 * u * t * cx + t * t * bx;
          const py = u * u * ay + 2 * u * t * cy + t * t * by;
          let best = Infinity;
          for (let k = first + 1; k <= last; k++) {
            const [x0, y0] = line[k - 1];
            const [x1, y1] = line[k];
            const dx = x1 - x0;
            const dy = y1 - y0;
            const s = Math.max(
              0,
              Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)),
            );
            best = Math.min(best, Math.hypot(px - (x0 + s * dx), py - (y0 + s * dy)));
          }
          expect(best).toBeLessThanOrEqual(TOLERANCE + 1e-9);
        }
      }
    }
  });

  it("is one run at the nib's width without pressure", () => {
    for (const pts of REAL) {
      const runs = inkRuns(pts, penOptions(4, false));
      expect(runs).toHaveLength(1);
      expect(runs[0].width).toBe(4);
    }
  });

  it("with pressure, cuts runs where the width moves, each joined to the last", () => {
    const pen = penOptions(3, true);
    // Steep: the pressure moves up to 0.02 a point.
    const runs = inkRuns(swell(120), pen);
    expect(runs.length).toBeGreaterThan(10);
    for (let k = 1; k < runs.length; k++) {
      const prev = runs[k - 1];
      const run = runs[k];
      // Joined: a run starts where the one before it ends.
      expect(run.pts.slice(0, 2)).toEqual(prev.pts.slice(-2));
      // A step of one or two WIDTH_STEPs, never a jump, however fast the
      // pressure changes: the segment is cut where it crosses each step.
      const step = Math.abs(run.width - prev.width) / prev.width;
      expect(step).toBeLessThanOrEqual(2 * WIDTH_STEP + 1e-3);
    }
    // The widths follow the pressure: thin at the ends, widest in the middle.
    const widths = runs.map((run) => run.width);
    expect(Math.max(...widths)).toBeGreaterThan(2 * widths[0]);
    expect(widths[0]).toBeCloseTo(2 * radiusAt(0.15, pen), 1);
  });

  it("draws one point as a dot of the line's width", () => {
    expect(inkRuns([25, 25, 0.25], penOptions(3, true))).toEqual([
      { width: 2 * radiusAt(0.25, penOptions(3, true)), pts: [25, 25] },
    ]);
    const svg = new SvgPath();
    traceRun(svg, { width: 2, pts: [25, 25] });
    expect(svg.toString()).toBe("M 25.00 25.00 L 25.00 25.00");
  });

  it("draws a harder press on the same spot as a wider dot there", () => {
    const tracer = new InkTracer(penOptions(3, true));
    tracer.push(10, 10, 0.2);
    tracer.push(10, 10, 0.9);
    tracer.push(10, 10, 0.5); // lighter again: nothing to add
    const runs = tracer.runs();
    expect(runs.map((run) => run.width)).toEqual([
      2 * radiusAt(0.2, penOptions(3, true)),
      2 * radiusAt(0.9, penOptions(3, true)),
    ]);
    expect(runs[1].pts).toEqual([10, 10]);
    expect(tracer.length).toBe(3);
  });

  it("skips points that are not numbers, and still counts them", () => {
    const tracer = new InkTracer(penOptions(3, false));
    tracer.push(0, 0, 0.5);
    tracer.push(Number.NaN, 5, 0.5);
    tracer.push(10, Number.POSITIVE_INFINITY, 0.5);
    tracer.push(10, 0, 0.5);
    expect(tracer.length).toBe(4);
    expect(tracer.runs()).toEqual([{ width: 3, pts: [0, 0, 5, 0, 10, 0] }]);
  });

  it("traces a run as a polyline, closed when asked", () => {
    const svg = new SvgPath();
    traceRun(svg, { width: 3, pts: [0, 0, 10, 0, 10, 10, 0, 0], closed: true });
    expect(svg.toString()).toBe("M 0.00 0.00 L 10.00 0.00 L 10.00 10.00 L 0.00 0.00 Z");
    const empty = new SvgPath();
    traceRun(empty, { width: 3, pts: [] });
    expect(empty.toString()).toBe("");
  });
});
