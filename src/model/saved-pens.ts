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

import { SIZES } from "../constants";
import { parseHexColor } from "./colors";
import { FINE_PEN_MIN, chosenWidth, widthStops } from "./pen-widths";
import { formatMm, mmToPage, pageToMm } from "./units";

/** The pen types, as `toolbar.ts` names them. */
export const SAVED_PEN_TYPES = ["fountain", "ball", "brush", "calligraphy", "highlighter"] as const;
export type SavedPenType = (typeof SAVED_PEN_TYPES)[number];

/** Each pen type's name, as the toolbar's pen menu shows it. */
export const SAVED_PEN_NAMES: Readonly<Record<SavedPenType, string>> = {
  fountain: "Fountain pen",
  ball: "Ball pen",
  brush: "Brush pen",
  calligraphy: "Calligraphy pen",
  highlighter: "Highlighter",
};

/**
 * Each pen type's multiplier on the chosen width, as `PEN_TYPES` in
 * `toolbar.ts` has it (a test holds the two together): a highlighter is a
 * fat nib, a brush a soft one.
 */
export const SAVED_PEN_SCALE: Readonly<Record<SavedPenType, number>> = {
  fountain: 1,
  ball: 1,
  brush: 1.8,
  calligraphy: 2.6,
  highlighter: 4,
};

/** The thinnest a highlighter goes, page px: the thinnest preset (FineNotes#7). */
export const HIGHLIGHTER_MIN_WIDTH = Math.min(...SIZES);

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
 *
 * The mm are the ink's on the page: with a pen type's multiplier `scale`
 * (a highlighter's 4), typing 4 mm sets the width that draws a 4 mm band.
 * What is stored stays the width before the multiplier, so saved pens and
 * strokes do not change; only the number people see and type does.
 */
export function widthFromMm(text: string, scale = 1): number | null {
  const match = /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(?:mm)?\s*$/i.exec(text);
  if (!match || !(scale > 0)) return null;
  const mm = Number(match[1].replace(",", "."));
  // A slider stop, as the field shows it, reads back as that stop: two
  // decimals of mm through a 1.8x brush would drift 3 to 3.01.
  const shown = mm.toFixed(2);
  const stop = widthStops(SIZES, true).find((w) => mmText(w, scale) === shown);
  if (stop !== undefined) return stop;
  const width = Math.round((mmToPage(mm) / scale) * 100) / 100;
  return isPenWidth(width) ? width : null;
}

/**
 * A width in page px, before the multiplier `scale`, as the mm field shows
 * it: the ink's width on the page, two decimals, no unit.
 */
export function mmText(width: number, scale = 1): string {
  return pageToMm(width * scale).toFixed(2);
}

/**
 * The width a note opens with (settings' "Start with"), as the ink it lays
 * down with the tool it opens with: "0.62 mm" for the pen, four times that
 * for the highlighter. Any other tool opens on the pen's width.
 */
export function defaultWidthText(tool: string, size: number): string {
  const type: SavedPenType = tool === "highlighter" ? "highlighter" : "fountain";
  return formatMm(laidWidth({ type, color: "#000000", size }));
}

/** What a pen is called in a list, by the width of its ink: "Highlighter, 4.10 mm". */
export function savedPenLabel(pen: SavedPen): string {
  return `${SAVED_PEN_NAMES[pen.type]}, ${mmText(pen.size, SAVED_PEN_SCALE[pen.type])} mm`;
}

/**
 * The width a pen lays down on the page, page px, as `strokeWidthFor` in
 * `toolbar.ts` works it out: the chosen width (a highlighter never under
 * its thinnest preset) times the type's multiplier.
 */
export function laidWidth(pen: SavedPen): number {
  const floor = pen.type === "highlighter" ? HIGHLIGHTER_MIN_WIDTH : 0;
  return Math.max(0.5, chosenWidth(pen.size, floor) * SAVED_PEN_SCALE[pen.type]);
}

/**
 * The thickest a pen's sample stroke is drawn, screen px: the settings row's
 * sample and the pen dialog's preview share it, so a pen looks the same in
 * both.
 */
export const SAMPLE_MAX_THICKNESS = 24;

/**
 * How thick a pen's sample stroke is drawn, screen px. One scale for every
 * pen, so the samples compare as the ink does: the widest width a pen can
 * be saved with ({@link MAX_PEN_WIDTH}) fills {@link SAMPLE_MAX_THICKNESS},
 * which is close to the page at fit zoom. The types' multipliers apply on
 * top, so a broad highlighter, brush or calligraphy nib can reach the
 * strip's edge and is drawn at its full height, which still reads as the
 * broadest. Never under 1 px, or the finest pens would not show.
 */
export function sampleThickness(pen: SavedPen): number {
  const px = (laidWidth(pen) * SAMPLE_MAX_THICKNESS) / MAX_PEN_WIDTH;
  return Math.round(Math.max(1, Math.min(SAMPLE_MAX_THICKNESS, px)) * 100) / 100;
}

/**
 * `pen` as a pen of type `type`. A highlighter keeps at least its thinnest
 * preset, so the width the dialog shows is the width it is saved with.
 */
export function withPenType(pen: SavedPen, type: SavedPenType): SavedPen {
  const size = type === "highlighter" ? Math.max(HIGHLIGHTER_MIN_WIDTH, pen.size) : pen.size;
  return { ...pen, type, size };
}

/** The index of another saved pen than the one at `except` that draws as `pen` does, or -1. */
export function duplicateIndex(pens: readonly SavedPen[], pen: SavedPen, except: number): number {
  return pens.findIndex((saved, i) => i !== except && samePen(saved, pen));
}

/**
 * `pens` with `pen` saved: put at `index`, or added at the end when `index`
 * is null. `null` when it cannot be: the list is full, `index` names no
 * saved pen, `pen` is not a valid pen, or another saved pen draws the same.
 */
export function putSavedPen(
  pens: readonly SavedPen[],
  pen: SavedPen,
  index: number | null,
): SavedPen[] | null {
  const valid = savedPenOf(pen);
  if (!valid) return null;
  if (index === null) {
    if (pens.length >= MAX_SAVED_PENS || duplicateIndex(pens, valid, -1) >= 0) return null;
    return [...pens, valid];
  }
  if (index < 0 || index >= pens.length || duplicateIndex(pens, valid, index) >= 0) return null;
  return pens.map((saved, i) => (i === index ? valid : saved));
}

/** What a new pen starts as: the pen last written with, or a black ball pen. */
export function newPenDraft(last: unknown): SavedPen {
  return savedPenOf(last) ?? { type: "ball", color: "#1a1a1a", size: 2 };
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
