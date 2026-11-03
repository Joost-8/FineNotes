/**
 * The OCR cache of one PDF: a JSON sidecar in the plugin's folder
 * (`<plugin>/ocr/<sha256 of the PDF's bytes>.json`), so the vault syncs it
 * to the other devices and a page is read once, ever. A PDF is known by what
 * it holds, not by where it is: moving or renaming it keeps its cache.
 *
 * Each page records the model version that read it and the file's format
 * number; entries from another model version or format are ignored (the
 * page is read again), and the file is read tolerantly: whatever does not
 * parse is dropped, never thrown.
 *
 * PURE: no DOM, no Obsidian.
 */

import { CLASSIFY_VERSION, PAGE_CONDITIONS, type PageCondition, type Region } from "./figures";
import { OCR_MODEL_VERSION } from "./ocr-model";
import type { OcrLine, OcrPage, OcrWord } from "./ocr-words";

/** The sidecar's format number: a different one is not read. */
export const OCR_CACHE_FORMAT = 2;

/**
 * A page as stored: what kind of page it is, the areas that were read, the
 * raw words found there, and by which model. A `TEXT_ONLY` page has no
 * areas and no words: it is recorded so that opening the PDF again costs
 * nothing.
 */
export interface StoredPage extends OcrPage {
  model: string;
  condition: PageCondition;
  regions: Region[];
  /** The classification rules in force when the page was recorded (`CLASSIFY_VERSION`). */
  rules: number;
}

export interface OcrCacheFile {
  format: number;
  /** Zero-based PDF page number → what was read. */
  pages: Record<string, StoredPage>;
}

export function emptyCache(): OcrCacheFile {
  return { format: OCR_CACHE_FORMAT, pages: {} };
}

/** A SHA-256 as the cache key: 64 lower-case hex digits. */
export function isCacheKey(key: string): boolean {
  return /^[0-9a-f]{64}$/.test(key);
}

/** The sidecar's path for a PDF with this hash. */
export function cachePath(pluginDir: string, key: string): string {
  return `${pluginDir}/ocr/${key}.json`;
}

/** The folder the sidecars live in. */
export function cacheFolder(pluginDir: string): string {
  return `${pluginDir}/ocr`;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function wordOf(raw: unknown): OcrWord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const box = r.box;
  if (typeof r.text !== "string" || r.text === "" || !Array.isArray(box) || box.length !== 4) {
    return null;
  }
  const b = box.map(num);
  const conf = num(r.conf);
  const min = num(r.min);
  if (b.some((v) => v === null) || conf === null || min === null) return null;
  const [x0, y0, x1, y1] = b as [number, number, number, number];
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { text: r.text, box: [x0, y0, x1, y1], conf, min };
}

function regionOf(raw: unknown): Region | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const x0 = num(r.x0);
  const y0 = num(r.y0);
  const x1 = num(r.x1);
  const y1 = num(r.y1);
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x0, y0, x1, y1, dpi: num(r.dpi) };
}

function pageOf(raw: unknown): StoredPage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.model !== "string" || !Array.isArray(r.lines)) return null;
  const condition = PAGE_CONDITIONS.find((c) => c === r.condition);
  const rules = num(r.rules);
  if (!condition || rules === null || !Array.isArray(r.regions)) return null;
  const regions = (r.regions as unknown[]).map(regionOf).filter((x): x is Region => x !== null);
  const imageWidth = num(r.imageWidth);
  const imageHeight = num(r.imageHeight);
  const pageWidth = num(r.pageWidth);
  const pageHeight = num(r.pageHeight);
  if (imageWidth === null || imageHeight === null || pageWidth === null || pageHeight === null) {
    return null;
  }
  const lines: OcrLine[] = [];
  for (const rawLine of r.lines as unknown[]) {
    if (typeof rawLine !== "object" || rawLine === null) continue;
    const l = rawLine as Record<string, unknown>;
    const conf = num(l.conf);
    if (conf === null || !Array.isArray(l.words)) continue;
    const words = (l.words as unknown[]).map(wordOf).filter((w): w is OcrWord => w !== null);
    if (words.length > 0) lines.push({ conf, words });
  }
  return {
    model: r.model,
    condition,
    regions,
    rules,
    imageWidth,
    imageHeight,
    pageWidth,
    pageHeight,
    lines,
  };
}

/**
 * A sidecar's text as a cache: empty when it is not JSON, is another format,
 * or holds nothing usable. Pages are kept whatever model read them (they are
 * ignored on lookup, and replaced when read again).
 */
export function parseCache(text: string): OcrCacheFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyCache();
  }
  if (typeof raw !== "object" || raw === null) return emptyCache();
  const r = raw as Record<string, unknown>;
  if (r.format !== OCR_CACHE_FORMAT || typeof r.pages !== "object" || r.pages === null) {
    return emptyCache();
  }
  const file = emptyCache();
  for (const [key, value] of Object.entries(r.pages)) {
    if (!/^\d+$/.test(key)) continue;
    const page = pageOf(value);
    if (page) file.pages[key] = page;
  }
  return file;
}

export function serializeCache(file: OcrCacheFile): string {
  return JSON.stringify(file);
}

/**
 * The page as recorded by this build's model, or null (not recorded, read
 * by another model, or recorded as `TEXT_ONLY` under other classification
 * rules, which costs only a look at the page again).
 */
export function cachedPage(
  file: OcrCacheFile,
  page: number,
  model: string = OCR_MODEL_VERSION,
): StoredPage | null {
  const stored = file.pages[String(page)];
  if (!stored || stored.model !== model) return null;
  if (stored.condition === "TEXT_ONLY" && stored.rules !== CLASSIFY_VERSION) return null;
  return stored;
}

/** Boxes to a tenth of a point and confidences to the thousandth: the sidecar stays small. */
function rounded(page: OcrPage): OcrPage {
  const tenth = (v: number): number => Math.round(v * 10) / 10;
  return {
    ...page,
    regions: page.regions?.map((r) => ({
      x0: tenth(r.x0),
      y0: tenth(r.y0),
      x1: tenth(r.x1),
      y1: tenth(r.y1),
      dpi: r.dpi === null ? null : Math.round(r.dpi),
    })),
    lines: page.lines.map((line) => ({
      conf: line.conf,
      words: line.words.map((w) => ({
        text: w.text,
        box: [tenth(w.box[0]), tenth(w.box[1]), tenth(w.box[2]), tenth(w.box[3])],
        conf: w.conf,
        min: w.min,
      })),
    })),
  };
}

/**
 * `file` with `page` stored, as read by `model`. A page without a condition
 * (a plain whole-page reading) is a `SCANNED` page of the whole page.
 */
export function withPage(
  file: OcrCacheFile,
  index: number,
  page: OcrPage,
  model: string = OCR_MODEL_VERSION,
): OcrCacheFile {
  const condition = page.condition ?? "SCANNED";
  const regions = page.regions ?? [
    { x0: 0, y0: 0, x1: page.pageWidth, y1: page.pageHeight, dpi: null },
  ];
  const read = rounded({ ...page, condition, regions });
  const stored: StoredPage = {
    ...read,
    condition,
    regions: read.regions ?? [],
    model,
    rules: CLASSIFY_VERSION,
  };
  return { format: file.format, pages: { ...file.pages, [String(index)]: stored } };
}

/**
 * `ours` merged over `theirs` (the file on disk, which another device may
 * have added pages to): a page of ours replaces theirs, unless theirs was
 * read by this build's model and ours was not.
 */
export function mergeCaches(theirs: OcrCacheFile, ours: OcrCacheFile): OcrCacheFile {
  const pages = { ...theirs.pages };
  for (const [key, page] of Object.entries(ours.pages)) {
    const other = pages[key];
    if (other && other.model === OCR_MODEL_VERSION && page.model !== OCR_MODEL_VERSION) continue;
    pages[key] = page;
  }
  return { format: OCR_CACHE_FORMAT, pages };
}
