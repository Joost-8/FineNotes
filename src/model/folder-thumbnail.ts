/**
 * Reading a notebook just far enough to draw its thumbnail and to search
 * its text, for the Folders sidebar. A notebook's data block
 * (`%%goodobsidian … %%`) holds its pages as packed JSON; this module unpacks
 * it and reads, defensively, only what a thumbnail or a search needs: the
 * first page's paper, pictures and strokes, and every page's text boxes.
 * Anything that does not parse is skipped, never thrown. No Obsidian, no DOM.
 */

import { BLOCK_LABEL, LEGACY_BLOCK_LABEL } from "../constants";
import { inflateFromBase64 } from "./compress";

const BLOCK_RE = new RegExp(
  `\\n*[ \\t]*%%(?:${BLOCK_LABEL}|${LEGACY_BLOCK_LABEL})[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*%%[ \\t]*\\n?`,
);

/** A page's width when the file does not say, px. */
export const DEFAULT_PAGE_WIDTH = 1024;
/** A page's height when the file does not say, px. */
export const DEFAULT_PAGE_HEIGHT = 1448;
/** How much a note may unpack to when only its text is wanted (64 MB). */
export const TEXT_UNPACK_LIMIT = 64 * 1024 * 1024;
/** How much a note may unpack to when its first page is drawn (256 MB). */
export const THUMBNAIL_UNPACK_LIMIT = 256 * 1024 * 1024;
/** The most pictures drawn on a thumbnail. */
export const MAX_THUMBNAIL_IMAGES = 8;
/** How opaque highlighter strokes are drawn. */
export const HIGHLIGHTER_ALPHA = 0.4;

/** Line spacing of each ruled paper, in page units, when the file does not say. */
export const RULING_SPACING: Readonly<Record<string, number>> = {
  "ruled-narrow": 24,
  "ruled-wide": 34,
  lined: 34,
  legal: 34,
  squared: 28,
  grid: 28,
  graph: 28,
  dotted: 28,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** The text between the data block's markers, or null when the note has none. */
export function extractBlock(markdown: string): string | null {
  const match = BLOCK_RE.exec(markdown);
  return match ? (match[1] ?? null) : null;
}

/** The block's "v2:" prefix split off: its version number, and the packed payload. */
function splitBlock(markdown: string): { version: number; payload: string } | null {
  const block = extractBlock(markdown);
  if (block === null) return null;
  const text = block.trim();
  const colon = text.indexOf(":");
  if (!text.startsWith("v") || colon < 0) return null;
  const version = Number(text.slice(1, colon).split("+")[0] ?? "");
  return { version, payload: text.slice(colon + 1) };
}

function unpack(payload: string, limit: number): string {
  return inflateFromBase64(payload.replace(/\s+/g, ""), limit);
}

// --- The text of a notebook (search) --------------------------------------------

/** One page of a notebook, as search reads it. */
export interface NotebookTextPage {
  /** The page's text boxes, one per line. */
  text: string;
  /** The PDF page behind it, when the page has a PDF backdrop. */
  pdf?: { path: string; page: number };
}

/** Every page's text boxes and PDF backdrop; null when the note is not a readable notebook. */
export function readNotebookText(markdown: string): NotebookTextPage[] | null {
  try {
    const block = splitBlock(markdown);
    if (!block) return null;
    const doc: unknown = JSON.parse(unpack(block.payload, TEXT_UNPACK_LIMIT));
    if (!isObject(doc) || !Array.isArray(doc.pages)) return null;
    const pages: NotebookTextPage[] = [];
    for (const page of doc.pages as unknown[]) {
      if (!isObject(page)) {
        pages.push({ text: "" });
        continue;
      }
      const lines: string[] = [];
      if (Array.isArray(page.textBoxes)) {
        for (const box of page.textBoxes as unknown[]) {
          if (isObject(box) && typeof box.text === "string" && box.text.trim())
            lines.push(box.text);
        }
      }
      const backdrop = isObject(page.backdrop) ? page.backdrop : {};
      const entry: NotebookTextPage = { text: lines.join("\n") };
      if (
        backdrop.kind === "pdf" &&
        typeof backdrop.path === "string" &&
        backdrop.path.length > 0
      ) {
        entry.pdf = {
          path: backdrop.path,
          page: Math.max(0, Math.round(finite(backdrop.page, 0))),
        };
      }
      pages.push(entry);
    }
    return pages;
  } catch {
    return null;
  }
}

// --- The first page (thumbnail) -------------------------------------------------

/** A stroke as a thumbnail draws it: points are (x, y, pressure) triples in page units. */
export interface ThumbnailStroke {
  color: string;
  size: number;
  highlighter: boolean;
  pts: number[];
  /** A recognised shape: drawn with straight segments. */
  shape: boolean;
}

/** A picture on the page. */
export interface ThumbnailImage {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** The part of the picture shown, as fractions of it. */
  crop?: { x: number; y: number; w: number; h: number };
  flipX: boolean;
  flipY: boolean;
  /** Drawn over the ink, not under it. */
  front: boolean;
  opacity: number;
  /** A sticky note: a flat colour instead of a picture. */
  sticky?: string;
}

/** The first page of a notebook, as a thumbnail draws it. */
export interface ThumbnailPage {
  width: number;
  height: number;
  ruling: string;
  paperColor: string;
  ruleColor?: string;
  spacing?: number;
  pdf?: { path: string; page: number };
  images: ThumbnailImage[];
  strokes: ThumbnailStroke[];
}

/** A stored stroke; its points are kept as hundredths, pressure as 0 to 255. */
export function parseStroke(raw: unknown): ThumbnailStroke | null {
  if (!isObject(raw) || !Array.isArray(raw.pts)) return null;
  const stored = raw.pts as unknown[];
  const length = stored.length - (stored.length % 3);
  const pts = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const value =
      typeof stored[i] === "number" && Number.isFinite(stored[i]) ? (stored[i] as number) : 0;
    pts[i] = i % 3 === 2 ? value / 255 : value / 100;
  }
  return {
    color: typeof raw.color === "string" ? raw.color : "#111111",
    size: typeof raw.size === "number" && raw.size > 0 ? raw.size : 2,
    highlighter: raw.tool === "highlighter",
    pts,
    shape: typeof raw.shape === "string" && raw.shape.length > 0,
  };
}

/** A stored picture or sticky note; null when it is neither. */
export function parseImage(raw: unknown): ThumbnailImage | null {
  if (!isObject(raw)) return null;
  const sticky =
    isObject(raw.sticky) && typeof raw.sticky.color === "string" ? raw.sticky.color : undefined;
  const path = typeof raw.path === "string" ? raw.path : "";
  if (!sticky && !path) return null;
  let crop: ThumbnailImage["crop"];
  if (!sticky && isObject(raw.crop)) {
    const c = raw.crop;
    if (
      [c.x, c.y, c.w, c.h].every((v) => typeof v === "number" && Number.isFinite(v)) &&
      (c.w as number) > 0 &&
      (c.h as number) > 0
    ) {
      crop = { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number };
    }
  }
  return {
    path,
    x: finite(raw.x, 0),
    y: finite(raw.y, 0),
    w: Math.max(1, finite(raw.w, 100)),
    h: Math.max(1, finite(raw.h, 100)),
    rotation: finite(raw.rotation, 0),
    crop,
    flipX: raw.flipX === true,
    flipY: raw.flipY === true,
    front: raw.front === true,
    opacity:
      typeof raw.opacity === "number" && raw.opacity > 0 && raw.opacity <= 1 ? raw.opacity : 1,
    sticky,
  };
}

/** The first page of an unpacked document; null when it has none. */
export function parseThumbnailPage(doc: unknown): ThumbnailPage | null {
  if (!isObject(doc) || !Array.isArray(doc.pages) || doc.pages.length === 0) return null;
  const view = isObject(doc.view) ? doc.view : {};
  const viewWidth = finite(view.width, DEFAULT_PAGE_WIDTH);
  const first: unknown = doc.pages[0];
  if (!isObject(first)) return null;
  const geometry = isObject(first.geometry) ? first.geometry : {};
  const width = finite(geometry.width, viewWidth);
  const height = finite(geometry.height, DEFAULT_PAGE_HEIGHT);
  const backdrop = isObject(first.backdrop) ? first.backdrop : {};
  const page: ThumbnailPage = {
    width: width > 0 ? width : viewWidth,
    height: height > 0 ? height : DEFAULT_PAGE_HEIGHT,
    ruling: "blank",
    paperColor: "#ffffff",
    images: [],
    strokes: [],
  };
  if (backdrop.kind === "pdf" && typeof backdrop.path === "string" && backdrop.path.length > 0) {
    page.pdf = { path: backdrop.path, page: Math.max(0, Math.round(finite(backdrop.page, 0))) };
  } else if (typeof backdrop.kind === "string") {
    page.ruling = backdrop.kind;
    if (typeof backdrop.paperColor === "string") page.paperColor = backdrop.paperColor;
    if (typeof backdrop.color === "string") page.ruleColor = backdrop.color;
    if (typeof backdrop.spacing === "number" && backdrop.spacing > 0) {
      page.spacing = backdrop.spacing;
    }
  }
  if (Array.isArray(first.images)) {
    for (const raw of first.images as unknown[]) {
      const image = parseImage(raw);
      if (image) page.images.push(image);
    }
  }
  if (Array.isArray(first.strokes)) {
    for (const raw of first.strokes as unknown[]) {
      const stroke = parseStroke(raw);
      if (stroke) page.strokes.push(stroke);
    }
  }
  return page;
}

/** The first page of a notebook note; null when the note is not a readable notebook. */
export function readThumbnailPage(markdown: string): ThumbnailPage | null {
  try {
    const block = splitBlock(markdown);
    if (!block || !Number.isFinite(block.version)) return null;
    return parseThumbnailPage(JSON.parse(unpack(block.payload, THUMBNAIL_UNPACK_LIMIT)));
  } catch {
    return null;
  }
}

/** How a page of `source` size is fitted, centred, into `target`. */
export function fitInto(
  source: { width: number; height: number },
  target: { width: number; height: number },
): { fit: number; dx: number; dy: number } {
  const fit = Math.min(target.width / source.width, target.height / source.height);
  return {
    fit,
    dx: (target.width - source.width * fit) / 2,
    dy: (target.height - source.height * fit) / 2,
  };
}

// --- Files named by a thumbnail --------------------------------------------------

/** A short fingerprint of `key` for a cache file name: 16 hex digits. */
export function thumbnailHash(key: string): string {
  let a = 2166136261;
  let b = 16777619;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619) >>> 0;
    b = Math.imul(b + code, 2246822507) >>> 0;
    b ^= b >>> 13;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The bytes of a `data:` URL's base64 payload. */
export function dataUrlToBytes(url: string): ArrayBuffer {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** A JPEG's bytes as a `data:` URL. */
export function jpegBytesToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** Whether a file's extension is a picture a thumbnail can show as it is. */
export const THUMBNAIL_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
]);

/** The file name part of a link such as `Photo.png#x|300`. */
export function linkTarget(link: string): string {
  return (link.split("#")[0] ?? "").split("|")[0]?.trim() ?? "";
}

/** Whether a note's name marks it as a FineNotes notebook or page. */
export function isNotebookName(name: string): boolean {
  return /\.(notebook|page)\.md$/i.test(name);
}

/** Whether a note's frontmatter claims it for FineNotes. */
export function claimsNotebook(frontmatterFlag: unknown): boolean {
  return frontmatterFlag === true || frontmatterFlag === "true";
}
