/**
 * The save worker's memory (save-worker.ts): each page's JSON as UTF-8, by
 * the slot the encoder gave that text (`PageFragment.slot`, serialize.ts),
 * and the compression of a whole document put together from them. Kept
 * between saves, so the main thread sends only the pages that changed.
 *
 * Pure: no DOM, no worker API, so tests run it directly.
 */

import { SCHEMA_VERSION } from "../constants";
import { SAVE_LEVEL, deflateBytesToBase64 } from "./compress";

const COMMA = 0x2c;
const PAGES_CLOSE = new Uint8Array([0x5d, 0x7d]); // "]}"

export class FragmentStore {
  private readonly bytes = new Map<number, Uint8Array>();
  private readonly utf8 = new TextEncoder();

  /** Keep these pages' text, slot by slot. */
  put(slots: readonly number[], jsons: readonly string[]): void {
    slots.forEach((slot, i) => this.bytes.set(slot, this.utf8.encode(jsons[i])));
  }

  /** How many pages are held. */
  get size(): number {
    return this.bytes.size;
  }

  /**
   * The `v<n>:<base64>` payload of the document whose stored JSON is `head`,
   * then the pages in `slots` joined by commas, then `]}`: the very payload
   * `DocumentEncoder.encode` makes of that JSON. Slots not listed are
   * forgotten, as the main thread forgets them when it asks. Throws when a
   * listed slot was never put.
   */
  compress(head: string, slots: readonly number[]): string {
    const keep = new Set(slots);
    for (const slot of this.bytes.keys()) if (!keep.has(slot)) this.bytes.delete(slot);
    const start = this.utf8.encode(head);
    let length = start.length + Math.max(0, slots.length - 1) + PAGES_CLOSE.length;
    const parts = slots.map((slot) => {
      const part = this.bytes.get(slot);
      if (!part) throw new Error(`page text ${slot} was never sent`);
      length += part.length;
      return part;
    });
    const json = new Uint8Array(length);
    json.set(start, 0);
    let at = start.length;
    parts.forEach((part, i) => {
      if (i > 0) json[at++] = COMMA;
      json.set(part, at);
      at += part.length;
    });
    json.set(PAGES_CLOSE, at);
    return `v${SCHEMA_VERSION}:${deflateBytesToBase64(json, SAVE_LEVEL)}`;
  }
}
