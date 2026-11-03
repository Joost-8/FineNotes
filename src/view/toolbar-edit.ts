/**
 * Customize toolbar (discussion #43): the bar's own edit mode, opened from
 * the More tools menu or the command palette.
 *
 *   ┌ START ───────────┐   ┌ MIDDLE ──────────────────┐   ┌ END ─────────┐
 *   │ ▢ 🔍 ✦ ▦ ↶ ↷     │   │ ⌇ ✎📌 ⌫ T ◇ ▣ ▤ 🧰📌       │   │ ⤢ + ⇪ ⋯📌 ⚙ │
 *   └──────────────────┘   └──────────────────────────┘   └──────────────┘
 *   [▔][▁][▏][▕]  ◉ Dock tool options                         Reset   [✓]
 *   MORE TOOLS  ✋ 🔍 ✍ ☺ 🗒 📏 🩹 🎤 🪣
 *   HIDDEN      (empty)
 *
 * Every button of the real bar can be picked up (finger, Pencil or mouse,
 * no hold) and dropped at any place in any zone, or on a shelf of the tray:
 * More tools or Hidden. A tap opens the same moves as a menu; with the
 * keyboard, arrows move the focused button one place and Enter opens the
 * menu. The pen, the toolbox and ⋯ stay on the bar (`PINNED`). The tray
 * also holds the bar's edge and "Dock tool options". The page dims and
 * takes no ink; a tap on it, ✓ or Escape closes the mode. Every change is
 * live, and kept at once (`apply`).
 *
 * The model is `toolbar-layout.ts` (pure); this file is the DOM around it.
 */

import { setIcon } from "obsidian";
import { type BarDock, isBarUpright } from "./bar-dock-model";
import {
  BAR_ITEM_ICONS,
  BAR_ITEM_LABELS,
  type BarItemId,
  type Target,
  type ToolbarLayout,
  ZONES,
  ZONE_LABELS,
  type Zone,
  defaultLayout,
  isPinned,
  menuItems,
  moveTo,
  offItems,
  placeOf,
  sameLayout,
  slotAt,
  stepItem,
} from "./toolbar-layout";

/** What the editor needs of the tool bar. */
export interface ToolbarEditorHost {
  /** The bar element. */
  bar: HTMLElement;
  /** The notebook view the bar sits in: the tray, the scrim and the menu go here. */
  host: HTMLElement;
  /** The bar's three zone elements. */
  zones: () => Partial<Record<Zone, HTMLElement>>;
  /** The bar's button for an item, if this bar has it. */
  button: (id: BarItemId) => HTMLButtonElement | undefined;
  /** Whether this bar has a button for an item (no handler here, no button). */
  has: (id: BarItemId) => boolean;
  layout: () => ToolbarLayout;
  /** Show `layout` and keep it. */
  apply: (layout: ToolbarLayout) => void;
  /** Mark what would fold into ⋯ at this width, every button shown. */
  foldsNow: () => void;
  barDock: () => BarDock;
  pillRow: () => boolean;
  setBarDock?: (dock: BarDock) => void;
  setPillRow?: (on: boolean) => void;
  /** The mode closed. */
  done: () => void;
}

/** The bar's edges, each its Lucide panel icon, as the ⋯ sheet offered them. */
const BAR_DOCKS: ReadonlyArray<{ dock: BarDock; label: string }> = [
  { dock: "top", label: "Toolbar at the top" },
  { dock: "bottom", label: "Toolbar at the bottom" },
  { dock: "left", label: "Toolbar on the left" },
  { dock: "right", label: "Toolbar on the right" },
];

/** How far a press travels before it is a drag, CSS px. */
const DRAG_SLOP = 6;
/** How far beside the bar a drop still counts as on it, CSS px. */
const BAR_REACH = 28;

interface Press {
  id: BarItemId;
  el: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  dragging: boolean;
}

export class ToolbarEditor {
  private readonly doc: Document;
  private readonly tray: HTMLElement;
  private readonly scrim: HTMLElement;
  private menuShelf: HTMLElement | null = null;
  private offShelf: HTMLElement | null = null;
  private menu: HTMLElement | null = null;
  private press: Press | null = null;
  private ghost: HTMLElement | null = null;
  private gap: HTMLElement | null = null;
  private target: Target | null = null;
  /** Buttons disabled when the mode opened (undo with nothing to undo): pickable meanwhile. */
  private readonly wasDisabled: HTMLButtonElement[] = [];
  private readonly cleanups: Array<() => void> = [];
  private finished = false;

  constructor(private readonly h: ToolbarEditorHost) {
    this.doc = h.bar.ownerDocument;
    h.bar.addClass("is-editing");
    h.host.addClass("goodobsidian-customizing");
    for (const button of Array.from(h.bar.querySelectorAll<HTMLButtonElement>("button"))) {
      if (!button.disabled || !button.hasAttribute("data-item")) continue;
      button.disabled = false;
      this.wasDisabled.push(button);
    }
    this.scrim = h.host.createDiv({ cls: "goodobsidian-edit-scrim" });
    this.tray = h.host.createDiv({ cls: "goodobsidian-edit-tray" });
    this.tray.setAttribute("role", "toolbar");
    this.tray.setAttribute("aria-label", "Customize toolbar");

    const swallow = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    this.listen(this.scrim, "pointerdown", swallow);
    this.listen(this.scrim, "click", (event) => {
      swallow(event);
      this.finish();
    });
    // The bar's buttons do nothing while it is edited: a press picks one up.
    for (const el of [h.bar, this.tray]) {
      this.listen(el, "pointerdown", (event) => this.onDown(event as PointerEvent), true);
      this.listen(
        el,
        "click",
        (event) => {
          if (el === h.bar || (event.target as Element).closest("[data-item]")) swallow(event);
        },
        true,
      );
      this.listen(el, "keydown", (event) => this.onKey(event as KeyboardEvent), true);
    }
    this.listen(this.doc, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") {
        swallow(event);
        if (this.menu) this.closeMenu();
        else this.finish();
      }
    });
    const win = this.doc.defaultView;
    if (win) this.listen(win, "resize", () => this.place());
    this.refresh();
    this.h.button("pen")?.focus({ preventScroll: true });
  }

  /** The layout or the bar's edge changed: draw the zones' names, the tray and the marks again. */
  refresh(): void {
    if (this.finished) return;
    const upright = isBarUpright(this.h.barDock());
    for (const zone of ZONES) {
      const el = this.h.zones()[zone];
      if (!el) continue;
      el.addClass("is-zone");
      el.setAttribute("data-zone-label", ZONE_LABELS[zone][upright ? "upright" : "across"]);
    }
    for (const id of this.barIds()) {
      const button = this.h.button(id);
      if (!button) continue;
      button.toggleClass("is-pinned", isPinned(id));
      // Its own name ("Lasso select (V)") comes back when the mode closes.
      if (!button.hasAttribute("data-label")) {
        button.setAttribute("data-label", button.getAttribute("aria-label") ?? "");
      }
      button.setAttribute("aria-label", this.ariaLabel(id));
    }
    this.h.foldsNow();
    this.buildTray();
    this.place();
  }

  /** Close the mode: everything it added goes, the bar's buttons work again. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.endPress();
    this.closeMenu();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const button of this.wasDisabled) button.disabled = true;
    this.h.bar.removeClass("is-editing");
    this.h.host.removeClass("goodobsidian-customizing");
    for (const zone of ZONES) {
      const el = this.h.zones()[zone];
      el?.removeClass("is-zone");
      el?.removeAttribute("data-zone-label");
    }
    // Every button, not only those on the bar now: one moved off it meanwhile
    // keeps its own name for when it comes back.
    for (const id of Object.keys(BAR_ITEM_LABELS) as BarItemId[]) {
      const button = this.h.button(id);
      if (!button) continue;
      button.removeClass("is-pinned", "will-fold");
      const own = button.getAttribute("data-label");
      if (own !== null) button.setAttribute("aria-label", own || BAR_ITEM_LABELS[id]);
      button.removeAttribute("data-label");
    }
    this.scrim.remove();
    this.tray.remove();
    this.h.done();
  }

  // --- the tray -------------------------------------------------------------

  private buildTray(): void {
    const tray = this.tray;
    tray.empty();
    const head = tray.createDiv({ cls: "goodobsidian-edit-head" });
    const dock = this.h.barDock();
    const setDock = this.h.setBarDock;
    if (setDock) {
      const places = head.createDiv({ cls: "goodobsidian-edit-docks" });
      places.setAttribute("role", "radiogroup");
      places.setAttribute("aria-label", "Toolbar");
      for (const { dock: d, label } of BAR_DOCKS) {
        const button = places.createEl("button", { cls: "goodobsidian-edit-dock clickable-icon" });
        setIcon(button, `panel-${d}`);
        button.toggleClass("is-active", d === dock);
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(d === dock));
        button.setAttribute("aria-label", label);
        button.addEventListener("click", () => setDock(d));
      }
    }
    const setRow = this.h.setPillRow;
    if (setRow && (dock === "top" || dock === "bottom")) {
      const on = this.h.pillRow();
      const row = head.createEl("button", { cls: "goodobsidian-edit-switch clickable-icon" });
      row.createSpan({ cls: "goodobsidian-edit-toggle" }).toggleClass("is-on", on);
      row.createSpan({ text: "Dock tool options" });
      row.setAttribute("role", "switch");
      row.setAttribute("aria-checked", String(on));
      row.addEventListener("click", () => setRow(!on));
    }
    head.createDiv({ cls: "goodobsidian-edit-spacer" });
    const reset = head.createEl("button", {
      cls: "goodobsidian-edit-reset clickable-icon",
      text: "Reset",
    });
    reset.disabled = sameLayout(this.h.layout(), defaultLayout());
    reset.addEventListener("click", () => this.h.apply(defaultLayout()));
    const done = head.createEl("button", { cls: "goodobsidian-edit-done clickable-icon" });
    setIcon(done, "check");
    done.setAttribute("aria-label", "Done");
    done.addEventListener("click", () => this.finish());

    const layout = this.h.layout();
    this.menuShelf = this.shelf(
      "More tools",
      "menu",
      menuItems(layout).filter((id) => this.h.has(id)),
    );
    this.offShelf = this.shelf(
      "Hidden",
      "off",
      offItems(layout).filter((id) => this.h.has(id)),
    );
  }

  private shelf(name: string, place: "menu" | "off", ids: BarItemId[]): HTMLElement {
    const shelf = this.tray.createDiv({ cls: `goodobsidian-edit-shelf is-${place}` });
    shelf.createSpan({ cls: "goodobsidian-edit-shelf-name", text: name });
    const chips = shelf.createDiv({ cls: "goodobsidian-edit-chips" });
    for (const id of ids) {
      const chip = chips.createEl("button", { cls: "goodobsidian-edit-chip clickable-icon" });
      setIcon(chip, BAR_ITEM_ICONS[id]);
      chip.setAttribute("data-item", id);
      chip.setAttribute("aria-label", this.ariaLabel(id));
    }
    // An empty shelf shows what it is for by its mark alone.
    if (ids.length === 0) setIcon(chips.createSpan({ cls: "goodobsidian-edit-empty" }), "inbox");
    return shelf;
  }

  /** Under a bar along the top, over one along the bottom, beside an upright one. */
  private place(): void {
    const host = this.h.host.getBoundingClientRect();
    const bar = this.h.bar.getBoundingClientRect();
    const dock = this.h.barDock();
    const style: Record<string, string> = { top: "", bottom: "", left: "", right: "" };
    const margin = 8;
    if (dock === "top") style.top = `${Math.round(bar.bottom - host.top + margin)}px`;
    else if (dock === "bottom") style.bottom = `${Math.round(host.bottom - bar.top + margin)}px`;
    else style.top = `${margin}px`;
    if (dock === "left") style.left = `${Math.round(bar.right - host.left + margin)}px`;
    else if (dock === "right") style.right = `${Math.round(host.right - bar.left + margin)}px`;
    this.tray.setCssStyles(style);
    this.tray.toggleClass("is-beside", isBarUpright(dock));
  }

  // --- pressing, dragging and dropping -------------------------------------

  private onDown(event: PointerEvent): void {
    const el = (event.target as Element | null)?.closest<HTMLElement>("[data-item]");
    if (!el || event.button > 0) return;
    if (!this.h.bar.contains(el) && !this.tray.contains(el)) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
    this.endPress();
    this.press = {
      id: el.getAttribute("data-item") as BarItemId,
      el,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
    };
    const move = (e: Event): void => this.onMove(e as PointerEvent);
    const up = (e: Event): void => this.onUp(e as PointerEvent);
    this.doc.addEventListener("pointermove", move, true);
    this.doc.addEventListener("pointerup", up, true);
    this.doc.addEventListener("pointercancel", up, true);
    this.pressCleanup = () => {
      this.doc.removeEventListener("pointermove", move, true);
      this.doc.removeEventListener("pointerup", up, true);
      this.doc.removeEventListener("pointercancel", up, true);
    };
  }

  private pressCleanup: (() => void) | null = null;

  private onMove(event: PointerEvent): void {
    const press = this.press;
    if (!press || event.pointerId !== press.pointerId) return;
    event.preventDefault();
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_SLOP) return;
      press.dragging = true;
      // Its own element, not a clone: a copied <button> would take Obsidian's
      // button padding (20 px a side on an iPad) and squeeze its icon away.
      const ghost = this.doc.body.createDiv({ cls: "goodobsidian-edit-ghost" });
      setIcon(ghost, BAR_ITEM_ICONS[press.id]);
      this.ghost = ghost;
      press.el.addClass("is-drag-source");
      this.h.bar.addClass("is-dragging");
    }
    this.ghost?.setCssStyles({
      left: `${Math.round(event.clientX)}px`,
      top: `${Math.round(event.clientY)}px`,
    });
    this.setTarget(this.hitTest(press.id, event.clientX, event.clientY));
  }

  private onUp(event: PointerEvent): void {
    const press = this.press;
    if (!press || event.pointerId !== press.pointerId) return;
    event.preventDefault();
    const target = event.type === "pointerup" ? this.target : null;
    const { id, dragging, el } = press;
    this.endPress();
    if (!dragging) {
      if (event.type === "pointerup") this.openMenu(id, el);
      return;
    }
    if (target) this.move(id, target);
  }

  private endPress(): void {
    this.pressCleanup?.();
    this.pressCleanup = null;
    this.press?.el.removeClass("is-drag-source");
    this.press = null;
    this.ghost?.remove();
    this.ghost = null;
    this.setTarget(null);
    this.h.bar.removeClass("is-dragging");
  }

  /** Where a drop at (`x`, `y`) would put `id`: a place on the bar, a shelf, or nowhere. */
  private hitTest(id: BarItemId, x: number, y: number): Target | null {
    for (const [shelf, place] of [
      [this.menuShelf, "menu"],
      [this.offShelf, "off"],
    ] as const) {
      if (!shelf || !inside(shelf.getBoundingClientRect(), x, y, 4)) continue;
      return isPinned(id) ? null : place;
    }
    const bar = this.h.bar.getBoundingClientRect();
    const upright = isBarUpright(this.h.barDock());
    if (!inside(bar, x, y, BAR_REACH)) return null;
    const along = upright ? y : x;
    let best: { zone: Zone; distance: number } | null = null;
    for (const zone of ZONES) {
      const el = this.h.zones()[zone];
      if (!el) continue;
      const box = el.getBoundingClientRect();
      const start = upright ? box.top : box.left;
      const end = upright ? box.bottom : box.right;
      const distance = along < start ? start - along : along > end ? along - end : 0;
      if (!best || distance < best.distance) best = { zone, distance };
    }
    if (!best) return null;
    const shown = this.shownIn(best.zone, id);
    const centres = shown.map(({ el }) => {
      const box = el.getBoundingClientRect();
      return upright ? box.top + box.height / 2 : box.left + box.width / 2;
    });
    const slot = slotAt(centres, along);
    // A slot among the buttons shown is a place in the zone's list, which
    // also holds buttons this bar does not show (none for them here).
    const list = this.h.layout()[best.zone].filter((item) => item !== id);
    const index = slot < shown.length ? list.indexOf(shown[slot].id) : list.length;
    return { zone: best.zone, index: Math.max(0, index) };
  }

  /** The buttons shown in `zone`, in order, without `except`. */
  private shownIn(zone: Zone, except: BarItemId): Array<{ id: BarItemId; el: HTMLElement }> {
    const out: Array<{ id: BarItemId; el: HTMLElement }> = [];
    for (const id of this.h.layout()[zone]) {
      if (id === except) continue;
      const el = this.h.button(id);
      if (el && el.offsetWidth > 0) out.push({ id, el });
    }
    return out;
  }

  /** Show where a drop would land: a gap opening on the bar, or a lit shelf. */
  private setTarget(target: Target | null): void {
    this.target = target;
    this.menuShelf?.toggleClass("is-target", target === "menu");
    this.offShelf?.toggleClass("is-target", target === "off");
    this.gap?.remove();
    this.gap = null;
    if (!target || typeof target === "string" || !this.press) return;
    const zone = this.h.zones()[target.zone];
    if (!zone) return;
    const gap = zone.createDiv({ cls: "goodobsidian-edit-gap" });
    const list = this.h.layout()[target.zone].filter((item) => item !== this.press?.id);
    const before = list
      .slice(target.index)
      .map((id) => this.h.button(id))
      .find((el) => el !== undefined && el.offsetWidth > 0);
    if (before) zone.insertBefore(gap, before);
    this.gap = gap;
  }

  // --- the tap menu and the keyboard ----------------------------------------

  /** A tap: the moves `id` can make, as a menu by it. */
  private openMenu(id: BarItemId, anchor: HTMLElement): void {
    this.closeMenu();
    const layout = this.h.layout();
    const place = placeOf(layout, id);
    const upright = isBarUpright(this.h.barDock());
    const menu = this.h.host.createDiv({ cls: "goodobsidian-edit-menu" });
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", BAR_ITEM_LABELS[id]);
    const row = (icon: string, label: string, next: ToolbarLayout): void => {
      if (sameLayout(next, layout)) return;
      const button = menu.createEl("button", { cls: "goodobsidian-edit-menu-row clickable-icon" });
      setIcon(button.createSpan({ cls: "goodobsidian-edit-menu-icon" }), icon);
      button.createSpan({ text: label });
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => {
        this.closeMenu();
        this.apply(id, next);
      });
    };
    if (place !== "menu" && place !== "off") {
      row(
        upright ? "arrow-up" : "arrow-left",
        upright ? "Move up" : "Move left",
        stepItem(layout, id, -1),
      );
      row(
        upright ? "arrow-down" : "arrow-right",
        upright ? "Move down" : "Move right",
        stepItem(layout, id, 1),
      );
    }
    for (const zone of ZONES) {
      if (zone === place) continue;
      const name = ZONE_LABELS[zone][upright ? "upright" : "across"].toLowerCase();
      row(
        zone === "middle"
          ? "panel-top"
          : zone === "start"
            ? "align-start-vertical"
            : "align-end-vertical",
        `To the ${name}`,
        moveTo(layout, id, { zone, index: layout[zone].length }),
      );
    }
    if (!isPinned(id)) {
      if (place !== "menu") row("toolbox", "To More tools", moveTo(layout, id, "menu"));
      if (place !== "off") row("eye-off", "Hide", moveTo(layout, id, "off"));
    }
    const host = this.h.host.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    menu.setCssStyles({
      left: `${Math.round(Math.max(8, Math.min(at.left - host.left, host.width - 220)))}px`,
      top: `${Math.round(at.bottom - host.top + 6)}px`,
    });
    // Above the button when there is no room under it.
    if (at.bottom + 6 + menu.offsetHeight > host.bottom - 8) {
      menu.setCssStyles({ top: `${Math.round(at.top - host.top - 6 - menu.offsetHeight)}px` });
    }
    this.menu = menu;
    menu.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  private onKey(event: KeyboardEvent): void {
    const el = (event.target as Element | null)?.closest<HTMLElement>("[data-item]");
    if (!el) return;
    const id = el.getAttribute("data-item") as BarItemId;
    const upright = isBarUpright(this.h.barDock());
    const back = upright ? "ArrowUp" : "ArrowLeft";
    const on = upright ? "ArrowDown" : "ArrowRight";
    if (event.key === back || event.key === on) {
      event.preventDefault();
      event.stopPropagation();
      this.apply(id, stepItem(this.h.layout(), id, event.key === back ? -1 : 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      this.openMenu(id, el);
    }
  }

  // --- changes ----------------------------------------------------------------

  private move(id: BarItemId, target: Target): void {
    this.apply(id, moveTo(this.h.layout(), id, target));
  }

  /** Show and keep `next`, the moved button keeping the focus where it went. */
  private apply(id: BarItemId, next: ToolbarLayout): void {
    if (sameLayout(next, this.h.layout())) return;
    this.h.apply(next);
    const moved =
      this.h.button(id)?.hasClass("is-unlisted") === false
        ? this.h.button(id)
        : this.tray.querySelector<HTMLElement>(`[data-item="${id}"]`);
    moved?.focus({ preventScroll: true });
  }

  private barIds(): BarItemId[] {
    const layout = this.h.layout();
    return [...layout.start, ...layout.middle, ...layout.end];
  }

  /** A button's name in edit mode: what pressing it does now. */
  private ariaLabel(id: BarItemId): string {
    const name = BAR_ITEM_LABELS[id];
    return isPinned(id) ? `${name}, stays on the toolbar` : `Move ${name}`;
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    capture = false,
  ): void {
    target.addEventListener(type, handler, capture);
    this.cleanups.push(() => target.removeEventListener(type, handler, capture));
  }
}

/** Whether (`x`, `y`) is in `box` grown by `pad` on every side. */
function inside(box: DOMRect, x: number, y: number, pad: number): boolean {
  return x >= box.left - pad && x <= box.right + pad && y >= box.top - pad && y <= box.bottom + pad;
}
