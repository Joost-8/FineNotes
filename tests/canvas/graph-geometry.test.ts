/** `src/canvas/graph-geometry.ts`: the resolution a graph's curves are sampled for. */

import { describe, expect, it } from "vitest";
import { GRAPH_MAX_SAMPLES, GRAPH_MIN_SAMPLES, sampleCount } from "../../src/canvas/graph-geometry";

describe("sampleCount", () => {
  it("asks for the frame's width in device px, as a power of two", () => {
    expect(sampleCount(300, 2)).toBe(1024);
    expect(sampleCount(300, 1)).toBe(512);
    expect(sampleCount(256, 1)).toBe(256);
  });

  it("shares one resolution across nearby zoom levels", () => {
    expect(sampleCount(300, 1.5)).toBe(sampleCount(300, 1.6));
  });

  it("stays inside its limits, and survives nonsense", () => {
    expect(sampleCount(10, 0.1)).toBe(GRAPH_MIN_SAMPLES);
    expect(sampleCount(4000, 8)).toBe(GRAPH_MAX_SAMPLES);
    expect(sampleCount(Number.NaN, 1)).toBe(GRAPH_MIN_SAMPLES);
    expect(sampleCount(300, Infinity)).toBe(GRAPH_MIN_SAMPLES);
  });
});
