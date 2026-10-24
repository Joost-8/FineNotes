/**
 * Table commands: placing a table, its row and column edits, resizing a
 * column or a row, the header row and a cell's text, each one undo step.
 * Moving, resizing, deleting and copying a table as a whole are the lasso's
 * (`selection-commands.ts`), with every other element.
 *
 * A table is held by identity, as the selection commands hold theirs (ids
 * repeat in hand-edited notes), and every inverse puts back the exact table
 * it changed, key order included, so an undo is `JSON.stringify`-identical.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { type InkDocument, type TableElement, pageById } from "./document";
import {
  type TableCellStylePatch,
  removeColumn,
  removeRow,
  setCellStyle,
  setCellText,
  setColumnWidth,
  setRowHeight,
} from "./table";
import { insertColumnWithin, insertRowWithin } from "./table-fit";

/** Put a table on a page, above the tables already there. */
export class AddTable implements Command {
  readonly label = "Add table";
  /** Whether the page had no `tables` list before, so undo leaves it without one. */
  private created = false;

  constructor(
    readonly pageId: string,
    private readonly table: TableElement,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.created = page.tables === undefined;
    (page.tables ??= []).push(this.table);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    const tables = page?.tables;
    if (!page || !tables) return;
    const index = tables.indexOf(this.table);
    if (index >= 0) tables.splice(index, 1);
    if (this.created && tables.length === 0) delete page.tables;
  }
}

/** What a table edit does to the table it is given. */
type TableEditFn = (table: TableElement) => void;

/**
 * A change to one table, undone by putting back a copy taken just before.
 * The edit runs again on redo, from the same state, so it lands the same.
 */
class TableEdit implements Command {
  private before: TableElement | null = null;

  constructor(
    readonly pageId: string,
    private readonly table: TableElement,
    readonly label: string,
    private readonly edit: TableEditFn,
  ) {}

  apply(doc: InkDocument): void {
    this.before = null;
    if (!onPage(doc, this.pageId, this.table)) return;
    this.before = structuredClone(this.table);
    this.edit(this.table);
  }

  invert(doc: InkDocument): void {
    const before = this.before;
    if (!before || !onPage(doc, this.pageId, this.table)) return;
    restoreTable(this.table, before);
    this.before = null;
  }
}

/**
 * An empty row at `index` (0 = above the first row), no higher than the
 * `room` left below the table (page px; none given: as high as it copies).
 */
export class InsertTableRow extends TableEdit {
  constructor(pageId: string, table: TableElement, index: number, room = Infinity) {
    super(pageId, table, "Add row", (t) => insertRowWithin(t, index, room));
  }
}

/** Take out row `index`. */
export class RemoveTableRow extends TableEdit {
  constructor(pageId: string, table: TableElement, index: number) {
    super(pageId, table, "Delete row", (t) => removeRow(t, index));
  }
}

/**
 * An empty column at `index` (0 = left of the first column), the columns
 * narrowed to fit within `room` (page px from the table's left edge to the
 * page's right edge; none given: no limit).
 */
export class InsertTableColumn extends TableEdit {
  constructor(pageId: string, table: TableElement, index: number, room = Infinity) {
    super(pageId, table, "Add column", (t) => insertColumnWithin(t, index, room));
  }
}

/** Take out column `index`. */
export class RemoveTableColumn extends TableEdit {
  constructor(pageId: string, table: TableElement, index: number) {
    super(pageId, table, "Delete column", (t) => removeColumn(t, index));
  }
}

/** Give column `index` a width, page px. */
export class ResizeTableColumn extends TableEdit {
  constructor(pageId: string, table: TableElement, index: number, width: number) {
    super(pageId, table, "Resize column", (t) => setColumnWidth(t, index, width));
  }
}

/** Give row `index` a least height, page px. */
export class ResizeTableRow extends TableEdit {
  constructor(pageId: string, table: TableElement, index: number, height: number) {
    super(pageId, table, "Resize row", (t) => setRowHeight(t, index, height));
  }
}

/** Make the first row a header, or an ordinary row again. */
export class SetTableHeader extends TableEdit {
  constructor(pageId: string, table: TableElement, on: boolean) {
    super(pageId, table, on ? "Header row" : "No header row", (t) => {
      if (on) t.header = true;
      else delete t.header;
    });
  }
}

/** A cell's own look: bold or not, its text colour or the table's. */
export class SetTableCellStyle extends TableEdit {
  constructor(
    pageId: string,
    table: TableElement,
    row: number,
    col: number,
    patch: TableCellStylePatch,
  ) {
    super(pageId, table, "Cell style", (t) => setCellStyle(t, row, col, patch));
  }
}

/**
 * A cell's text. Typing writes the cell as it goes (so the page, its
 * thumbnail and a save see it at once), and the edit is recorded when the
 * cell is left, with the text it had before: `before` is given, not read,
 * because by then the table already holds `after`.
 *
 * Text that would run past the bottom of the page moves the table up
 * instead; `move` gives its top edge before and after, so the text and the
 * move are one step.
 */
export class SetTableCell implements Command {
  readonly label = "Edit cell";

  constructor(
    readonly pageId: string,
    private readonly table: TableElement,
    private readonly row: number,
    private readonly col: number,
    private readonly before: string,
    private readonly after: string,
    private readonly move?: { from: number; to: number },
  ) {}

  apply(doc: InkDocument): void {
    if (onPage(doc, this.pageId, this.table)) {
      setCellText(this.table, this.row, this.col, this.after);
      if (this.move) this.table.y = this.move.to;
    }
  }

  invert(doc: InkDocument): void {
    if (onPage(doc, this.pageId, this.table)) {
      setCellText(this.table, this.row, this.col, this.before);
      if (this.move) this.table.y = this.move.from;
    }
  }
}

/** Whether `table` is on page `pageId` of `doc` now. */
function onPage(doc: InkDocument, pageId: string, table: TableElement): boolean {
  return pageById(doc, pageId)?.tables?.includes(table) === true;
}

/** Make `table` exactly `before` again, the same object, its keys in their old order. */
export function restoreTable(table: TableElement, before: TableElement): void {
  const target = table as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(table, structuredClone(before));
}
