/**
 * Customize toolbar (discussion #43): the bar's own edit mode, opened from
 * the More tools menu or the command palette.
 *
 *   ┌ START ───────────┐   ┌ MIDDLE ──────────────────┐   ┌ END ─────────┐
 *   │ ▢ 🔍 ✦ ▦ ↶ ↷     │   │ ⌇ ✎📌 ⌫ T ◇ ▣ ▤ 🧰📌       │   │ ⤢ + ⇪ ⋯📌 ⚙ │
 *   └──────────────────┘   └──────────────────────────┘   └──────────────┘
 *   [▔][▁][▏][▕]  ◉ Dock tool options  [✎+]                   Reset   [✓]
 *   MORE TOOLS  ✋ 🔍 ✍ ☺ 🗒 📏 🩹 🎤 🪣
 *   HIDDEN      (empty)
 *   STYLE       ▭ ◯ ▬ ▭ ▭ ▣ ◘ ▤ ▫
 *   COLOURS     ◐ ◐ ◐ ◐ ◐ ◐ ◐ ◐ ◐ ◐
 *
 * Every button of the real bar can be picked up (finger, Pencil or mouse,
 * no hold) and dropped at any place in any zone, or on a shelf of the tray:
 * More tools or Hidden. A tap opens the same moves as a menu; with the
 * keyboard, arrows move the focused button one place and Enter opens the
 * menu. The pen, the toolbox and ⋯ stay on the bar (`PINNED`). The tray
 * also holds the bar's edge, "Dock tool options", New pen [✎+] (a pen as
 * a button of its own, FineNotes#211) and the look (Settings →
 * Look's style and colours, a tap each; Reset takes it back too). The page dims and
 * takes no ink; a tap on it, ✓ or Escape closes the mode. Every change is
 * live, and kept at once (`apply`).
 *
 * The model is `toolbar-layout.ts` (pure); this file is the DOM around it.
 */

import { setIcon } from "obsidian";
import { type TextKey, t } from "../i18n/translate";
import { type BarDock, isBarUpright } from "./bar-dock-model";
import {
  LOOK_PALETTES,
  LOOK_STYLES,
  type LookPalette,
  type LookStyle,
  PALETTE_VARIABLES,
  lookPaletteNames,
  lookStyleNames,
} from "../model/look";
import {
  BAR_ITEM_ICONS,
  BAR_ITEM_LABELS,
  type BarItemId,
  type BarPreset,
  type CoreItemId,
  type Target,
  type ToolbarLayout,
  ZONES,
  ZONE_LABELS,
  type Zone,
  defaultLayout,
  essentialsLayout,
  isFixedInPreset,
  isPenSlot,
  isPinnedIn,
  menuItems,
  moveTo,
  offItems,
  placeOf,
  sameLayout,
  slotAt,
  stepItem,
  swapItems,
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
  /** What an item is called: its own name, or a pen's (FineNotes#211). */
  label: (id: BarItemId) => string;
  /**
   * The tray's New pen (FineNotes#211): dragged onto the bar, the pen in
   * hand becomes a saved pen there, a button of its own. Without it, no New pen.
   */
  newPen?: {
    /** Whether the pen in hand can be added: saved pens not full, not on the bar yet. */
    can: () => boolean;
    /** Save the pen in hand if need be; its slot, or `null`. */
    make: () => BarItemId | null;
    /** Draw the pen in hand on the chip. */
    draw: (chip: HTMLElement) => void;
    /**
     * Delete a pen button: a saved pen leaves the bar and Saved pens, a pen
     * type the bar. Without it, no trash and no Delete.
     */
    remove?: (id: BarItemId) => void;
    /**
     * The pen dialog, starting from the pen in hand; `place` gets the slot of
     * the pen it saved. Without it a tap adds the pen in hand as it is.
     */
    customize?: (place: (slot: BarItemId) => void) => void;
  };
  layout: () => ToolbarLayout;
  /** Show `layout` and keep it. */
  apply: (layout: ToolbarLayout) => void;
  /** Mark what would fold into ⋯ at this width, every button shown. */
  foldsNow: () => void;
  barDock: () => BarDock;
  pillRow: () => boolean;
  setBarDock?: (dock: BarDock) => void;
  setPillRow?: (on: boolean) => void;
  /** The bar's preset (`BarPreset`); without `setPreset`, no Essentials switch. */
  preset?: () => BarPreset;
  setPreset?: (preset: BarPreset) => void;
  /** The look worn now; without it (and `setLook`) the tray has no Style or Colours row. */
  look?: () => { style: LookStyle; palette: LookPalette };
  setLook?: (style: LookStyle, palette: LookPalette) => void;
  /** The mode closed. */
  done: () => void;
}

/** The bar's edges, each its Lucide panel icon, as the ⋯ sheet offered them. */
function barDocks(): ReadonlyArray<{ dock: BarDock; label: string }> {
  return [
    { dock: "top", label: t("view.morePanel.dockTop") },
    { dock: "bottom", label: t("view.morePanel.dockBottom") },
    { dock: "left", label: t("view.morePanel.dockLeft") },
    { dock: "right", label: t("view.morePanel.dockRight") },
  ];
}

/** A button's way to a zone, named whole so each language can word it. */
const TO_ZONE: Record<Zone, { across: TextKey; upright: TextKey }> = {
  start: { across: "toolbar.edit.toStart", upright: "toolbar.edit.toTop" },
  middle: { across: "toolbar.edit.toMiddle", upright: "toolbar.edit.toMiddle" },
  end: { across: "toolbar.edit.toEnd", upright: "toolbar.edit.toBottom" },
};

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

/** The tools a look chip shows, the pen pressed: the bar's own icons. */
const PREVIEW_TOOLS = ["pen", "eraser"] as const;

/**
 * A small bar in `style` and `palette`, drawn by the Looks section's own
 * tokens (`styles.css`). Match Obsidian takes the theme's colours from the
 * body, since a palette worn by the view would otherwise reach it.
 */
export function lookPreview(
  parent: HTMLElement,
  style: LookStyle,
  palette: LookPalette,
): HTMLElement {
  const preview = parent.createDiv({
    cls: `goodobsidian-look-preview is-style-${style} is-palette-${palette}`,
  });
  if (palette === "obsidian" && typeof getComputedStyle === "function") {
    const theme = getComputedStyle(document.body);
    for (const name of PALETTE_VARIABLES) {
      const value = theme.getPropertyValue(name).trim();
      if (value) preview.style.setProperty(name, value);
    }
  }
  const bar = preview.createDiv({ cls: "goodobsidian-look-bar" });
  PREVIEW_TOOLS.forEach((id, i) => {
    const tool = bar.createSpan({ cls: "goodobsidian-look-tool" });
    tool.toggleClass("is-active", i === 0);
    setIcon(tool, BAR_ITEM_ICONS[id]);
  });
  return preview;
}

/** The New pen chip's `data-item`: a source of new pens, never a bar item. */
const NEW_PEN = "new-pen";

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
  /** Essentials: the bar button a drop would swap with (`swapItems`). */
  private swapWith: BarItemId | null = null;
  /** The trash beside New pen, shown while a pen button is dragged. */
  private trash: HTMLElement | null = null;
  /** A dragged pen is over the trash: let go, it is deleted. */
  private overTrash = false;
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
    this.tray.setAttribute("aria-label", t("toolbar.customize.title"));

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
      button.toggleClass("is-pinned", isPinnedIn(this.h.layout(), id));
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
    const ids = [...(Object.keys(BAR_ITEM_LABELS) as BarItemId[]), ...this.barIds()];
    for (const id of ids) {
      const button = this.h.button(id);
      if (!button) continue;
      button.removeClass("is-pinned", "will-fold");
      const own = button.getAttribute("data-label");
      if (own !== null) button.setAttribute("aria-label", own || this.h.label(id));
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
      places.setAttribute("aria-label", t("view.morePanel.toolbar"));
      for (const { dock: d, label } of barDocks()) {
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
    if (setRow) {
      const on = this.h.pillRow();
      const row = head.createEl("button", { cls: "goodobsidian-edit-switch clickable-icon" });
      row.createSpan({ cls: "goodobsidian-edit-toggle" }).toggleClass("is-on", on);
      row.createSpan({ text: t("toolbar.edit.dockOptions") });
      row.setAttribute("role", "switch");
      row.setAttribute("aria-checked", String(on));
      row.addEventListener("click", () => setRow(!on));
    }
    // Essentials is for docked options: its switch shows while they are docked.
    const setPreset = this.h.setPreset;
    if (setPreset && this.h.pillRow()) {
      const on = this.inPreset();
      const preset = head.createEl("button", { cls: "goodobsidian-edit-switch clickable-icon" });
      preset.createSpan({ cls: "goodobsidian-edit-toggle" }).toggleClass("is-on", on);
      preset.createSpan({ text: t("toolbar.edit.essentials") });
      preset.setAttribute("role", "switch");
      preset.setAttribute("aria-checked", String(on));
      preset.addEventListener("click", () => setPreset(on ? "own" : "essentials"));
    }
    this.newPenChip(head);
    if (this.h.newPen?.remove) {
      // Beside New pen, while a pen button is carried: dropped here, it goes.
      const trash = head.createDiv({ cls: "goodobsidian-edit-trash is-hidden" });
      setIcon(trash, "trash-2");
      trash.setAttribute("aria-label", t("toolbar.edit.deletePen"));
      this.trash = trash;
    }
    head.createDiv({ cls: "goodobsidian-edit-spacer" });
    const reset = head.createEl("button", {
      cls: "goodobsidian-edit-reset clickable-icon",
      text: t("toolbar.edit.reset"),
    });
    const look = this.h.look?.();
    const setLook = this.h.setLook;
    const lookIsDefault =
      !look || (look.style === LOOK_STYLES[0] && look.palette === LOOK_PALETTES[0]);
    // Reset gives back the layout the preset in use starts with.
    const start = this.inPreset() ? essentialsLayout() : defaultLayout();
    reset.disabled = sameLayout(this.h.layout(), start) && lookIsDefault;
    reset.addEventListener("click", () => {
      if (!lookIsDefault) setLook?.(LOOK_STYLES[0], LOOK_PALETTES[0]);
      this.h.apply(start);
    });
    const done = head.createEl("button", { cls: "goodobsidian-edit-done clickable-icon" });
    setIcon(done, "check");
    done.setAttribute("aria-label", t("common.done"));
    done.addEventListener("click", () => this.finish());
    // What the switches above do to the bar, said where they are, only while
    // it is true (Joost, 2026-11-13): Essentials keeps its end in ⋯ and
    // swaps tools; docked options that do not fit take a bar of their own.
    const docked = this.h.pillRow() && !isBarUpright(this.h.barDock());
    const note = this.inPreset()
      ? t("toolbar.edit.essentialsNote")
      : setRow && docked
        ? t("toolbar.edit.dockSecondBar")
        : null;
    if (note) {
      const line = tray.createDiv({ cls: "goodobsidian-edit-note" });
      setIcon(line.createSpan({ cls: "goodobsidian-edit-note-icon" }), "info");
      line.createSpan({ text: note });
    }

    const layout = this.h.layout();
    this.menuShelf = this.shelf(
      t("toolbar.moreTools"),
      "menu",
      menuItems(layout).filter((id) => this.h.has(id)),
    );
    this.offShelf = this.shelf(
      t("toolbar.customize.hidden"),
      "off",
      offItems(layout).filter((id) => this.h.has(id)),
    );
    if (look && setLook) {
      const styles = lookStyleNames();
      this.lookShelf(
        t("settings.look.styleLabel"),
        LOOK_STYLES,
        look.style,
        (id, chip) => {
          chip.setAttribute("aria-label", styles[id]);
          lookPreview(chip, id, look.palette);
        },
        (id) => {
          setLook(id, look.palette);
          this.refresh();
        },
      );
      const palettes = lookPaletteNames();
      this.lookShelf(
        t("settings.look.paletteLabel"),
        LOOK_PALETTES,
        look.palette,
        (id, chip) => {
          chip.setAttribute("aria-label", palettes[id]);
          lookPreview(chip, look.style, id);
        },
        (id) => {
          setLook(look.style, id);
          this.refresh();
        },
      );
    }
  }

  /** A row of looks to pick from, the one worn ringed; a tap wears another. */
  private lookShelf<T extends string>(
    name: string,
    ids: readonly T[],
    current: T,
    draw: (id: T, chip: HTMLButtonElement) => void,
    pick: (id: T) => void,
  ): void {
    const shelf = this.tray.createDiv({ cls: "goodobsidian-edit-shelf is-look" });
    shelf.createSpan({ cls: "goodobsidian-edit-shelf-name", text: name });
    const chips = shelf.createDiv({ cls: "goodobsidian-edit-chips" });
    chips.setAttribute("role", "radiogroup");
    chips.setAttribute("aria-label", name);
    for (const id of ids) {
      const chip = chips.createEl("button", {
        cls: "goodobsidian-edit-chip goodobsidian-look-chip clickable-icon",
      });
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(id === current));
      chip.toggleClass("is-active", id === current);
      draw(id, chip);
      chip.addEventListener("click", () => {
        if (id !== current) pick(id);
      });
    }
  }

  /**
   * New pen (FineNotes#211): one chip beside Dock tool options, however many
   * pens there are, drawn as the pen in hand. Dragged onto the bar it leaves
   * that pen as a button where it lands; a tap opens the pen dialog on it, to
   * change it first, and puts the pen it makes after the pen's button.
   * Dimmed when it cannot add one.
   */
  private newPenChip(parent: HTMLElement): void {
    const pen = this.h.newPen;
    if (!pen) return;
    const chip = parent.createEl("button", {
      cls: "goodobsidian-edit-chip goodobsidian-edit-new-pen clickable-icon",
    });
    pen.draw(chip);
    setIcon(chip.createSpan({ cls: "goodobsidian-edit-new-pen-plus" }), "plus");
    const can = pen.can();
    chip.setAttribute("data-item", NEW_PEN);
    chip.toggleClass("is-disabled", !can);
    chip.setAttribute("aria-disabled", String(!can));
    chip.setAttribute("aria-label", t("toolbar.edit.newPenTip"));
  }

  private shelf(name: string, place: "menu" | "off", ids: CoreItemId[]): HTMLElement {
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
    // Clear of the bar, so the bar can be seen and scrolled while this is open.
    const margin = 8;
    const gap = 28;
    if (dock === "top") style.top = `${Math.round(bar.bottom - host.top + gap)}px`;
    else if (dock === "bottom") style.bottom = `${Math.round(host.bottom - bar.top + gap)}px`;
    else style.top = `${margin}px`;
    if (dock === "left") style.left = `${Math.round(bar.right - host.left + gap)}px`;
    else if (dock === "right") style.right = `${Math.round(host.right - bar.left + gap)}px`;
    // Never taller than the room it has: past that it scrolls (styles.css).
    const room =
      dock === "top"
        ? host.bottom - bar.bottom - gap - margin
        : dock === "bottom"
          ? bar.top - host.top - gap - margin
          : host.height - 2 * margin;
    style.maxHeight = `${Math.max(120, Math.round(room))}px`;
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
    if (el.getAttribute("data-item") === NEW_PEN && this.h.newPen?.can() !== true) return;
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
      // A pen carries its own drawing; every other button its icon.
      const pen = press.el.querySelector(
        "svg.goodobsidian-tool-pen-glyph, .goodobsidian-pen-glyph",
      );
      if (isPenSlot(press.id) || (press.id as string) === NEW_PEN) {
        const drawn = pen ?? press.el.querySelector("svg");
        if (drawn) ghost.append(drawn.cloneNode(true));
      } else setIcon(ghost, BAR_ITEM_ICONS[press.id]);
      this.ghost = ghost;
      press.el.addClass("is-drag-source");
      this.h.bar.addClass("is-dragging");
      if (isPenSlot(press.id)) this.trash?.removeClass("is-hidden");
    }
    // Over the trash, a pen is deleted when let go; nowhere else is lit.
    const trashBox = this.trash?.hasClass("is-hidden") ? null : this.trash?.getBoundingClientRect();
    this.overTrash = !!trashBox && inside(trashBox, event.clientX, event.clientY, 8);
    this.trash?.toggleClass("is-target", this.overTrash);
    if (this.overTrash) {
      this.ghost?.setCssStyles({
        left: `${Math.round(event.clientX)}px`,
        top: `${Math.round(event.clientY)}px`,
      });
      this.setTarget(null);
      return;
    }
    this.ghost?.setCssStyles({
      left: `${Math.round(event.clientX)}px`,
      top: `${Math.round(event.clientY)}px`,
    });
    if (this.inPreset()) {
      this.setSwap(this.swapAt(press.id, event.clientX, event.clientY));
      return;
    }
    this.setTarget(this.hitTest(press.id, event.clientX, event.clientY));
  }

  /** Essentials is in use: tools are swapped, never added or taken away. */
  private inPreset(): boolean {
    return this.h.preset?.() === "essentials";
  }

  /**
   * Essentials: the bar button nearest (`x`, `y`) along the bar that `id`
   * may swap with, or `null` (off the bar, or no button there may move).
   */
  private swapAt(id: BarItemId, x: number, y: number): BarItemId | null {
    const bar = this.h.bar.getBoundingClientRect();
    if (!inside(bar, x, y, BAR_REACH)) return null;
    const layout = this.h.layout();
    if ((id as string) !== NEW_PEN && isFixedInPreset(layout, id) && placeOf(layout, id) !== "menu")
      return null;
    const upright = isBarUpright(this.h.barDock());
    const along = upright ? y : x;
    let best: { id: BarItemId; distance: number } | null = null;
    for (const zone of ["start", "middle"] as const) {
      for (const { id: slot, el } of this.shownIn(zone, id)) {
        if (isFixedInPreset(layout, slot)) continue;
        const box = el.getBoundingClientRect();
        const centre = upright ? box.top + box.height / 2 : box.left + box.width / 2;
        const distance = Math.abs(centre - along);
        if (!best || distance < best.distance) best = { id: slot, distance };
      }
    }
    return best && best.distance <= BAR_REACH * 2 ? best.id : null;
  }

  /** Light the button a drop would swap with. */
  private setSwap(slot: BarItemId | null): void {
    if (this.swapWith) this.h.button(this.swapWith)?.removeClass("is-swap-target");
    this.swapWith = slot;
    if (slot) this.h.button(slot)?.addClass("is-swap-target");
  }

  private onUp(event: PointerEvent): void {
    const press = this.press;
    if (!press || event.pointerId !== press.pointerId) return;
    event.preventDefault();
    const target = event.type === "pointerup" ? this.target : null;
    const swap = event.type === "pointerup" ? this.swapWith : null;
    const toTrash = event.type === "pointerup" && this.overTrash;
    const { id, dragging, el } = press;
    this.endPress();
    if (dragging && toTrash && isPenSlot(id)) {
      this.h.newPen?.remove?.(id);
      this.buildTray();
      return;
    }
    if (this.inPreset() && dragging) {
      // Essentials: a drop on a button swaps; anywhere else changes nothing.
      if (!swap) return;
      const slot = (id as string) === NEW_PEN ? this.h.newPen?.make() : id;
      if (slot) this.apply(slot, swapItems(this.h.layout(), slot, swap));
      return;
    }
    if ((id as string) === NEW_PEN) {
      if (event.type !== "pointerup") return;
      if (dragging) {
        if (target) this.addPen(target);
      } else if (!this.inPreset()) this.customizePen();
      return;
    }
    if (!dragging) {
      if (event.type === "pointerup") this.openMenu(id, el);
      return;
    }
    if (target) this.move(id, target);
  }

  /**
   * New pen let go: a pen button for the pen in hand at `target` on the bar,
   * or after the pen's button when it was only tapped (`null`).
   */
  private addPen(target: Target | null): void {
    if (target !== null && typeof target === "string") return;
    const slot = this.h.newPen?.make();
    if (!slot) return;
    const layout = this.h.layout();
    const next =
      target === null ? moveTo(layout, slot, afterPen(layout)) : moveTo(layout, slot, target);
    this.apply(slot, next);
  }

  /** New pen tapped: the pen dialog, and the pen it saves after the pen's button. */
  private customizePen(): void {
    const pen = this.h.newPen;
    if (!pen?.customize) {
      this.addPen(null);
      return;
    }
    pen.customize((slot) => {
      const layout = this.h.layout();
      this.apply(slot, moveTo(layout, slot, afterPen(layout)));
    });
  }

  private endPress(): void {
    this.pressCleanup?.();
    this.pressCleanup = null;
    this.press?.el.removeClass("is-drag-source");
    this.press = null;
    this.ghost?.remove();
    this.ghost = null;
    this.setTarget(null);
    this.setSwap(null);
    this.h.bar.removeClass("is-dragging");
    this.overTrash = false;
    this.trash?.removeClass("is-target");
    this.trash?.addClass("is-hidden");
  }

  /** Where a drop at (`x`, `y`) would put `id`: a place on the bar, a shelf, or nowhere. */
  private hitTest(id: BarItemId, x: number, y: number): Target | null {
    for (const [shelf, place] of [
      [this.menuShelf, "menu"],
      [this.offShelf, "off"],
    ] as const) {
      if (!shelf || !inside(shelf.getBoundingClientRect(), x, y, 4)) continue;
      // A new pen only goes on the bar; a pen as a button leaves it by Hidden.
      if ((id as string) === NEW_PEN || (isPenSlot(id) && place === "menu")) return null;
      return isPinnedIn(this.h.layout(), id) ? null : place;
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
    menu.setAttribute("aria-label", this.h.label(id));
    const row = (icon: string, label: string, next: ToolbarLayout): void => {
      if (sameLayout(next, layout)) return;
      if (this.inPreset() && !this.keepsPreset(layout, next)) return;
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
        upright ? t("toolbar.edit.moveUp") : t("toolbar.edit.moveLeft"),
        stepItem(layout, id, -1),
      );
      row(
        upright ? "arrow-down" : "arrow-right",
        upright ? t("toolbar.edit.moveDown") : t("toolbar.edit.moveRight"),
        stepItem(layout, id, 1),
      );
    }
    for (const zone of ZONES) {
      if (zone === place) continue;
      row(
        zone === "middle"
          ? "panel-top"
          : zone === "start"
            ? "align-start-vertical"
            : "align-end-vertical",
        t(TO_ZONE[zone][upright ? "upright" : "across"]),
        moveTo(layout, id, { zone, index: layout[zone].length }),
      );
    }
    if (isPenSlot(id)) {
      // A pen as a button is not kept anywhere off the bar: it goes.
      row("pin-off", t("toolbar.pen.removeFromBar"), moveTo(layout, id, "off"));
      const remove = this.h.newPen?.remove;
      if (remove && id.startsWith("saved:")) {
        // Delete: off the bar and out of Saved pens, as the trash does.
        const button = menu.createEl("button", {
          cls: "goodobsidian-edit-menu-row mod-warning clickable-icon",
        });
        setIcon(button.createSpan({ cls: "goodobsidian-edit-menu-icon" }), "trash-2");
        button.createSpan({ text: t("toolbar.edit.deletePen") });
        button.setAttribute("role", "menuitem");
        button.addEventListener("click", () => {
          this.closeMenu();
          remove(id);
          this.buildTray();
        });
      }
    } else if (!isPinnedIn(layout, id)) {
      if (place !== "menu")
        row("toolbox", t("toolbar.edit.toMoreTools"), moveTo(layout, id, "menu"));
      if (place !== "off") row("eye-off", t("toolbar.edit.hide"), moveTo(layout, id, "off"));
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
    if ((id as string) === NEW_PEN) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      if (this.h.newPen?.can() === true) this.customizePen();
      return;
    }
    const upright = isBarUpright(this.h.barDock());
    const back = upright ? "ArrowUp" : "ArrowLeft";
    const on = upright ? "ArrowDown" : "ArrowRight";
    if (event.key === back || event.key === on) {
      event.preventDefault();
      event.stopPropagation();
      const layout = this.h.layout();
      const next = stepItem(layout, id, event.key === back ? -1 : 1);
      if (!this.inPreset() || this.keepsPreset(layout, next)) this.apply(id, next);
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

  /**
   * Essentials keeps its buttons where they belong: the same ones in the
   * start and middle together, and the end as it is (it lives in ⋯).
   */
  private keepsPreset(layout: ToolbarLayout, next: ToolbarLayout): boolean {
    const slots = (l: ToolbarLayout): string =>
      [...l.start, ...l.middle].filter((id) => !isFixedInPreset(l, id)).sort().join(",");
    return slots(layout) === slots(next) && layout.end.join(",") === next.end.join(",");
  }

  private barIds(): BarItemId[] {
    const layout = this.h.layout();
    return [...layout.start, ...layout.middle, ...layout.end];
  }

  /** A button's name in edit mode: what pressing it does now. */
  private ariaLabel(id: BarItemId): string {
    const name = this.h.label(id);
    return isPinnedIn(this.h.layout(), id)
      ? t("toolbar.edit.pinned", { name })
      : t("toolbar.customize.move", { name });
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

/** Right after the pen's button, or the last pen as a button, or the middle's start. */
function afterPen(layout: ToolbarLayout): Target {
  let at: Target = { zone: "middle", index: 0 };
  for (const zone of ZONES) {
    layout[zone].forEach((id, index) => {
      if (id === "pen" || isPenSlot(id)) at = { zone, index: index + 1 };
    });
  }
  return at;
}

/** Whether (`x`, `y`) is in `box` grown by `pad` on every side. */
function inside(box: DOMRect, x: number, y: number, pad: number): boolean {
  return x >= box.left - pad && x <= box.right + pad && y >= box.top - pad && y <= box.bottom + pad;
}
