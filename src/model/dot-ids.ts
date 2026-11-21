/**
 * Ids made as dots, `<device>.<counter>` (FineNotes#274, `model/provenance`),
 * for a notebook kept as one file per page per device: two devices adding
 * a stroke at once must never make the same id, or the union of their
 * files would take the two strokes for one.
 *
 * Every function that makes a new id (`nextImageId`, `nextPageId`, the
 * surface's stroke ids …) asks {@link mintedId} first. A notebook the view
 * keeps in that layout has a {@link DotClock} attached, and gets a dot; any
 * other notebook gets the id it always did (`s12`, `p3`). The same counter
 * stamps each change (`d`), so an id and a change are never the same dot.
 *
 * Pure: no DOM, no Obsidian.
 */

import { isDeviceId, readDot } from "./provenance";

/** One device's counter in one notebook. */
export class DotClock {
  constructor(
    readonly device: string,
    private counter = 0,
  ) {
    if (!isDeviceId(device)) throw new Error("not a device id");
  }

  /** The highest counter handed out (or seen). */
  get last(): number {
    return this.counter;
  }

  /** A new dot. */
  next(): string {
    this.counter += 1;
    return `${this.device}.${this.counter}`;
  }

  /** Move past every dot of this device in `dots` (ids, changes, a vector's entry); never back. */
  raise(dots: Iterable<unknown>): void {
    for (const text of dots) {
      const dot = readDot(text);
      if (dot && dot.device === this.device && dot.counter > this.counter) {
        this.counter = dot.counter;
      }
    }
  }

  /** Move past a counter of this device (from a version vector). */
  raiseTo(counter: number): void {
    if (Number.isSafeInteger(counter) && counter > this.counter) this.counter = counter;
  }
}

const clocks = new WeakMap<object, DotClock>();

/** Give `doc` (a notebook, or anything holding its pages) the clock its new ids come from. */
export function attachDotClock(doc: object, clock: DotClock): void {
  clocks.set(doc, clock);
}

/** Take the clock off again: new ids are made as they always were. */
export function detachDotClock(doc: object): void {
  clocks.delete(doc);
}

/** The clock attached to `doc`, if any. */
export function dotClockOf(doc: object): DotClock | undefined {
  return clocks.get(doc);
}

/** Every id in a notebook: its pages' and their elements' (any list of things with an id). */
export function* idsIn(doc: { readonly pages: readonly object[] }): Generator<unknown> {
  for (const page of doc.pages) {
    yield (page as { id?: unknown }).id;
    for (const value of Object.values(page)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (typeof item === "object" && item !== null) yield (item as { id?: unknown }).id;
      }
    }
  }
}

/** A new dot for an id in `doc`, or `null` when `doc` has no clock (the id is made as before). */
export function mintedId(doc: object): string | null {
  return clocks.get(doc)?.next() ?? null;
}
