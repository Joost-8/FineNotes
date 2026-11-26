import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EVENNESS_SCALE,
  UNMEASURED,
  evennessOf,
  feetOf,
  lettersOf,
  roughness,
  unevenness,
} from "../../../src/recognition/writer/evenness";
import { ROW, type Rows, curvePoints } from "../../../src/recognition/writer/rows";
import { UNIT_LIFT, straighten } from "../../../src/recognition/writer/straighten";

/** Four lines Dostoyev 2.0 wrote, with what research/handwriting-rig/gen/pretty.py gives for them (gen/pretty_fixture.py). */
interface FixtureLine {
  text: string;
  char: number[];
  rows: number[][];
  measure: Record<string, number | null>;
  ugly: number;
  at07: number[][];
  at07_ugly: number;
  at10: number[][];
  at10_ugly: number;
}
const FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/straighten.json"), "utf8"),
) as { scale: Record<string, number>; lines: FixtureLine[] };

const rowsOf = (rows: number[][]): Rows => ({ x: Float32Array.from(rows.flat()), n: rows.length });

/** A row: end displacement, straight arms, pen up or down. */
const row = (dx: number, dy: number, up = false): number[] => [
  dx,
  dy,
  dx / 3,
  dy / 3,
  -dx / 3,
  -dy / 3,
  0,
  0,
  0,
  up ? 1 : 0,
];

describe("evennessOf", () => {
  it("uses the scale the research measured", () => {
    expect(EVENNESS_SCALE).toEqual(FIXTURE.scale);
  });

  it.each(FIXTURE.lines.map((line) => [line.text, line] as const))(
    "measures %s as the research does",
    (_, line) => {
      const m = evennessOf(rowsOf(line.rows), line.char, line.text);
      for (const [part, want] of Object.entries(line.measure)) {
        // `xh` and `lean` are the research's own notes, not parts of the measure.
        if (!(part in m)) continue;
        const got = m[part as keyof typeof m];
        if (want === null) expect(got).toBeNaN();
        else expect(got).toBeCloseTo(want, 4);
      }
      expect(unevenness(m)).toBeCloseTo(line.ugly, 4);
    },
  );

  it("says nothing of a line of two letters, and gives no number for one part", () => {
    const r = rowsOf([row(0, 1), row(1, -1, true), row(0, 1)]);
    const m = evennessOf(r, [0, 1, 1], "ab");
    expect(Object.values(m).every(Number.isNaN)).toBe(true);
    expect(unevenness(m)).toBeNaN();
    expect(unevenness({ ...m, base: 0.2 })).toBeNaN();
    expect(unevenness({ ...m, base: 0.221, size: 0.311 })).toBeCloseTo(1);
  });

  it("gives a line too short to measure one fixed roughness, so its tries tie", () => {
    const r = rowsOf([row(0, 1), row(1, -1, true), row(0, 1)]);
    expect(roughness(r, [0, 1, 1], "ab")).toBe(UNMEASURED);
    const line = FIXTURE.lines[0];
    expect(roughness(rowsOf(line.rows), line.char, line.text)).toBeCloseTo(line.ugly, 4);
  });

  it("takes f for a foot only when a word has no other", () => {
    // "of": o stands on 0, f goes under the line.
    const r = rowsOf([row(0, 0.4), row(0.5, -1, true), row(0, 1)]);
    const letters = lettersOf(r, [0, 1, 1], "of");
    expect(feetOf(letters).map((q) => q.c)).toEqual(["o"]);
    expect(feetOf(letters.filter((q) => q.c === "f")).map((q) => q.c)).toEqual(["f"]);
  });
});

describe("straighten", () => {
  it.each(FIXTURE.lines.map((line) => [line.text, line] as const))(
    "straightens %s as the research does",
    (_, line) => {
      const r = rowsOf(line.rows);
      for (const [strength, want, ugly] of [
        [0.7, line.at07, line.at07_ugly],
        [1, line.at10, line.at10_ugly],
      ] as const) {
        const out = straighten(r, line.char, line.text, strength);
        expect(out.n).toBe(r.n);
        let worst = 0;
        want.forEach((w, i) =>
          w.forEach((v, j) => {
            worst = Math.max(worst, Math.abs(out.x[i * ROW + j] - v));
          }),
        );
        expect(worst).toBeLessThan(5e-5);
        // Times and pen-up are not touched.
        for (let i = 0; i < r.n; i++) {
          for (let j = 6; j < ROW; j++) expect(out.x[i * ROW + j]).toBe(r.x[i * ROW + j]);
        }
        expect(unevenness(evennessOf(out, line.char, line.text))).toBeCloseTo(ugly, 4);
        expect(ugly).toBeLessThan(line.ugly);
      }
    },
  );

  it("is more even the stronger it is", () => {
    for (const line of FIXTURE.lines) {
      const r = rowsOf(line.rows);
      const at = (s: number): number =>
        unevenness(evennessOf(straighten(r, line.char, line.text, s), line.char, line.text));
      expect(at(1)).toBeLessThan(at(0.4));
      expect(at(0.4)).toBeLessThan(at(0));
      expect(at(0)).toBeLessThan(line.ugly);
    }
  });

  it("returns the line itself when it cannot be measured", () => {
    const r = rowsOf([row(0, 1), row(1, -1, true), row(0, 1)]);
    expect(straighten(r, null, "ab", 1)).toBe(r);
    expect(straighten(r, [0, 1], "ab", 1)).toBe(r);
    const one = rowsOf([row(0, 1)]);
    expect(straighten(one, [0], "a", 1)).toBe(one);
    const empty = rowsOf([]);
    expect(straighten(empty, [], "", 1)).toBe(empty);
  });

  it("sets words on one level and turns a rising word flat", () => {
    // "nun mum": each letter a down stroke of 0.4; the second word stands 0.3 higher and rises 0.1 a letter.
    const rows: number[][] = [];
    const char: number[] = [];
    const text = "nun mum";
    let y = 0;
    Array.from(text).forEach((c, i) => {
      if (c === " ") return;
      const rise = i > 3 ? 0.1 : 0;
      const jump = i === 4 ? 0.3 : 0;
      // Move to the letter's top, then draw it down.
      rows.push(row(0.5, 0.4 + rise + jump - y, true), row(0, -0.4));
      char.push(i, i);
      y = 0;
    });
    const r = rowsOf(rows);
    const feet = (q: Rows): number[] => lettersOf(q, char, text).map((l) => l.y0);
    const before = feet(r);
    expect(Math.max(...before) - Math.min(...before)).toBeGreaterThan(0.4);
    const after = feet(straighten(r, char, text, 0));
    expect(Math.max(...after) - Math.min(...after)).toBeLessThan(1e-6);
  });

  it("moves joined letters as one and a lone letter to its word's foot line", () => {
    // "anna": a, then "nn" written without a lift, then a last a standing 0.1 high.
    const text = "anna";
    const rows = [
      row(0, 0.4, true),
      row(0, -0.4), // a
      row(0.4, 0.4, true),
      row(0, -0.4), // n
      row(0.3, 0.2), // joined on to the next n, which ends 0.2 high
      row(0.4, 0.3, true),
      row(0, -0.4), // a, 0.1 high
    ];
    const char = [0, 0, 1, 1, 2, 3, 3];
    const r = rowsOf(rows);
    const out = straighten(r, char, text, 1);
    const pts = (q: Rows): Float64Array => curvePoints(q, 2).pts;
    const a = pts(r);
    const b = pts(out);
    // The joined unit (rows 3 and 4) keeps its shape: its two rows move by the same amount.
    const moved = (i: number): number => b[i * 4 + 1] - a[i * 4 + 1];
    expect(moved(3)).toBeCloseTo(moved(4), 6);
    // No unit moves further than the limit.
    const xh = 0.4;
    for (let i = 0; i < r.n; i++) expect(Math.abs(moved(i))).toBeLessThan(2 * UNIT_LIFT * xh);
    // The letters' feet are nearer one line than before.
    const feet = (q: Rows): number[] => lettersOf(q, char, text).map((l) => l.y0);
    const spreadOf = (v: number[]): number => Math.max(...v) - Math.min(...v);
    expect(spreadOf(feet(out))).toBeLessThan(spreadOf(feet(r)));
  });
});
