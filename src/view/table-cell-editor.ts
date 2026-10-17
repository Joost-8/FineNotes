/**
 * Typing in a table cell (DOM). One `<textarea>` lies over the cell being
 * edited, styled as a page text box's is — the same font stack, the size the
 * page scale gives with the iPad's 16 px floor undone by a transform, and the
 * padding in page units — so it wraps at the words the canvas wraps the cell
 * at (`canvas/table-layout`). While it is up, the canvas leaves that cell's
 * text out, so nothing shows twice.
 *
 * Above the table floats its bar: add a row or a column, delete the cell's
 * row or column, and the header row. On the cell's right and bottom edges
 * sit grips that resize its column and its row.
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

/** What the bar's buttons do. */
export type TableAction =
  "row-above" | "row-below" | "col-left" | "col-right" | "delete-row" | "delete-col" | "header";

export interface CellEditorCallbacks {
  /** The text was typed or pasted into. */
  onInput: (text: string) => void;
  /** The textarea took the focus. */
  onFocus: () => void;
  /** The textarea lost it, to `next` (`null`: to nothing). */
  onBlur: (next: EventTarget | null) => void;
  /** Tab (`1`) or Shift+Tab (`-1`): go to the next or previous cell. */
  onStep: (step: 1 | -1) => void;
  /** Escape: stop typing. */
  onEscape: () => void;
  onAction: (action: TableAction) => void;
  /** A grip was pressed: drag the column's right edge or the row's bottom edge. */
  onGrip: (kind: "col" | "row", event: PointerEvent) => void;
}

/** Where the cell is on screen and how its text looks there. */
export interface CellPlacement {
  /** The cell's frame, in the text layer's px. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The table's frame's left and top edges, in the same px, for the bar. */
  tableLeft: number;
  tableTop: number;
  /** CSS px per page px. */
  scale: number;
  /** The cell's style; `color` already as the page shows it. */
  style: TextStyle;
  /** Whether the table has a header row (the bar's toggle shows it). */
  header: boolean;
}

/** iPadOS zooms into a text field whose computed font is under this (ink-surface's rule). */
const IOS_MIN_INPUT_FONT_PX = 16;
/** The bar's gap above the table, CSS px. */
const BAR_GAP_PX = 8;
/** The bar's height, CSS px, as styles.css sets it: it goes below the table if there is no room. */
const BAR_HEIGHT_PX = 36;

const ACTIONS: ReadonlyArray<{ action: TableAction; icon: string; label: string; text: string }> = [
  { action: "row-above", icon: "arrow-up-to-line", label: "Add row above", text: "Row above" },
  { action: "row-below", icon: "arrow-down-to-line", label: "Add row below", text: "Row below" },
  { action: "col-left", icon: "arrow-left-to-line", label: "Add column left", text: "Column left" },
  {
    action: "col-right",
    icon: "arrow-right-to-line",
    label: "Add column right",
    text: "Column right",
  },
  { action: "delete-row", icon: "trash-2", label: "Delete row", text: "Row" },
  { action: "delete-col", icon: "trash-2", label: "Delete column", text: "Column" },
  { action: "header", icon: "heading", label: "Header row", text: "Header" },
];

export class TableCellEditor {
  /** The cell's frame: the textarea and the two grips. */
  readonly root: HTMLElement;
  readonly input: HTMLTextAreaElement;
  readonly bar: HTMLElement;
  private readonly headerButton: HTMLButtonElement;
  private shown = false;

  constructor(layer: HTMLElement, callbacks: CellEditorCallbacks) {
    this.root = layer.createDiv({ cls: "goodobsidian-table-cell is-hidden" });
    this.input = this.root.createEl("textarea", {
      cls: "goodobsidian-table-cell-input",
      attr: { "aria-label": "Table cell", rows: "1" },
    });
    for (const kind of ["col", "row"] as const) {
      const grip = this.root.createDiv({
        cls: `goodobsidian-table-grip is-${kind}`,
        attr: { "aria-label": kind === "col" ? "Resize column" : "Resize row" },
      });
      grip.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        // The textarea keeps the focus, and the keyboard stays up.
        event.preventDefault();
        callbacks.onGrip(kind, event);
      });
    }
    // Dark in every theme, as the lasso's action bar is (Obsidian's own palette class).
    this.bar = layer.createDiv({ cls: "goodobsidian-table-bar theme-dark is-hidden" });
    // No press on the bar starts ink or takes the focus from the cell.
    for (const type of ["pointerdown", "mousedown"]) {
      this.bar.addEventListener(type, (event) => {
        event.stopPropagation();
        event.preventDefault();
      });
    }
    let header: HTMLButtonElement | null = null;
    for (const entry of ACTIONS) {
      if (entry.action === "delete-row") this.bar.createDiv({ cls: "goodobsidian-table-bar-gap" });
      const button = this.bar.createEl("button", {
        cls: "goodobsidian-table-bar-button clickable-icon",
        attr: { "aria-label": entry.label, title: entry.label },
      });
      const icon = button.createSpan({ cls: "goodobsidian-table-bar-icon" });
      setIcon(icon, entry.icon);
      button.createSpan({ cls: "goodobsidian-table-bar-text", text: entry.text });
      onPress(button, () => callbacks.onAction(entry.action));
      if (entry.action === "header") header = button;
    }
    this.headerButton = header ?? this.bar.createEl("button");

    // Text editing never starts ink on the page beneath.
    this.input.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.input.addEventListener("input", () => callbacks.onInput(this.input.value));
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
    this.headerButton.toggleClass("is-active", at.header);
    this.headerButton.setAttribute("aria-pressed", String(at.header));
  }

  /** Take the editor away; the caller has blurred it or is about to. */
  hide(): void {
    this.shown = false;
    this.root.addClass("is-hidden");
    this.bar.addClass("is-hidden");
  }

  remove(): void {
    this.root.remove();
    this.bar.remove();
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
    if (!button.disabled) action();
  });
  button.addEventListener("pointercancel", () => {
    armed = null;
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.detail === 0 && !button.disabled) action();
  });
}
