/**
 * Where every button of the tool bar is: the model behind "Customize
 * toolbar" (discussion #43), the bar's own edit mode.
 *
 * The bar has three zones, left to right (top to bottom when it stands
 * upright): `start` (the pages, search, AI, the calculator, undo and redo),
 * `middle` (the writing tools, centred, as in Goodnotes) and `end` (the
 * document's actions, ⋯ and the notebook's settings). Every button can go to
 * any place in any zone, into the More tools menu (the toolbox), or out of
 * sight (`off`). More tools holds every known button that is neither in a
 * zone nor off, in catalogue order, so a button added in a later version
 * lands there in a layout saved before it existed.
 *
 * Three buttons are pinned to the bar, in any zone: the pen (a bar needs a
 * writing tool), the toolbox (its menu is the way into this mode) and ⋯ (the
 * notebook's own menu). A layout missing one puts it back.
 *
 * PURE: no DOM, no Obsidian.
 */

import { ICON_STYLUS_ONLY } from "../constants";
import { t } from "../i18n/translate";
import {
  SAVED_PEN_TYPES,
  type SavedPen,
  type SavedPenType,
  isPenId,
  samePen,
} from "../model/saved-pens";

/** Every button the tool bar has of its own. */
export type CoreItemId =
  | "select"
  | "pen"
  | "eraser"
  | "text"
  | "shape"
  | "pan"
  | "zoom"
  | "stylus"
  | "image"
  | "pdf"
  | "sticker"
  | "sticky"
  | "ruler"
  | "tape"
  | "record"
  | "fill"
  | "calculator"
  | "home"
  | "thumbnails"
  | "search"
  | "ai"
  | "undo"
  | "redo"
  | "fullscreen"
  | "addPage"
  | "share"
  | "settings"
  | "accessories"
  | "more";

/**
 * A pen as a button of its own (FineNotes#211): a pen type (`pen:ball`),
 * which keeps its own ink as the type does in the pen's row, or a saved pen
 * (`saved:<id>`), a preset as its key 1-8 is. These live only in a zone:
 * taken off the bar they are gone, never in More tools or Hidden, since the
 * pen's row and Saved pens are where they wait.
 */
export type PenSlotId = `pen:${SavedPenType}` | `saved:${string}`;

/** Every button the tool bar can show. */
export type BarItemId = CoreItemId | PenSlotId;

/** Whether `id` is a pen as a button of its own. */
export function isPenSlot(id: BarItemId): id is PenSlotId {
  return id.startsWith("pen:") || id.startsWith("saved:");
}

/** The pen type a `pen:` slot holds, or `null`. */
export function slotPenType(id: BarItemId): SavedPenType | null {
  if (!id.startsWith("pen:")) return null;
  const type = id.slice(4);
  return (SAVED_PEN_TYPES as readonly string[]).includes(type) ? (type as SavedPenType) : null;
}

/** The saved pen's id a `saved:` slot names, or `null`. */
export function slotSavedId(id: BarItemId): string | null {
  if (!id.startsWith("saved:")) return null;
  const pen = id.slice(6);
  return isPenId(pen) ? pen : null;
}

/** The slot for a pen type. */
export function penTypeSlot(type: SavedPenType): PenSlotId {
  return `pen:${type}`;
}

/** The slot for a saved pen. */
export function savedPenSlot(id: string): PenSlotId {
  return `saved:${id}`;
}

function isPenSlotId(value: string): value is PenSlotId {
  return slotPenType(value as BarItemId) !== null || slotSavedId(value as BarItemId) !== null;
}

/** Every button, in the order the More tools menu and the Hidden shelf give them. */
export const BAR_ITEMS: readonly CoreItemId[] = [
  "select",
  "pen",
  "eraser",
  "text",
  "shape",
  "pan",
  "zoom",
  "stylus",
  "image",
  "pdf",
  "sticker",
  "sticky",
  "ruler",
  "tape",
  "record",
  "fill",
  "calculator",
  "home",
  "thumbnails",
  "search",
  "ai",
  "undo",
  "redo",
  "fullscreen",
  "addPage",
  "share",
  "settings",
  "accessories",
  "more",
];

/** The bar's zones, in the order they run along it. */
export type Zone = "start" | "middle" | "end";
export const ZONES: readonly Zone[] = ["start", "middle", "end"];

/** What each zone is called in edit mode, for a bar along an edge and an upright one. */
export const ZONE_LABELS: Record<Zone, { across: string; upright: string }> = {
  start: {
    get across() {
      return t("toolbar.zone.start");
    },
    get upright() {
      return t("toolbar.zone.top");
    },
  },
  middle: {
    get across() {
      return t("toolbar.zone.middle");
    },
    get upright() {
      return t("toolbar.zone.middle");
    },
  },
  end: {
    get across() {
      return t("toolbar.zone.end");
    },
    get upright() {
      return t("toolbar.zone.bottom");
    },
  },
};

/** Every button's place: the three zones in order, and the buttons shown nowhere. */
export interface ToolbarLayout {
  start: BarItemId[];
  middle: BarItemId[];
  end: BarItemId[];
  off: BarItemId[];
}

/** Where a button is. */
export type ItemPlace = Zone | "menu" | "off";

/**
 * The bar a new install starts with, as it looked before it could be
 * customized; the hand, the magnifier, Stylus-only mode, stickers, sticky
 * notes, the ruler, cover tape, the mic and the fill bucket wait in More
 * tools, and nothing is off.
 */
export function defaultLayout(): ToolbarLayout {
  return {
    start: ["home", "thumbnails", "search", "ai", "calculator", "undo", "redo"],
    middle: ["select", "pen", "eraser", "text", "shape", "image", "pdf", "accessories"],
    end: ["fullscreen", "addPage", "share", "more", "settings"],
    off: [],
  };
}

/**
 * The bar's presets (Joost, 2026-11-13): the person's own layout, or
 * Essentials, the tools used all the time in a bar that holds a tool's
 * docked options in one row at 11″ landscape.
 */
export type BarPreset = "own" | "essentials";

/** A stored preset, read back: Essentials only when it was saved so. */
export function parseBarPreset(raw: unknown): BarPreset {
  return raw === "essentials" ? "essentials" : "own";
}

/**
 * Essentials as it starts: the sidebar, undo and redo; the lasso, pen,
 * eraser, text and shapes with the toolbox; the end's buttons, which in
 * Essentials always sit in ⋯ (`isFoldedInPreset`). The rest is in More tools.
 */
export function essentialsLayout(): ToolbarLayout {
  return {
    start: ["thumbnails", "undo", "redo"],
    middle: ["select", "pen", "eraser", "text", "shape", "accessories"],
    end: ["fullscreen", "addPage", "share", "more", "settings"],
    off: [],
  };
}

/**
 * The layout the bar shows: Essentials while it is chosen and the tool
 * options are docked (Joost, 2026-11-13: the preset is for docking), else
 * the person's own. A stored layout that is damaged or missing is the one
 * its preset starts with.
 */
export function layoutInUse(
  own: unknown,
  essentials: unknown,
  preset: BarPreset,
  docked: boolean,
): ToolbarLayout {
  if (preset !== "essentials" || !docked) return normalizeLayout(own);
  return essentials !== null && typeof essentials === "object"
    ? normalizeLayout(essentials)
    : essentialsLayout();
}

/** In Essentials the end's buttons, but ⋯, are always folded into ⋯. */
export function isFoldedInPreset(layout: ToolbarLayout, id: BarItemId): boolean {
  return id !== "more" && layout.end.includes(id);
}

/**
 * Whether `id` keeps its place in Essentials: undo, redo, the buttons that
 * never leave the bar (`isPinnedIn`), and the end's, which live in ⋯.
 */
export function isFixedInPreset(layout: ToolbarLayout, id: BarItemId): boolean {
  return id === "undo" || id === "redo" || isPinnedIn(layout, id) || layout.end.includes(id);
}

/**
 * Essentials keeps its number of buttons: tools are replaced, never added
 * (Joost, 2026-11-13). `layout` with `id` in `slot`'s place and `slot` where
 * `id` was: another place on the bar, or More tools when `id` came from off
 * the bar. Unchanged when either keeps its place (`isFixedInPreset`).
 */
export function swapItems(layout: ToolbarLayout, id: BarItemId, slot: BarItemId): ToolbarLayout {
  const next = copyLayout(layout);
  if (id === slot || isFixedInPreset(layout, slot)) return next;
  const zoneOf = (item: BarItemId): Zone | undefined =>
    ZONES.find((zone) => next[zone].includes(item));
  const to = zoneOf(slot);
  if (!to) return next;
  const from = zoneOf(id);
  if (from && isFixedInPreset(layout, id)) return next;
  const at = next[to].indexOf(slot);
  if (from) next[from][next[from].indexOf(id)] = slot;
  next.off = next.off.filter((item) => item !== id);
  next[to][at] = id;
  return next;
}

/** The buttons that never leave the bar, and the zone each goes back to if lost. */
export const PINNED: Readonly<Partial<Record<CoreItemId, Zone>>> = {
  pen: "middle",
  accessories: "middle",
  more: "end",
};

/** Whether `id` must stay on the bar, whatever else is on it. */
export function isPinned(id: BarItemId): boolean {
  return !isPenSlot(id) && PINNED[id] !== undefined;
}

/** The pens on the bar as buttons of their own, in bar order. */
export function penSlotsOf(layout: ToolbarLayout): PenSlotId[] {
  return barItems(layout).filter(isPenSlot);
}

/**
 * Whether `id` must stay on the bar under `layout`. The pen is pinned only
 * while it is the bar's one writing tool: once another pen is on the bar it
 * may go to More tools or out of sight (FineNotes#211).
 */
export function isPinnedIn(layout: ToolbarLayout, id: BarItemId): boolean {
  if (id === "pen") return penSlotsOf(layout).length === 0;
  return isPinned(id);
}

/** What each button is called, in its tooltip, the menus and edit mode. */
export const BAR_ITEM_LABELS: Record<CoreItemId, string> = {
  get select() {
    return t("toolbar.tool.lasso");
  },
  get pen() {
    return t("toolbar.tool.pen");
  },
  get eraser() {
    return t("toolbar.tool.eraser");
  },
  get text() {
    return t("toolbar.tool.text");
  },
  get shape() {
    return t("toolbar.tool.shapes");
  },
  get pan() {
    return t("toolbar.tool.hand");
  },
  get zoom() {
    return t("toolbar.tool.magnifier");
  },
  get stylus() {
    return t("toolbar.tool.stylusOnly");
  },
  get image() {
    return t("toolbar.tool.image");
  },
  get pdf() {
    return t("toolbar.tool.pdf");
  },
  get sticker() {
    return t("toolbar.tool.stickers");
  },
  get sticky() {
    return t("toolbar.tool.stickyNotes");
  },
  get ruler() {
    return t("toolbar.tool.ruler");
  },
  get tape() {
    return t("toolbar.tool.coverTape");
  },
  get record() {
    return t("toolbar.tool.recordAudio");
  },
  get fill() {
    return t("toolbar.tool.fill");
  },
  get calculator() {
    return t("toolbar.calculator");
  },
  get home() {
    return t("toolbar.item.home");
  },
  get thumbnails() {
    return t("toolbar.pageThumbnails");
  },
  get search() {
    return t("toolbar.item.search");
  },
  get ai() {
    return t("toolbar.ai");
  },
  get undo() {
    return t("common.undo");
  },
  get redo() {
    return t("common.redo");
  },
  get fullscreen() {
    return t("toolbar.fullScreen");
  },
  get addPage() {
    return t("toolbar.addPage");
  },
  get share() {
    return t("toolbar.export");
  },
  get settings() {
    return t("toolbar.notebookSettings");
  },
  get accessories() {
    return t("toolbar.moreTools");
  },
  get more() {
    return t("common.more");
  },
};

/** Each button's icon, in the menus and edit mode as on the bar. */
export const BAR_ITEM_ICONS: Record<CoreItemId, string> = {
  select: "lasso",
  pen: "pen-tool",
  eraser: "eraser",
  text: "type",
  shape: "shapes",
  pan: "hand",
  zoom: "zoom-in",
  stylus: ICON_STYLUS_ONLY,
  image: "image",
  pdf: "file-text",
  sticker: "sticker",
  sticky: "sticky-note",
  ruler: "ruler",
  tape: "bandage",
  record: "mic",
  fill: "paint-bucket",
  calculator: "calculator",
  home: "house",
  thumbnails: "panel-left",
  search: "search",
  ai: "sparkles",
  undo: "undo-2",
  redo: "redo-2",
  fullscreen: "maximize-2",
  addPage: "plus",
  share: "share",
  settings: "settings",
  accessories: "toolbox",
  more: "more-horizontal",
};

function isBarItem(value: unknown): value is CoreItemId {
  return typeof value === "string" && (BAR_ITEMS as readonly string[]).includes(value);
}

/**
 * Which saved pens a layout may show: `null` takes every well-formed
 * `saved:` slot, a set only those it names (a deleted pen's button goes).
 */
export type SavedPenIds = ReadonlySet<string> | null;

/**
 * Known ids from a stored list, each once and not already `taken`, in their
 * order; with `slots`, pens as buttons too (those `saved` allows).
 */
function readList(
  raw: unknown,
  taken: Set<BarItemId>,
  slots = false,
  saved: SavedPenIds = null,
): BarItemId[] {
  const out: BarItemId[] = [];
  if (!Array.isArray(raw)) return out;
  for (const value of raw) {
    if (typeof value !== "string") continue;
    let id: BarItemId | null = null;
    if (isBarItem(value)) id = value;
    else if (slots && isPenSlotId(value)) {
      const pen = slotSavedId(value);
      if (pen === null || saved === null || saved.has(pen)) id = value;
    }
    if (id === null || taken.has(id)) continue;
    taken.add(id);
    out.push(id);
  }
  return out;
}

/**
 * A pinned button that went missing goes back to its zone: the pen first,
 * the rest last. The pen only while no other pen is on the bar.
 */
function restorePinned(layout: ToolbarLayout): void {
  for (const id of BAR_ITEMS) {
    const zone = PINNED[id];
    if (!zone || ZONES.some((z) => layout[z].includes(id))) continue;
    if (id === "pen") {
      if (penSlotsOf(layout).length > 0) continue;
      layout.off = layout.off.filter((item) => item !== "pen");
      layout[zone].unshift(id);
    } else layout[zone].push(id);
  }
}

/**
 * The layout a stored value names: in each zone the known buttons, each
 * once across all of them, in their order; of `off` the known buttons not
 * in a zone and not pinned, in catalogue order; every pinned button on the
 * bar. Anything that is not an object (a new install, a damaged file) is
 * the default layout.
 */
export function normalizeLayout(raw: unknown, saved: SavedPenIds = null): ToolbarLayout {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return defaultLayout();
  const stored = raw as Record<string, unknown>;
  const taken = new Set<BarItemId>();
  const layout: ToolbarLayout = {
    start: readList(stored.start, taken, true, saved),
    middle: readList(stored.middle, taken, true, saved),
    end: readList(stored.end, taken, true, saved),
    off: [],
  };
  const off = readList(stored.off, taken);
  // The pen may be out of sight only while another pen is on the bar.
  layout.off = BAR_ITEMS.filter((id) => off.includes(id) && !isPinnedIn(layout, id));
  restorePinned(layout);
  return layout;
}

/**
 * The layout the three settings of 2.7 and before name (`toolbarItems`,
 * the tools on the bar; `toolbarOff`, the tools hidden; `toolbarHome`, the
 * calculator at the top left, from this release's first pass): those tools
 * in the middle, the toolbox after them, and the rest of the bar as it was
 * built then. Nobody's bar changes on update.
 */
export function migrateLayout(items: unknown, off: unknown, home?: unknown): ToolbarLayout {
  const base = defaultLayout();
  const tools = Array.isArray(items)
    ? items.filter(isBarItem)
    : base.middle.filter((id) => id !== "accessories");
  const hidden = Array.isArray(off) ? off.filter(isBarItem) : [];
  const calculatorHome =
    !tools.includes("calculator") &&
    !hidden.includes("calculator") &&
    (!Array.isArray(home) || home.includes("calculator"));
  return normalizeLayout({
    start: base.start.filter((id) => id !== "calculator" || calculatorHome),
    middle: [...tools, "accessories"],
    end: base.end,
    off: hidden,
  });
}

/** Where `id` is in `layout`. A pen as a button off the bar is nowhere: "off". */
export function placeOf(layout: ToolbarLayout, id: BarItemId): ItemPlace {
  for (const zone of ZONES) if (layout[zone].includes(id)) return zone;
  return layout.off.includes(id) || isPenSlot(id) ? "off" : "menu";
}

/** Every button on the bar, in zone order. */
export function barItems(layout: ToolbarLayout): BarItemId[] {
  return [...layout.start, ...layout.middle, ...layout.end];
}

/** The buttons the More tools menu lists, in catalogue order. */
export function menuItems(layout: ToolbarLayout): CoreItemId[] {
  return BAR_ITEMS.filter((id) => placeOf(layout, id) === "menu");
}

/** The buttons shown nowhere, in catalogue order. */
export function offItems(layout: ToolbarLayout): CoreItemId[] {
  return BAR_ITEMS.filter((id) => layout.off.includes(id));
}

/** A copy of `layout`. */
export function copyLayout(layout: ToolbarLayout): ToolbarLayout {
  return {
    start: [...layout.start],
    middle: [...layout.middle],
    end: [...layout.end],
    off: [...layout.off],
  };
}

/** Where a button can be sent: a place in a zone, the menu, or out of sight. */
export type Target = { zone: Zone; index: number } | "menu" | "off";

/**
 * `layout` with `id` moved to `target`. In a zone, `index` counts the
 * zone's buttons without `id` itself and is clamped into it. A pinned button
 * sent to the menu or off stays where it is. A pen as a button sent to
 * either leaves the layout; the last one to go brings the pen back to the
 * bar if it was away (it is pinned again). `layout` is not changed.
 */
export function moveTo(layout: ToolbarLayout, id: BarItemId, target: Target): ToolbarLayout {
  const next = copyLayout(layout);
  if (typeof target === "string" && isPinnedIn(layout, id)) return next;
  for (const zone of ZONES) next[zone] = next[zone].filter((item) => item !== id);
  next.off = next.off.filter((item) => item !== id);
  if (target === "off") {
    if (!isPenSlot(id))
      next.off = BAR_ITEMS.filter((item) => item === id || next.off.includes(item));
  } else if (target !== "menu") {
    const list = next[target.zone];
    const index = Math.max(0, Math.min(list.length, Math.round(target.index)));
    list.splice(index, 0, id);
  }
  restorePinned(next);
  return next;
}

/**
 * `layout` with the pen `slot` on the bar right after the pen's button (or
 * after the last pen as a button, where the pen is away), or taken off it
 * when it is there already (`on` false). Where neither is on the bar, it
 * goes at the start of the middle zone.
 */
export function setPenSlot(layout: ToolbarLayout, slot: PenSlotId, on: boolean): ToolbarLayout {
  const here = placeOf(layout, slot) !== "off";
  if (!on) return here ? moveTo(layout, slot, "off") : copyLayout(layout);
  if (here) return copyLayout(layout);
  const anchors = ["pen" as BarItemId, ...penSlotsOf(layout)];
  let after: { zone: Zone; index: number } | null = null;
  for (const zone of ZONES) {
    layout[zone].forEach((id, index) => {
      if (anchors.includes(id)) after = { zone, index: index + 1 };
    });
  }
  return moveTo(layout, slot, after ?? { zone: "middle", index: 0 });
}

/**
 * `layout` with `id` one place along the bar (`step` -1: toward the start,
 * +1: toward the end), crossing into the next zone at a zone's end; a
 * button already first or last on the bar stays. A button off the bar
 * stays where it is too.
 */
export function stepItem(layout: ToolbarLayout, id: BarItemId, step: -1 | 1): ToolbarLayout {
  const place = placeOf(layout, id);
  if (place === "menu" || place === "off") return copyLayout(layout);
  const at = layout[place].indexOf(id);
  const z = ZONES.indexOf(place);
  if (step < 0 && at > 0) return moveTo(layout, id, { zone: place, index: at - 1 });
  if (step > 0 && at < layout[place].length - 1) {
    return moveTo(layout, id, { zone: place, index: at + 1 });
  }
  const neighbour = ZONES[z + step];
  if (!neighbour) return copyLayout(layout);
  // Into the next zone: at its near end.
  return moveTo(layout, id, { zone: neighbour, index: step < 0 ? layout[neighbour].length : 0 });
}

/**
 * Where a button dropped at `pos` along a zone lands: the number of the
 * zone's buttons (by their middles, `centres`, in order) before it.
 */
export function slotAt(centres: readonly number[], pos: number): number {
  let index = 0;
  while (index < centres.length && centres[index] < pos) index += 1;
  return index;
}

/** Whether two lists hold the same buttons in the same order. */
function sameList(a: readonly BarItemId[], b: readonly BarItemId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Whether two layouts put every button in the same place, in the same order. */
export function sameLayout(a: ToolbarLayout, b: ToolbarLayout): boolean {
  return ZONES.every((zone) => sameList(a[zone], b[zone])) && sameList(a.off, b.off);
}

// --- A button shown nowhere has nothing left on -------------------------------

/** The bar item a tool belongs to: the highlighter and the laser are the pen's. */
export function barItemOfTool(tool: string): BarItemId | null {
  switch (tool) {
    case "select":
    case "eraser":
    case "text":
    case "shape":
    case "pan":
    case "zoom":
    case "tape":
    case "fill":
      return tool;
    case "pen":
    case "highlighter":
    case "laser":
      return "pen";
    default:
      return null;
  }
}

/** What is on in a notebook, of what the bar's items turn on. */
export interface ItemEffects {
  /** The tool in hand. */
  tool: string;
  onlyStylus: boolean;
  rulerOut: boolean;
  recording: boolean;
  /** A sticky note waits to be placed. */
  stickyArmed: boolean;
}

/** Which of `ItemEffects` to end: `pen` puts the pen back in hand. */
export interface EndedEffects {
  pen: boolean;
  onlyStylus: boolean;
  ruler: boolean;
  recording: boolean;
  sticky: boolean;
}

/**
 * The effects to end under `layout` (Joost, 2026-10-30): an item shown
 * nowhere leaves nothing on, since no button would show it or turn it off.
 * A tool of its in hand gives way to the pen; Stylus-only mode goes off,
 * the ruler away, a recording stops (and is saved), a sticky note waiting
 * to be placed is dropped. An item in the More tools menu is still
 * reachable, and keeps its effect.
 */
export function effectsOfOffItems(layout: ToolbarLayout, live: ItemEffects): EndedEffects {
  const off = (id: BarItemId): boolean => layout.off.includes(id);
  const item = barItemOfTool(live.tool);
  return {
    // The pen is out of sight only while other pens are on the bar: the pen
    // in hand is one of theirs, and stays.
    pen: item !== null && item !== "pen" && !isPinned(item) && off(item),
    onlyStylus: live.onlyStylus && off("stylus"),
    ruler: live.rulerOut && off("ruler"),
    recording: live.recording && off("record"),
    sticky: live.stickyArmed && off("sticky"),
  };
}

/**
 * Whether an item is shown nowhere, so nothing (a shortcut, a command) may
 * turn its effect on: it would be on with no button to show it.
 */
export function isItemOff(layout: ToolbarLayout, id: BarItemId): boolean {
  // The pen out of sight still writes: the pens on the bar are its types.
  if (id === "pen" && penSlotsOf(layout).length > 0) return false;
  return layout.off.includes(id);
}

// --- Pens as buttons of their own (FineNotes#211) -------------------------------

/** The pen types on the bar as buttons of their own. */
export function penTypesOnBar(layout: ToolbarLayout): Set<SavedPenType> {
  const types = new Set<SavedPenType>();
  for (const slot of penSlotsOf(layout)) {
    const type = slotPenType(slot);
    if (type) types.add(type);
  }
  return types;
}

/**
 * The pen types the pen's row offers, of `shown` (the user's order, as the
 * row has them): those not on the bar as buttons of their own. None when
 * the type in hand is one of those (its button's pill has no row), or when
 * one type is left, which is then simply what the pen's button is.
 */
export function penRowOffers(
  shown: readonly SavedPenType[],
  onBar: ReadonlySet<SavedPenType>,
  inHand: SavedPenType,
): SavedPenType[] {
  if (onBar.has(inHand)) return [];
  const row = shown.filter((type) => !onBar.has(type));
  return row.length > 1 ? row : [];
}

/**
 * The button the pen in hand belongs to: a saved pen on the bar it draws
 * exactly as (the first, in bar order), else its type's own button, else
 * `null`, the pen's button. `saved` resolves a `saved:` slot's pen.
 */
export function penSlotInHand(
  layout: ToolbarLayout,
  inHand: SavedPen,
  saved: (id: string) => SavedPen | null,
): PenSlotId | null {
  const slots = penSlotsOf(layout);
  for (const slot of slots) {
    const id = slotSavedId(slot);
    const pen = id === null ? null : saved(id);
    if (pen && samePen(pen, inHand)) return slot;
  }
  const own = penTypeSlot(inHand.type);
  return slots.includes(own) ? own : null;
}

/**
 * The pen menu's "Add to toolbar" row: the button the pen in hand is on
 * (`inHand`, from {@link penSlotInHand}), which it offers to take off,
 * else its type's own, which it offers to add. A pinned saved pen is on the
 * bar as `saved:<id>`, never as its type's slot.
 */
export function penMenuPin(
  layout: ToolbarLayout,
  inHand: PenSlotId | null,
  type: SavedPenType,
): { slot: PenSlotId; on: boolean } {
  const slot = inHand ?? penTypeSlot(type);
  return { slot, on: placeOf(layout, slot) !== "off" };
}

/**
 * The pen type the pen's button stands for: the type in hand while it is
 * not on the bar as a button of its own, else the latest it stood for that
 * is still free (`recent`, newest first: the one it stood for a moment ago
 * may be the type just given a button), else the first free type in the
 * user's order. `null` when every type has its own button.
 */
export function penButtonType(
  order: readonly SavedPenType[],
  onBar: ReadonlySet<SavedPenType>,
  inHand: SavedPenType,
  recent: readonly SavedPenType[],
): SavedPenType | null {
  if (!onBar.has(inHand)) return inHand;
  const free = recent.find((type) => !onBar.has(type));
  if (free !== undefined) return free;
  return order.find((type) => !onBar.has(type)) ?? null;
}

/** `recent` with `type` first, each type once, at most as many as there are types. */
export function rememberPenType(
  recent: readonly SavedPenType[],
  type: SavedPenType,
): SavedPenType[] {
  return [type, ...recent.filter((each) => each !== type)].slice(0, 8);
}
