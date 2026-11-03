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

/** Every button the tool bar can show. */
export type BarItemId =
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

/** Every button, in the order the More tools menu and the Hidden shelf give them. */
export const BAR_ITEMS: readonly BarItemId[] = [
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
  start: { across: "Start", upright: "Top" },
  middle: { across: "Middle", upright: "Middle" },
  end: { across: "End", upright: "Bottom" },
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
    start: ["thumbnails", "search", "ai", "calculator", "undo", "redo"],
    middle: ["select", "pen", "eraser", "text", "shape", "image", "pdf", "accessories"],
    end: ["fullscreen", "addPage", "share", "more", "settings"],
    off: [],
  };
}

/** The buttons that never leave the bar, and the zone each goes back to if lost. */
export const PINNED: Readonly<Partial<Record<BarItemId, Zone>>> = {
  pen: "middle",
  accessories: "middle",
  more: "end",
};

/** Whether `id` must stay on the bar. */
export function isPinned(id: BarItemId): boolean {
  return PINNED[id] !== undefined;
}

/** What each button is called, in its tooltip, the menus and edit mode. */
export const BAR_ITEM_LABELS: Record<BarItemId, string> = {
  select: "Lasso",
  pen: "Pen",
  eraser: "Eraser",
  text: "Text",
  shape: "Shapes",
  pan: "Hand",
  zoom: "Magnifier",
  stylus: "Stylus only",
  image: "Image",
  pdf: "PDF",
  sticker: "Stickers",
  sticky: "Sticky notes",
  ruler: "Ruler",
  tape: "Cover tape",
  record: "Record audio",
  fill: "Fill",
  calculator: "Calculator",
  thumbnails: "Page thumbnails",
  search: "Search",
  ai: "AI",
  undo: "Undo",
  redo: "Redo",
  fullscreen: "Full screen",
  addPage: "Add page",
  share: "Export",
  settings: "Notebook settings",
  accessories: "More tools",
  more: "More",
};

/** Each button's icon, in the menus and edit mode as on the bar. */
export const BAR_ITEM_ICONS: Record<BarItemId, string> = {
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

function isBarItem(value: unknown): value is BarItemId {
  return typeof value === "string" && (BAR_ITEMS as readonly string[]).includes(value);
}

/** Known ids from a stored list, each once and not already `taken`, in their order. */
function readList(raw: unknown, taken: Set<BarItemId>): BarItemId[] {
  const out: BarItemId[] = [];
  if (!Array.isArray(raw)) return out;
  for (const value of raw) {
    if (!isBarItem(value) || taken.has(value)) continue;
    taken.add(value);
    out.push(value);
  }
  return out;
}

/** A pinned button that went missing goes back to its zone: the pen first, the rest last. */
function restorePinned(layout: ToolbarLayout): void {
  for (const id of BAR_ITEMS) {
    const zone = PINNED[id];
    if (!zone || ZONES.some((z) => layout[z].includes(id))) continue;
    if (id === "pen") layout[zone].unshift(id);
    else layout[zone].push(id);
  }
}

/**
 * The layout a stored value names: in each zone the known buttons, each
 * once across all of them, in their order; of `off` the known buttons not
 * in a zone and not pinned, in catalogue order; every pinned button on the
 * bar. Anything that is not an object (a new install, a damaged file) is
 * the default layout.
 */
export function normalizeLayout(raw: unknown): ToolbarLayout {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return defaultLayout();
  const stored = raw as Record<string, unknown>;
  const taken = new Set<BarItemId>();
  const layout: ToolbarLayout = {
    start: readList(stored.start, taken),
    middle: readList(stored.middle, taken),
    end: readList(stored.end, taken),
    off: [],
  };
  const off = readList(stored.off, taken);
  layout.off = BAR_ITEMS.filter((id) => off.includes(id) && !isPinned(id));
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

/** Where `id` is in `layout`. */
export function placeOf(layout: ToolbarLayout, id: BarItemId): ItemPlace {
  for (const zone of ZONES) if (layout[zone].includes(id)) return zone;
  return layout.off.includes(id) ? "off" : "menu";
}

/** Every button on the bar, in zone order. */
export function barItems(layout: ToolbarLayout): BarItemId[] {
  return [...layout.start, ...layout.middle, ...layout.end];
}

/** The buttons the More tools menu lists, in catalogue order. */
export function menuItems(layout: ToolbarLayout): BarItemId[] {
  return BAR_ITEMS.filter((id) => placeOf(layout, id) === "menu");
}

/** The buttons shown nowhere, in catalogue order. */
export function offItems(layout: ToolbarLayout): BarItemId[] {
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
 * sent to the menu or off stays where it is. `layout` is not changed.
 */
export function moveTo(layout: ToolbarLayout, id: BarItemId, target: Target): ToolbarLayout {
  const next = copyLayout(layout);
  if (typeof target === "string" && isPinned(id)) return next;
  for (const zone of ZONES) next[zone] = next[zone].filter((item) => item !== id);
  next.off = next.off.filter((item) => item !== id);
  if (target === "off")
    next.off = BAR_ITEMS.filter((item) => item === id || next.off.includes(item));
  else if (target !== "menu") {
    const list = next[target.zone];
    const index = Math.max(0, Math.min(list.length, Math.round(target.index)));
    list.splice(index, 0, id);
  }
  return next;
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
    pen: item !== null && !isPinned(item) && off(item),
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
  return layout.off.includes(id);
}
