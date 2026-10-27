/**
 * Which tools the tool bar shows, in what order, and which wait in its
 * accessories menu: the model behind "Customize toolbar", after Goodnotes'
 * own (Joost's recording, 2026-10-25), in one list rather than its two tabs.
 *
 * The bar's centre holds the items in `shown` order, left to right; every
 * other item is hidden, and the accessories menu (the last button of the
 * centre group) lists the hidden ones in catalogue order. The pen never
 * hides: a bar needs a writing tool, and Goodnotes keeps at least one too.
 *
 * PURE: no DOM, no Obsidian.
 */

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
 * The bar a new install starts with; the hand, the magnifier, Only stylus mode,
 * stickers, sticky notes, the ruler and the mic wait in the menu.
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

/** The item that can never be hidden. */
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
  stylus: "Only stylus mode",
  image: "Image",
  pdf: "PDF",
  sticker: "Stickers",
  sticky: "Sticky notes",
  ruler: "Ruler",
  record: "Record audio",
};

/** Each item's Lucide icon: its bar button's, in the menu and the list too. */
export const BAR_ITEM_ICONS: Record<BarItemId, string> = {
  select: "lasso",
  pen: "pen-tool",
  eraser: "eraser",
  text: "type",
  shape: "shapes",
  pan: "hand",
  zoom: "zoom-in",
  stylus: "tablet",
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

/** The hidden items, in catalogue order. */
export function hiddenItems(shown: readonly BarItemId[]): BarItemId[] {
  return BAR_ITEMS.filter((id) => !shown.includes(id));
}

/** `shown` without `id`; the pen stays. */
export function hideItem(shown: readonly BarItemId[], id: BarItemId): BarItemId[] {
  if (id === ALWAYS_SHOWN) return [...shown];
  return shown.filter((item) => item !== id);
}

/** `shown` with `id` added at the right end, where Goodnotes adds it. */
export function showItem(shown: readonly BarItemId[], id: BarItemId): BarItemId[] {
  return shown.includes(id) ? [...shown] : [...shown, id];
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
