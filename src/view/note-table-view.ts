/**
 * A table on a text note's page. The page treats it as one section (an
 * island, like a picture); inside it each cell is a small editable field of
 * its own. Typing changes the cell's text in place and tells the editor,
 * which keeps undo; the table is only rebuilt when its shape or a cell's
 * text changed from outside (undo, a file read).
 *
 * Tab moves to the next cell (and adds a row after the last), Shift+Tab
 * back; Return goes to the cell below, adding a row at the foot.
 */

import { setIcon } from "obsidian";
import {
  addColumn,
  addRow,
  columnCount,
  removeColumn,
  removeRow,
  setCell,
} from "../model/note-table";
import type { TableBlock } from "../model/text-note";

export interface TableViewHost {
  /** The table changed; `typing` groups the change with the typing around it for undo. */
  commit(id: string, next: TableBlock, typing: boolean): void;
  /** Remove the whole table. */
  remove(id: string): void;
  label(key: TableLabel): string;
}

export type TableLabel = "addRow" | "addColumn" | "deleteRow" | "deleteColumn" | "deleteTable";

interface Cell {
  row: number;
  column: number;
}

export class NoteTableView {
  readonly el: HTMLElement;
  private block: TableBlock;
  private readonly table: HTMLTableElement;
  /** The cell the caret was last in: the bar's row and column buttons act on it. */
  private focus: Cell = { row: 0, column: 0 };

  constructor(
    block: TableBlock,
    private readonly host: TableViewHost,
  ) {
    this.block = block;
    this.el = createDiv({
      cls: "finenotes-note-table",
      attr: { contenteditable: "false", "data-fn-id": block.id, "data-fn-island": "table" },
    });
    const scroll = this.el.createDiv({ cls: "finenotes-note-table-scroll" });
    this.table = scroll.createEl("table");
    this.buildBar();
    this.build();
    this.table.addEventListener("input", this.onInput);
    this.table.addEventListener("keydown", this.onKeyDown);
    this.table.addEventListener("focusin", this.onFocus);
    this.table.addEventListener("paste", this.onPaste);
    this.table.addEventListener("beforeinput", this.onBeforeInput);
  }

  get id(): string {
    return this.block.id;
  }

  /** Show `next`; the cells are kept when they already hold what it says. */
  setBlock(next: TableBlock): void {
    const previous = this.block;
    this.block = next;
    if (previous === next) return;
    const sameShape =
      previous.rows.length === next.rows.length && columnCount(previous) === columnCount(next);
    if (sameShape && this.cellsMatch()) return;
    const hadFocus = this.el.contains(this.el.doc.activeElement);
    this.build();
    if (hadFocus) this.focusCell(this.clamp(this.focus));
  }

  /** Put the caret in a cell: the first one, or the one given. */
  focusCell(cell: Cell = { row: 0, column: 0 }, atEnd = true): void {
    const el = this.cellEl(cell);
    if (!el) return;
    el.focus();
    const selection = this.el.win.getSelection();
    if (!selection) return;
    const range = this.el.doc.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    selection.removeAllRanges();
    selection.addRange(range);
    this.focus = cell;
  }

  // -------------------------------------------------------------- building

  private build(): void {
    this.table.empty();
    this.block.rows.forEach((cells, row) => {
      const tr = this.table.createEl("tr");
      cells.forEach((text, column) => {
        const cell = tr.createEl(row === 0 ? "th" : "td", {
          attr: {
            contenteditable: "true",
            "data-row": String(row),
            "data-column": String(column),
            spellcheck: "true",
          },
        });
        cell.setText(text);
      });
    });
  }

  private buildBar(): void {
    const bar = this.el.createDiv({ cls: "finenotes-note-island-bar finenotes-note-table-bar" });
    const button = (icon: string, key: TableLabel, act: () => void): void => {
      const b = bar.createEl("button", {
        cls: "clickable-icon finenotes-note-island-button",
        attr: { type: "button", "aria-label": this.host.label(key) },
      });
      setIcon(b, icon);
      // On pointerup: a Pencil's tap makes no click; and the caret must stay in its cell.
      b.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      b.addEventListener("pointerup", (event) => {
        event.preventDefault();
        event.stopPropagation();
        act();
      });
    };
    button("between-horizontal-end", "addRow", () => {
      this.change(addRow(this.block, this.focus.row + 1), {
        ...this.focus,
        row: this.focus.row + 1,
      });
    });
    button("between-vertical-end", "addColumn", () => {
      this.change(addColumn(this.block, this.focus.column + 1), {
        ...this.focus,
        column: this.focus.column + 1,
      });
    });
    button("rows-3", "deleteRow", () => {
      const next = removeRow(this.block, this.focus.row);
      if (next) this.change(next, this.focus);
      else this.host.remove(this.block.id);
    });
    button("columns-3", "deleteColumn", () => {
      const next = removeColumn(this.block, this.focus.column);
      if (next) this.change(next, this.focus);
      else this.host.remove(this.block.id);
    });
    button("trash-2", "deleteTable", () => this.host.remove(this.block.id));
  }

  // -------------------------------------------------------------- editing

  private change(next: TableBlock, focus: Cell): void {
    if (next === this.block) return;
    this.focus = this.clamp(focus, next);
    this.host.commit(this.block.id, next, false);
    this.focusCell(this.focus);
  }

  private cellOf(target: EventTarget | null): (Cell & { el: HTMLElement }) | null {
    const node = target as Node | null;
    const el = node?.instanceOf(Element) ? node.closest("[data-row]") : null;
    if (!el?.instanceOf(HTMLElement) || !this.table.contains(el)) return null;
    return { row: Number(el.dataset.row), column: Number(el.dataset.column), el };
  }

  private cellEl(cell: Cell): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(
      `[data-row="${cell.row}"][data-column="${cell.column}"]`,
    );
  }

  private clamp(cell: Cell, block: TableBlock = this.block): Cell {
    return {
      row: Math.max(0, Math.min(block.rows.length - 1, cell.row)),
      column: Math.max(0, Math.min(columnCount(block) - 1, cell.column)),
    };
  }

  private cellsMatch(): boolean {
    return this.block.rows.every((cells, row) =>
      cells.every((text, column) => (this.cellEl({ row, column })?.textContent ?? "") === text),
    );
  }

  private readonly onFocus = (event: FocusEvent): void => {
    const cell = this.cellOf(event.target);
    if (cell) this.focus = { row: cell.row, column: cell.column };
  };

  private readonly onInput = (event: Event): void => {
    event.stopPropagation();
    const cell = this.cellOf(event.target);
    if (!cell) return;
    const next = setCell(this.block, cell.row, cell.column, cell.el.textContent ?? "");
    if (next === this.block) return;
    this.block = next;
    this.host.commit(next.id, next, true);
  };

  /** Undo is the page's; styling a cell's text is not offered; the rest is the cell's own. */
  private readonly onBeforeInput = (event: InputEvent): void => {
    const type = event.inputType;
    if (type.startsWith("history")) return;
    event.stopPropagation();
    if (type.startsWith("format") || type === "insertParagraph" || type === "insertLineBreak") {
      event.preventDefault();
    }
  };

  private readonly onPaste = (event: ClipboardEvent): void => {
    // Plain text only: a cell holds one line of text.
    event.preventDefault();
    event.stopPropagation();
    const cell = this.cellOf(event.target);
    const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/[\r\n\t]+/g, " ");
    const selection = this.el.win.getSelection();
    if (!cell || !text || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!cell.el.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = this.el.doc.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    const next = setCell(this.block, cell.row, cell.column, cell.el.textContent ?? "");
    if (next === this.block) return;
    this.block = next;
    this.host.commit(next.id, next, false);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const cell = this.cellOf(event.target);
    if (!cell) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod) return; // undo and the marks are the page's
    event.stopPropagation();
    const width = columnCount(this.block);
    if (event.key === "Tab") {
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      let row = cell.row;
      let column = cell.column + step;
      if (column >= width) {
        column = 0;
        row++;
      } else if (column < 0) {
        column = width - 1;
        row--;
      }
      if (row < 0) return;
      if (row >= this.block.rows.length) {
        this.change(addRow(this.block, row), { row, column });
        return;
      }
      this.focusCell({ row, column });
      return;
    }
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      const row = cell.row + 1;
      if (row >= this.block.rows.length) this.change(addRow(this.block, row), { ...cell, row });
      else this.focusCell({ row, column: cell.column });
    }
  };
}
