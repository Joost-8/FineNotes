/**
 * Tables as one element (`TableElement`): making one, reading one from disk,
 * and the row and column edits its commands make. Before 2026-10-17 the
 * Table tool placed loose strokes (`ink/table-geometry`); those stay ink, as
 * they were drawn, and are never converted behind the user's back.
 *
 * A table's geometry is its columns' widths and its rows' least heights; the
 * shown height of a row also depends on how its text wraps, which needs a
 * font to measure with, so that part lives in `canvas/table-layout`.
 *
 * Pure: no DOM, no Obsidian.
 */

import {
  type InkDocument,
  type ShapeDash,
  type TableElement,
  TEXT_FONTS,
  type TextFont,
} from "./document";
import { readDash, readFill, withAlpha } from "./shape-style";
import { isHexColor, MAX_TEXT_SIZE, MIN_TEXT_SIZE } from "./text-style";

/** A column is never narrower than this, page px: room for a letter and the cell's padding. */
export const TABLE_MIN_COL = 24;
/** A row is never lower than this, page px. */
export const TABLE_MIN_ROW = 20;
/** The most rows and columns a table keeps: past it, a file is not a table anyone drew. */
export const TABLE_MAX_ROWS = 200;
export const TABLE_MAX_COLS = 50;
/** The grid's line width the Table tool places, page px: under the thinnest pen. */
export const TABLE_LINE_WIDTH = 1.5;
/** The cells' font size the Table tool places, page px. */
export const TABLE_FONT_SIZE = 18;
/** How strong a header row's default fill is: a tint of the table's line colour. */
export const TABLE_HEADER_ALPHA = 0.16;
/** The thickest grid line kept, page px. */
export const TABLE_MAX_LINE = 20;

/** What a new table is made from: a frame, a size and its look. */
export interface NewTable {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: number;
  cols: number;
  color: string;
  textColor: string;
  fontSize?: number;
  header?: boolean;
}

/** An even `rows` x `cols` table filling `w` x `h`, every cell empty. */
export function makeTable(spec: NewTable): TableElement {
  const rows = clampCount(spec.rows, TABLE_MAX_ROWS);
  const cols = clampCount(spec.cols, TABLE_MAX_COLS);
  const colW = Math.max(TABLE_MIN_COL, spec.w / cols);
  const rowH = Math.max(TABLE_MIN_ROW, spec.h / rows);
  return {
    id: spec.id,
    x: spec.x,
    y: spec.y,
    cols: Array.from({ length: cols }, () => round2(colW)),
    rows: Array.from({ length: rows }, () => round2(rowH)),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => "")),
    color: spec.color,
    size: TABLE_LINE_WIDTH,
    textColor: spec.textColor,
    fontSize: spec.fontSize ?? TABLE_FONT_SIZE,
    ...(spec.header ? { header: true as const } : {}),
  };
}

/** The fill a header row is drawn with: its own, else a soft tint of the lines' colour. */
export function headerFillOf(table: Pick<TableElement, "headerFill" | "color">): string {
  return table.headerFill ?? withAlpha(table.color, TABLE_HEADER_ALPHA);
}

/** The table's least width and height, page px: the sum of its columns and of its rows. */
export function tableFloorSize(table: Pick<TableElement, "cols" | "rows">): {
  w: number;
  h: number;
} {
  return { w: sum(table.cols), h: sum(table.rows) };
}

/** A table id not yet used anywhere in `doc`: one above the highest `g<N>`. */
export function nextTableId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const table of page.tables ?? []) {
      const match = /^g(\d+)$/.exec(table.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `g${max + 1}`;
}

// --- Edits ------------------------------------------------------------------
// Each changes the table in place; the commands snapshot it first.

/** Put an empty row in at `index` (0 = above the first), as high as the row it copies. */
export function insertRow(table: TableElement, index: number): void {
  if (table.rows.length >= TABLE_MAX_ROWS) return;
  const at = clampIndex(index, table.rows.length);
  const like = table.rows[Math.min(at, table.rows.length - 1)] ?? TABLE_MIN_ROW;
  table.rows.splice(at, 0, like);
  table.cells.splice(
    at,
    0,
    table.cols.map(() => ""),
  );
}

/** Take out row `index`; the last row stays (a table always has one). */
export function removeRow(table: TableElement, index: number): void {
  if (table.rows.length <= 1 || !inRange(index, table.rows.length)) return;
  table.rows.splice(index, 1);
  table.cells.splice(index, 1);
  // The header was that row: the next row does not become one.
  if (index === 0) delete table.header;
}

/** Put an empty column in at `index`, as wide as the column it copies. */
export function insertColumn(table: TableElement, index: number): void {
  if (table.cols.length >= TABLE_MAX_COLS) return;
  const at = clampIndex(index, table.cols.length);
  const like = table.cols[Math.min(at, table.cols.length - 1)] ?? TABLE_MIN_COL;
  table.cols.splice(at, 0, like);
  for (const row of table.cells) row.splice(at, 0, "");
}

/** Take out column `index`; the last column stays. */
export function removeColumn(table: TableElement, index: number): void {
  if (table.cols.length <= 1 || !inRange(index, table.cols.length)) return;
  table.cols.splice(index, 1);
  for (const row of table.cells) row.splice(index, 1);
}

/** Set column `index`'s width, never under {@link TABLE_MIN_COL}. */
export function setColumnWidth(table: TableElement, index: number, width: number): void {
  if (!inRange(index, table.cols.length) || !Number.isFinite(width)) return;
  table.cols[index] = round2(Math.max(TABLE_MIN_COL, width));
}

/** Set row `index`'s least height, never under {@link TABLE_MIN_ROW}. */
export function setRowHeight(table: TableElement, index: number, height: number): void {
  if (!inRange(index, table.rows.length) || !Number.isFinite(height)) return;
  table.rows[index] = round2(Math.max(TABLE_MIN_ROW, height));
}

/** The text of a cell, `""` outside the table. */
export function cellText(table: TableElement, row: number, col: number): string {
  return table.cells[row]?.[col] ?? "";
}

/** Set a cell's text; nothing outside the table. */
export function setCellText(table: TableElement, row: number, col: number, text: string): void {
  const cells = table.cells[row];
  if (!cells || !inRange(col, cells.length)) return;
  cells[col] = text;
}

/** The cell after (`step` 1) or before (`step` -1) one, reading order; `null` past either end. */
export function stepCell(
  table: Pick<TableElement, "rows" | "cols">,
  row: number,
  col: number,
  step: 1 | -1,
): { row: number; col: number } | null {
  const n = table.cols.length;
  const at = row * n + col + step;
  if (at < 0 || at >= table.rows.length * n) return null;
  return { row: Math.floor(at / n), col: at % n };
}

/**
 * Scale a table by `k` (a lasso resize): its place about (ax, ay), its
 * columns and rows, its line width and its font, so it wraps at the same
 * words. The font stays inside the sizes the loader keeps.
 */
export function scaleTable(table: TableElement, ax: number, ay: number, k: number): void {
  table.x = ax + (table.x - ax) * k;
  table.y = ay + (table.y - ay) * k;
  table.cols = table.cols.map((w) => Math.max(TABLE_MIN_COL, w * k));
  table.rows = table.rows.map((h) => Math.max(TABLE_MIN_ROW, h * k));
  table.size = Math.min(TABLE_MAX_LINE, table.size * k);
  table.fontSize = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, table.fontSize * k));
}

/**
 * How far a resize may scale `tables` and keep their fonts as they were
 * scaled (the loader floors and caps them).
 */
export function tableScaleRange(tables: readonly TableElement[]): { min: number; max: number } {
  let min = 0;
  let max = Infinity;
  for (const { fontSize } of tables) {
    if (!(fontSize > 0) || !Number.isFinite(fontSize)) continue;
    min = Math.max(min, MIN_TEXT_SIZE / fontSize);
    max = Math.min(max, MAX_TEXT_SIZE / fontSize);
  }
  return { min: Math.min(min, 1), max: Math.max(max, 1) };
}

// --- Reading from disk --------------------------------------------------------

/**
 * A stored table as the model keeps it, or `null` when it is not one (no
 * columns, no rows). Ragged cell rows are padded or cut to the columns; a
 * size out of range is raised to the least the editor makes, never dropped,
 * since the cells' text is the user's.
 */
export function normalizeTable(raw: unknown, mintId: () => string): TableElement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const cols = lengths(r.cols, TABLE_MIN_COL, TABLE_MAX_COLS);
  const rows = lengths(r.rows, TABLE_MIN_ROW, TABLE_MAX_ROWS);
  if (cols.length === 0 || rows.length === 0) return null;
  const stored = Array.isArray(r.cells) ? r.cells : [];
  const cells = rows.map((_, i) => {
    const row: unknown[] = Array.isArray(stored[i]) ? (stored[i] as unknown[]) : [];
    return cols.map((__, j) => (typeof row[j] === "string" ? (row[j] as string) : ""));
  });
  const table: TableElement = {
    id: typeof r.id === "string" ? r.id : mintId(),
    x: finite(r.x, 0),
    y: finite(r.y, 0),
    cols,
    rows,
    cells,
    color: isHexColor(r.color) ? r.color : DEFAULT_TABLE_COLOR,
    size: Math.min(TABLE_MAX_LINE, Math.max(0.25, finite(r.size, TABLE_LINE_WIDTH))),
    textColor: isHexColor(r.textColor) ? r.textColor : DEFAULT_TABLE_COLOR,
    fontSize: Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, finite(r.fontSize, TABLE_FONT_SIZE))),
  };
  if (TEXT_FONTS.includes(r.font as TextFont)) table.font = r.font as TextFont;
  if (r.header === true) table.header = true;
  const headerFill = readFill(r.headerFill);
  if (headerFill) table.headerFill = headerFill;
  const fill = readFill(r.fill);
  if (fill) table.fill = fill;
  const dash: ShapeDash | undefined = readDash(r.dash);
  if (dash) table.dash = dash;
  return table;
}

/** A table's colour when the file has none to give: the default ink. */
const DEFAULT_TABLE_COLOR = "#1a1a1a";

// --- Helpers ----------------------------------------------------------------

function lengths(raw: unknown, min: number, most: number): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, most)
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, v) : min));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampCount(n: number, most: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.min(most, Math.trunc(n))) : 1;
}

function clampIndex(index: number, length: number): number {
  return Number.isFinite(index) ? Math.max(0, Math.min(length, Math.trunc(index))) : length;
}

function inRange(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
