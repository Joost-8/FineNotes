/**
 * What a converter from another notes app hands back, and the small helpers
 * every converter shares. Pure.
 */

import type { InkDocument, TextFont } from "../model/document";
import { PAGE_PX_PER_MM } from "../model/units";

export type ImportSource = "goodnotes" | "notability";

/** A file the notebook uses: a paper or annotated PDF, a picture, a recording. */
export interface ImportAttachment {
  /**
   * A file name, unique within one result. The document refers to the file by
   * this name until {@link relinkAttachments} swaps in its vault path.
   */
  name: string;
  bytes: Uint8Array;
  mime: string;
}

export interface ImportResult {
  source: ImportSource;
  /** The notebook's title in the other app (or the file's name). */
  title: string;
  /** Ready for `buildInkFile` once its attachment paths are relinked. */
  doc: InkDocument;
  attachments: ImportAttachment[];
  /** Plain sentences for the user: what could not be brought over. */
  warnings: string[];
}

/**
 * Replace attachment names in the document with vault paths, after the
 * caller has saved the attachments. A name missing from `paths` is left as
 * it was.
 */
export function relinkAttachments(doc: InkDocument, paths: ReadonlyMap<string, string>): void {
  const swap = (name: string): string => paths.get(name) ?? name;
  for (const page of doc.pages) {
    if (page.backdrop.kind === "pdf")
      page.backdrop = { ...page.backdrop, path: swap(page.backdrop.path) };
    for (const image of page.images) image.path = swap(image.path);
  }
  for (const recording of doc.recordings ?? []) recording.path = swap(recording.path);
}

/**
 * The folder (`""` or `"Name/"`) holding a notebook's key file, when that
 * file sits at the top of the zip or one folder down — not deeper, and not
 * inside another notebook package, so a backup holding unpacked notebooks is
 * not taken for one of them.
 */
export function packageRoot(
  files: ReadonlyMap<string, Uint8Array>,
  keyFile: string,
): string | null {
  for (const name of files.keys()) {
    const parts = name.split("/");
    if (parts[parts.length - 1] !== keyFile || parts.length > 2) continue;
    if (parts.length === 2 && /\.(goodnotes|note)$/i.test(parts[0])) continue;
    return parts.length === 1 ? "" : `${parts[0]}/`;
  }
  return null;
}

/** A file's type from its first bytes, for pictures and PDFs inside a notebook package. */
export function sniffFile(bytes: Uint8Array): { mime: string; ext: string } {
  const b = bytes;
  const ascii = (from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return { mime: "image/png", ext: "png" };
  if (ascii(0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (ascii(0, 4) === "GIF8") return { mime: "image/gif", ext: "gif" };
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) {
      return { mime: "image/heic", ext: "heic" };
    }
    return { mime: "audio/mp4", ext: "m4a" };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return { mime: "application/octet-stream", ext: "bin" };
}

/**
 * A picture's size in pixels from its header (PNG, JPEG, GIF), or null when
 * the header does not say.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const { mime } = sniffFile(b);
  if (mime === "image/png" && b.length >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/gif" && b.length >= 10) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (mime === "image/jpeg") {
    // Walk the segments to the first start-of-frame marker.
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) return null;
      const marker = b[at + 1];
      const length = view.getUint16(at + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      at += 2 + length;
    }
  }
  return null;
}

/** "1 stroke", "3 strokes": a count with its noun. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The FineNotes typeface nearest to a font family another app names. */
export function fontFor(family: string | undefined): TextFont {
  const name = (family ?? "").toLowerCase();
  if (/courier|mono|menlo/.test(name)) return "mono";
  if (/times/.test(name)) return "times";
  if (/verdana/.test(name)) return "verdana";
  if (/trebuchet/.test(name)) return "trebuchet";
  if (/georgia|serif|garamond|baskerville|palatino/.test(name) && !/sans/.test(name)) {
    return "serif";
  }
  return "sans";
}

/** `#rrggbb` from colour channels in 0..1. */
export function hexColor(r: number, g: number, b: number): string {
  const byte = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Round to hundredths, as strokes and frames are stored. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Page px per unit for an app whose page is `width` units across `widthMm` of paper. */
export function pageScale(width: number, widthMm: number): number {
  return (PAGE_PX_PER_MM * widthMm) / width;
}

/** The median of a non-empty list. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/**
 * The pressure that makes FineNotes draw a pen of nib `size` at `width`:
 * with pressure-sensitive pens on, a stroke is `size × (0.4 + 1.2 p)` wide.
 */
export function pressureForWidth(width: number, size: number): number {
  if (!(size > 0)) return 0.5;
  return Math.max(0, Math.min(1, (width / size - 0.4) / 1.2));
}
