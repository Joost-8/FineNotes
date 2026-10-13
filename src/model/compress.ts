/**
 * The byte layer under every note: text as UTF-8, packed with raw DEFLATE
 * (fflate at its default level, or {@link SAVE_LEVEL} for a view's saves),
 * written as standard base64.
 *
 * A note saved without changes has to come out byte for byte the same, so
 * this wrapper adds nothing of its own: the output is exactly what fflate and
 * the platform's `btoa` make of the text. `btoa`, `atob` and `TextDecoder` are
 * present in every Obsidian webview and in Node, so tests run the same code.
 */

import { Inflate, deflateSync, strFromU8, strToU8 } from "fflate";

/**
 * The most a small payload may unpack to (64 MB): a crafted note, a few KB on
 * disk, cannot make the plugin allocate gigabytes the moment it is opened.
 */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/**
 * How many times its packed size a large payload may unpack to. A notebook's
 * JSON packs about 3:1 (research/SCALE.md); DEFLATE can reach 1032:1.
 */
export const MAX_INFLATE_RATIO = 32;

/**
 * The most a base64 payload of `base64Length` characters may unpack to:
 * {@link MAX_INFLATED_BYTES}, or {@link MAX_INFLATE_RATIO} times its bytes
 * when that is more. A fixed 64 MB held every notebook past ~250 pages of
 * notes (~100 dense ones) read-only the next time it opened, though it had
 * saved without complaint.
 */
export function inflateLimit(base64Length: number): number {
  return Math.max(MAX_INFLATED_BYTES, Math.floor((base64Length * 3) / 4) * MAX_INFLATE_RATIO);
}

/**
 * The level a view's saves compress at. fflate's default (6) spent most of a
 * save compressing: 121 ms for three written pages on a laptop, and a save
 * mid-stroke on an older iPad lost the ink drawn meanwhile (FineNotes#1).
 * Level 1 takes 48 ms and makes the payload 4.5% larger; every level decodes
 * the same.
 */
export const SAVE_LEVEL = 1;

/** Text to base64 of its DEFLATEd UTF-8, at fflate's default level unless `level` says. */
export function deflateToBase64(text: string, level?: 1): string {
  return deflateBytesToBase64(strToU8(text), level);
}

/**
 * {@link deflateToBase64} of text already encoded as UTF-8: the same bytes
 * give the same base64, here or in a worker (fragment-store.ts).
 */
export function deflateBytesToBase64(utf8: Uint8Array, level?: 1): string {
  const packed = deflateSync(utf8, level === undefined ? undefined : { level });
  // `btoa` wants one character per byte; fflate's latin1 mode builds that
  // string in slices, so a large note never overflows the argument limit.
  return btoa(strFromU8(packed, true));
}

/**
 * The inverse of {@link deflateToBase64}. Throws for anything that is not
 * base64 of a complete DEFLATE stream, and stops with an error as soon as
 * the output passes `maxBytes` ({@link inflateLimit} unless given), without
 * unpacking the rest.
 */
export function inflateFromBase64(base64: string, maxBytes = inflateLimit(base64.length)): string {
  const packed = strToU8(atob(base64), true);
  // The text is decoded as the bytes stream out, so the unpacked buffer is
  // never held in full beside the string it becomes. A streaming decode
  // gives the same string as decoding everything at once.
  const utf8 = new TextDecoder();
  let unpacked = 0;
  let text = "";
  const stream = new Inflate((chunk) => {
    unpacked += chunk.length;
    if (unpacked > maxBytes) throw new RangeError(`payload unpacks past ${maxBytes} bytes`);
    text += utf8.decode(chunk, { stream: true });
  });
  stream.push(packed, true);
  return text + utf8.decode();
}
