/**
 * "Customize toolbar", from the tool bar's accessories menu: which tools the
 * bar shows, left to right, and which wait in the menu. Goodnotes' own sheet
 * (Joost's recording, 2026-10-25) in one list instead of its two tabs:
 *
 *   Customize toolbar                              ✕
 *   ON THE TOOLBAR
 *   (−)  ⌇  Lasso                                   ⋮⋮
 *        ✎  Pen                                     ⋮⋮   (the pen never hides)
 *   (−)  ⌫  Eraser                                  ⋮⋮
 *   …
 *   HIDDEN
 *   (+)  ▭  Sticky notes
 *   …
 *   Reset toolbar
 *
 * A row's grip drags it to another place on the bar (top is leftmost); (−)
 * moves it to Hidden and (+) back onto the bar's right end. Every change is
 * live: it goes to `onChange` at once, and the bar behind the dialog follows.
 */

import { type App, Modal, setIcon } from "obsidian";
import {
  ALWAYS_SHOWN,
  BAR_ITEM_ICONS,
  BAR_ITEM_LABELS,
  type BarItemId,
  DEFAULT_BAR,
  dropIndex,
  hiddenItems,
  hideItem,
  moveItem,
  sameBar,
  showItem,
} from "./toolbar-layout";

export class CustomizeToolbarModal extends Modal {
  private shown: BarItemId[];
  private listEl: HTMLElement | null = null;

  constructor(
    app: App,
    shown: readonly BarItemId[],
    /** The items this bar can show at all; the rest are not offered. */
    private readonly available: readonly BarItemId[],
    private readonly onChange: (shown: BarItemId[]) => void,
  ) {
    super(app);
    this.shown = shown.filter((id) => available.includes(id));
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-customize-modal");
    this.titleEl.setText("Customize toolbar");
    this.listEl = this.contentEl.createDiv({ cls: "goodobsidian-customize-body" });
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.listEl = null;
  }

  private set(shown: BarItemId[]): void {
    if (sameBar(shown, this.shown)) return;
    this.shown = shown;
    this.onChange([...shown]);
    this.render();
  }

  private render(): void {
    const body = this.listEl;
    if (!body) return;
    body.empty();
    body.createDiv({ cls: "goodobsidian-customize-label", text: "On the toolbar" });
    const bar = body.createDiv({ cls: "goodobsidian-customize-list is-shown" });
    bar.setAttribute("role", "list");
    this.shown.forEach((id, index) => this.shownRow(bar, id, index));

    const hidden = hiddenItems(this.shown).filter((id) => this.available.includes(id));
    if (hidden.length > 0) {
      body.createDiv({ cls: "goodobsidian-customize-label", text: "Hidden" });
      const rest = body.createDiv({ cls: "goodobsidian-customize-list" });
      rest.setAttribute("role", "list");
      for (const id of hidden) this.hiddenRow(rest, id);
    }

    const reset = body.createEl("button", {
      cls: "goodobsidian-customize-reset mod-warning",
      text: "Reset toolbar",
    });
    reset.disabled = sameBar(this.defaultBar(), this.shown);
    reset.addEventListener("click", () => this.set(this.defaultBar()));
  }

  private defaultBar(): BarItemId[] {
    return DEFAULT_BAR.filter((id) => this.available.includes(id));
  }

  /** A row's leading round button and its icon and name. */
  private rowStart(row: HTMLElement, id: BarItemId): void {
    const icon = row.createSpan({ cls: "goodobsidian-customize-icon" });
    setIcon(icon, BAR_ITEM_ICONS[id]);
    row.createSpan({ cls: "goodobsidian-customize-name", text: BAR_ITEM_LABELS[id] });
  }

  private shownRow(list: HTMLElement, id: BarItemId, index: number): void {
    const row = list.createDiv({ cls: "goodobsidian-customize-row" });
    row.setAttribute("role", "listitem");
    if (id === ALWAYS_SHOWN) {
      // Keeps the column: the pen has no way off the bar.
      row.createSpan({ cls: "goodobsidian-customize-toggle is-blank" });
    } else {
      const hide = row.createEl("button", {
        cls: "goodobsidian-customize-toggle clickable-icon is-remove",
        attr: { "aria-label": `Hide ${BAR_ITEM_LABELS[id]}` },
      });
      setIcon(hide, "circle-minus");
      hide.addEventListener("click", () => this.set(hideItem(this.shown, id)));
    }
    this.rowStart(row, id);
    const grip = row.createSpan({ cls: "goodobsidian-customize-grip" });
    setIcon(grip, "grip-vertical");
    grip.setAttribute("aria-label", `Move ${BAR_ITEM_LABELS[id]}`);
    grip.addEventListener("pointerdown", (event) => this.startDrag(event, list, row, index));
  }

  private hiddenRow(list: HTMLElement, id: BarItemId): void {
    const row = list.createDiv({ cls: "goodobsidian-customize-row" });
    row.setAttribute("role", "listitem");
    const show = row.createEl("button", {
      cls: "goodobsidian-customize-toggle clickable-icon is-add",
      attr: { "aria-label": `Show ${BAR_ITEM_LABELS[id]} on the toolbar` },
    });
    setIcon(show, "circle-plus");
    show.addEventListener("click", () => this.set(showItem(this.shown, id)));
    this.rowStart(row, id);
  }

  /**
   * Drag a shown row by its grip: it follows the pointer, the others make
   * room as its middle passes theirs, and the new order is kept on release.
   * Pen, mouse and finger alike; the grip takes no scroll (`touch-action`).
   */
  private startDrag(event: PointerEvent, list: HTMLElement, row: HTMLElement, from: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic or already-ended pointer: the drag still follows its events.
    }
    const rows = Array.from(list.children) as HTMLElement[];
    const height = row.offsetHeight;
    const top = list.getBoundingClientRect().top;
    const grabbed = event.clientY - row.getBoundingClientRect().top;
    let to = from;
    row.addClass("is-dragging");
    const place = (clientY: number): void => {
      const middle = clientY - grabbed + height / 2 - top;
      to = dropIndex(middle, height, rows.length);
      row.setCssStyles({ transform: `translateY(${clientY - event.clientY}px)` });
      rows.forEach((other, i) => {
        if (other === row) return;
        const shift =
          from < to && i > from && i <= to ? -1 : from > to && i >= to && i < from ? 1 : 0;
        other.setCssStyles({ transform: shift === 0 ? "" : `translateY(${shift * height}px)` });
      });
    };
    const move = (e: PointerEvent): void => {
      if (e.pointerId === event.pointerId) place(e.clientY);
    };
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== event.pointerId) return;
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      for (const other of rows) other.setCssStyles({ transform: "" });
      row.removeClass("is-dragging");
      if (e.type === "pointerup" && to !== from) this.set(moveItem(this.shown, from, to));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }
}
