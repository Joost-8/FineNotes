/**
 * "Customize toolbar", the last entry of the tool bar's More tools menu:
 * which tools the bar shows, left to right, which wait in the More tools
 * menu, and which are hidden altogether (`toolbar-layout.ts`). Goodnotes'
 * own sheet (Joost's recording, 2026-10-25) in one list instead of its two
 * tabs, with a third place:
 *
 *   Customize toolbar                              ✕
 *   ON THE TOOLBAR
 *   (−)  ⌇  Lasso                                   ⋮⋮
 *        ✎  Pen                                     ⋮⋮   (the pen never leaves)
 *   …
 *   IN MORE TOOLS
 *   (+)  ✋  Hand                               (eye-off)
 *   …
 *   HIDDEN
 *   (+)  🎤  Record audio
 *   Reset toolbar
 *
 * A row's grip drags it to another place on the bar (top is leftmost). (−)
 * moves a bar item into More tools, (+) moves an item one place up (from
 * More tools onto the bar's right end, from Hidden into More tools), and
 * the crossed eye hides an item of More tools. Every change is live: it
 * goes to `onChange` at once, and every open notebook's bar follows.
 */

import { type App, Modal, setIcon } from "obsidian";
import {
  ALWAYS_SHOWN,
  BAR_ITEMS,
  BAR_ITEM_ICONS,
  BAR_ITEM_LABELS,
  type BarItemId,
  type ItemPlace,
  type ToolbarLayout,
  defaultLayout,
  dropIndex,
  menuItems,
  moveItem,
  placeItem,
  sameLayout,
} from "./toolbar-layout";

export class CustomizeToolbarModal extends Modal {
  private layout: ToolbarLayout;
  private listEl: HTMLElement | null = null;

  constructor(
    app: App,
    layout: ToolbarLayout,
    private readonly onChange: (layout: ToolbarLayout) => void,
  ) {
    super(app);
    this.layout = { bar: [...layout.bar], off: [...layout.off] };
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

  private set(layout: ToolbarLayout): void {
    if (sameLayout(layout, this.layout)) return;
    this.layout = layout;
    this.onChange({ bar: [...layout.bar], off: [...layout.off] });
    this.render();
  }

  private place(id: BarItemId, place: ItemPlace): void {
    this.set(placeItem(this.layout, id, place));
  }

  private render(): void {
    const body = this.listEl;
    if (!body) return;
    body.empty();
    body.createDiv({ cls: "goodobsidian-customize-label", text: "On the toolbar" });
    const bar = body.createDiv({ cls: "goodobsidian-customize-list is-shown" });
    bar.setAttribute("role", "list");
    this.layout.bar.forEach((id, index) => this.barRow(bar, id, index));

    const menu = menuItems(this.layout);
    if (menu.length > 0) {
      body.createDiv({ cls: "goodobsidian-customize-label", text: "In More tools" });
      const list = this.list(body);
      for (const id of menu) this.menuRow(list, id);
    }

    const hidden = BAR_ITEMS.filter((id) => this.layout.off.includes(id));
    if (hidden.length > 0) {
      body.createDiv({ cls: "goodobsidian-customize-label", text: "Hidden" });
      const list = this.list(body);
      for (const id of hidden) this.hiddenRow(list, id);
    }

    const reset = body.createEl("button", {
      cls: "goodobsidian-customize-reset mod-warning",
      text: "Reset toolbar",
    });
    reset.disabled = sameLayout(defaultLayout(), this.layout);
    reset.addEventListener("click", () => this.set(defaultLayout()));
  }

  private list(body: HTMLElement): HTMLElement {
    const list = body.createDiv({ cls: "goodobsidian-customize-list" });
    list.setAttribute("role", "list");
    return list;
  }

  private row(list: HTMLElement): HTMLElement {
    const row = list.createDiv({ cls: "goodobsidian-customize-row" });
    row.setAttribute("role", "listitem");
    return row;
  }

  /** A round button that moves `id` to `place`: (+) toward the bar, (−) or the eye away. */
  private mover(
    row: HTMLElement,
    id: BarItemId,
    place: ItemPlace,
    icon: string,
    kind: string,
    label: string,
  ): void {
    const button = row.createEl("button", {
      cls: `goodobsidian-customize-toggle clickable-icon ${kind}`,
      attr: { "aria-label": label },
    });
    setIcon(button, icon);
    button.addEventListener("click", () => this.place(id, place));
  }

  /** A row's icon and name. */
  private rowStart(row: HTMLElement, id: BarItemId): void {
    const icon = row.createSpan({ cls: "goodobsidian-customize-icon" });
    setIcon(icon, BAR_ITEM_ICONS[id]);
    row.createSpan({ cls: "goodobsidian-customize-name", text: BAR_ITEM_LABELS[id] });
  }

  private barRow(list: HTMLElement, id: BarItemId, index: number): void {
    const row = this.row(list);
    const name = BAR_ITEM_LABELS[id];
    if (id === ALWAYS_SHOWN) {
      // Keeps the column: the pen has no way off the bar.
      row.createSpan({ cls: "goodobsidian-customize-toggle is-blank" });
    } else {
      this.mover(row, id, "menu", "circle-minus", "is-remove", `Move ${name} to More tools`);
    }
    this.rowStart(row, id);
    const grip = row.createSpan({ cls: "goodobsidian-customize-grip" });
    setIcon(grip, "grip-vertical");
    grip.setAttribute("aria-label", `Move ${name}`);
    grip.addEventListener("pointerdown", (event) => this.startDrag(event, list, row, index));
  }

  private menuRow(list: HTMLElement, id: BarItemId): void {
    const row = this.row(list);
    const name = BAR_ITEM_LABELS[id];
    this.mover(row, id, "bar", "circle-plus", "is-add", `Put ${name} on the toolbar`);
    this.rowStart(row, id);
    this.mover(row, id, "off", "eye-off", "is-off", `Hide ${name}`);
  }

  private hiddenRow(list: HTMLElement, id: BarItemId): void {
    const row = this.row(list);
    this.mover(
      row,
      id,
      "menu",
      "circle-plus",
      "is-add",
      `Add ${BAR_ITEM_LABELS[id]} to More tools`,
    );
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
      if (e.type === "pointerup" && to !== from)
        this.set({ ...this.layout, bar: moveItem(this.layout.bar, from, to) });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }
}
