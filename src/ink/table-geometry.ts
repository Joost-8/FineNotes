/**
 * Tables for the Shape tool (2026-09-22, Joost: "a mechanic to add tables
 * easily"). A table is placed as **ink** — an outer rectangle plus its inner
 * row and column lines, each an ordinary stroke with `shape` set — so it can
 * be written in, erased and lassoed like anything else, and needs nothing new
 * from the renderer, the hit-tester or the file format.
 *
 * Pure: no DOM, no Obsidian. Output points are rounded to serialize.ts's
 * 1/100 px, like every other clean shape.
 */

import { type Pt, presetGeometry } from "./shape-geometry";

export interface TableSize {
  rows: number;
  cols: number;
}

/** The picker's grid: up to this many rows and columns. */
export const TABLE_MAX_ROWS = 8;
export const TABLE_MAX_COLS = 8;

/** What the Table tool starts with before anything is picked. */
export const DEFAULT_TABLE_SIZE: Readonly<TableSize> = { rows: 3, cols: 3 };

/** Page px per column and per row of a table placed with a tap: room to write a word in. */
export const TABLE_CELL_WIDTH = 120;
export const TABLE_CELL_HEIGHT = 56;
/** A dragged table is never smaller than this per cell, so its lines stay apart. */
export const TABLE_MIN_CELL = 16;
/** A tap-placed table keeps this far from the page's edges. */
const PAGE_MARGIN = 24;

export function isTableSize(value: unknown): value is TableSize {
  if (typeof value !== "object" || value === null) return false;
  const { rows, cols } = value as Partial<TableSize>;
  return (
    Number.isInteger(rows) &&
    Number.isInteger(cols) &&
    (rows as number) >= 1 &&
    (cols as number) >= 1 &&
    (rows as number) <= TABLE_MAX_ROWS &&
    (cols as number) <= TABLE_MAX_COLS
  );
}

/** "3 × 4": rows by columns, the way the picker reads. */
export function tableSizeLabel(size: TableSize): string {
  return `${size.rows} × ${size.cols}`;
}

/** One stroke of a table: the outline, or one inner line. */
export interface TableStroke {
  shape: "rect" | "line";
  pts: number[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The strokes of a `size` table filling the box spanned by `from` and `to`:
 * the outline first (a closed rect from the top-left, clockwise), then the
 * row lines top to bottom, then the column lines left to right, all evenly
 * spaced. Returns `[]` for a degenerate or non-finite box.
 */
export function tableStrokes(from: Pt, to: Pt, size: TableSize, pressure: number): TableStroke[] {
  if (!isTableSize(size)) return [];
  const outline = presetGeometry("rect", from, to, pressure);
  if (outline.length === 0) return [];
  const x0 = Math.min(from.x, to.x);
  const y0 = Math.min(from.y, to.y);
  const x1 = Math.max(from.x, to.x);
  const y1 = Math.max(from.y, to.y);
  const strokes: TableStroke[] = [{ shape: "rect", pts: outline }];
  for (let r = 1; r < size.rows; r++) {
    const y = round2(y0 + ((y1 - y0) * r) / size.rows);
    strokes.push({ shape: "line", pts: [round2(x0), y, pressure, round2(x1), y, pressure] });
  }
  for (let c = 1; c < size.cols; c++) {
    const x = round2(x0 + ((x1 - x0) * c) / size.cols);
    strokes.push({ shape: "line", pts: [x, round2(y0), pressure, x, round2(y1), pressure] });
  }
  return strokes;
}

/**
 * The box a table dragged from `from` to `to` fills. Too small a drag is
 * grown, away from the press in the drag's direction, until every cell is at
 * least {@link TABLE_MIN_CELL} square — a nearly flat drag still makes a
 * table rather than nothing — and the box is then moved back onto the page.
 * `cellScale` scales that minimum, so it stays the same size on screen when
 * the view is zoomed (the surface passes 1 / zoom).
 */
export function draggedTableBox(
  from: Pt,
  to: Pt,
  size: TableSize,
  page: { width: number; height: number },
  cellScale = 1,
): { from: Pt; to: Pt } {
  const grow = (a: number, b: number, min: number): number =>
    Math.abs(b - a) >= min ? b : a + (b >= a ? min : -min);
  const minCell = TABLE_MIN_CELL * cellScale;
  const end = {
    x: grow(from.x, to.x, size.cols * minCell),
    y: grow(from.y, to.y, size.rows * minCell),
  };
  const shift = (a: number, b: number, limit: number): number => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo < 0) return -lo;
    if (hi > limit) return Math.max(limit - hi, -lo);
    return 0;
  };
  const dx = shift(from.x, end.x, page.width);
  const dy = shift(from.y, end.y, page.height);
  return {
    from: { x: from.x + dx, y: from.y + dy },
    to: { x: end.x + dx, y: end.y + dy },
  };
}

/**
 * The box of a table placed with a tap: its top-left corner at the tap, its
 * cells {@link TABLE_CELL_WIDTH} by {@link TABLE_CELL_HEIGHT} — narrowed or
 * shortened evenly if the whole table would not fit on the page — and moved
 * onto the page, clear of its edges, if the tap was too near one.
 * `cellScale` scales the cells, so a table tapped at 5x zoom looks as big
 * on screen as one tapped at fit (the surface passes 1 / zoom).
 */
export function tappedTableBox(
  at: Pt,
  size: TableSize,
  page: { width: number; height: number },
  cellScale = 1,
): { from: Pt; to: Pt } {
  const room = (extent: number): number =>
    Math.max(TABLE_MIN_CELL * cellScale, extent - 2 * PAGE_MARGIN);
  const w = Math.min(size.cols * TABLE_CELL_WIDTH * cellScale, room(page.width));
  const h = Math.min(size.rows * TABLE_CELL_HEIGHT * cellScale, room(page.height));
  const place = (v: number, extent: number, length: number): number =>
    Math.max(PAGE_MARGIN, Math.min(v, extent - PAGE_MARGIN - length));
  const x = place(at.x, page.width, w);
  const y = place(at.y, page.height, h);
  return { from: { x, y }, to: { x: x + w, y: y + h } };
}
