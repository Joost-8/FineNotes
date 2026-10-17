/**
 * Saved pens (FineNotes#24, #25): up to eight presets, each a pen type, a
 * colour and a width, picked from the toolbar's favourites or with the keys
 * 1 to 8, as in Stylus Labs Write. And the pen last written with, which a
 * notebook opens with, in every notebook and after a restart.
 *
 * Both live in the plugin's settings, which sync between devices and may
 * hold anything an older or newer build wrote, so every read goes through
 * {@link savedPenOf} or {@link savedPensOf}.
 *
 * Pure: no DOM, no Obsidian.
 */

import { parseHexColor } from "./colors";
import { FINE_PEN_MIN } from "./pen-widths";
import { mmToPage, pageToMm } from "./units";

/** The pen types, as `toolbar.ts` names them. */
export const SAVED_PEN_TYPES = ["fountain", "ball", "brush", "calligraphy", "highlighter"] as const;
export type SavedPenType = (typeof SAVED_PEN_TYPES)[number];

/** A pen: its type, its ink as `#rrggbb`, and its width in page px before the type's multiplier. */
export interface SavedPen {
  type: SavedPenType;
  color: string;
  size: number;
}

/** How many saved pens there can be: one per number key, 1 to 8. */
export const MAX_SAVED_PENS = 8;

/**
 * The widest width that can be typed in, in mm. The presets stop at 12 page
 * px (2.5 mm); a highlighter is drawn four times its width, so 5 mm is a
 * very fat marker already.
 */
export const MAX_PEN_MM = 5;

/** The widest width, in page px. */
export const MAX_PEN_WIDTH = Math.round(mmToPage(MAX_PEN_MM) * 100) / 100;

/**
 * The saved pens a fresh install has, as the issue asked: 1 blue, 2 red,
 * 3 green, 4 a second blue, broader, and 8 a highlighter. The widths are
 * presets (`SIZES`): 2 page px is 0.41 mm, the issue's own "default stroke".
 */
export const DEFAULT_SAVED_PENS: readonly SavedPen[] = [
  { type: "ball", color: "#1971c2", size: 2 },
  { type: "ball", color: "#e03131", size: 2 },
  { type: "ball", color: "#2f9e44", size: 2 },
  { type: "fountain", color: "#1971c2", size: 5 },
  { type: "fountain", color: "#1a1a1a", size: 3 },
  { type: "ball", color: "#1a1a1a", size: 1.22 },
  { type: "brush", color: "#9c36b5", size: 3 },
  { type: "highlighter", color: "#fab005", size: 5 },
];

/** A fresh copy of the default saved pens, for the settings' defaults. */
export function defaultSavedPens(): SavedPen[] {
  return DEFAULT_SAVED_PENS.map((pen) => ({ ...pen }));
}

function isPenType(value: unknown): value is SavedPenType {
  return (SAVED_PEN_TYPES as readonly unknown[]).includes(value);
}

/** Whether `size` is a width a pen can be saved with, page px. */
export function isPenWidth(size: unknown): size is number {
  return (
    typeof size === "number" &&
    Number.isFinite(size) &&
    size >= FINE_PEN_MIN - 1e-9 &&
    size <= MAX_PEN_WIDTH + 1e-9
  );
}

/** A stored pen as a pen, or `null` when it is not one. The colour comes back as `#rrggbb`. */
export function savedPenOf(value: unknown): SavedPen | null {
  if (typeof value !== "object" || value === null) return null;
  const { type, color, size } = value as Record<string, unknown>;
  if (!isPenType(type) || typeof color !== "string" || !isPenWidth(size)) return null;
  const hex = parseHexColor(color);
  return hex ? { type, color: hex, size } : null;
}

/**
 * The stored saved pens as a list: what is not a pen is left out, and only
 * the first eight count. Anything but a list (a vault from before saved
 * pens) is the defaults; an empty list stays empty, since the user deleted
 * them.
 */
export function savedPensOf(value: unknown): SavedPen[] {
  if (!Array.isArray(value)) return defaultSavedPens();
  const pens: SavedPen[] = [];
  for (const item of value) {
    const pen = savedPenOf(item);
    if (pen) pens.push(pen);
    if (pens.length === MAX_SAVED_PENS) break;
  }
  return pens;
}

/** Whether two pens draw the same: type, colour (any case) and width. */
export function samePen(a: SavedPen, b: SavedPen): boolean {
  return (
    a.type === b.type &&
    a.color.toLowerCase() === b.color.toLowerCase() &&
    Math.abs(a.size - b.size) < 0.005
  );
}

/** The index of the saved pen that is `pen`, or -1. */
export function savedPenIndex(pens: readonly SavedPen[], pen: SavedPen): number {
  return pens.findIndex((saved) => samePen(saved, pen));
}

/** `pens` with `pen` added at the end; unchanged when it is full or `pen` is saved already. */
export function addSavedPen(pens: readonly SavedPen[], pen: SavedPen): SavedPen[] {
  if (pens.length >= MAX_SAVED_PENS || savedPenIndex(pens, pen) >= 0) return [...pens];
  return [...pens, { ...pen }];
}

/** `pens` without the one at `index`. */
export function removeSavedPen(pens: readonly SavedPen[], index: number): SavedPen[] {
  return pens.filter((_, i) => i !== index);
}

/** `pens` with the one at `index` moved by `step` (−1 up, +1 down); unchanged at either end. */
export function moveSavedPen(pens: readonly SavedPen[], index: number, step: number): SavedPen[] {
  const to = index + step;
  const moved = [...pens];
  if (index < 0 || index >= pens.length || to < 0 || to >= pens.length) return moved;
  [moved[index], moved[to]] = [moved[to], moved[index]];
  return moved;
}

/** `pens` with the one at `index` changed by `patch`, as far as the patch is a valid pen. */
export function editSavedPen(
  pens: readonly SavedPen[],
  index: number,
  patch: Partial<SavedPen>,
): SavedPen[] {
  return pens.map((pen, i) => (i === index ? (savedPenOf({ ...pen, ...patch }) ?? pen) : pen));
}

/**
 * A width typed in mm (`0.3`, `0,3`, `0.3 mm`) as page px to a hundredth,
 * as a stroke stores it; `null` while the text is not a width between the
 * thinnest pen and {@link MAX_PEN_MM}. Out of range is refused rather than
 * clamped: a clamped number would be a width nobody typed.
 */
export function widthFromMm(text: string): number | null {
  const match = /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(?:mm)?\s*$/i.exec(text);
  if (!match) return null;
  const mm = Number(match[1].replace(",", "."));
  const width = Math.round(mmToPage(mm) * 100) / 100;
  return isPenWidth(width) ? width : null;
}

/** A width in page px as the mm field shows it: two decimals, no unit. */
export function mmText(width: number): string {
  return pageToMm(width).toFixed(2);
}

/** What a pen is called in a list: "Ball pen, 0.41 mm". */
export function savedPenLabel(pen: SavedPen): string {
  const names: Record<SavedPenType, string> = {
    fountain: "Fountain pen",
    ball: "Ball pen",
    brush: "Brush pen",
    calligraphy: "Calligraphy pen",
    highlighter: "Highlighter",
  };
  return `${names[pen.type]}, ${mmText(pen.size)} mm`;
}

/**
 * The tool a notebook opens with when the settings' default tool is
 * `defaultTool` and the pen last written with was `last`: a pen or
 * highlighter default becomes whichever of the two the last pen was, so a
 * notebook opens with the pen put down; any other tool is kept.
 */
export function openingTool<T extends string>(
  defaultTool: T,
  last: SavedPen | null,
): T | "pen" | "highlighter" {
  if (!last || (defaultTool !== "pen" && defaultTool !== "highlighter")) return defaultTool;
  return last.type === "highlighter" ? "highlighter" : "pen";
}
