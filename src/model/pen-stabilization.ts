/**
 * Each pen type's stroke stabilization, a percentage, as Goodnotes keeps it
 * per pen (FineNotes discussion #30): how strongly a wobbly hand is steadied
 * while writing (`ink/stroke-builder.ts`, `stabilizationReach`). A pen never
 * set is 0%, off.
 *
 * PURE: plain records in and out; the toolbar holds them, the settings keep
 * them (`penStabilization`).
 */

import { SAVED_PEN_TYPES, type SavedPenType } from "./saved-pens";

/** Each pen type's stabilization, whole percent 1-100; a pen left out is 0%. */
export type PenStabilization = Partial<Record<SavedPenType, number>>;

/** A percentage a file can hold, as a whole 0-100, or null for anything else. */
function percentOf(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * The stabilization a stored value holds. Anything but a record is none; a
 * pen type this build does not know, or a value that is not a number, is
 * dropped; a number out of range is held to 0-100 and rounded, and 0 is
 * left out, as it is the default.
 */
export function penStabilizationOf(raw: unknown): PenStabilization {
  const out: PenStabilization = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const record = raw as Record<string, unknown>;
  for (const type of SAVED_PEN_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(record, type)) continue;
    const percent = percentOf(record[type]);
    if (percent) out[type] = percent;
  }
  return out;
}

/** Pen type `type`'s stabilization, whole percent; 0 when it was never set. */
export function stabilizationOf(all: PenStabilization | undefined, type: SavedPenType): number {
  return percentOf(all?.[type]) ?? 0;
}

/** A copy of `all` with pen type `type` at `percent` (held to 0-100, whole). */
export function withStabilization(
  all: PenStabilization | undefined,
  type: SavedPenType,
  percent: number,
): PenStabilization {
  const out = penStabilizationOf(all);
  const value = percentOf(percent) ?? 0;
  if (value) out[type] = value;
  else delete out[type];
  return out;
}
