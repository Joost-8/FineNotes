import { describe, expect, it } from "vitest";
import { recognizeShape } from "../../src/ink/shape-recognizer";

/** A straight run of pen samples, 1 px of wobble, `step` page px apart. */
function run(x0: number, y0: number, x1: number, y1: number, step: number): number[] {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(
      x0 + (x1 - x0) * t + Math.sin(i * 0.7) * 0.4,
      y0 + (y1 - y0) * t + Math.cos(i * 0.5) * 0.4,
      0.5,
    );
  }
  return out;
}

describe("small handwriting is not a shape (FineNotes#36)", () => {
  // A "1" with its tick, 28 px tall: the whole stroke fits inside the fixed
  // closing gap, so it used to read as a closed loop and snap to a triangle.
  const smallOne = [...run(90, 100, 100, 92, 1), ...run(100, 92, 100, 120, 1)];

  it("stays ink on lift", () => {
    expect(recognizeShape(smallOne)).toBeNull();
  });

  it("stays ink on a hold", () => {
    expect(recognizeShape(smallOne, { held: true })).toBeNull();
  });

  it("still snaps a loop drawn at the same size once it is a real closed shape", () => {
    const square = [
      ...run(100, 100, 160, 100, 1.5),
      ...run(160, 100, 160, 160, 1.5),
      ...run(160, 160, 100, 160, 1.5),
      ...run(100, 160, 100, 100, 1.5),
    ];
    expect(recognizeShape(square)?.kind).toBe("rect");
  });
});
