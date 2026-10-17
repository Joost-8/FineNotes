/**
 * `src/canvas/table-layout.ts`: columns, rows grown to their text, and the
 * cells' lines, wrapped exactly as a text box of the column's width would be
 * (which is what the cell's textarea does while it is typed in).
 *
 * `measure` is a fake monospace: 10 px a character, 12 in bold.
 */

import { describe, expect, it } from "vitest";
import {
  TABLE_CELL_PAD,
  cellAt,
  cellFill,
  cellFrame,
  cellStyle,
  edgeAt,
  isHeaderRow,
  layoutTable,
  tableFrame,
  tableLayoutKey,
} from "../../src/canvas/table-layout";
import { layoutTextBox, textInset } from "../../src/canvas/text-layout";
import type { TableElement } from "../../src/model/document";
import { headerFillOf, makeTable, setCellText } from "../../src/model/table";

const measureFor =
  (bold: boolean) =>
  (text: string): number =>
    text.length * (bold ? 12 : 10);

function table(extra: Partial<TableElement> = {}): TableElement {
  return {
    ...makeTable({
      id: "g1",
      x: 10,
      y: 20,
      w: 300,
      h: 120,
      rows: 3,
      cols: 3,
      color: "#000000",
      textColor: "#333333",
      fontSize: 16,
    }),
    ...extra,
  };
}

describe("layoutTable", () => {
  it("places columns and rows at their sums", () => {
    const layout = layoutTable(table(), measureFor);
    expect(layout.colX).toEqual([10, 110, 210]);
    expect(layout.rowY).toEqual([20, 60, 100]);
    expect(layout.rowH).toEqual([40, 40, 40]);
    expect(tableFrame(layout)).toEqual({ x: 10, y: 20, w: 300, h: 120 });
  });

  it("wraps a cell as a text box of its column's width, and grows its row", () => {
    const t = table();
    // 100 px column, inset 4 + 4 each side: 84 px of line, so one word a line.
    setCellText(t, 1, 0, "aaaa bbbb cccc dddd");
    const layout = layoutTable(t, measureFor);
    const alone = layoutTextBox(
      { ...cellStyle(t, 1), x: 10, y: 60, w: 100, text: "aaaa bbbb cccc dddd" },
      measureFor(false),
    );
    const cell = layout.cells[1][0];
    expect(cell.lines.map((l) => l.runs.map((r) => r.text).join(""))).toEqual(
      alone.lines.map((l) => l.runs.map((r) => r.text).join("")),
    );
    expect(cell.lines).toHaveLength(4);
    expect(layout.rowH[1]).toBe(alone.height);
    expect(layout.rowH[1]).toBeGreaterThan(40);
    // Every cell of the row is as high as the row.
    expect(layout.cells[1].every((c) => c.height === layout.rowH[1])).toBe(true);
    expect(layout.rowY[2]).toBe(60 + layout.rowH[1]);
    expect(textInset(cellStyle(t, 1)).x).toBe(4 + TABLE_CELL_PAD);
  });

  it("lays a header out bold", () => {
    const t = table({ header: true });
    setCellText(t, 0, 0, "aaaaaaa");
    setCellText(t, 1, 0, "aaaaaaa");
    const layout = layoutTable(t, measureFor);
    // 84 px of line: seven bold characters (84) fit, seven plain (70) too.
    expect(layout.cells[0][0].lines[0].right).toBe(84);
    expect(layout.cells[1][0].lines[0].right).toBe(70);
    expect(isHeaderRow(t, 0)).toBe(true);
    expect(isHeaderRow(t, 1)).toBe(false);
    expect(cellStyle(t, 0).bold).toBe(true);
    expect(cellStyle({ ...t, font: "mono" }, 1).font).toBe("mono");
  });

  it("fills the header and the body as the table says", () => {
    const t = table({ header: true, fill: "#eeeeee" });
    expect(cellFill(t, 0)).toBe(headerFillOf(t));
    expect(cellFill(t, 1)).toBe("#eeeeee");
    expect(cellFill(table(), 0)).toBeUndefined();
  });
});

describe("hit testing", () => {
  const layout = layoutTable(table(), measureFor);

  it("finds the cell under a point", () => {
    expect(cellAt(layout, 15, 25)).toEqual({ row: 0, col: 0 });
    expect(cellAt(layout, 250, 119)).toEqual({ row: 2, col: 2 });
    expect(cellAt(layout, 110, 60)).toEqual({ row: 0, col: 0 });
    expect(cellAt(layout, 5, 25)).toBeNull();
    expect(cellAt(layout, 15, 141)).toBeNull();
  });

  it("frames a cell", () => {
    expect(cellFrame(layout, { row: 1, col: 2 })).toEqual({ x: 210, y: 60, w: 100, h: 40 });
    expect(cellFrame(layout, { row: 3, col: 0 })).toBeNull();
  });

  it("finds the nearest right or bottom edge within reach", () => {
    expect(edgeAt(layout, 112, 80, 4)).toEqual({ kind: "col", index: 0 });
    expect(edgeAt(layout, 150, 101, 4)).toEqual({ kind: "row", index: 1 });
    expect(edgeAt(layout, 311, 141, 4)).toEqual({ kind: "row", index: 2 });
    expect(edgeAt(layout, 150, 80, 4)).toBeNull();
    expect(edgeAt(layout, 400, 80, 4)).toBeNull();
    expect(edgeAt(layout, 112, 0, 4)).toBeNull();
  });
});

describe("tableLayoutKey", () => {
  it("changes with what the layout depends on, and only that", () => {
    const t = table();
    const key = tableLayoutKey(t);
    expect(tableLayoutKey({ ...t, color: "#ff0000" })).toBe(key);
    setCellText(t, 0, 0, "x");
    expect(tableLayoutKey(t)).not.toBe(key);
    expect(tableLayoutKey({ ...t, header: true })).not.toBe(tableLayoutKey(t));
  });
});
