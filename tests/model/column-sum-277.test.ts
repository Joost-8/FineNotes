/**
 * FineNotes#277, "Column sum not reliable", on the reporter's own ink
 * (`tests/ink/fixtures/column-sum-277.json`, whole px as iPadOS 17 records
 * it): a plus left of the amount (a), a plus close enough to read as "-1"
 * (b), and a column beside another sum, one row per ruled line, that never
 * added up (c).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Column, columnAbove, parseAmount, ruleAtEnd } from "../../src/model/column-sum";
import type { Stroke } from "../../src/model/document";

interface Case {
  rows: Stroke[][];
  rule: Stroke[];
  plus?: Stroke[];
  minus?: Stroke[];
  left?: Stroke[];
}

const fixture = JSON.parse(
  readFileSync("tests/ink/fixtures/column-sum-277.json", "utf8"),
) as Record<"a" | "b" | "c", Case>;

/** `strokes` moved by dx, dy (whole px), under new ids. */
function moved(strokes: readonly Stroke[], dx: number, dy: number, tag = "m"): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    id: `${s.id}${tag}`,
    pts: s.pts.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v)),
  }));
}

/** The column the line (drawn last) closes, or null. */
function columnOf(strokes: Stroke[]): Column | null {
  const rule = ruleAtEnd(strokes);
  expect(rule).not.toBeNull();
  return columnAbove(strokes, rule!);
}

const ids = (strokes: readonly Stroke[]): string[] => strokes.map((s) => s.id).sort();

describe("FineNotes#277 on the reporter's ink", () => {
  it("(a) a plus left of the amount is the row's sign, not part of the amount", () => {
    const { rows, plus, rule } = fixture.a;
    const column = columnOf([...rows.flat(), ...plus!, ...rule]);
    expect(column?.rows).toHaveLength(2);
    expect(ids(column!.rows[0].amount)).toEqual(ids(rows[0]));
    expect(ids(column!.rows[1].amount)).toEqual(ids(rows[1]));
    expect(ids(column!.rows[1].signStrokes)).toEqual(ids(plus!));
    expect(column!.rows[1].sign).toBe(1);
  });

  it("(b) a plus written close to 17 is taken out before Grape reads it", () => {
    const { rows, plus, rule } = fixture.b;
    const column = columnOf([...rows.flat(), ...plus!, ...rule]);
    expect(column?.rows).toHaveLength(2);
    expect(ids(column!.rows[1].amount)).toEqual(ids(rows[1]));
    expect(column!.rows[1].sign).toBe(1);
  });

  it("(c) a column one row per ruled line, beside another sum, adds up all three rows", () => {
    const { rows, minus, rule, left } = fixture.c;
    const column = columnOf([...left!, ...rows.flat(), ...minus!, ...rule]);
    expect(column?.rows).toHaveLength(3);
    column!.rows.forEach((row, i) => expect(ids(row.amount)).toEqual(ids(rows[i])));
    // The reporter's minus is 1.46 digits wide.
    expect(column!.rows.map((r) => r.sign)).toEqual([1, -1, 1]);
    expect(ids(column!.rows[1].signStrokes)).toEqual(ids(minus!));
  });

  it("(c) the sum beside it, half a line lower, neither splits the column nor ends it", () => {
    const { rows, minus, rule, left } = fixture.c;
    const lower = moved(left!, 0, 42);
    const column = columnOf([...lower, ...rows.flat(), ...minus!, ...rule]);
    expect(column?.rows).toHaveLength(3);
    column!.rows.forEach((row, i) => expect(ids(row.amount)).toEqual(ids(rows[i])));
    // Nothing of the other sum is read as an amount.
    const amounts = new Set(column!.rows.flatMap((r) => r.amount.map((s) => s.id)));
    expect(lower.some((s) => amounts.has(s.id))).toBe(false);
  });

  it("a plus on a line of its own above the column changes nothing", () => {
    const { rows, plus, rule } = fixture.a;
    const above = moved(plus!, 0, -45);
    const column = columnOf([...rows.flat(), ...above, ...rule]);
    expect(column?.rows).toHaveLength(2);
    expect(column!.rows.every((r) => r.sign === 1)).toBe(true);
    expect(ids(column!.rows[0].amount)).toEqual(ids(rows[0]));
  });

  it("a plus after the amount is taken out of it", () => {
    const { rows, plus, rule } = fixture.a;
    // Right of 13, a third of a digit clear of it.
    const after = moved(plus!, 112, 0);
    const column = columnOf([...rows.flat(), ...after, ...rule]);
    expect(ids(column!.rows[1].amount)).toEqual(ids(rows[1]));
  });

  it("a minus on a line of its own belongs to the row under it", () => {
    const { rows, minus, rule } = fixture.c;
    // Halfway between 230 and 13, at the minus's own x.
    const between = moved(minus!, 0, -40);
    const column = columnOf([...rows.flat(), ...between, ...rule]);
    expect(column?.rows).toHaveLength(3);
    expect(column!.rows.map((r) => r.sign)).toEqual([1, -1, 1]);
  });

  it("ink two digits over the column that does not line up with it is not a row", () => {
    const { rows, minus, rule, left } = fixture.c;
    // The other sum's 217, two and a half digits over 230 and two digits left of its right edge.
    const word = moved(left!.slice(-3), 300, -100);
    const column = columnOf([...word, ...rows.flat(), ...minus!, ...rule]);
    expect(column?.rows).toHaveLength(3);
  });

  it("an amount Grape read with its plus is still an amount", () => {
    expect(parseAmount("+13", "en")).toEqual({ units: 13, scale: 0 });
    expect(parseAmount("+ 1.234,50", "de")).toEqual({ units: 123450, scale: 2 });
  });
});
