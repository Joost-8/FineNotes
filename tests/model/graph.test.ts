import { describe, expect, it } from "vitest";
import {
  type GraphRange,
  type Polyline,
  MAX_SPAN,
  MIN_SPAN,
  compileGraph,
  defaultRange,
  fitRange,
  formatTick,
  minorStep,
  nextPinName,
  niceTicks,
  panRange,
  sampleCurve,
  sampleGraph,
  toScreen,
  toValue,
  traceAt,
  zoomRange,
} from "../../src/model/graph";

const RANGE: GraphRange = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
const W = 400;
const H = 400;

/** Largest vertical screen distance between a polyline and the true curve at its vertices and midpoints. */
function worstError(fn: (x: number) => number, lines: Polyline[], range = RANGE): number {
  let worst = 0;
  for (const line of lines) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const xm = (line[i] + line[i + 2]) / 2;
      const ym = (line[i + 1] + line[i + 3]) / 2;
      const truth = fn(xm);
      if (truth > range.yMax || truth < range.yMin) continue;
      worst = Math.max(worst, (Math.abs(truth - ym) * H) / (range.yMax - range.yMin));
    }
  }
  return worst;
}

/** The largest vertical step between two consecutive points, in px. */
function tallestStep(lines: Polyline[], range = RANGE): number {
  let worst = 0;
  for (const line of lines) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const a = toScreen(range, W, H, line[i], line[i + 1]);
      const b = toScreen(range, W, H, line[i + 2], line[i + 3]);
      const inView = (a.py >= 0 && a.py <= H) || (b.py >= 0 && b.py <= H) || a.py < 0 !== b.py < 0;
      if (inView && Math.abs(b.px - a.px) < 0.5) worst = Math.max(worst, Math.abs(b.py - a.py));
    }
  }
  return worst;
}

describe("sampleCurve", () => {
  it("draws a smooth curve as one line within half a pixel", () => {
    const lines = sampleCurve(Math.sin, RANGE, W, H);
    expect(lines).toHaveLength(1);
    expect(worstError(Math.sin, lines)).toBeLessThan(0.6);
    // It spans the frame and a little beyond.
    expect(lines[0][0]).toBeLessThan(RANGE.xMin);
    expect(lines[0][lines[0].length - 2]).toBeGreaterThan(RANGE.xMax);
  });

  it("adds points only where the curve bends", () => {
    const straight = sampleCurve((x) => 2 * x + 1, RANGE, W, H)[0].length / 2;
    const wiggly = sampleCurve((x) => Math.sin(5 * x), RANGE, W, H)[0].length / 2;
    expect(straight).toBeLessThan(140);
    expect(wiggly).toBeGreaterThan(straight);
    expect(
      worstError(
        (x) => Math.sin(5 * x),
        sampleCurve((x) => Math.sin(5 * x), RANGE, W, H),
      ),
    ).toBeLessThan(0.6);
  });

  it("breaks at an asymptote instead of drawing a vertical line", () => {
    const tan = sampleCurve(Math.tan, RANGE, W, H);
    // tan has asymptotes at ±π/2, ±3π/2, ±5π/2 inside [−10, 10]: 7 branches.
    expect(tan.length).toBe(7);
    expect(tallestStep(tan)).toBeLessThan(H);
    const recip = sampleCurve((x) => 1 / x, RANGE, W, H);
    expect(recip.length).toBe(2);
    expect(recip[0][recip[0].length - 2]).toBeLessThan(0);
    expect(recip[1][0]).toBeGreaterThan(0);
  });

  it("breaks at a jump", () => {
    const steps = sampleCurve((x) => Math.floor(x), RANGE, W, H);
    expect(steps.length).toBeGreaterThanOrEqual(20);
    expect(tallestStep(steps)).toBeLessThan(2.5);
  });

  it("starts and stops at the edge of the domain", () => {
    const root = sampleCurve(Math.sqrt, RANGE, W, H);
    expect(root).toHaveLength(1);
    expect(root[0][0]).toBeGreaterThanOrEqual(0);
    expect(root[0][0]).toBeLessThan(0.01);
    const log = sampleCurve((x) => Math.log(4 - x * x), RANGE, W, H);
    expect(log).toHaveLength(1);
    expect(log[0][0]).toBeGreaterThan(-2);
    expect(log[0][log[0].length - 2]).toBeLessThan(2);
    expect(sampleCurve(() => Number.NaN, RANGE, W, H)).toEqual([]);
  });

  it("keeps far-off points within a few view heights", () => {
    for (const line of sampleCurve((x) => Math.exp(x * 10), RANGE, W, H)) {
      for (let i = 1; i < line.length; i += 2) expect(Math.abs(line[i])).toBeLessThanOrEqual(90);
    }
  });

  it("stays within its call budget on a wild function", () => {
    let calls = 0;
    const lines = sampleCurve(
      (x) => {
        calls++;
        return Math.sin(1 / x);
      },
      RANGE,
      W,
      H,
    );
    expect(calls).toBeLessThan(40_000);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("works at any size and range", () => {
    expect(sampleCurve((x) => x, RANGE, 0, 0).length).toBe(1);
    const tiny = { xMin: 1, xMax: 1 + 1e-6, yMin: 0.84, yMax: 0.85 };
    expect(worstError(Math.sin, sampleCurve(Math.sin, tiny, W, H), tiny)).toBeLessThan(0.6);
  });
});

describe("compileGraph and sampleGraph", () => {
  it("draws what compiles and reports what does not", () => {
    const spec = { ...RANGE, expressions: ["y = x^2", "sin(", "q + 1"], angle: "rad" as const };
    const { fns, errors } = compileGraph(spec);
    expect(fns[0]?.(3)).toBe(9);
    expect(fns[1]).toBeNull();
    expect(errors).toEqual([null, "Syntax error", "Unknown name: q"]);
    const { curves } = sampleGraph(spec, W, H);
    expect(curves[0].length).toBe(1);
    expect(curves[1]).toEqual([]);
  });

  it("reads trig in degrees when told", () => {
    const { fns } = compileGraph({ expressions: ["sin(x)"], angle: "deg" });
    expect(fns[0]?.(90)).toBeCloseTo(1, 12);
    const { fns: rad } = compileGraph({ expressions: ["sin(x)"] });
    expect(rad[0]?.(Math.PI / 2)).toBeCloseTo(1, 12);
  });
});

describe("ticks", () => {
  it("steps by 1, 2 or 5 times a power of ten", () => {
    expect(niceTicks(-10, 10, 400, 60)).toEqual({ step: 5, values: [-10, -5, 0, 5, 10] });
    expect(niceTicks(0, 1, 500, 60).step).toBe(0.2);
    expect(niceTicks(0, 1000, 300, 60).step).toBe(200);
    expect(niceTicks(-0.3, 0.3, 400, 50).values).toContain(0);
    expect(niceTicks(5, 5, 400, 60).values).toEqual([]);
    expect(niceTicks(0, 1, 0, 60).values).toEqual([]);
  });

  it("labels ticks without float noise", () => {
    expect(formatTick(0.30000000000000004, 0.1)).toBe("0.3");
    expect(formatTick(-2, 1)).toBe("−2");
    expect(formatTick(0, 1)).toBe("0");
    expect(formatTick(250, 50)).toBe("250");
    expect(formatTick(2e6, 1e6)).toBe("2e6");
    expect(formatTick(0.00002, 0.00001)).toBe("2e-5");
  });
});

describe("view", () => {
  it("maps screen and value space both ways", () => {
    const v = toValue(RANGE, W, H, 300, 100);
    expect(v).toEqual({ x: 5, y: 5 });
    expect(toScreen(RANGE, W, H, 5, 5)).toEqual({ px: 300, py: 100 });
  });

  it("pans with the finger", () => {
    expect(panRange(RANGE, W, H, 40, -20)).toEqual({ xMin: -12, xMax: 8, yMin: -11, yMax: 9 });
  });

  it("zooms about the point under the fingers, within limits", () => {
    const z = zoomRange(RANGE, W, H, 2, 300, 100);
    expect(z.xMax - z.xMin).toBe(10);
    expect(toValue(z, W, H, 300, 100)).toEqual({ x: 5, y: 5 });
    let deep = RANGE;
    for (let i = 0; i < 100; i++) deep = zoomRange(deep, W, H, 10, 200, 200);
    expect(deep.xMax - deep.xMin).toBeGreaterThanOrEqual(MIN_SPAN * 0.999);
    let wide = RANGE;
    for (let i = 0; i < 100; i++) wide = zoomRange(wide, W, H, 0.1, 200, 200);
    expect(wide.xMax - wide.xMin).toBeLessThanOrEqual(MAX_SPAN * 1.001);
    expect(zoomRange(RANGE, W, H, 0, 1, 1)).toBe(RANGE);
    expect(zoomRange(RANGE, W, H, Number.NaN, 1, 1)).toBe(RANGE);
  });

  it("fits y to the curves, ignoring spikes", () => {
    const fit = fitRange([Math.sin, null], RANGE);
    expect(fit.xMin).toBe(-10);
    expect(fit.yMax).toBeGreaterThan(1);
    expect(fit.yMax).toBeLessThan(1.3);
    const spiky = fitRange([(x) => 1 / x], RANGE);
    expect(spiky.yMax - spiky.yMin).toBeLessThan(200);
    expect(fitRange([() => Number.NaN], RANGE)).toBe(RANGE);
    const flat = fitRange([() => 3], RANGE);
    expect(flat.yMin).toBeLessThan(3);
    expect(flat.yMax).toBeGreaterThan(3);
  });

  it("traces the nearest curve under a tap", () => {
    const fns = [(x: number) => x, (x: number) => -x, null];
    const hit = traceAt(fns, RANGE, W, H, 300, 98);
    expect(hit).toEqual({ index: 0, x: 5, y: 5 });
    expect(traceAt(fns, RANGE, W, H, 300, 302)?.index).toBe(1);
    expect(traceAt(fns, RANGE, W, H, 300, 200)).toBeNull();
    expect(traceAt([() => Number.NaN], RANGE, W, H, 1, 1)).toBeNull();
  });

  it("has a square default view", () => {
    expect(defaultRange(400, 200)).toEqual({ xMin: -10, xMax: 10, yMin: -5, yMax: 5 });
    expect(defaultRange(400, 200, "deg")).toEqual({ xMin: -360, xMax: 360, yMin: -5, yMax: 5 });
  });
});

describe("minor grid and pin names", () => {
  it("puts minor lines on round numbers between the major ones", () => {
    expect(minorStep(1)).toBeCloseTo(0.2, 12);
    expect(minorStep(5)).toBeCloseTo(1, 12);
    expect(minorStep(2)).toBeCloseTo(0.5, 12);
    expect(minorStep(20)).toBeCloseTo(5, 12);
    expect(minorStep(0.05)).toBeCloseTo(0.01, 12);
    expect(minorStep(0.2)).toBeCloseTo(0.05, 12);
  });

  it("names pins A, B, … and reuses a freed letter", () => {
    expect(nextPinName([])).toBe("A");
    expect(nextPinName([{ line: "l1", x: 0, name: "A" }])).toBe("B");
    expect(
      nextPinName([
        { line: "l1", x: 0, name: "B" },
        { line: "l1", x: 1 },
      ]),
    ).toBe("A");
    const all = Array.from({ length: 26 }, (_, i) => ({
      line: "l1",
      x: i,
      name: String.fromCharCode(65 + i),
    }));
    expect(nextPinName(all)).toBeNull();
  });
});
