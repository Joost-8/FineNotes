/**
 * An open notebook whose file changed on disk (FineNotes#273): what to show.
 *
 * Obsidian reads the file again whenever the vault reports it modified (a
 * sync landing, another app, or a stale read of this view's own save) and
 * hands the text to `setViewData`. Since 2.10.0 the notebook view is not
 * plain text to Obsidian (FineNotes#246), so Obsidian no longer merges a
 * change into the view's unsaved text: it replaces it. Taken as it is, that
 * drops every stroke written since the last save, and the undo history with
 * it. Two things stop that:
 *
 * - {@link OwnTexts}: a read that only brings back a text this view loaded
 *   or wrote itself has nothing new in it. Obsidian's `loadFileInternal`
 *   compares what it read with `lastSavedData` only after the read resolves,
 *   so a save that starts during the read makes the view's own previous save
 *   look like a change from elsewhere.
 * - {@link mergeReload}: a real change from elsewhere is merged with this
 *   view's unsaved changes, three ways, by id. Pages and the elements on them
 *   (strokes, text boxes, images, …) that either side added are kept; one
 *   that a side removed goes unless the other side changed it; a change on
 *   one side only is taken; a change on both sides keeps this device's.
 *
 * All three notebooks are compared as stored (each decoded from a file's
 * text), so runtime-only state never looks like a change.
 *
 * No DOM, no Obsidian.
 */

import type { InkDocument } from "./document";

/** How many of its own texts a view remembers. */
const OWN_TEXTS_MAX = 3;

/**
 * The texts a view loaded or wrote most recently, newest last. A read equal
 * to one of them holds nothing the view has not had.
 */
export class OwnTexts {
  private readonly texts: string[] = [];

  /** This text was loaded from the file, or written to it. */
  note(text: string): void {
    const at = this.texts.indexOf(text);
    if (at >= 0) this.texts.splice(at, 1);
    this.texts.push(text);
    if (this.texts.length > OWN_TEXTS_MAX) this.texts.shift();
  }

  /** Whether `text` is one this view loaded or wrote. */
  has(text: string): boolean {
    return this.texts.includes(text);
  }

  /** Another file, or none: nothing is known. */
  forget(): void {
    this.texts.length = 0;
  }
}

/** The result of {@link mergeReload}. */
export interface ReloadMerge {
  /** The notebook to show: the one on disk, with this view's changes carried onto it. */
  doc: InkDocument;
  /**
   * How many pages, and elements on pages the file also has, are in `doc`
   * but not in the file: what a plain reload would have dropped.
   */
  carried: number;
}

/** A JSON value, as a stored notebook is made of. */
type Json = unknown;

/** An object with a string `id`, as pages and every page element are. */
type WithId = { id: string } & Record<string, unknown>;

/**
 * Merge `remote` (the file as it is on disk now) with `local` (this view's
 * notebook), both descended from `base` (the text this view last loaded or
 * wrote). The three are not changed; the result shares no objects with
 * `base`, but may share them with `local` and `remote`.
 */
export function mergeReload(
  base: InkDocument,
  local: InkDocument,
  remote: InkDocument,
): ReloadMerge {
  const json = new WeakMap<object, string>();
  const same = (a: Json, b: Json): boolean => {
    if (a === b) return true;
    if (a === undefined || b === undefined) return false;
    return stringify(a, json) === stringify(b, json);
  };
  const doc = merge3(base, local, remote, same) as InkDocument;
  return { doc, carried: missingFrom(doc, remote) };
}

/** Pages of `doc` that `remote` lacks, and elements on the others that its page lacks. */
function missingFrom(doc: InkDocument, remote: InkDocument): number {
  const theirs = new Map(remote.pages.map((page) => [page.id, page]));
  let missing = 0;
  for (const page of doc.pages) {
    const other = theirs.get(page.id) as Record<string, Json> | undefined;
    if (!other) {
      missing++;
      continue;
    }
    for (const [key, value] of Object.entries(page as unknown as Record<string, Json>)) {
      if (!isIdList(value)) continue;
      const list = other[key];
      const ids = new Set(isIdList(list) ? list.map((item) => item.id) : []);
      missing += value.filter((item) => !ids.has(item.id)).length;
    }
  }
  return missing;
}

function stringify(value: Json, cache: WeakMap<object, string>): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "undefined";
  const known = cache.get(value);
  if (known !== undefined) return known;
  const text = JSON.stringify(value);
  cache.set(value, text);
  return text;
}

function merge3(base: Json, local: Json, remote: Json, same: (a: Json, b: Json) => boolean): Json {
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  if (isIdList(local) && isIdList(remote) && (base === undefined || isIdList(base))) {
    return mergeById(base ?? [], local, remote, same);
  }
  if (isRecord(local) && isRecord(remote) && (base === undefined || isRecord(base))) {
    const merged: Record<string, Json> = {};
    const from = base ?? {};
    // The local key order first, so a merged object stores like a local one.
    for (const key of unionKeys(local, remote)) {
      const value = merge3(from[key], local[key], remote[key], same);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  // Changed on both sides, and not something to look inside: this device's.
  return local;
}

/**
 * Three lists of things with ids, merged. Remote's order, with what only
 * local has placed after the item it follows locally. An id can repeat in a
 * file, so the n-th item with an id is matched with the n-th on each side.
 */
function mergeById(
  base: readonly WithId[],
  local: readonly WithId[],
  remote: readonly WithId[],
  same: (a: Json, b: Json) => boolean,
): WithId[] {
  const baseBy = byKey(base);
  const localBy = byKey(local);
  const remoteBy = byKey(remote);
  const out: { key: string; value: WithId }[] = [];

  for (const [key, theirs] of remoteBy) {
    const ours = localBy.get(key);
    const was = baseBy.get(key);
    if (ours === undefined) {
      // Removed here: it goes, unless it was changed (or added) over there.
      if (was === undefined || !same(theirs, was)) out.push({ key, value: theirs });
      continue;
    }
    out.push({ key, value: merge3(was, ours, theirs, same) as WithId });
  }

  // What only this side has: added here, or removed over there.
  let previous: string | null = null;
  for (const [key, ours] of localBy) {
    if (remoteBy.has(key)) {
      previous = key;
      continue;
    }
    const was = baseBy.get(key);
    // Removed over there and untouched here: it goes.
    if (was !== undefined && same(ours, was)) continue;
    const after = previous === null ? -1 : out.findIndex((item) => item.key === previous);
    out.splice(after + 1, 0, { key, value: ours });
    previous = key;
  }
  return out.map((item) => item.value);
}

/** Items by `id#n`, n counting the items before it with the same id. */
function byKey(items: readonly WithId[]): Map<string, WithId> {
  const seen = new Map<string, number>();
  const map = new Map<string, WithId>();
  for (const item of items) {
    const n = seen.get(item.id) ?? 0;
    seen.set(item.id, n + 1);
    map.set(`${item.id}#${n}`, item);
  }
  return map;
}

function unionKeys(a: Record<string, Json>, b: Record<string, Json>): string[] {
  const keys = Object.keys(a);
  for (const key of Object.keys(b)) if (!(key in a)) keys.push(key);
  return keys;
}

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdList(value: Json): value is WithId[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isRecord(item) && typeof item.id === "string" && item.id.length > 0)
  );
}
