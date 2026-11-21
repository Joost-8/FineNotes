/**
 * Where a change came from, so a merge can tell a stale copy from a real
 * erase (FineNotes#274, research note "Provenance").
 *
 * - A **dot** is `<device>.<counter>`: the device part is made once per
 *   install, the counter counts that device's changes. Element and page ids
 *   made under it are dots, so two devices never make the same id. An id
 *   without a device part (`s12`, `p3`, from before) is of unknown origin.
 * - Every element stores `d`, the dot of its last change.
 * - Every save stores a **version vector** `vv`: for each device, the
 *   highest counter whose changes the copy includes.
 *
 * A copy whose `vv` covers an element's `d` has seen that version of it. If
 * it lacks the element, it erased it; if it holds another version, its own
 * is newer. A copy whose `vv` does not cover `d` simply never got that
 * version, and its absence says nothing.
 *
 * Pure: no DOM, no Obsidian.
 */

/** Characters a device id is made of. It never holds a dot: a dot ends it. */
const DEVICE_ID = /^[a-z0-9-]{1,32}$/;

/** A counter: a whole number from 1, written without leading zeros. */
const COUNTER = /^[1-9][0-9]{0,15}$/;

/** Whether `id` is usable as a device id (and so as a file-name suffix). */
export function isDeviceId(id: unknown): id is string {
  return typeof id === "string" && DEVICE_ID.test(id);
}

/** A dot read: the device that made a change, and its counter there. */
export interface Dot {
  readonly device: string;
  readonly counter: number;
}

/** `<device>.<counter>` read, or `null` when `text` is not a dot (an old id, say). */
export function readDot(text: unknown): Dot | null {
  if (typeof text !== "string") return null;
  const at = text.lastIndexOf(".");
  if (at <= 0) return null;
  const device = text.slice(0, at);
  const digits = text.slice(at + 1);
  if (!isDeviceId(device) || !COUNTER.test(digits)) return null;
  const counter = Number(digits);
  return Number.isSafeInteger(counter) ? { device, counter } : null;
}

/** For each device, the highest counter a copy includes. */
export type VersionVector = Readonly<Record<string, number>>;

/**
 * A stored `vv` made safe: only device ids with whole positive counters.
 * Anything else (absent, an older build's copy) covers nothing.
 */
export function readVersionVector(raw: unknown): VersionVector {
  const vv: Record<string, number> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return vv;
  for (const [device, counter] of Object.entries(raw)) {
    if (isDeviceId(device) && Number.isSafeInteger(counter) && (counter as number) > 0) {
      vv[device] = counter as number;
    }
  }
  return vv;
}

/** Whether a copy with `vv` includes the change `dot`. A missing or foreign dot is never covered. */
export function covers(vv: VersionVector, dot: unknown): boolean {
  const read = readDot(dot);
  if (!read) return false;
  return (vv[read.device] ?? 0) >= read.counter;
}

/** The pointwise maximum: what a copy holding both sides includes. */
export function joinVersionVectors(...vectors: readonly VersionVector[]): VersionVector {
  const out: Record<string, number> = {};
  for (const vv of vectors) {
    for (const [device, counter] of Object.entries(vv)) {
      if (counter > (out[device] ?? 0)) out[device] = counter;
    }
  }
  return out;
}

/** One copy's version of an element: its last change `d`, and the `vv` of the copy it is in. */
export interface Version {
  readonly d: unknown;
  readonly vv: VersionVector;
}

/**
 * Which of two versions of one element is newer: `"a"`, `"b"`, `"same"`
 * (one change) or `"concurrent"` (neither copy saw the other's change).
 * The side whose `d` the other copy's `vv` does not cover is the newer one.
 */
export function newerVersion(a: Version, b: Version): "a" | "b" | "same" | "concurrent" {
  if (typeof a.d === "string" && a.d === b.d) return "same";
  if (a.d === undefined && b.d === undefined) return "same";
  const bSawA = covers(b.vv, a.d);
  const aSawB = covers(a.vv, b.d);
  if (bSawA && !aSawB) return "b";
  if (aSawB && !bSawA) return "a";
  return "concurrent";
}

/**
 * Whether an element in one copy but not another was erased there: the
 * other copy's `vv` covers its `d`, so it saw this version and dropped it.
 * Otherwise the other copy is stale or never got it, and it stays.
 */
export function erasedBy(other: VersionVector, d: unknown): boolean {
  return covers(other, d);
}
