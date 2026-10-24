/**
 * Keeping a table on its page. A table is edited in place, cell by cell, and
 * every edit that makes it bigger (a new row or column, a wider column, a
 * taller row, more text in a cell) is held to the paper: it fits, it is cut
 * down until it fits, or it is refused.
 *
 * The rule is "never worse": an edit may not take any edge of the table
 * further past the page's edge than it already was. A table that fits stays
 * inside the page; one that already hangs over (an older note, a font that
 * measures wider on another device) can still shrink, and only cannot grow.
 *
 * Pure: no DOM, no Obsidian. The shown height of a row depends on its text,
 * so the frames compared here come from the caller's layout.
 */

import type { TableElement } from "./document";
import {
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  TABLE_MIN_COL,
  TABLE_MIN_ROW,
  insertColumn,
  insertRow,
} from "./table";

/** A frame on the page, page px. */
export interface TableFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A page's size, page px. */
export interface PageSize {
  width: number;
  height: number;
}

/** Rounding a frame may differ by and still count as unchanged, page px. */
export const PAGE_SLACK = 0.5;

/**
 * Whether `after` is no further past any edge of the page than `before` was.
 * Inside the page is always allowed; past an edge, only as far as before.
 */
export function keepsToPage(before: TableFrame, after: TableFrame, page: PageSize): boolean {
  const left = Math.min(0, before.x);
  const top = Math.min(0, before.y);
  const right = Math.max(page.width, before.x + before.w);
  const bottom = Math.max(page.height, before.y + before.h);
  return (
    after.x >= left - PAGE_SLACK &&
    after.y >= top - PAGE_SLACK &&
    after.x + after.w <= right + PAGE_SLACK &&
    after.y + after.h <= bottom + PAGE_SLACK
  );
}

/**
 * Column widths brought down to `room` page px in all, each keeping its share
 * but none under {@link TABLE_MIN_COL}; unchanged when they already fit, and
 * `null` when not even the narrowest columns would.
 */
export function fitWidths(cols: readonly number[], room: number): number[] | null {
  const total = cols.reduce((a, b) => a + b, 0);
  if (total <= room + PAGE_SLACK) return cols.slice();
  if (!(cols.length * TABLE_MIN_COL <= room)) return null;
  // Shrink in proportion; a column that would go under the least is held
  // there, and the rest share what is left, until no more are held.
  const held = new Set<number>();
  for (;;) {
    const free = cols.reduce((a, w, i) => (held.has(i) ? a : a + w), 0);
    const left = room - held.size * TABLE_MIN_COL;
    const k = free > 0 ? left / free : 0;
    let more = false;
    for (let i = 0; i < cols.length; i++) {
      if (!held.has(i) && cols[i] * k < TABLE_MIN_COL) {
        held.add(i);
        more = true;
      }
    }
    if (!more) {
      // Rounded down to hundredths, so the sum never rounds past the room.
      return cols.map((w, i) =>
        held.has(i) ? TABLE_MIN_COL : Math.max(TABLE_MIN_COL, Math.floor(w * k * 100) / 100),
      );
    }
  }
}

/**
 * The widths after an empty column goes in at `index`, as wide as the column
 * it copies, all of them brought within `room` (the page px from the table's
 * left edge to the page's right edge). `null` when there is no room, or the
 * table has as many columns as it may.
 */
export function columnsWithInserted(
  cols: readonly number[],
  index: number,
  room: number,
): number[] | null {
  if (cols.length >= TABLE_MAX_COLS || cols.length === 0) return null;
  const at = clampIndex(index, cols.length);
  const next = cols.slice();
  next.splice(at, 0, cols[Math.min(at, cols.length - 1)]);
  // A table already wider than the room keeps its width: it may not grow.
  const total = cols.reduce((a, b) => a + b, 0);
  return fitWidths(next, Math.max(room, total));
}

/**
 * The least height a new row gets: as high as the row it copies (`like`),
 * cut to the `room` left below the table. `null` when not even a row of the
 * least height fits.
 */
export function insertedRowHeight(like: number, room: number): number | null {
  if (!(room >= TABLE_MIN_ROW - PAGE_SLACK)) return null;
  return Math.max(TABLE_MIN_ROW, Math.min(like, Math.floor(room * 100) / 100));
}

/**
 * Where a table's top edge goes while its text grows, so its bottom stays on
 * the page: up only as far as needed, never below where typing began
 * (`startY`), never above the page's top (or above where it already was,
 * when it began above it). Whether it then fits is the caller's
 * {@link keepsToPage}: a table as tall as the page cannot float any higher.
 */
export function floatedTop(startY: number, height: number, pageHeight: number): number {
  const top = Math.min(0, startY);
  return Math.max(top, Math.min(startY, pageHeight - height));
}

/** Put an empty column in at `index`, the columns brought within `room`; false when refused. */
export function insertColumnWithin(table: TableElement, index: number, room: number): boolean {
  const widths = columnsWithInserted(table.cols, index, room);
  if (!widths) return false;
  insertColumn(table, index);
  table.cols = widths;
  return true;
}

/**
 * Put an empty row in at `index` whose least height fits the `room` left
 * below the table; false when refused.
 */
export function insertRowWithin(table: TableElement, index: number, room: number): boolean {
  if (table.rows.length >= TABLE_MAX_ROWS || table.rows.length === 0) return false;
  const at = clampIndex(index, table.rows.length);
  const height = insertedRowHeight(table.rows[Math.min(at, table.rows.length - 1)], room);
  if (height === null) return false;
  insertRow(table, at);
  table.rows[at] = height;
  return true;
}

/**
 * The value nearest `to`, going from `from`, for which `fits` holds, found
 * by halving: `from` is taken to fit (it is where the drag started). A drag
 * that runs off the page stops at the page.
 */
export function furthestFitting(
  from: number,
  to: number,
  fits: (value: number) => boolean,
  steps = 12,
): number {
  if (fits(to)) return to;
  let good = from;
  let bad = to;
  for (let i = 0; i < steps; i++) {
    const mid = (good + bad) / 2;
    if (fits(mid)) good = mid;
    else bad = mid;
  }
  return Math.round(good * 100) / 100;
}

function clampIndex(index: number, length: number): number {
  return Number.isFinite(index) ? Math.max(0, Math.min(length, Math.trunc(index))) : length;
}
