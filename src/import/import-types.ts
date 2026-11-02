/**
 * What a converter from another notes app hands back, and the small helpers
 * every converter shares. Pure.
 */

import type { InkDocument, TextFont } from "../model/document";
import { PAGE_PX_PER_MM } from "../model/units";

export type ImportSource =
  | "goodnotes"
  | "notability"
  | "noteful"
  | "xournal"
  | "saber"
  | "remarkable"
  | "supernote"
  | "freenotes"
  | "template"
  | "pdf";

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
  /** The app it came from, when the source alone does not say (a PDF from Noteful). */
  app?: string;
  /** The notebook's title in the other app (or the file's name). */
  title: string;
  /**
   * Where the notebook sat inside a backup zip, `/` between folders
   * (`Math/Algebra`), the zip's own wrapper folder left out; absent at its top.
   */
  folder?: string;
  /** Ready for `buildInkFile` once its attachment paths are relinked. */
  doc: InkDocument;
  attachments: ImportAttachment[];
  /**
   * Plain sentences for the user: what was brought over another way, and
   * what could not be brought over, with the pages it was on.
   */
  warnings: string[];
  /**
   * What the other app's own handwriting recognition read on each page, by
   * page index ("" or absent for none): it keeps an imported notebook
   * searchable before FineNotes transcribes it.
   */
  pageText?: string[];
}

/** " (page 3)", " (pages 3, 4)", or "" for none: 1-based page numbers, sorted. */
export function onPages(pages: Iterable<number>): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return ` (page ${sorted[0]})`;
  const shown = sorted.slice(0, 6).join(", ");
  const more = sorted.length > 6 ? ` and ${sorted.length - 6} more` : "";
  return ` (pages ${shown}${more})`;
}

/** Things counted while converting, with the pages they were on. */
export class ImportTally {
  private readonly entries = new Map<string, { n: number; pages: Set<number> }>();

  /** Count one more `key`, on 1-based `page` when known. */
  add(key: string, page?: number): void {
    const entry = this.entries.get(key) ?? { n: 0, pages: new Set<number>() };
    entry.n++;
    if (page !== undefined) entry.pages.add(page);
    this.entries.set(key, entry);
  }

  count(key: string): number {
    return this.entries.get(key)?.n ?? 0;
  }

  /** `sentence(n)` with the pages before its full stop, or null when nothing was counted. */
  line(key: string, sentence: (n: number) => string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const text = sentence(entry.n);
    const pages = onPages(entry.pages);
    return text.endsWith(".") ? `${text.slice(0, -1)}${pages}.` : `${text}${pages}`;
  }
}

/**
 * An MP4/M4A file's length in milliseconds and its creation time (ms since
 * the Unix epoch, when it says), from its `moov/mvhd` box; null when there is none.
 */
export function mp4Info(bytes: Uint8Array): { duration: number; created?: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number): string => String.fromCharCode(...bytes.subarray(at + 4, at + 8));
  const find = (from: number, to: number, name: string): [number, number] | null => {
    let at = from;
    while (at + 8 <= to) {
      let size = view.getUint32(at);
      if (size === 1 && at + 16 <= to) size = Number(view.getBigUint64(at + 8));
      if (size < 8 || at + size > to) return null;
      if (type(at) === name) return [at, at + size];
      at += size;
    }
    return null;
  };
  const moov = find(0, bytes.length, "moov");
  const mvhd = moov ? find(moov[0] + 8, moov[1], "mvhd") : null;
  if (!mvhd) return null;
  const at = mvhd[0] + 8;
  const version = bytes[at];
  const long = version === 1;
  if (at + (long ? 32 : 20) > mvhd[1]) return null;
  const created = long ? Number(view.getBigUint64(at + 4)) : view.getUint32(at + 4);
  const scale = view.getUint32(at + (long ? 20 : 12));
  const length = long ? Number(view.getBigUint64(at + 24)) : view.getUint32(at + 16);
  if (!(scale > 0)) return null;
  // MP4 counts seconds from 1904.
  const MAC_EPOCH_S = 2082844800;
  return {
    duration: Math.round((length / scale) * 1000),
    ...(created > MAC_EPOCH_S ? { created: (created - MAC_EPOCH_S) * 1000 } : {}),
  };
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
  // JPEG 2000, as iPad scans and Goodnotes pictures often are: a box `jP  `.
  if (ascii(4, 8) === "jP  " && b[8] === 0x0d && b[9] === 0x0a) {
    return { mime: "image/jp2", ext: "jp2" };
  }
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
  if (/courier|mono|menlo|typewriter/.test(name)) return "mono";
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
