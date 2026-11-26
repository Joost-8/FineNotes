/**
 * A table in a text note: rows of plain-text cells, the first row its
 * header, as in Apple Notes and Markdown. PURE: every edit returns a new
 * block and leaves the one it was given alone.
 *
 * On disk a table is a GitHub-style Markdown table (`text-note-file.ts`),
 * so Obsidian's reading view shows it as a table too.
 */

import type { TableBlock } from "./text-note";

/** A new table's size: a header and two rows, two columns (Apple Notes' first table). */
export const TABLE_DEFAULT_ROWS = 3;
export const TABLE_DEFAULT_COLUMNS = 2;
/** The most a table grows to: past this a note is the wrong place for it. */
export const TABLE_MAX_ROWS = 200;
export const TABLE_MAX_COLUMNS = 12;

/** A table of `rows` by `columns` empty cells. */
export function emptyTable(
  id: string,
  rows = TABLE_DEFAULT_ROWS,
  columns = TABLE_DEFAULT_COLUMNS,
): TableBlock {
  const r = Math.max(1, Math.min(TABLE_MAX_ROWS, Math.round(rows)));
  const c = Math.max(1, Math.min(TABLE_MAX_COLUMNS, Math.round(columns)));
  return { type: "table", id, rows: Array.from({ length: r }, () => Array<string>(c).fill("")) };
}

/** Every row as long as the longest: a ragged table read from a file is squared up. */
export function squareRows(rows: readonly (readonly string[])[]): string[][] {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const out = rows.map((row) => {
    const cells = row.slice(0, TABLE_MAX_COLUMNS).map((cell) => cleanCell(cell));
    while (cells.length < Math.min(width, TABLE_MAX_COLUMNS)) cells.push("");
    return cells;
  });
  return out.length > 0 ? out.slice(0, TABLE_MAX_ROWS) : [[""]];
}

/** A cell's text on one line: a table cell holds no line breaks. */
export function cleanCell(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

export function columnCount(block: TableBlock): number {
  return block.rows[0]?.length ?? 0;
}

/** The table with one cell's text set; the same block when nothing changed. */
export function setCell(block: TableBlock, row: number, column: number, text: string): TableBlock {
  const current = block.rows[row]?.[column];
  const clean = cleanCell(text);
  if (current === undefined || current === clean) return block;
  const rows = block.rows.map((cells, r) =>
    r === row ? cells.map((cell, c) => (c === column ? clean : cell)) : cells,
  );
  return { ...block, rows };
}

/** A new empty row at index `at` (clamped), below the header at the least. */
export function addRow(block: TableBlock, at: number): TableBlock {
  if (block.rows.length >= TABLE_MAX_ROWS) return block;
  const index = Math.max(1, Math.min(block.rows.length, Math.round(at)));
  const rows = block.rows.slice();
  rows.splice(index, 0, Array<string>(columnCount(block)).fill(""));
  return { ...block, rows };
}

/** A new empty column at index `at` (clamped). */
export function addColumn(block: TableBlock, at: number): TableBlock {
  const width = columnCount(block);
  if (width >= TABLE_MAX_COLUMNS) return block;
  const index = Math.max(0, Math.min(width, Math.round(at)));
  const rows = block.rows.map((cells) => {
    const next = cells.slice();
    next.splice(index, 0, "");
    return next;
  });
  return { ...block, rows };
}

/** The table without row `at`; null when that would leave no row. */
export function removeRow(block: TableBlock, at: number): TableBlock | null {
  if (at < 0 || at >= block.rows.length) return block;
  if (block.rows.length <= 1) return null;
  return { ...block, rows: block.rows.filter((_, r) => r !== at) };
}

/** The table without column `at`; null when that would leave no column. */
export function removeColumn(block: TableBlock, at: number): TableBlock | null {
  const width = columnCount(block);
  if (at < 0 || at >= width) return block;
  if (width <= 1) return null;
  return { ...block, rows: block.rows.map((cells) => cells.filter((_, c) => c !== at)) };
}

// ---------------------------------------------------------------- Markdown

/** A cell's text as a Markdown table cell: a pipe and a backslash are escaped. */
function encodeCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").trim();
}

/** A table as its Markdown lines: header, separator, rows. */
export function encodeTable(block: TableBlock): string[] {
  const rows = squareRows(block.rows);
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell) => encodeCell(cell) || " ").join(" | ")} |`.replace(/ {2,}\|/g, " |");
  const separator = `|${rows[0].map(() => " --- ").join("|")}|`;
  return [line(rows[0]), separator, ...rows.slice(1).map(line)];
}

/** A Markdown table row's cells, its escapes undone. */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && (text[i + 1] === "|" || text[i + 1] === "\\")) {
      cell += text[i + 1];
      i++;
    } else if (c === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Whether a table starts at line `i`: a row of pipes, then a separator line. */
export function tableStartsAt(lines: readonly string[], i: number): boolean {
  const head = lines[i];
  const rule = lines[i + 1];
  return (
    head !== undefined &&
    rule !== undefined &&
    head.trimStart().startsWith("|") &&
    SEPARATOR.test(rule.trim()) &&
    splitTableRow(rule).length === splitTableRow(head).length
  );
}

/** The table starting at line `i` and the index of its last line. */
export function readTable(
  lines: readonly string[],
  i: number,
  id: string,
): { block: TableBlock; end: number } {
  const rows: string[][] = [splitTableRow(lines[i])];
  let end = i + 1;
  while (end + 1 < lines.length && lines[end + 1].trimStart().startsWith("|")) {
    end++;
    rows.push(splitTableRow(lines[end]));
  }
  return { block: { type: "table", id, rows: squareRows(rows) }, end };
}
