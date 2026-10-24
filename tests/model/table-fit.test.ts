/**
 * `src/model/table-fit.ts`: a table edited in place never goes further past
 * the page's edges than it was, and the insert commands that use it undo to
 * the exact table they changed.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type TableElement, emptyDocument } from "../../src/model/document";
import {
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  TABLE_MIN_COL,
  TABLE_MIN_ROW,
} from "../../src/model/table";
import {
  PAGE_SLACK,
  columnsWithInserted,
  fitWidths,
  furthestFitting,
  insertColumnWithin,
  insertRowWithin,
  insertedRowHeight,
  keepsToPage,
} from "../../src/model/table-fit";
import { InsertTableColumn, InsertTableRow } from "../../src/model/table-commands";

const PAGE = { width: 800, height: 1000 };

function grid(cols: number[], rows: number[], extra: Partial<TableElement> = {}): TableElement {
  return {
    id: "g1",
    x: 100,
    y: 100,
    cols,
    rows,
    cells: rows.map(() => cols.map(() => "")),
    color: "#1a1a1a",
    size: 1.5,
    textColor: "#1a1a1a",
    fontSize: 18,
    ...extra,
  };
}

function docWith(table: TableElement): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].tables = [table];
  return doc;
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe("keepsToPage", () => {
  const inside = { x: 100, y: 100, w: 300, h: 200 };

  it("lets a table that stays inside the page change freely", () => {
    expect(keepsToPage(inside, { x: 0, y: 0, w: 800, h: 1000 }, PAGE)).toBe(true);
  });

  it("refuses a table that would cross an edge it was inside", () => {
    expect(keepsToPage(inside, { ...inside, w: 701 + PAGE_SLACK }, PAGE)).toBe(false);
    expect(keepsToPage(inside, { ...inside, h: 901 + PAGE_SLACK }, PAGE)).toBe(false);
    expect(keepsToPage(inside, { ...inside, x: -1 }, PAGE)).toBe(false);
    expect(keepsToPage(inside, { ...inside, y: -1 }, PAGE)).toBe(false);
  });

  it("allows rounding inside the slack", () => {
    expect(keepsToPage(inside, { ...inside, w: 700 + PAGE_SLACK / 2 }, PAGE)).toBe(true);
  });

  it("never makes a table that already hangs over worse, but lets it shrink", () => {
    const over = { x: 600, y: 900, w: 400, h: 300 };
    expect(keepsToPage(over, over, PAGE)).toBe(true);
    expect(keepsToPage(over, { ...over, w: 300, h: 150 }, PAGE)).toBe(true);
    expect(keepsToPage(over, { ...over, w: 410 }, PAGE)).toBe(false);
    expect(keepsToPage(over, { ...over, h: 310 }, PAGE)).toBe(false);
  });
});

describe("fitWidths", () => {
  it("leaves widths that fit as they are", () => {
    expect(fitWidths([100, 200], 300)).toEqual([100, 200]);
  });

  it("shrinks in proportion to the room", () => {
    const out = fitWidths([100, 300], 200);
    expect(out).toEqual([50, 150]);
  });

  it("holds a narrow column at the least and lets the wide ones give", () => {
    const out = fitWidths([30, 400, 400], 300);
    expect(out).not.toBeNull();
    const widths = out ?? [];
    expect(widths[0]).toBe(TABLE_MIN_COL);
    expect(sum(widths)).toBeLessThanOrEqual(300);
    expect(sum(widths)).toBeGreaterThan(299.9);
    expect(widths[1]).toBeCloseTo(widths[2], 5);
  });

  it("never leaves a column under the least, and never sums past the room", () => {
    for (let seed = 1; seed < 200; seed++) {
      const cols = Array.from(
        { length: 1 + (seed % 9) },
        (_, i) => 24 + ((seed * 37 + i * 91) % 300),
      );
      const room = cols.length * TABLE_MIN_COL + ((seed * 53) % 900);
      const out = fitWidths(cols, room);
      expect(out).not.toBeNull();
      for (const w of out ?? []) expect(w).toBeGreaterThanOrEqual(TABLE_MIN_COL);
      expect(sum(out ?? [])).toBeLessThanOrEqual(Math.max(room, sum(cols)) + PAGE_SLACK);
    }
  });

  it("refuses when not even the narrowest columns fit", () => {
    expect(fitWidths([100, 100, 100], TABLE_MIN_COL * 3 - 1)).toBeNull();
    expect(fitWidths([100, 100, 100], Number.NaN)).toBeNull();
  });
});

describe("columnsWithInserted", () => {
  it("copies the width of the column it goes beside while there is room", () => {
    expect(columnsWithInserted([100, 60], 1, 1000)).toEqual([100, 60, 60]);
    expect(columnsWithInserted([100, 60], 0, 1000)).toEqual([100, 100, 60]);
    expect(columnsWithInserted([100, 60], 2, 1000)).toEqual([100, 60, 60]);
  });

  it("narrows every column so the table ends at the page's edge", () => {
    const out = columnsWithInserted([200, 200], 1, 500);
    expect(out).toHaveLength(3);
    expect(sum(out ?? [])).toBeLessThanOrEqual(500);
    expect(sum(out ?? [])).toBeGreaterThan(499.9);
  });

  it("keeps a table that is already wider than the room at its width", () => {
    const out = columnsWithInserted([300, 300], 2, 400);
    expect(sum(out ?? [])).toBeLessThanOrEqual(600);
    expect(sum(out ?? [])).toBeGreaterThan(599.9);
  });

  it("refuses when not even its own width holds one more column, or at the most columns", () => {
    expect(columnsWithInserted([100, 100], 1, TABLE_MIN_COL * 3 - 1)).toHaveLength(3);
    expect(columnsWithInserted([30, 30], 1, 10)).toBeNull();
    expect(
      columnsWithInserted(
        Array.from({ length: TABLE_MAX_COLS }, () => 30),
        0,
        1e6,
      ),
    ).toBeNull();
    expect(columnsWithInserted([], 0, 1000)).toBeNull();
  });
});

describe("insertedRowHeight", () => {
  it("copies the row's height, cut to the room below the table", () => {
    expect(insertedRowHeight(40, 500)).toBe(40);
    expect(insertedRowHeight(40, 30.123)).toBe(30.12);
  });

  it("refuses when not even the least row fits", () => {
    expect(insertedRowHeight(40, TABLE_MIN_ROW - 1)).toBeNull();
    expect(insertedRowHeight(40, -50)).toBeNull();
    expect(insertedRowHeight(40, Number.NaN)).toBeNull();
  });
});

describe("insertRowWithin and insertColumnWithin", () => {
  it("put in a row no higher than the room, cells empty", () => {
    const t = grid([100, 100], [40, 40]);
    t.cells = [
      ["a", "b"],
      ["c", "d"],
    ];
    expect(insertRowWithin(t, 1, 25)).toBe(true);
    expect(t.rows).toEqual([40, 25, 40]);
    expect(t.cells).toEqual([
      ["a", "b"],
      ["", ""],
      ["c", "d"],
    ]);
  });

  it("change nothing when refused", () => {
    const t = grid([30, 30], [40, 40]);
    const before = JSON.stringify(t);
    expect(insertRowWithin(t, 1, 5)).toBe(false);
    expect(insertColumnWithin(t, 1, 10)).toBe(false);
    expect(JSON.stringify(t)).toBe(before);
    const full = grid(
      [100],
      Array.from({ length: TABLE_MAX_ROWS }, () => 20),
    );
    expect(insertRowWithin(full, 0, 1e6)).toBe(false);
  });

  it("put in a column and narrow the rest to the room", () => {
    const t = grid([200, 200], [40]);
    t.cells = [["a", "b"]];
    expect(insertColumnWithin(t, 2, 500)).toBe(true);
    expect(t.cells).toEqual([["a", "b", ""]]);
    expect(sum(t.cols)).toBeLessThanOrEqual(500);
  });
});

describe("the insert commands, held to the page", () => {
  it("undo to the exact table, key order included, and redo the same", () => {
    const t = grid([200, 200], [40, 40], { header: true });
    const doc = docWith(t);
    const before = JSON.stringify(doc);
    const add = new InsertTableColumn(doc.pages[0].id, t, 1, 500);
    add.apply(doc);
    const after = JSON.stringify(doc);
    expect(sum(t.cols)).toBeLessThanOrEqual(500);
    add.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
    add.apply(doc);
    expect(JSON.stringify(doc)).toBe(after);

    const row = new InsertTableRow(doc.pages[0].id, t, 2, 22);
    row.apply(doc);
    expect(t.rows).toEqual([40, 40, 22]);
    row.invert(doc);
    expect(JSON.stringify(doc)).toBe(after);
  });

  it("change nothing, and undo to nothing, when there is no room", () => {
    const t = grid([200, 200], [40, 40]);
    const doc = docWith(t);
    const before = JSON.stringify(doc);
    const row = new InsertTableRow(doc.pages[0].id, t, 0, 3);
    row.apply(doc);
    expect(JSON.stringify(doc)).toBe(before);
    row.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("keep the old behaviour with no room given", () => {
    const t = grid([100], [40]);
    const doc = docWith(t);
    new InsertTableColumn(doc.pages[0].id, t, 1).apply(doc);
    new InsertTableRow(doc.pages[0].id, t, 1).apply(doc);
    expect(t.cols).toEqual([100, 100]);
    expect(t.rows).toEqual([40, 40]);
  });
});

describe("furthestFitting", () => {
  it("goes all the way when the end fits", () => {
    expect(furthestFitting(100, 300, () => true)).toBe(300);
  });

  it("stops at the edge, from either side", () => {
    expect(furthestFitting(100, 300, (v) => v <= 212.5)).toBeCloseTo(212.5, 1);
    expect(furthestFitting(100, 300, (v) => v <= 212.5)).toBeLessThanOrEqual(212.5 + 0.01);
    expect(furthestFitting(300, 50, (v) => v >= 120)).toBeCloseTo(120, 1);
  });

  it("stays where it started when nothing past it fits", () => {
    expect(furthestFitting(100, 300, (v) => v <= 100)).toBeCloseTo(100, 1);
  });
});
