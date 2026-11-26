import { describe, expect, it } from "vitest";

import { measureHand } from "../../../src/ink/tidy";
import { placeLines } from "../../../src/recognition/writer/layout";
import { ROW, type Rows } from "../../../src/recognition/writer/rows";
import {
  LEAST_X_PER_PEN,
  inkXHeight,
  leastXHeight,
  writtenXHeight,
} from "../../../src/recognition/writer/x-height";
import { writerLine, writtenLine, ys } from "./fixture";

/** A stroke from y0 to y1 (page px, y down) at x. */
const upright = (x: number, y0: number, y1: number) => ({ pts: [x, y0, 0.5, x, y1, 0.5] });

describe("inkXHeight", () => {
  it("is the median height of strokes read as x-height letters only", () => {
    const strokes = [
      upright(0, 100, 110), // a
      upright(5, 100, 112), // e
      upright(9, 100, 111), // n
      upright(12, 80, 110), // t: an ascender
      upright(15, 100, 140), // n and g in one stroke: a descender
    ];
    const chars = [
      { char: "a", strokes: [0] },
      { char: "e", strokes: [1] },
      { char: "n", strokes: [2] },
      { char: "t", strokes: [3] },
      { char: "n", strokes: [4] },
      { char: "g", strokes: [4] },
    ];
    expect(inkXHeight(strokes, chars)).toBe(11);
  });

  it("is null with fewer than two such strokes", () => {
    expect(inkXHeight([upright(0, 0, 10)], [{ char: "a", strokes: [0] }])).toBeNull();
    expect(
      inkXHeight([upright(0, 0, 30), upright(5, 0, 30)], [{ char: "t", strokes: [0, 1] }]),
    ).toBeNull();
  });
});

/** Rows of straight moves: each `[dx, dy, letter]`, pen down. */
function rows(moves: [number, number, number][]): { r: Rows; char: Int32Array } {
  const x = new Float32Array(moves.length * ROW);
  moves.forEach(([dx, dy], i) => {
    x[i * ROW] = dx;
    x[i * ROW + 1] = dy;
  });
  return { r: { x, n: moves.length }, char: Int32Array.from(moves.map((m) => m[2])) };
}

describe("writtenXHeight", () => {
  it("is the median height of the curves written for each x-height letter", () => {
    // "at": the a 0.4 tall, the t 1.0 (left out).
    const { r, char } = rows([
      [0.1, 0.4, 0],
      [0.1, -0.4, 0],
      [0.1, 1.0, 1],
      [0.1, -1.0, 1],
    ]);
    expect(writtenXHeight(r, char, "at")).toBeNull(); // one x-height letter only
    const two = rows([
      [0.1, 0.4, 0],
      [0.1, -0.4, 0],
      [0.1, 0.5, 1],
      [0.1, -0.5, 1],
      [0.1, 1.0, 2],
      [0.1, -1.0, 2],
    ]);
    expect(writtenXHeight(two.r, two.char, "aet")).toBeCloseTo(0.45, 5);
  });
});

describe("leastXHeight", () => {
  it("is a few pen widths, and nothing for a pen of no width", () => {
    expect(leastXHeight(2)).toBe(2 * LEAST_X_PER_PEN);
    expect(leastXHeight(0)).toBe(0);
    expect(leastXHeight(Number.NaN)).toBe(0);
  });
});

describe("placeLines with x-heights (Joost, 25 November: the size of his own words)", () => {
  const line = writerLine(40, 100);
  const profile = measureHand(line.strokes);
  if (!profile) throw new Error("no hand");
  // writtenLine's letters stand 0.389 model units tall.
  const place = (ink: number, least: number) => {
    const [placed] = placeLines(
      [
        {
          strokes: line.strokes,
          words: line.words,
          rewrite: [false, true, true, false],
          written: writtenLine(),
          xHeight: { ink, written: 0.389, least },
        },
      ],
      profile,
    );
    const y = placed.added.flatMap((s) => ys(s.pts));
    return Math.max(...y) - Math.min(...y);
  };

  it("writes the new words at the writer's x-height on that line", () => {
    expect(place(12, 0)).toBeCloseTo(12, 0);
    expect(place(30, 0)).toBeCloseTo(30, 0);
  });

  it("writes them larger only where the writer's is under the least the model writes legibly", () => {
    expect(place(3, 9)).toBeCloseTo(9, 0);
  });
});
