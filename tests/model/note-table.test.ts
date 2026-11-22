import { describe, expect, it } from "vitest";
import {
  addColumn,
  addRow,
  emptyTable,
  encodeTable,
  removeColumn,
  removeRow,
  setCell,
  splitTableRow,
  squareRows,
  tableStartsAt,
} from "../../src/model/note-table";
import { decodeNote, encodeNote } from "../../src/model/text-note-file";
import { textBlock, type NoteBlock, type TableBlock } from "../../src/model/text-note";

const table = (rows: string[][]): TableBlock => ({ type: "table", id: "t", rows });

function ids(): () => string {
  let n = 0;
  return () => `i${++n}`;
}

function shape(blocks: readonly NoteBlock[]): unknown[] {
  return blocks.map((block) => {
    const { id: _id, ...rest } = block;
    return rest;
  });
}

describe("table edits", () => {
  it("starts as a header and two rows of two columns", () => {
    expect(emptyTable("t").rows).toEqual([
      ["", ""],
      ["", ""],
      ["", ""],
    ]);
  });

  it("sets one cell and leaves the rest shared, keeping the block when nothing changed", () => {
    const before = table([
      ["a", "b"],
      ["c", "d"],
    ]);
    const after = setCell(before, 1, 0, "x\ny");
    expect(after.rows).toEqual([
      ["a", "b"],
      ["x y", "d"],
    ]);
    expect(after.rows[0]).toBe(before.rows[0]);
    expect(setCell(before, 0, 0, "a")).toBe(before);
    expect(setCell(before, 5, 0, "z")).toBe(before);
  });

  it("adds rows below the header and columns anywhere", () => {
    const t = table([
      ["h1", "h2"],
      ["a", "b"],
    ]);
    expect(addRow(t, 0).rows).toEqual([
      ["h1", "h2"],
      ["", ""],
      ["a", "b"],
    ]);
    expect(addRow(t, 99).rows[2]).toEqual(["", ""]);
    expect(addColumn(t, 1).rows).toEqual([
      ["h1", "", "h2"],
      ["a", "", "b"],
    ]);
  });

  it("removes rows and columns, and says when the table would be empty", () => {
    const t = table([
      ["h1", "h2"],
      ["a", "b"],
    ]);
    expect(removeRow(t, 1)?.rows).toEqual([["h1", "h2"]]);
    expect(removeColumn(t, 0)?.rows).toEqual([["h2"], ["b"]]);
    expect(removeRow(table([["x"]]), 0)).toBeNull();
    expect(removeColumn(table([["x"], ["y"]]), 0)).toBeNull();
  });

  it("squares up a ragged table", () => {
    expect(squareRows([["a"], ["b", "c", "d"]])).toEqual([
      ["a", "", ""],
      ["b", "c", "d"],
    ]);
  });
});

describe("tables in Markdown", () => {
  it("writes a header, a separator and the rows, escaping pipes", () => {
    expect(
      encodeTable(
        table([
          ["Day", "Hut"],
          ["Fri", "Firenze | booked"],
          ["", "Puez"],
        ]),
      ),
    ).toEqual(["| Day | Hut |", "| --- | --- |", "| Fri | Firenze \\| booked |", "| | Puez |"]);
    expect(splitTableRow("| Fri | Firenze \\| booked |")).toEqual(["Fri", "Firenze | booked"]);
  });

  it("finds a table only where a separator follows a row of pipes", () => {
    expect(tableStartsAt(["| a | b |", "| --- | --- |"], 0)).toBe(true);
    expect(tableStartsAt(["| a | b |", "| --- |"], 0)).toBe(false);
    expect(tableStartsAt(["| a | b |", "text"], 0)).toBe(false);
  });

  it("round-trips a table between paragraphs, keeping them apart with empty lines", () => {
    const blocks: NoteBlock[] = [
      textBlock("a", "title", [{ text: "Trip", marks: 0 }]),
      table([
        ["Day", "Hut"],
        ["Fri", "Firenze"],
      ]),
      textBlock("b", "body", [{ text: "after", marks: 0 }]),
    ];
    const text = encodeNote({ blocks });
    expect(text.split("\n")).toEqual([
      "# Trip",
      "",
      "| Day | Hut |",
      "| --- | --- |",
      "| Fri | Firenze |",
      "",
      "after",
    ]);
    expect(shape(decodeNote(text, ids()).blocks)).toEqual(shape(blocks));
  });

  it("keeps empty paragraphs around a table", () => {
    const blocks: NoteBlock[] = [
      textBlock("a", "body", [{ text: "x", marks: 0 }]),
      textBlock("b"),
      table([["one"], ["two"]]),
      textBlock("c"),
      textBlock("d", "body", [{ text: "y", marks: 0 }]),
    ];
    expect(shape(decodeNote(encodeNote({ blocks }), ids()).blocks)).toEqual(shape(blocks));
  });

  it("keeps body text that starts with a pipe as body text", () => {
    const blocks: NoteBlock[] = [
      textBlock("a", "body", [{ text: "| not a table |", marks: 0 }]),
      textBlock("b", "body", [{ text: "| --- |", marks: 0 }]),
    ];
    expect(shape(decodeNote(encodeNote({ blocks }), ids()).blocks)).toEqual(shape(blocks));
  });
});
