/**
 * The byte layer under every note: text as UTF-8, packed with raw DEFLATE
 * (fflate at its default level), written as standard base64.
 *
 * A note saved without changes has to come out byte for byte the same, so
 * this wrapper adds nothing of its own: the output is exactly what fflate and
 * the platform's `btoa` make of the text. `btoa`, `atob` and `TextDecoder` are
 * present in every Obsidian webview and in Node, so tests run the same code.
 */

import { Inflate, deflateSync, strFromU8, strToU8 } from "fflate";

/**
 * The most a payload may unpack to (64 MB). A real notebook's JSON is a few
 * MB; the limit means a crafted note, a few KB on disk, cannot make the
 * plugin allocate gigabytes the moment it is opened.
 */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/** Text to base64 of its DEFLATEd UTF-8. */
export function deflateToBase64(text: string): string {
  const packed = deflateSync(strToU8(text));
  // `btoa` wants one character per byte; fflate's latin1 mode builds that
  // string in slices, so a large note never overflows the argument limit.
  return btoa(strFromU8(packed, true));
}

/**
 * The inverse of {@link deflateToBase64}. Throws for anything that is not
 * base64 of a complete DEFLATE stream, and stops with an error as soon as
 * the output passes `maxBytes`, without unpacking the rest.
 */
export function inflateFromBase64(base64: string, maxBytes = MAX_INFLATED_BYTES): string {
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
