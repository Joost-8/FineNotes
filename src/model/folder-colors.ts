/**
 * The colours a folder can be given in the Folders sidebar: five from the
 * palette, the ones the person used lately, and any hex colour. No Obsidian,
 * no DOM.
 */

export interface PaletteColor {
  /** Which colour: names its translated label (`view.folders.color.<id>`). */
  id: "rose" | "amber" | "moss" | "tide" | "plum";
  color: string;
}

/** The palette offered first, in this order. */
export const FOLDER_PALETTE: readonly PaletteColor[] = [
  { id: "rose", color: "#c4566f" },
  { id: "amber", color: "#c28a2c" },
  { id: "moss", color: "#6a8f57" },
  { id: "tide", color: "#3d8c99" },
  { id: "plum", color: "#8660a8" },
];

/** What the custom colour field starts at when the folder has no colour. */
export const DEFAULT_CUSTOM_COLOR = "#3d8c99";

/** How many of the last-used folders are kept. */
export const MAX_RECENT_FOLDERS = 10;
/** How many recent folders show under the pinned ones. */
export const MAX_RECENT_SHOWN = 3;
/** How many of the person's own colours are kept. */
export const MAX_RECENT_COLORS = 6;

/** A random colour of the palette. */
export function randomPaletteColor(random: () => number = Math.random): string {
  const pick = Math.floor(random() * FOLDER_PALETTE.length);
  return (FOLDER_PALETTE[pick] ?? FOLDER_PALETTE[0]).color;
}

/** Whether `color` is a palette colour (those are not kept in "Your colors"). */
export function isPaletteColor(color: string): boolean {
  return FOLDER_PALETTE.some((entry) => entry.color === color);
}

/** Whether `text` is a #rgb or #rrggbb colour. */
export function isHexColor(text: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text);
}

/** A hex colour as #rrggbb in lower case (#rgb is spelled out); other text trimmed and lower-cased. */
export function normalizeHex(text: string): string {
  const color = text.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(color);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : color;
}

/** What was typed in the hex field, with the # it may have left out. */
export function typedHex(text: string): string {
  const typed = text.trim();
  return typed.startsWith("#") ? typed : `#${typed}`;
}

/** `value` first in `list`, once, and no more than `max` long. */
export function pushFront(list: readonly string[], value: string, max: number): string[] {
  return [value, ...list.filter((entry) => entry !== value)].slice(0, max);
}
