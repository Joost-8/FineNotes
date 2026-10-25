/**
 * `src/model/calc-ink.ts`: the "=" a line ends with, the sum's strokes on its
 * line, and where the answer goes. Synthetic ink with hand tremor (three
 * low-frequency sinusoids, ledger "Synthetic test ink must model tremor"),
 * on ruled paper and on blank paper, at two sizes.
 */

import { describe, expect, it } from "vitest";
import { writingLines } from "../../src/canvas/backdrop";
import { answerPlace, equalsAtEnd, isSumInk, sumStrokes } from "../../src/model/calc-ink";
import type { Stroke } from "../../src/model/document";

const A4 = { width: 1024, height: 1448 };
const RULED = writingLines({ kind: "ruled-wide" }, A4);

let nextId = 0;
let seed = 7;
function random(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

/** A polyline through `pts`, sampled every 1.4 px, with tremor of about `amp` px. */
function stroke(pts: Array<[number, number]>, amp = 0.6, extra: Partial<Stroke> = {}): Stroke {
  const phases = [random(), random(), random()].map((p) => p * Math.PI * 2);
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / 1.4));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      s += len / n;
      const wobble =
        amp *
        (0.5 * Math.sin(s / 9 + phases[0]) +
          0.3 * Math.sin(s / 4 + phases[1]) +
          0.2 * Math.sin(s / 17 + phases[2]));
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + wobble, 0.5);
    }
  }
  const [lx, ly] = pts[pts.length - 1];
  out.push(lx, ly, 0.5);
  return { id: `s${++nextId}`, color: "#000", size: 2, tool: "pen", pts: out, ...extra };
}

/** A digit-like stroke: a narrow loop `h` tall with its foot on `baseline`. */
function digit(x: number, baseline: number, h: number): Stroke {
  const w = h * 0.55;
  return stroke([
    [x + w, baseline - h],
    [x, baseline - h * 0.6],
    [x + w * 0.9, baseline - h * 0.4],
    [x + w * 0.2, baseline],
  ]);
}

/** A "+" as two strokes. */
function plus(x: number, baseline: number, h: number): Stroke[] {
  const cy = baseline - h * 0.45;
  return [
    stroke([
      [x, cy],
      [x + h * 0.5, cy],
    ]),
    stroke([
      [x + h * 0.25, cy - h * 0.25],
      [x + h * 0.25, cy + h * 0.25],
    ]),
  ];
}

/** An "=" as two dashes, `h` the digits' height. */
function equals(x: number, baseline: number, h: number): Stroke[] {
  const w = h * 0.5;
  return [
    stroke([
      [x, baseline - h * 0.6],
      [x + w, baseline - h * 0.62],
    ]),
    stroke([
      [x + 1, baseline - h * 0.3],
      [x + w + 1, baseline - h * 0.28],
    ]),
  ];
}

/** "12+4=" from `x` on `baseline`, digits `h` tall: its strokes, in writing order. */
function sumLine(x: number, baseline: number, h: number): Stroke[] {
  const step = h * 0.75;
  return [
    digit(x, baseline, h),
    digit(x + step, baseline, h),
    ...plus(x + step * 2, baseline, h),
    digit(x + step * 3, baseline, h),
    ...equals(x + step * 4, baseline, h),
  ];
}

describe("equalsAtEnd", () => {
  it("finds an = drawn as the last two strokes, at any size", () => {
    for (const h of [8, 24, 60]) {
      const line = sumLine(100, 300, h);
      const eq = equalsAtEnd(line);
      expect(eq, `h ${h}`).not.toBeNull();
      expect(eq!.strokes.map((s) => s.id)).toEqual(line.slice(-2).map((s) => s.id));
      // The top dash first, whichever was drawn first.
      const swapped = [...line.slice(0, -2), line[line.length - 1], line[line.length - 2]];
      expect(equalsAtEnd(swapped)!.strokes[0].id).toBe(line[line.length - 2].id);
    }
  });

  it("ignores what is not an =", () => {
    const h = 24;
    // A + at the end: one dash and an upright stroke.
    expect(equalsAtEnd([digit(100, 300, h), ...plus(130, 300, h)])).toBeNull();
    // Two dashes far apart (a fraction bar over a minus).
    const far = [
      stroke([
        [100, 260],
        [112, 260],
      ]),
      stroke([
        [100, 300],
        [112, 300],
      ]),
    ];
    expect(equalsAtEnd(far)).toBeNull();
    // Side by side, not one above the other.
    const beside = [
      stroke([
        [100, 290],
        [112, 290],
      ]),
      stroke([
        [130, 292],
        [142, 292],
      ]),
    ];
    expect(equalsAtEnd(beside)).toBeNull();
    // Very different lengths.
    const unequal = [
      stroke([
        [100, 290],
        [104, 290],
      ]),
      stroke([
        [100, 298],
        [140, 298],
      ]),
    ];
    expect(equalsAtEnd(unequal)).toBeNull();
    // Too few strokes, or the last one a highlighter.
    expect(equalsAtEnd([digit(100, 300, h)])).toBeNull();
    const line = sumLine(100, 300, h);
    const highlighted = [
      ...line,
      stroke(
        [
          [90, 290],
          [200, 290],
        ],
        0.6,
        { tool: "highlighter" },
      ),
    ];
    expect(equalsAtEnd(highlighted)).not.toBeNull();
    expect(isSumInk(highlighted[highlighted.length - 1])).toBe(false);
    // A scribble is not a dash.
    const zigzag = [
      stroke([
        [100, 290],
        [104, 284],
        [108, 290],
        [112, 284],
        [116, 290],
      ]),
      stroke([
        [100, 298],
        [116, 298],
      ]),
    ];
    expect(equalsAtEnd(zigzag)).toBeNull();
  });
});

describe("sumStrokes", () => {
  it("takes the whole line on ruled paper, however long ago its start was written", () => {
    // On the line whose rule is y = 320 (rule 8), digits sitting on it.
    const line = sumLine(100, 318, 24);
    const above = sumLine(100, 278, 24).slice(0, 3);
    const below = sumLine(100, 358, 24).slice(0, 3);
    // Written in any order: the line above and below come after, in time.
    const page = [...line.slice(0, 3), ...above, ...below, ...line.slice(3)];
    const eq = equalsAtEnd(page)!;
    const got = sumStrokes(page, eq, RULED).map((s) => s.id);
    expect(got).toEqual(line.map((s) => s.id));
  });

  it("finds the line by a band around the = on blank paper", () => {
    for (const h of [10, 30]) {
      const line = sumLine(200, 500, h);
      const above = sumLine(200, 500 - h * 2.2, h).slice(0, 4);
      const page = [...above, ...line];
      const eq = equalsAtEnd(page)!;
      expect(
        sumStrokes(page, eq, []).map((s) => s.id),
        `h ${h}`,
      ).toEqual(line.map((s) => s.id));
    }
  });

  it("stops at a wide gap: an earlier sum on the same line is left out", () => {
    const h = 24;
    const first = sumLine(60, 318, h).slice(0, 4);
    const second = sumLine(400, 318, h);
    const page = [...first, ...second];
    const got = sumStrokes(page, equalsAtEnd(page)!, RULED).map((s) => s.id);
    expect(got).toEqual(second.map((s) => s.id));
    // Ink right of the "=" is not part of the sum.
    const after = digit(400 + h * 0.75 * 6, 318, h);
    const withAfter = [after, ...second];
    expect(sumStrokes(withAfter, equalsAtEnd(withAfter)!, RULED).map((s) => s.id)).not.toContain(
      after.id,
    );
  });

  it("keeps a decimal point that sits below the line's middle", () => {
    const h = 24;
    const point = stroke(
      [
        [140, 317],
        [141, 318],
      ],
      0.1,
    );
    const line = sumLine(100, 318, h);
    const page = [...line.slice(0, 2), point, ...line.slice(2)];
    const got = sumStrokes(page, equalsAtEnd(page)!, RULED).map((s) => s.id);
    expect(got).toContain(point.id);
    const blank = sumStrokes(page, equalsAtEnd(page)!, []).map((s) => s.id);
    expect(blank).toContain(point.id);
  });
});

describe("answerPlace", () => {
  it("puts the answer after the =, on the digits' baseline, as tall as they are", () => {
    for (const h of [10, 24, 50]) {
      const line = sumLine(100, 318, h);
      const eq = equalsAtEnd(line)!;
      const place = answerPlace(sumStrokes(line, eq, RULED), eq);
      expect(place.x).toBeGreaterThan(eq.bounds.maxX);
      expect(place.x - eq.bounds.maxX).toBeLessThan(h * 0.5);
      expect(Math.abs(place.baseline - 318)).toBeLessThan(h * 0.15 + 1);
      expect(place.height / h).toBeGreaterThan(0.85);
      expect(place.height / h).toBeLessThan(1.15);
    }
  });

  it("sizes by the = when there is nothing else on the line", () => {
    const eq = equalsAtEnd(equals(100, 318, 24))!;
    const place = answerPlace(eq.strokes, eq);
    expect(place.height).toBeGreaterThan(10);
    expect(place.x).toBeGreaterThan(eq.bounds.maxX);
    expect(place.baseline).toBeGreaterThan(eq.bounds.maxY);
  });
});
