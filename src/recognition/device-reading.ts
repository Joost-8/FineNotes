/**
 * Which page the on-device recogniser reads next, for search and the text
 * layer: the page being read first, then the rest in order. A page is read
 * when it has ink and its text layer entry is missing, or is a device
 * reading of what the page was before. A transcription is never replaced,
 * not even an out-of-date one: it reads better than the device does, and
 * transcribing again brings it up to date. A device reading of a page whose
 * ink has gone is cleared.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Page } from "../model/document";

/** What to do next: read a page, clear its device reading, or nothing. */
export type DeviceStep =
  | { kind: "read"; page: Page; key: string; hash: string }
  | { kind: "clear"; page: Page; key: string };

export interface DeviceReadingState {
  pages: readonly Page[];
  /** Each page's key (`pageKeys`). */
  keys: readonly string[];
  /** The text layer's entries by key (`transcriptSources`). */
  entries: ReadonlyMap<string, { hash: string; device: boolean }>;
  /** Each page's content hash now (`pageContentHash`). */
  hashOf: (page: Page) => string;
  /** Pages read already in this session, by key, at the hash they were read at. */
  read: ReadonlyMap<string, string>;
  /** The page being read: it goes first. */
  current: number;
}

/** Whether a page has ink the recogniser reads: pen strokes and shapes, not highlighter. */
export function hasReadableInk(page: Page): boolean {
  return page.strokes.some((stroke) => stroke.tool !== "highlighter");
}

/** The next thing to do, or null when every page is up to date. */
export function nextDeviceStep(state: DeviceReadingState): DeviceStep | null {
  const { pages, keys, entries, hashOf, read, current } = state;
  const order = pages.map((_, i) => i);
  if (current > 0 && current < pages.length) {
    order.splice(current, 1);
    order.unshift(current);
  }
  for (const i of order) {
    const page = pages[i];
    const key = keys[i];
    const entry = entries.get(key);
    if (entry && !entry.device) continue;
    if (!hasReadableInk(page)) {
      if (entry) return { kind: "clear", page, key };
      continue;
    }
    const hash = hashOf(page);
    if (entry?.hash === hash || read.get(key) === hash) continue;
    return { kind: "read", page, key, hash };
  }
  return null;
}
