/** `src/canvas/graph-geometry.ts`: sample counts, grid ticks, and curves broken at gaps and asymptotes. */

import { describe, expect, it } from "vitest";
import {
  GRAPH_MAX_SAMPLES,
  GRAPH_MIN_SAMPLES,
  frameX,
  frameY,
  niceStep,
  sampleCount,
  sampleXs,
  tickLabel,
  ticks,
  valueRuns,
} from "../../src/canvas/graph-geometry";

const MINUS = String.fromCharCode(0x2212);

describe("sampleCount", () => {
  it("asks for about a sample a device pixel, as a power of two", () => {
    expect(sampleCount(300, 2)).toBe(1024);
    expect(sampleCount(300, 1)).toBe(512);
    expect(sampleCount(256, 1)).toBe(256);
  });

  it("shares one count across nearby zoom levels", () => {
    expect(sampleCount(300, 1.5)).toBe(sampleCount(300, 1.6));
  });

  it("stays inside its limits, and survives nonsense", () => {
    expect(sampleCount(10, 0.1)).toBe(GRAPH_MIN_SAMPLES);
    expect(sampleCount(4000, 8)).toBe(GRAPH_MAX_SAMPLES);
    expect(sampleCount(Number.NaN, 1)).toBe(GRAPH_MIN_SAMPLES);
    expect(sampleCount(300, Infinity)).toBe(GRAPH_MIN_SAMPLES);
  });
});

describe("sampleXs", () => {
  it("runs from end to end, both included", () => {
    const xs = sampleXs([-1, 1], 5);
    expect([...xs]).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(sampleXs([0, 0.3], 7)[6]).toBe(0.3);
    expect(sampleXs([0, 1], 1)).toHaveLength(2);
  });
});

describe("niceStep, ticks and tickLabel", () => {
  it("steps by 1, 2 or 5 times a power of ten", () => {
    expect(niceStep(10, 10)).toBe(1);
    expect(niceStep(10, 4)).toBe(5);
    expect(niceStep(10, 6)).toBe(2);
    expect(niceStep(0.03, 3)).toBeCloseTo(0.01, 15);
    expect(niceStep(950, 1)).toBe(1000);
    expect(niceStep(0, 5)).toBe(1);
    expect(niceStep(10, 0)).toBe(1);
  });

  it("lists the multiples in range, with zero exact", () => {
    expect(ticks([-2.5, 2.5], 1)).toEqual([-2, -1, 0, 1, 2]);
    expect(ticks([0.1, 0.35], 0.1).map((t) => Number(t.toFixed(10)))).toEqual([0.1, 0.2, 0.3]);
    expect(ticks([-1, 1], 0)).toEqual([]);
    expect(ticks([0, 1e6], 1, 10)).toHaveLength(12);
  });

  it("writes as many decimals as the step needs, with a real minus", () => {
    expect(tickLabel(0, 1)).toBe("0");
    expect(tickLabel(2, 1)).toBe("2");
    expect(tickLabel(0.30000000000000004, 0.1)).toBe("0.3");
    expect(tickLabel(-1.5, 0.5)).toBe(`${MINUS}1.5`);
    expect(tickLabel(2e7, 1e7)).toBe("2e+7");
    expect(tickLabel(3e-6, 1e-6)).toBe("3e-6");
  });
});

describe("frame mapping and valueRuns", () => {
  const map = {
    xRange: [-1, 1] as [number, number],
    yRange: [-1, 1] as [number, number],
    w: 200,
    h: 100,
  };

  it("maps values into the frame, y upwards", () => {
    expect(frameX(map, -1)).toBe(0);
    expect(frameX(map, 1)).toBe(200);
    expect(frameY(map, 1)).toBe(0);
    expect(frameY(map, -1)).toBe(100);
  });

  it("keeps a defined curve as one run in value space", () => {
    expect(valueRuns([-1, 0, 1], [-1, 0, 1], [-1, 1])).toEqual([[-1, -1, 0, 0, 1, 1]]);
  });

  it("breaks at an undefined value, and drops lone points", () => {
    const runs = valueRuns([-1, -0.5, 0, 0.5, 1], [0, 0, Number.NaN, 0, Infinity], [-1, 1]);
    expect(runs).toEqual([[-1, 0, -0.5, 0]]);
  });

  it("breaks across an asymptote instead of joining it", () => {
    // 1/x sampled either side of 0: from far below to far above the view.
    const xs = [-0.5, -0.01, 0.01, 0.5];
    expect(
      valueRuns(
        xs,
        xs.map((x) => 1 / x),
        [-1, 1],
      ),
    ).toHaveLength(2);
  });

  it("keeps a steep but continuous curve whole", () => {
    expect(valueRuns([-1, 0, 1], [0, 1e9, 0], [-1, 1])).toHaveLength(1);
  });
});
