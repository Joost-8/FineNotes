/**
 * Each pen type's own ink: the colour it writes with, its row of colours in
 * the pen pill, and its width. Switching from the fountain pen to the
 * highlighter and back brings each one's colours and width back, as
 * GoodNotes keeps them per pen.
 *
 * PURE: plain records in and out; the toolbar holds them, the settings keep
 * them (`penInks`).
 */

import { parseHexColor } from "./colors";
import { SAVED_PEN_TYPES, type SavedPenType } from "./saved-pens";

/** A pen type's ink: the colour in hand, its pill row's picked colours, and its width. */
export interface PenInk {
  color: string;
  /** The row's picked slots (`ToolbarState.penColors`); absent: the built-in palette. */
  colors?: string[];
  /**
   * The width chosen for it (`ToolbarState.size`, before the pen type's own
   * multiplier), page px. Absent on inks saved before widths were kept per
   * pen: such a pen takes the width in hand.
   */
  size?: number;
}

/** Every pen type's ink, as far as it has been used. */
export type PenInks = Partial<Record<SavedPenType, PenInk>>;

/** A highlighter that was never used starts yellow, as in GoodNotes. */
export const FIRST_HIGHLIGHTER_COLOR = "#fab005";

/** The most colours a row keeps; more than a pill shows, fewer than a file can hold. */
const MAX_ROW = 16;

/** A width a file can hold: a finite positive number; anything else is none. */
function sizeOf(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/** A copy of `ink`, its row copied too, with only the keys it has. */
function copyInk(ink: PenInk, color = ink.color): PenInk {
  const out: PenInk = { color };
  if (ink.colors) out.colors = [...ink.colors];
  if (ink.size !== undefined) out.size = ink.size;
  return out;
}

function colorsOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const value of raw) {
    const color = typeof value === "string" ? parseHexColor(value) : null;
    if (color && !out.includes(color)) out.push(color);
    if (out.length === MAX_ROW) break;
  }
  return out;
}

/**
 * The pen inks a stored value holds. Anything but a record is none; a pen
 * type this build does not know, or an entry without a readable colour, is
 * dropped; colours are normalised to `#rrggbb`.
 */
export function penInksOf(raw: unknown): PenInks {
  const out: PenInks = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const record = raw as Record<string, unknown>;
  for (const type of SAVED_PEN_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(record, type)) continue;
    const entry = record[type];
    if (typeof entry !== "object" || entry === null) continue;
    const { color, colors, size } = entry as Record<string, unknown>;
    const parsed = typeof color === "string" ? parseHexColor(color) : null;
    if (!parsed) continue;
    const ink: PenInk = { color: parsed };
    const row = colorsOf(colors);
    if (row) ink.colors = row;
    const width = sizeOf(size);
    if (width !== undefined) ink.size = width;
    out[type] = ink;
  }
  return out;
}

/** `inks` with `type`'s ink set to `ink`, a copy. */
export function withPenInk(inks: PenInks, type: SavedPenType, ink: PenInk): PenInks {
  return { ...inks, [type]: copyInk(ink) };
}

/**
 * The ink `type` writes with: its own if it has been used, else `current`
 * (the pen in hand's), except that a highlighter starts yellow. An own ink
 * saved without a width takes the width in hand.
 */
export function penInkFor(inks: PenInks, type: SavedPenType, current: PenInk): PenInk {
  const own = inks[type];
  if (own) {
    const ink = copyInk(own);
    if (ink.size === undefined && current.size !== undefined) ink.size = current.size;
    return ink;
  }
  return copyInk(current, type === "highlighter" ? FIRST_HIGHLIGHTER_COLOR : current.color);
}

/**
 * Switch from pen type `from` to `to`: `from` keeps the ink it was writing
 * with (`current`), and `to` brings back its own. Returns the new inks and the
 * ink now in hand. The same type twice changes nothing.
 */
export function switchPenInk(
  inks: PenInks,
  from: SavedPenType,
  to: SavedPenType,
  current: PenInk,
): { inks: PenInks; ink: PenInk } {
  if (from === to) return { inks, ink: current };
  const kept = withPenInk(inks, from, current);
  return { inks: kept, ink: penInkFor(kept, to, current) };
}
