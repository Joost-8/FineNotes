/**
 * The width presets (FineNotes#210, #211): each pen type keeps three widths
 * of its own, and the eraser three sizes. Picking a preset and moving the
 * slider (or typing a width) changes that preset and nothing else; the
 * others keep theirs. A reset puts a pen type's presets back to the
 * defaults.
 *
 * Which preset is chosen is not stored: it is the one holding the width in
 * hand, and the toolbar's last pick decides between two that hold the same
 * width. A width in hand that no preset holds (a saved pen's, say) leaves
 * none chosen, and the slider then changes only the width in hand.
 *
 * The settings sync between devices and may hold anything an older or newer
 * build wrote, so every read goes through {@link widthPresetsOf} or
 * {@link eraserPresetsOf}; a value they cannot use is the defaults.
 *
 * Pure: no DOM, no Obsidian.
 */

import { ERASER_SIZES, SIZES } from "../constants";
import { ERASER_MAX_SIZE, ERASER_MIN_SIZE } from "./eraser-sizes";
import { SAVED_PEN_TYPES, type SavedPenType, isPenWidth } from "./saved-pens";

/** How many presets a pen type and the eraser keep: the pill's quick picks. */
export const PRESET_COUNT = 3;

/** Every pen type's presets until it is given its own, page px. */
export const DEFAULT_WIDTH_PRESETS: readonly number[] = SIZES.slice(0, PRESET_COUNT);

/** The eraser's presets until they are changed, page px. */
export const DEFAULT_ERASER_PRESETS: readonly number[] = [...ERASER_SIZES];

/** Each pen type's own presets, for the types that have been given any. */
export type WidthPresets = Partial<Record<SavedPenType, number[]>>;

/** Two widths the same preset could hold: equal to a ten-thousandth of a px. */
function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-4;
}

/** `raw` as exactly {@link PRESET_COUNT} widths each passing `ok`, or `null`. */
function listOf(raw: unknown, ok: (value: unknown) => value is number): number[] | null {
  if (!Array.isArray(raw) || raw.length !== PRESET_COUNT) return null;
  return raw.every(ok) ? [...raw] : null;
}

/**
 * The presets a stored value holds. Anything but a record is none; a pen
 * type this build does not know, or a list that is not three pen widths, is
 * dropped (that type has the defaults).
 */
export function widthPresetsOf(raw: unknown): WidthPresets {
  const out: WidthPresets = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const record = raw as Record<string, unknown>;
  for (const type of SAVED_PEN_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(record, type)) continue;
    const list = listOf(record[type], isPenWidth);
    if (list) out[type] = list;
  }
  return out;
}

/** `type`'s presets: its own, else the defaults. A copy. */
export function presetsFor(all: WidthPresets, type: SavedPenType): number[] {
  return [...(all[type] ?? DEFAULT_WIDTH_PRESETS)];
}

/**
 * `all` with `type`'s preset `slot` set to `width`, a copy. A slot that is
 * not one, or a width no pen can have, changes nothing.
 */
export function withWidthPreset(
  all: WidthPresets,
  type: SavedPenType,
  slot: number,
  width: number,
): WidthPresets {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PRESET_COUNT || !isPenWidth(width)) {
    return { ...all };
  }
  const list = presetsFor(all, type);
  list[slot] = width;
  return { ...all, [type]: list };
}

/** `all` with `type` back on the defaults, a copy. */
export function withoutWidthPresets(all: WidthPresets, type: SavedPenType): WidthPresets {
  const out = { ...all };
  delete out[type];
  return out;
}

/** Whether `size` is an eraser size the slider can reach. */
function isEraserSize(size: unknown): size is number {
  return (
    typeof size === "number" &&
    Number.isFinite(size) &&
    size >= ERASER_MIN_SIZE &&
    size <= ERASER_MAX_SIZE
  );
}

/** The eraser presets a stored value holds: three sizes in the slider's range, else the defaults. */
export function eraserPresetsOf(raw: unknown): number[] {
  return listOf(raw, isEraserSize) ?? [...DEFAULT_ERASER_PRESETS];
}

/** `presets` with `slot` set to `size`, a copy; a slot or size that is not one changes nothing. */
export function withEraserPreset(presets: readonly number[], slot: number, size: number): number[] {
  const out = [...presets];
  if (Number.isInteger(slot) && slot >= 0 && slot < out.length && isEraserSize(size)) {
    out[slot] = size;
  }
  return out;
}

/**
 * The chosen preset: `hint` (the last one picked) while it still holds
 * `value`, else the first that does, else `null`, none.
 */
export function chosenSlot(
  presets: readonly number[],
  value: number,
  hint: number | null = null,
): number | null {
  if (hint !== null && hint >= 0 && hint < presets.length && same(presets[hint], value)) {
    return hint;
  }
  const index = presets.findIndex((preset) => same(preset, value));
  return index >= 0 ? index : null;
}
