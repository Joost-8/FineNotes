/**
 * Where a table's columns, rows and cell text go, in page px.
 *
 * Each cell is laid out as a fixed-width text box (`text-layout.ts`): the
 * column's width, {@link TABLE_CELL_PAD} of padding, the table's font, wrapped
 * by the textarea's own rules. The cell being typed in is a textarea styled
 * the same way, so the text wraps at the same words while it is typed, on the
 * page afterwards, in the thumbnails and in a PDF export.
 *
 * A row is as high as its least height (`rows[i]`) or its tallest cell's
 * text, whichever is more: typing a long line into a cell grows its row,
 * and clearing the cell lets the row fall back.
 *
 * Pure: the caller injects the measuring (canvas `measureText` in the
 * renderer and the surface, a fake in the tests).
 */

import type { TableElement } from "../model/document";
import { headerFillOf } from "../model/table";
import type { TextStyle } from "../model/text-style";
import { type Measure, type TextBoxLayout, layoutTextBox } from "./text-layout";

/** Room between a cell's lines and its text beyond a text box's own, page px. */
export const TABLE_CELL_PAD = 4;

/** Measuring in the table's font, its bold weight for a header cell. */
export type MeasureFor = (bold: boolean) => Measure;

export interface TableLayout {
  /** The table's frame, page px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Each column's left edge and width, page px. */
  colX: number[];
  colW: number[];
  /** Each row's top edge and shown height, page px. */
  rowY: number[];
  rowH: number[];
  /** Each cell's text, laid out: `cells[row][col]`. */
  cells: TextBoxLayout[][];
}

/** A cell's place in its table. */
export interface CellRef {
  row: number;
  col: number;
}

/** Whether row `row` of `table` is its header. */
export function isHeaderRow(table: Pick<TableElement, "header">, row: number): boolean {
  return row === 0 && table.header === true;
}

/** The text style a cell is typed and drawn in. */
export function cellStyle(table: TableElement, row: number): TextStyle {
  return {
    color: table.textColor,
    fontSize: table.fontSize,
    ...(table.font ? { font: table.font } : {}),
    ...(isHeaderRow(table, row) ? { bold: true } : {}),
    padding: TABLE_CELL_PAD,
  };
}

/** The fill a cell is drawn with, or `undefined` for none. */
export function cellFill(table: TableElement, row: number): string | undefined {
  return isHeaderRow(table, row) ? headerFillOf(table) : table.fill;
}

/** Lay a table out: its columns, its rows grown to their text, every cell's lines. */
export function layoutTable(table: TableElement, measureFor: MeasureFor): TableLayout {
  const colX: number[] = [];
  let x = table.x;
  for (const w of table.cols) {
    colX.push(x);
    x += w;
  }
  const rowY: number[] = [];
  const rowH: number[] = [];
  const cells: TextBoxLayout[][] = [];
  let y = table.y;
  table.rows.forEach((least, r) => {
    const style = cellStyle(table, r);
    const measure = measureFor(style.bold === true);
    const row = table.cols.map((w, c) =>
      layoutTextBox({ ...style, x: colX[c], y, w, text: table.cells[r]?.[c] ?? "" }, measure),
    );
    const h = Math.max(least, ...row.map((cell) => cell.height));
    for (const cell of row) cell.height = h;
    rowY.push(y);
    rowH.push(h);
    cells.push(row);
    y += h;
  });
  return {
    x: table.x,
    y: table.y,
    w: x - table.x,
    h: y - table.y,
    colX,
    colW: table.cols.slice(),
    rowY,
    rowH,
    cells,
  };
}

/** The frame of a laid-out table, as a box. */
export function tableFrame(layout: TableLayout): { x: number; y: number; w: number; h: number } {
  return { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
}

/** A cell's frame, page px. */
export function cellFrame(
  layout: TableLayout,
  cell: CellRef,
): { x: number; y: number; w: number; h: number } | null {
  const x = layout.colX[cell.col];
  const y = layout.rowY[cell.row];
  if (x === undefined || y === undefined) return null;
  return { x, y, w: layout.colW[cell.col], h: layout.rowH[cell.row] };
}

/** The cell under a page point, or `null` outside the table. */
export function cellAt(layout: TableLayout, px: number, py: number): CellRef | null {
  if (!(px >= layout.x && px <= layout.x + layout.w && py >= layout.y && py <= layout.y + layout.h))
    return null;
  return { row: indexAt(layout.rowY, layout.rowH, py), col: indexAt(layout.colX, layout.colW, px) };
}

/**
 * A column's right edge or a row's bottom edge within `reach` of a page
 * point — what dragging resizes. Inner and outer edges alike; the left and
 * top edges move the table, so they are not offered. `null` when none is.
 */
export function edgeAt(
  layout: TableLayout,
  px: number,
  py: number,
  reach: number,
): { kind: "col" | "row"; index: number } | null {
  const inX = px >= layout.x - reach && px <= layout.x + layout.w + reach;
  const inY = py >= layout.y - reach && py <= layout.y + layout.h + reach;
  if (!inX || !inY) return null;
  let best: { kind: "col" | "row"; index: number } | null = null;
  let nearest = reach;
  for (let i = 0; i < layout.colX.length; i++) {
    const d = Math.abs(px - (layout.colX[i] + layout.colW[i]));
    if (d <= nearest) {
      best = { kind: "col", index: i };
      nearest = d;
    }
  }
  for (let i = 0; i < layout.rowY.length; i++) {
    const d = Math.abs(py - (layout.rowY[i] + layout.rowH[i]));
    if (d <= nearest) {
      best = { kind: "row", index: i };
      nearest = d;
    }
  }
  return best;
}

/**
 * A fingerprint of everything a table's layout depends on but the font
 * measuring: equal fingerprints lay out the same, so a cached layout can be
 * reused.
 */
export function tableLayoutKey(table: TableElement): string {
  return JSON.stringify([
    table.x,
    table.y,
    table.cols,
    table.rows,
    table.cells,
    table.fontSize,
    table.font ?? "",
    table.header === true,
  ]);
}

/** The index of the band `[start, start + size]` holding `v`, clamped to the bands. */
function indexAt(starts: readonly number[], sizes: readonly number[], v: number): number {
  for (let i = 0; i < starts.length; i++) {
    if (v <= starts[i] + sizes[i]) return i;
  }
  return starts.length - 1;
}
