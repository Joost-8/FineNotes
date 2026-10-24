/**
 * A table cell's own look (bold, colour) in `src/model/table.ts`, its
 * command, the typing step that also moves the table up, and the float rule
 * in `src/model/table-fit.ts`. A table nobody styled must be stored, loaded
 * and undone exactly as before.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type TableElement, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import {
  cellStyleOf,
  insertColumn,
  insertRow,
  normalizeTable,
  removeColumn,
  removeRow,
  setCellStyle,
} from "../../src/model/table";
import { SetTableCell, SetTableCellStyle } from "../../src/model/table-commands";
import { floatedTop } from "../../src/model/table-fit";
import { cellStyle, layoutTable } from "../../src/canvas/table-layout";

function grid(extra: Partial<TableElement> = {}): TableElement {
  return {
    id: "g1",
    x: 100,
    y: 100,
    cols: [100, 100],
    rows: [40, 40],
    cells: [
      ["a", "b"],
      ["c", "d"],
    ],
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

describe("setCellStyle", () => {
  it("makes the grid of looks on first use, shaped as the cells", () => {
    const t = grid();
    setCellStyle(t, 1, 0, { bold: true });
    expect(t.cellStyles).toEqual([
      [null, null],
      [{ bold: true }, null],
    ]);
    expect(cellStyleOf(t, 1, 0)).toEqual({ bold: true });
    expect(cellStyleOf(t, 0, 0)).toBeNull();
  });

  it("merges, lower-cases colours and takes a look away again", () => {
    const t = grid();
    setCellStyle(t, 0, 1, { color: "#E03131" });
    setCellStyle(t, 0, 1, { bold: true });
    expect(cellStyleOf(t, 0, 1)).toEqual({ color: "#e03131", bold: true });
    setCellStyle(t, 0, 1, { color: null });
    expect(cellStyleOf(t, 0, 1)).toEqual({ bold: true });
  });

  it("drops the grid once no cell has a look, so the table is as it was", () => {
    const t = grid();
    const before = JSON.stringify(t);
    setCellStyle(t, 0, 0, { bold: true, color: "#123456" });
    setCellStyle(t, 0, 0, { bold: false, color: null });
    expect(t.cellStyles).toBeUndefined();
    expect(JSON.stringify(t)).toBe(before);
  });

  it("ignores cells outside the table and colours that are not #rrggbb", () => {
    const t = grid();
    setCellStyle(t, 5, 0, { bold: true });
    setCellStyle(t, 0, -1, { bold: true });
    setCellStyle(t, 0, 0, { color: "red" });
    setCellStyle(t, 0, 0, { color: "#12345678" });
    expect(t.cellStyles).toBeUndefined();
  });
});

describe("row and column edits keep the looks with their cells", () => {
  it("inserting shifts the looks with the cells", () => {
    const t = grid();
    setCellStyle(t, 1, 1, { bold: true });
    insertRow(t, 0);
    insertColumn(t, 0);
    expect(t.cells[2][2]).toBe("d");
    expect(cellStyleOf(t, 2, 2)).toEqual({ bold: true });
    expect(t.cellStyles?.length).toBe(t.cells.length);
    for (const row of t.cellStyles ?? []) expect(row.length).toBe(t.cols.length);
  });

  it("removing the last styled row or column drops the grid", () => {
    const t = grid();
    setCellStyle(t, 1, 0, { bold: true });
    removeColumn(t, 1);
    expect(cellStyleOf(t, 1, 0)).toEqual({ bold: true });
    removeRow(t, 1);
    expect(t.cellStyles).toBeUndefined();
  });

  it("a table with no looks never grows a grid", () => {
    const t = grid();
    insertRow(t, 1);
    insertColumn(t, 1);
    removeRow(t, 0);
    removeColumn(t, 0);
    expect(t.cellStyles).toBeUndefined();
  });
});

describe("reading looks from disk", () => {
  it("loads a table without looks exactly as before", () => {
    const raw = grid();
    const table = normalizeTable(JSON.parse(JSON.stringify(raw)), () => "g9");
    expect(table).toEqual(raw);
    expect(table && "cellStyles" in table).toBe(false);
  });

  it("pads, cuts and cleans what is stored", () => {
    const raw = {
      ...grid(),
      cellStyles: [
        [{ bold: true, extra: 1 }, { color: "#ABCDEF" }, { bold: true }],
        [{ bold: "yes", color: "blue" }],
      ],
    };
    const table = normalizeTable(raw, () => "g9");
    expect(table?.cellStyles).toEqual([
      [{ bold: true }, { color: "#abcdef" }],
      [null, null],
    ]);
  });

  it("drops a grid that holds nothing worth keeping", () => {
    const table = normalizeTable({ ...grid(), cellStyles: [[null, {}], "x"] }, () => "g9");
    expect(table?.cellStyles).toBeUndefined();
    expect(normalizeTable({ ...grid(), cellStyles: "x" }, () => "g9")?.cellStyles).toBeUndefined();
  });

  it("survive a save and a load", () => {
    const t = grid();
    setCellStyle(t, 1, 1, { bold: true, color: "#e03131" });
    const doc = docWith(t);
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].tables?.[0].cellStyles).toEqual(t.cellStyles);
  });
});

describe("the cell's style in layout", () => {
  it("draws a cell in its own bold and colour, the others in the table's", () => {
    const t = grid();
    setCellStyle(t, 1, 0, { bold: true, color: "#e03131" });
    expect(cellStyle(t, 1, 0)).toMatchObject({ bold: true, color: "#e03131" });
    expect(cellStyle(t, 1, 1).bold).toBeUndefined();
    expect(cellStyle(t, 1, 1).color).toBe("#1a1a1a");
    // A header cell stays bold, whatever its own look says.
    expect(cellStyle({ ...t, header: true }, 0, 0).bold).toBe(true);
  });

  it("measures a bold cell with the bold measure, so it wraps as drawn", () => {
    const t = grid({
      cells: [
        ["word word word", "word word word"],
        ["", ""],
      ],
    });
    setCellStyle(t, 0, 0, { bold: true });
    const seen: boolean[] = [];
    const layout = layoutTable(t, (bold) => (text) => {
      seen.push(bold);
      return text.length * (bold ? 20 : 8);
    });
    expect(seen).toContain(true);
    expect(seen).toContain(false);
    expect(layout.cells[0][0].lines.length).toBeGreaterThan(layout.cells[0][1].lines.length);
  });
});

describe("SetTableCellStyle", () => {
  it("undoes to the exact table and redoes the same", () => {
    const t = grid({ header: true });
    const doc = docWith(t);
    const before = JSON.stringify(doc);
    const bold = new SetTableCellStyle(doc.pages[0].id, t, 1, 1, { bold: true });
    bold.apply(doc);
    const after = JSON.stringify(doc);
    const red = new SetTableCellStyle(doc.pages[0].id, t, 1, 1, { color: "#e03131" });
    red.apply(doc);
    red.invert(doc);
    expect(JSON.stringify(doc)).toBe(after);
    bold.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
    bold.apply(doc);
    expect(JSON.stringify(doc)).toBe(after);
  });
});

describe("SetTableCell with a move", () => {
  it("is the text and the move in one step", () => {
    const t = grid();
    const doc = docWith(t);
    const before = JSON.stringify(doc);
    const step = new SetTableCell(doc.pages[0].id, t, 1, 1, "d", "a longer d", {
      from: 100,
      to: 60,
    });
    step.apply(doc);
    expect(t.cells[1][1]).toBe("a longer d");
    expect(t.y).toBe(60);
    step.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("leaves the table where it is without one", () => {
    const t = grid();
    const doc = docWith(t);
    new SetTableCell(doc.pages[0].id, t, 0, 0, "a", "ab").apply(doc);
    expect(t.y).toBe(100);
  });
});

describe("floatedTop", () => {
  it("stays put while the table fits", () => {
    expect(floatedTop(100, 300, 1000)).toBe(100);
  });

  it("rises only as far as the bottom needs", () => {
    expect(floatedTop(800, 300, 1000)).toBe(700);
  });

  it("never rises above the page's top", () => {
    expect(floatedTop(100, 1200, 1000)).toBe(0);
  });

  it("never rises above where it already was above the page", () => {
    expect(floatedTop(-50, 1200, 1000)).toBe(-50);
  });
});
