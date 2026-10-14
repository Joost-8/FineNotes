/**
 * Each pen type's own ink: the colour it writes with and its row of colours
 * in the pen pill. Switching from the fountain pen to the highlighter and
 * back brings each one's colours back, as GoodNotes keeps them per pen.
 *
 * PURE: plain records in and out; the toolbar holds them, the settings keep
 * them (`penInks`).
 */

import { parseHexColor } from "./colors";
import { SAVED_PEN_TYPES, type SavedPenType } from "./saved-pens";

/** A pen type's ink: the colour in hand, and its pill row's picked colours. */
export interface PenInk {
  color: string;
  /** The row's picked slots (`ToolbarState.penColors`); absent: the built-in palette. */
  colors?: string[];
}

/** Every pen type's ink, as far as it has been used. */
export type PenInks = Partial<Record<SavedPenType, PenInk>>;

/** A highlighter that was never used starts yellow, as in GoodNotes. */
export const FIRST_HIGHLIGHTER_COLOR = "#fab005";

/** The most colours a row keeps; more than a pill shows, fewer than a file can hold. */
const MAX_ROW = 16;

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
    const { color, colors } = entry as Record<string, unknown>;
    const parsed = typeof color === "string" ? parseHexColor(color) : null;
    if (!parsed) continue;
    const row = colorsOf(colors);
    out[type] = row ? { color: parsed, colors: row } : { color: parsed };
  }
  return out;
}

/** `inks` with `type`'s ink set to `ink`, a copy. */
export function withPenInk(inks: PenInks, type: SavedPenType, ink: PenInk): PenInks {
  const copy: PenInk = ink.colors
    ? { color: ink.color, colors: [...ink.colors] }
    : { color: ink.color };
  return { ...inks, [type]: copy };
}

/**
 * The ink `type` writes with: its own if it has been used, else `current`
 * (the pen in hand's), except that a highlighter starts yellow.
 */
export function penInkFor(inks: PenInks, type: SavedPenType, current: PenInk): PenInk {
  const own = inks[type];
  if (own) return own.colors ? { color: own.color, colors: [...own.colors] } : { color: own.color };
  const colors = current.colors ? [...current.colors] : undefined;
  const color = type === "highlighter" ? FIRST_HIGHLIGHTER_COLOR : current.color;
  return colors ? { color, colors } : { color };
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
