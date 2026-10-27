/**
 * Which tools the tool bar shows, in what order, which wait in its
 * accessories menu ("More tools"), and which are hidden altogether: the
 * model behind "Customize toolbar", after Goodnotes' own (Joost's recording,
 * 2026-10-25), in one list rather than its two tabs.
 *
 * Every item has one of three places. The bar's centre holds the items in
 * `bar` order, left to right; the items in `off` are shown nowhere; every
 * other item is hidden from the bar and waits in the accessories menu (the
 * last button of the centre group), in catalogue order. So a layout stored
 * before `off` existed keeps its meaning: what was hidden is in the menu.
 * The pen never leaves the bar: a bar needs a writing tool, and Goodnotes
 * keeps at least one too.
 *
 * PURE: no DOM, no Obsidian.
 */

import { ICON_STYLUS_ONLY } from "../constants";

/** Every item the tool bar's centre can show. */
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
  | "record";

/** Every item, in the order the hidden list and the accessories menu give them. */
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
  "record",
];

/**
 * The bar a new install starts with; the hand, the magnifier, Stylus-only mode,
 * stickers, sticky notes, the ruler and the mic wait in the menu, and nothing
 * is off.
 */
export const DEFAULT_BAR: readonly BarItemId[] = [
  "select",
  "pen",
  "eraser",
  "text",
  "shape",
  "image",
  "pdf",
];

/** The item that can never leave the bar. */
export const ALWAYS_SHOWN: BarItemId = "pen";

/** What each item is called, in the bar's tooltip, the menu and the list. */
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
  record: "Record audio",
};

/** Each item's icon: its bar button's, in the menu and the list too. */
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
  record: "mic",
};

function isBarItem(value: unknown): value is BarItemId {
  return typeof value === "string" && (BAR_ITEMS as readonly string[]).includes(value);
}

/**
 * The shown items a stored value names: known ids, each once, the pen
 * among them (put back first if it went missing). Anything that is not a
 * list (a new install, a damaged file) is the default bar.
 */
export function normalizeBar(raw: unknown): BarItemId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_BAR];
  const shown: BarItemId[] = [];
  for (const value of raw) if (isBarItem(value) && !shown.includes(value)) shown.push(value);
  if (!shown.includes(ALWAYS_SHOWN)) shown.unshift(ALWAYS_SHOWN);
  return shown;
}

/** The items off the bar (in the menu or not shown), in catalogue order. */
export function hiddenItems(shown: readonly BarItemId[]): BarItemId[] {
  return BAR_ITEMS.filter((id) => !shown.includes(id));
}

/** Where an item is: on the bar, in the accessories menu, or not shown at all. */
export type ItemPlace = "bar" | "menu" | "off";

/** Every item's place: the bar, left to right, and the items shown nowhere. */
export interface ToolbarLayout {
  bar: BarItemId[];
  off: BarItemId[];
}

/** A new install's layout: the default bar, the rest in the menu. */
export function defaultLayout(): ToolbarLayout {
  return { bar: [...DEFAULT_BAR], off: [] };
}

/**
 * The layout two stored values name: `bar` as `normalizeBar` reads it, and
 * of `off` the known items that are not on the bar, each once, in catalogue
 * order. The pen is never off. Anything that is not a list is no item off,
 * as a layout stored before there was an "off" means.
 */
export function normalizeLayout(bar: unknown, off: unknown): ToolbarLayout {
  const shown = normalizeBar(bar);
  const listed = Array.isArray(off) ? off : [];
  return {
    bar: shown,
    off: BAR_ITEMS.filter((id) => listed.includes(id) && !shown.includes(id)),
  };
}

/** Where `id` is in `layout`. */
export function placeOf(layout: ToolbarLayout, id: BarItemId): ItemPlace {
  if (layout.bar.includes(id)) return "bar";
  return layout.off.includes(id) ? "off" : "menu";
}

/** The items the accessories menu lists, in catalogue order. */
export function menuItems(layout: ToolbarLayout): BarItemId[] {
  return BAR_ITEMS.filter((id) => placeOf(layout, id) === "menu");
}

/**
 * `layout` with `id` moved to `place`. An item put on the bar goes to its
 * right end, where Goodnotes adds it; one already there keeps its place. The
 * pen stays on the bar.
 */
export function placeItem(layout: ToolbarLayout, id: BarItemId, place: ItemPlace): ToolbarLayout {
  if (id === ALWAYS_SHOWN || placeOf(layout, id) === place) {
    return { bar: [...layout.bar], off: [...layout.off] };
  }
  const bar = layout.bar.filter((item) => item !== id);
  const off = layout.off.filter((item) => item !== id);
  if (place === "bar") bar.push(id);
  if (place === "off") off.push(id);
  return { bar, off: BAR_ITEMS.filter((item) => off.includes(item)) };
}

/** `shown` with the item at `from` moved to `to` (both clamped into the list). */
export function moveItem(shown: readonly BarItemId[], from: number, to: number): BarItemId[] {
  const next = [...shown];
  if (next.length === 0) return next;
  const a = Math.max(0, Math.min(next.length - 1, Math.round(from)));
  const b = Math.max(0, Math.min(next.length - 1, Math.round(to)));
  const [item] = next.splice(a, 1);
  next.splice(b, 0, item);
  return next;
}

/**
 * Where a row dragged in a list of `rows` rows of `rowHeight` px lands, its
 * middle `offset` px below the list's top: the index its middle is over.
 */
export function dropIndex(offset: number, rowHeight: number, rows: number): number {
  if (!(rowHeight > 0) || rows <= 0) return 0;
  return Math.max(0, Math.min(rows - 1, Math.floor(offset / rowHeight)));
}

/** Whether two bars show the same items in the same order. */
export function sameBar(a: readonly BarItemId[], b: readonly BarItemId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Whether two layouts put every item in the same place, the bar in the same order. */
export function sameLayout(a: ToolbarLayout, b: ToolbarLayout): boolean {
  return sameBar(a.bar, b.bar) && sameBar(a.off, b.off);
}
