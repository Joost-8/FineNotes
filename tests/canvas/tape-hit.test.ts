/**
 * A cover tape is hit, and found by the spatial index, over its whole band,
 * not only along the line between its ends: the eraser, the lasso's tap and
 * the tap that shows it through all reach it at its edges.
 */

import { describe, expect, it } from "vitest";
import { strokeHitByPoint } from "../../src/canvas/hit-test";
import { SpatialIndex } from "../../src/canvas/spatial-index";
import type { Stroke } from "../../src/model/document";

const tape: Stroke = {
  id: "t",
  color: "#e6d3a3",
  size: 40,
  tool: "tape",
  pts: [100, 100, 0.5, 300, 100, 0.5],
};

describe("a cover tape", () => {
  it("is hit anywhere on its band, and within reach of it", () => {
    expect(strokeHitByPoint(tape, 200, 118, 0)).toBe(true);
    expect(strokeHitByPoint(tape, 200, 125, 0)).toBe(false);
    expect(strokeHitByPoint(tape, 200, 125, 6)).toBe(true);
    // A pen line as thick is only hit along its centre line.
    expect(strokeHitByPoint({ ...tape, tool: "pen" }, 200, 118, 0)).toBe(false);
  });

  it("is listed in the index over its band", () => {
    const index = new SpatialIndex();
    index.insert(tape);
    expect(index.queryPoint(200, 118, 0).has("t")).toBe(true);
  });
});
