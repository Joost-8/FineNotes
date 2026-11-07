import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURVE_RAW, orderCurves } from "../../src/recognition/hwr/curves";

interface Case {
  raw: number[][];
  moved: number;
  out: number[][] | null;
}

const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "hwr-order.json"), "utf8")) as {
  cases: Case[];
};

function curves(rows: number[][]) {
  const features = new Float32Array(rows.length * CURVE_RAW);
  rows.forEach((r, i) => r.forEach((v, j) => (features[i * CURVE_RAW + j] = v)));
  return { features, frames: rows.length, curveStroke: new Int32Array(rows.length) };
}

describe("orderCurves (sym_order.py port)", () => {
  it("moves the same strokes to the same places as the reference, to the bit", () => {
    let moved = 0;
    for (const c of fx.cases) {
      const input = curves(c.raw);
      const got = orderCurves(input);
      if (c.out === null) {
        expect(got).toBe(input);
        continue;
      }
      moved++;
      expect(got.frames).toBe(c.out.length);
      expect(Array.from(got.features)).toEqual(Array.from(curves(c.out).features));
    }
    expect(moved).toBeGreaterThan(10);
  });

  it("leaves a line written left to right alone", () => {
    const rows = [
      [0.2, 0, 0.07, 0, -0.07, 0, 0.2, 0, 0, 0],
      [0.1, 0, 0.03, 0, -0.03, 0, 0.1, 0, 0, 1],
      [0.2, 0.1, 0.07, 0.03, -0.07, -0.03, 0.2, 0, 0, 0],
    ];
    const input = curves(rows);
    expect(orderCurves(input)).toBe(input);
  });
});
