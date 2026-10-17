/**
 * `src/model/table.ts` and `table-commands.ts`: the table element, its
 * loader, its row and column edits, and their undo. Every inverse must leave
 * the document `JSON.stringify`-identical, key order included.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type TableElement, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import {
  TABLE_FONT_SIZE,
  TABLE_HEADER_ALPHA,
  TABLE_LINE_WIDTH,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  TABLE_MIN_COL,
  TABLE_MIN_ROW,
  cellText,
  headerFillOf,
  insertColumn,
  insertRow,
  makeTable,
  nextTableId,
  normalizeTable,
  removeColumn,
  removeRow,
  scaleTable,
  setCellText,
  setColumnWidth,
  setRowHeight,
  stepCell,
  tableFloorSize,
  tableScaleRange,
} from "../../src/model/table";
import {
  AddTable,
  InsertTableColumn,
  InsertTableRow,
  RemoveTableColumn,
  RemoveTableRow,
  ResizeTableColumn,
  ResizeTableRow,
  SetTableCell,
  SetTableHeader,
} from "../../src/model/table-commands";
import {
  AddElements,
  RemoveElements,
  ReorientElements,
  ScaleElements,
  TranslateElements,
  copyElements,
  elementsOnPage,
  isEmptySelection,
} from "../../src/model/selection-commands";
import type { Command } from "../../src/model/commands";

function table(extra: Partial<TableElement> = {}): TableElement {
  return {
    ...makeTable({
      id: "g1",
      x: 40,
      y: 60,
      w: 300,
      h: 120,
      rows: 3,
      cols: 3,
      color: "#1a1a1a",
      textColor: "#222222",
    }),
    ...extra,
  };
}

function docWith(t: TableElement): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].tables = [t];
  return doc;
}

/** Apply, invert, and apply again: undo restores the document exactly, redo lands the same. */
function roundTrip(doc: InkDocument, command: Command): { before: string; after: string } {
  const before = JSON.stringify(doc);
  command.apply(doc);
  const after = JSON.stringify(doc);
  command.invert(doc);
  expect(JSON.stringify(doc)).toBe(before);
  command.apply(doc);
  expect(JSON.stringify(doc)).toBe(after);
  return { before, after };
}

describe("makeTable", () => {
  it("splits the frame evenly, every cell empty", () => {
    const t = table();
    expect(t.cols).toEqual([100, 100, 100]);
    expect(t.rows).toEqual([40, 40, 40]);
    expect(t.cells).toEqual([
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ]);
    expect(t.size).toBe(TABLE_LINE_WIDTH);
    expect(t.fontSize).toBe(TABLE_FONT_SIZE);
    expect(t.header).toBeUndefined();
  });

  it("keeps cells at their least size, and the counts in range", () => {
    const t = makeTable({
      id: "g1",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rows: 0,
      cols: 9999,
      color: "#000000",
      textColor: "#000000",
      header: true,
    });
    expect(t.rows).toEqual([TABLE_MIN_ROW]);
    expect(t.cols.length).toBe(TABLE_MAX_COLS);
    expect(t.cols[0]).toBe(TABLE_MIN_COL);
    expect(t.header).toBe(true);
    expect(makeTable({ ...t, w: 1, h: 1, rows: NaN, cols: 2 }).rows).toHaveLength(1);
  });

  it("measures its floor", () => {
    expect(tableFloorSize(table())).toEqual({ w: 300, h: 120 });
  });

  it("tints the header with its line colour unless it has a fill", () => {
    expect(headerFillOf({ color: "#336699" })).toBe(
      `#336699${Math.round(TABLE_HEADER_ALPHA * 255).toString(16)}`,
    );
    expect(headerFillOf({ color: "#336699", headerFill: "#ffee00" })).toBe("#ffee00");
  });
});

describe("table edits", () => {
  it("inserts and removes rows, keeping every row as long as the columns", () => {
    const t = table();
    setCellText(t, 1, 1, "b");
    insertRow(t, 1);
    expect(t.rows).toHaveLength(4);
    expect(t.cells[1]).toEqual(["", "", ""]);
    expect(cellText(t, 2, 1)).toBe("b");
    insertRow(t, 99);
    expect(t.rows).toHaveLength(5);
    removeRow(t, 0);
    removeRow(t, 7);
    expect(t.rows).toHaveLength(4);
    for (let i = 0; i < 5; i++) removeRow(t, 0);
    expect(t.rows).toHaveLength(1);
  });

  it("drops the header when its row goes", () => {
    const t = table({ header: true });
    removeRow(t, 1);
    expect(t.header).toBe(true);
    removeRow(t, 0);
    expect(t.header).toBeUndefined();
  });

  it("inserts and removes columns in every row", () => {
    const t = table();
    setCellText(t, 0, 2, "c");
    insertColumn(t, 0);
    expect(t.cols).toHaveLength(4);
    expect(t.cells.every((row) => row.length === 4)).toBe(true);
    expect(cellText(t, 0, 3)).toBe("c");
    removeColumn(t, 3);
    removeColumn(t, -1);
    expect(t.cells[0]).toEqual(["", "", ""]);
    for (let i = 0; i < 5; i++) removeColumn(t, 0);
    expect(t.cols).toHaveLength(1);
  });

  it("stops adding past the most it keeps", () => {
    const t = table();
    t.cols = new Array<number>(TABLE_MAX_COLS).fill(30);
    t.cells = t.cells.map(() => new Array<string>(TABLE_MAX_COLS).fill(""));
    insertColumn(t, 0);
    expect(t.cols).toHaveLength(TABLE_MAX_COLS);
    t.rows = new Array<number>(TABLE_MAX_ROWS).fill(30);
    insertRow(t, 0);
    expect(t.rows).toHaveLength(TABLE_MAX_ROWS);
  });

  it("resizes within the least sizes", () => {
    const t = table();
    setColumnWidth(t, 0, 3);
    setRowHeight(t, 2, 61.234);
    setColumnWidth(t, 5, 100);
    setRowHeight(t, 0, NaN);
    expect(t.cols).toEqual([TABLE_MIN_COL, 100, 100]);
    expect(t.rows).toEqual([40, 40, 61.23]);
  });

  it("ignores a cell outside the table", () => {
    const t = table();
    setCellText(t, 5, 0, "x");
    setCellText(t, 0, 5, "x");
    expect(cellText(t, 5, 0)).toBe("");
    expect(t.cells.flat().join("")).toBe("");
  });

  it("steps through cells in reading order", () => {
    const t = table();
    expect(stepCell(t, 0, 2, 1)).toEqual({ row: 1, col: 0 });
    expect(stepCell(t, 1, 0, -1)).toEqual({ row: 0, col: 2 });
    expect(stepCell(t, 0, 0, -1)).toBeNull();
    expect(stepCell(t, 2, 2, 1)).toBeNull();
  });

  it("scales everything, its font kept in range", () => {
    const t = table();
    scaleTable(t, 0, 0, 2);
    expect(t).toMatchObject({ x: 80, y: 120, cols: [200, 200, 200], rows: [80, 80, 80] });
    expect(t.size).toBe(TABLE_LINE_WIDTH * 2);
    expect(t.fontSize).toBe(TABLE_FONT_SIZE * 2);
    const range = tableScaleRange([table()]);
    expect(range.min).toBeCloseTo(12 / TABLE_FONT_SIZE);
    expect(range.max).toBeCloseTo(400 / TABLE_FONT_SIZE);
    expect(tableScaleRange([])).toEqual({ min: 0, max: Infinity });
  });

  it("finds the next free id across pages", () => {
    const doc = docWith(table({ id: "g7" }));
    expect(nextTableId(doc)).toBe("g8");
    expect(nextTableId(emptyDocument())).toBe("g1");
  });
});

describe("normalizeTable", () => {
  it("keeps a good table as it is", () => {
    const t = table({ header: true, font: "serif", fill: "#ffeeaa", dash: "dash" });
    t.headerFill = "#00ff0080";
    expect(normalizeTable(JSON.parse(JSON.stringify(t)), () => "x")).toEqual(t);
  });

  it("refuses what is no table", () => {
    expect(normalizeTable(null, () => "x")).toBeNull();
    expect(normalizeTable({ cols: [], rows: [10] }, () => "x")).toBeNull();
    expect(normalizeTable({ cols: [10] }, () => "x")).toBeNull();
  });

  it("mends ragged cells and bad values without losing text", () => {
    const t = normalizeTable(
      {
        cols: [100, "x", 1],
        rows: [10, 50],
        cells: [["a", 3, "c", "extra"], "nope"],
        color: "red",
        size: 99,
        fontSize: 2,
        font: "comic",
        header: "yes",
        dash: "wavy",
        fill: "#zzzzzz",
      },
      () => "g3",
    );
    expect(t).toEqual({
      id: "g3",
      x: 0,
      y: 0,
      cols: [100, TABLE_MIN_COL, TABLE_MIN_COL],
      rows: [TABLE_MIN_ROW, 50],
      cells: [
        ["a", "", "c"],
        ["", "", ""],
      ],
      color: "#1a1a1a",
      size: 20,
      textColor: "#1a1a1a",
      fontSize: 12,
    });
  });

  it("round-trips through a save, and a page without tables gains no key", () => {
    const doc = docWith(table({ header: true }));
    setCellText(doc.pages[0].tables![0], 0, 0, "Name");
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].tables).toEqual(doc.pages[0].tables);
    const plain = decodeDocument(encodeDocument(emptyDocument()));
    expect("tables" in plain.pages[0]).toBe(false);
  });

  it("mints ids above the highest stored one", () => {
    const doc = emptyDocument();
    const raw = table();
    delete (raw as Partial<TableElement>).id;
    doc.pages[0].tables = [table({ id: "g4" }), raw];
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].tables!.map((t) => t.id)).toEqual(["g4", "g5"]);
  });
});

describe("table commands", () => {
  it("adds a table, and undo leaves the page without a tables list", () => {
    const doc = emptyDocument();
    const t = table();
    const { after } = roundTrip(doc, new AddTable("p1", t));
    expect(JSON.parse(after).pages[0].tables).toHaveLength(1);
    new AddTable("nope", t).apply(doc);
    new AddTable("nope", t).invert(doc);
  });

  it("undoes every row, column, size and header edit exactly", () => {
    const commands = (t: TableElement): Command[] => [
      new InsertTableRow("p1", t, 1),
      new RemoveTableRow("p1", t, 0),
      new InsertTableColumn("p1", t, 3),
      new RemoveTableColumn("p1", t, 1),
      new ResizeTableColumn("p1", t, 0, 180),
      new ResizeTableRow("p1", t, 2, 90),
      new SetTableHeader("p1", t, true),
      new SetTableHeader("p1", t, false),
    ];
    for (let i = 0; i < 8; i++) {
      const t = table({ header: true, fill: "#eeeeee" });
      setCellText(t, 0, 0, "head");
      setCellText(t, 1, 2, "body");
      const doc = docWith(t);
      const command = commands(t)[i];
      roundTrip(doc, command);
      expect(command.label.length).toBeGreaterThan(0);
    }
  });

  it("does nothing to a table no longer on its page", () => {
    const t = table();
    const doc = emptyDocument();
    const command = new InsertTableRow("p1", t, 0);
    command.apply(doc);
    command.invert(doc);
    expect(t.rows).toHaveLength(3);
  });

  it("records a cell edit with the text it had before", () => {
    const t = table();
    const doc = docWith(t);
    setCellText(t, 1, 1, "typed");
    const edit = new SetTableCell("p1", t, 1, 1, "", "typed");
    edit.apply(doc);
    expect(cellText(t, 1, 1)).toBe("typed");
    edit.invert(doc);
    expect(cellText(t, 1, 1)).toBe("");
    new SetTableCell("p1", table(), 0, 0, "", "x").apply(doc);
    new SetTableCell("p1", table(), 0, 0, "", "x").invert(doc);
  });
});

describe("tables in a lasso selection", () => {
  it("moves, resizes and turns a table with the rest, and undoes exactly", () => {
    const make = (): { doc: InkDocument; t: TableElement } => {
      const t = table();
      setCellText(t, 0, 0, "a");
      return { doc: docWith(t), t };
    };
    {
      const { doc, t } = make();
      roundTrip(
        doc,
        new TranslateElements("p1", { strokes: [], images: [], textBoxes: [], tables: [t] }, 5, -7),
      );
      expect(t).toMatchObject({ x: 45, y: 53 });
    }
    {
      const { doc, t } = make();
      roundTrip(
        doc,
        new ScaleElements(
          "p1",
          { strokes: [], images: [], textBoxes: [], tables: [t] },
          40,
          60,
          1.5,
        ),
      );
      expect(t.cols[0]).toBe(150);
    }
    {
      const { doc, t } = make();
      const heights = new Map([[t, 200]]);
      const turn = new ReorientElements(
        "p1",
        { strokes: [], images: [], textBoxes: [], tables: [t] },
        { kind: "rotate", angle: Math.PI },
        190,
        160,
        heights,
      );
      roundTrip(doc, turn);
      // Turned half round its own middle, it lands where it was: upright.
      expect(t.x).toBeCloseTo(40);
      expect(t.y).toBeCloseTo(60);
    }
    {
      const { doc, t } = make();
      roundTrip(
        doc,
        new ReorientElements(
          "p1",
          { strokes: [], images: [], textBoxes: [], tables: [t] },
          { kind: "flip", axis: "x" },
          0,
          0,
        ),
      );
      expect(t.x).toBeCloseTo(-340);
    }
  });

  it("deletes and duplicates tables", () => {
    const t = table();
    const doc = docWith(t);
    roundTrip(
      doc,
      new RemoveElements("p1", { strokes: [], images: [], textBoxes: [], tables: [t] }),
    );
    const fresh = emptyDocument();
    const copies = copyElements(
      { strokes: [], images: [], textBoxes: [], tables: [t] },
      { stroke: () => "s", image: () => "i", textBox: () => "t", table: () => "g9" },
      10,
      10,
    );
    expect(copies.tables![0]).toMatchObject({ id: "g9", x: 50, y: 70 });
    expect(copies.tables![0].cells).not.toBe(t.cells);
    const add = new AddElements("p1", copies);
    roundTrip(fresh, add);
    add.invert(fresh);
    expect("tables" in fresh.pages[0]).toBe(false);
  });

  it("counts a table as something selected, and finds it on its page", () => {
    const t = table();
    const doc = docWith(t);
    expect(isEmptySelection({ strokes: [], images: [], textBoxes: [], tables: [t] })).toBe(false);
    expect(isEmptySelection({ strokes: [], images: [], textBoxes: [] })).toBe(true);
    expect(
      elementsOnPage(doc.pages[0], { strokes: [], images: [], textBoxes: [], tables: [t, table()] })
        .tables,
    ).toEqual([t]);
  });
});
