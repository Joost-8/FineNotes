/**
 * Typing in a table cell (DOM). One `<textarea>` lies over the cell being
 * edited, styled as a page text box's is — the same font stack, the size the
 * page scale gives with the iPad's 16 px floor undone by a transform, and the
 * padding in page units — so it wraps at the words the canvas wraps the cell
 * at (`canvas/table-layout`). While it is up, the canvas leaves that cell's
 * text out, so nothing shows twice.
 *
 * Above the table floats its bar: add a row or a column, the header row, and
 * delete the cell's row or column; an addition that would not fit on the
 * page is greyed out. Every column's right edge has a grip on the table's top
 * border and every row's bottom edge one on its left border, outside the
 * cells, so a drag of any border resizes and a tap in any cell types there.
 *
 * The rules from CLAUDE.md's ledger this follows: every button is
 * `clickable-icon` (Obsidian pads plain buttons 20 px on the iPad) and acts on
 * a pointerup after a pointerdown on itself, a click only from the keyboard
 * (a Pencil tap over the page never becomes a click); no press on the bar
 * moves the focus (the keyboard stays up); nothing waits on an animation's
 * finish. The surface owns the keyboard handling (the body class that lifts
 * Obsidian's keyboard cap, keeping the cell above the keyboard).
 */

import { setIcon } from "obsidian";
import { fontFamilyOf } from "../model/text-style";
import type { TextStyle } from "../model/text-style";
import { lineHeightOf } from "../model/text-style";
import { textInset } from "../canvas/text-layout";
import { swallowGhostClick } from "./ghost-click";

/** What the bar's buttons do. */
export type TableAction =
  "row-above" | "row-below" | "col-left" | "col-right" | "delete-row" | "delete-col" | "header";

export interface CellEditorCallbacks {
  /** The text was typed or pasted into (`composing`: an input method is still at it). */
  onInput: (text: string, composing: boolean) => void;
  /** The textarea took the focus. */
  onFocus: () => void;
  /** The textarea lost it, to `next` (`null`: to nothing). */
  onBlur: (next: EventTarget | null) => void;
  /** Tab (`1`) or Shift+Tab (`-1`): go to the next or previous cell. */
  onStep: (step: 1 | -1) => void;
  /** Escape: stop typing. */
  onEscape: () => void;
  onAction: (action: TableAction) => void;
  /** A grip was pressed: drag column `index`'s right edge or row `index`'s bottom edge. */
  onGrip: (kind: "col" | "row", index: number, event: PointerEvent) => void;
}

/** Where the cell is on screen and how its text looks there. */
export interface CellPlacement {
  /** The cell's frame, in the text layer's px. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The table's frame, in the same px: the bar sits above it, the grips on its borders. */
  tableLeft: number;
  tableTop: number;
  tableWidth: number;
  tableHeight: number;
  /** Each column's right edge and each row's bottom edge, in the same px. */
  colEdges: readonly number[];
  rowEdges: readonly number[];
  /** The cell's column and row, whose grips are marked. */
  col: number;
  row: number;
  /** CSS px per page px. */
  scale: number;
  /** The cell's style; `color` already as the page shows it. */
  style: TextStyle;
  /** Whether the table has a header row (the bar's toggle shows it). */
  header: boolean;
  /** The bar's actions that would do nothing now (no room on the page, the last row). */
  disabled: ReadonlySet<TableAction>;
}

/** iPadOS zooms into a text field whose computed font is under this (ink-surface's rule). */
const IOS_MIN_INPUT_FONT_PX = 16;
/** The bar's gap above the table, CSS px: clear of the column grips on its top border. */
const BAR_GAP_PX = 16;
/** The bar's height, CSS px, as styles.css sets it: it goes below the table if there is no room. */
const BAR_HEIGHT_PX = 36;
/** How long a refused edit marks the cell, ms. */
const REFUSED_MS = 450;

/**
 * The bar, left to right. A symbol each, its name in the tooltip; only what
 * deletes keeps a word, as everywhere in FineNotes.
 */
const ACTIONS: ReadonlyArray<{ action: TableAction; icon: string; label: string; text?: string }> =
  [
    { action: "row-above", icon: "arrow-up-to-line", label: "Add row above" },
    { action: "row-below", icon: "arrow-down-to-line", label: "Add row below" },
    { action: "col-left", icon: "arrow-left-to-line", label: "Add column left" },
    { action: "col-right", icon: "arrow-right-to-line", label: "Add column right" },
    { action: "header", icon: "heading", label: "Header row" },
    { action: "delete-row", icon: "trash-2", label: "Delete row", text: "Row" },
    { action: "delete-col", icon: "trash-2", label: "Delete column", text: "Column" },
  ];
/** A divider goes before each of these. */
const GROUP_STARTS: ReadonlySet<TableAction> = new Set(["col-left", "header", "delete-row"]);

export class TableCellEditor {
  /** The cell's frame: the textarea. */
  readonly root: HTMLElement;
  readonly input: HTMLTextAreaElement;
  readonly bar: HTMLElement;
  /** The grips on the table's borders, one per column and per row, reused as the table changes. */
  readonly grips: HTMLElement;
  private readonly colGrips: HTMLElement[] = [];
  private readonly rowGrips: HTMLElement[] = [];
  /** A line along the border being dragged, across the whole table. */
  private readonly guide: HTMLElement;
  private readonly buttons = new Map<TableAction, HTMLButtonElement>();
  private readonly callbacks: CellEditorCallbacks;
  private shown = false;
  private refuseTimer = 0;

  constructor(layer: HTMLElement, callbacks: CellEditorCallbacks) {
    this.callbacks = callbacks;
    this.root = layer.createDiv({ cls: "goodobsidian-table-cell is-hidden" });
    this.input = this.root.createEl("textarea", {
      cls: "goodobsidian-table-cell-input",
      attr: { "aria-label": "Table cell", rows: "1" },
    });
    this.grips = layer.createDiv({ cls: "goodobsidian-table-grips is-hidden" });
    this.guide = this.grips.createDiv({ cls: "goodobsidian-table-guide is-hidden" });
    // Dark in every theme, as the lasso's action bar is (Obsidian's own palette class).
    this.bar = layer.createDiv({ cls: "goodobsidian-table-bar theme-dark is-hidden" });
    // No press on the bar starts ink or takes the focus from the cell.
    for (const type of ["pointerdown", "mousedown"]) {
      this.bar.addEventListener(type, (event) => {
        event.stopPropagation();
        event.preventDefault();
      });
    }
    for (const entry of ACTIONS) {
      if (GROUP_STARTS.has(entry.action)) this.bar.createDiv({ cls: "goodobsidian-table-bar-gap" });
      const button = this.bar.createEl("button", {
        cls: "goodobsidian-table-bar-button clickable-icon",
        attr: { "aria-label": entry.label },
      });
      button.dataset.action = entry.action;
      const icon = button.createSpan({ cls: "goodobsidian-table-bar-icon" });
      setIcon(icon, entry.icon);
      if (entry.text) button.createSpan({ cls: "goodobsidian-table-bar-text", text: entry.text });
      onPress(button, () => callbacks.onAction(entry.action));
      this.buttons.set(entry.action, button);
    }

    // Text editing never starts ink on the page beneath.
    this.input.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.input.addEventListener("input", (event) =>
      callbacks.onInput(this.input.value, (event as InputEvent).isComposing === true),
    );
    // What an input method settles on is checked once it is settled.
    this.input.addEventListener("compositionend", () => callbacks.onInput(this.input.value, false));
    this.input.addEventListener("focus", () => callbacks.onFocus());
    this.input.addEventListener("blur", (event) => callbacks.onBlur(event.relatedTarget));
    this.input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Tab") {
        event.preventDefault();
        callbacks.onStep(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        callbacks.onEscape();
      }
    });
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Put the editor over a cell, styled as the cell's text is drawn. */
  place(at: CellPlacement): void {
    this.shown = true;
    this.root.removeClass("is-hidden");
    this.bar.removeClass("is-hidden");
    const { style, scale } = at;
    this.root.setCssStyles({
      left: `${at.left}px`,
      top: `${at.top}px`,
      width: `${at.width}px`,
      height: `${at.height}px`,
    });
    const fontPx = style.fontSize * scale;
    const shrink = Math.min(1, fontPx / IOS_MIN_INPUT_FONT_PX);
    // Page px -> the textarea's own px, before its shrink transform.
    const unit = scale / shrink;
    const inset = textInset(style);
    this.input.setCssStyles({
      fontSize: `${(fontPx / shrink).toFixed(2)}px`,
      fontFamily: fontFamilyOf(style),
      fontWeight: style.bold ? "700" : "400",
      lineHeight: String(lineHeightOf(style)),
      padding: `${(inset.y * unit).toFixed(2)}px ${(inset.x * unit).toFixed(2)}px`,
      color: style.color,
      width: `${100 / shrink}%`,
      height: `${100 / shrink}%`,
      transform: shrink < 1 ? `scale(${shrink})` : "",
    });
    const above = at.tableTop - BAR_GAP_PX - BAR_HEIGHT_PX;
    this.bar.setCssStyles({
      left: `${Math.max(0, at.tableLeft)}px`,
      top: `${above >= 0 ? above : at.top + at.height + BAR_GAP_PX}px`,
    });
    for (const [action, button] of this.buttons) button.disabled = at.disabled.has(action);
    const header = this.buttons.get("header");
    header?.toggleClass("is-active", at.header);
    header?.setAttribute("aria-pressed", String(at.header));
    this.placeGrips(at);
  }

  /** One grip per column on the table's top border, one per row on its left border. */
  private placeGrips(at: CellPlacement): void {
    this.grips.removeClass("is-hidden");
    this.grips.setCssStyles({
      left: `${at.tableLeft}px`,
      top: `${at.tableTop}px`,
      width: `${at.tableWidth}px`,
      height: `${at.tableHeight}px`,
    });
    this.syncGrips("col", this.colGrips, at.colEdges.length);
    this.syncGrips("row", this.rowGrips, at.rowEdges.length);
    at.colEdges.forEach((edge, i) => {
      this.colGrips[i].setCssStyles({ left: `${edge - at.tableLeft}px` });
      this.colGrips[i].toggleClass("is-current", i === at.col);
    });
    at.rowEdges.forEach((edge, i) => {
      this.rowGrips[i].setCssStyles({ top: `${edge - at.tableTop}px` });
      this.rowGrips[i].toggleClass("is-current", i === at.row);
    });
  }

  /** Make `list` hold exactly `count` grips of `kind`, reusing the ones there. */
  private syncGrips(kind: "col" | "row", list: HTMLElement[], count: number): void {
    while (list.length > count) list.pop()?.remove();
    while (list.length < count) {
      const index = list.length;
      const grip = this.grips.createDiv({
        cls: `goodobsidian-table-grip is-${kind}`,
        attr: { "aria-label": kind === "col" ? "Resize column" : "Resize row" },
      });
      grip.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        // The textarea keeps the focus, and the keyboard stays up.
        event.preventDefault();
        this.callbacks.onGrip(kind, index, event);
      });
      list.push(grip);
    }
  }

  /** The grip a drag of column or row `index`'s edge started on. */
  gripAt(kind: "col" | "row", index: number): HTMLElement | undefined {
    return (kind === "col" ? this.colGrips : this.rowGrips)[index];
  }

  /**
   * Show the guide along the border being dragged, at `offset` from the
   * table's left (a column) or top (a row) edge, in the layer's px; `null`
   * hides it.
   */
  showGuide(kind: "col" | "row" | null, offset = 0): void {
    this.guide.toggleClass("is-hidden", kind === null);
    this.guide.toggleClass("is-col", kind === "col");
    this.guide.toggleClass("is-row", kind === "row");
    if (kind === "col") this.guide.setCssStyles({ left: `${offset}px`, top: "" });
    else if (kind === "row") this.guide.setCssStyles({ top: `${offset}px`, left: "" });
  }

  /**
   * Show for a moment that what was asked does not fit (the page ends, the
   * table is as full as it may be): the cell's outline turns red. A timer
   * clears it, never an animation's finish.
   */
  refuse(): void {
    this.root.addClass("is-refused");
    window.clearTimeout(this.refuseTimer);
    this.refuseTimer = window.setTimeout(() => this.root.removeClass("is-refused"), REFUSED_MS);
  }

  /** Take the editor away; the caller has blurred it or is about to. */
  hide(): void {
    this.shown = false;
    this.root.addClass("is-hidden");
    this.bar.addClass("is-hidden");
    this.grips.addClass("is-hidden");
    this.showGuide(null);
  }

  remove(): void {
    this.root.remove();
    this.bar.remove();
    this.grips.remove();
  }
}

/**
 * Run `action` on a pointerup after a pointerdown on `button`, or on a
 * keyboard click (`detail === 0`): a Pencil tap over the page is never a click.
 */
function onPress(button: HTMLButtonElement, action: () => void): void {
  let armed: number | null = null;
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    armed = event.pointerId;
  });
  button.addEventListener("pointerup", (event) => {
    event.stopPropagation();
    if (armed !== event.pointerId) return;
    armed = null;
    if (button.disabled) return;
    // Android follows the lift with a click on whatever is under the finger then.
    swallowGhostClick(button.ownerDocument, event);
    action();
  });
  button.addEventListener("pointercancel", () => {
    armed = null;
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.detail === 0 && !button.disabled) action();
  });
}
