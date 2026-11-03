/**
 * What OCR found on a PDF page, and what is made of it: the words with how
 * sure the reader was of each, the filter that leaves out what looks like
 * messy handwriting, the test for a page whose own text is too sparse to
 * trust, the merge with that native text, and the conversion into the text
 * items (`canvas/pdf-text.ts`) the highlighter, Copy and search read.
 *
 * Every word is stored with its confidences and filtered when it is read,
 * so tuning {@link OCR_TUNING} never needs a page to be read again.
 *
 * Coordinates: a word's box is in points of the page as pdf.js shows it at
 * scale 1 (`getViewport({ scale: 1 })`: y down, rotation applied), the space
 * the page was rasterised in, divided by the raster scale.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { PageCondition, Region } from "./figures";
import {
  type Matrix,
  type PdfTextItem,
  type TextLayout,
  layoutText,
  pdfToPage,
} from "../../canvas/pdf-text";

/** One word: its box `[x0, y0, x1, y1]` and the confidence of its characters. */
export interface OcrWord {
  text: string;
  box: [number, number, number, number];
  /** Mean of its characters' confidences. */
  conf: number;
  /** The least of its characters' confidences. */
  min: number;
}

/** A line of words, left to right, and the mean confidence of all its characters. */
export interface OcrLine {
  conf: number;
  words: OcrWord[];
}

/** A page as read: its lines in reading order. */
export interface OcrPage {
  /** The image that was read, in pixels. */
  imageWidth: number;
  imageHeight: number;
  /** The page, in points at scale 1: the space the boxes are in. */
  pageWidth: number;
  pageHeight: number;
  lines: OcrLine[];
  /** What kind of page it is (see figures.ts); absent on a page read before pictures were looked at. */
  condition?: PageCondition;
  /** The areas that were read, in the page's points; the whole page for a scan. */
  regions?: Region[];
}

/**
 * Every number that decides what OCR text is trusted and used, in one place.
 * Changing them needs no new reading: words are stored with their confidences.
 */
export const OCR_TUNING = {
  /** A word is kept when the mean of its characters' confidences is at least this ... */
  wordMean: 0.85,
  /** ... and the least of them is at least this. */
  wordMin: 0.5,
  /** A line whose mean confidence is below this is dropped whole. */
  lineMean: 0.75,
  /** A page's own text is sparse (OCR adds to it) below this share of the page's area ... */
  sparseAreaShare: 0.02,
  /** ... or with fewer characters than this. */
  sparseChars: 40,
  /** An OCR word is dropped when this much of it lies over the page's own text. */
  overlap: 0.3,

  // Figures (figures.ts). These decide which areas are read, so unlike the
  // numbers above a change needs `CLASSIFY_VERSION` bumped to take effect on
  // pages already recorded as having nothing to read.

  /**
   * A picture narrower or shorter than this is not a figure, pt (0.5 in):
   * icons, logos, bullets and badges. Measured on the lecture PDFs: every
   * figure with labels is at least 116 pt (1.6 in) on its short side, and
   * the badges are drawn as vectors, so the number is a principled floor
   * (the smallest print a reader could still be asked to read), not fitted.
   */
  figureMinSide: 36,
  /** A picture covering less of the page than this is not a figure either (a logo as wide as a line). */
  figureMinAreaShare: 0.015,
  /** Pictures this close, pt, are one figure (a picture cut into strips touches itself). */
  figureMergeGap: 3,
  /** A figure's area is read this much wider on every side, pt: labels sit at the edge of a picture. */
  figurePad: 6,
  /** A sparse page with a picture covering this share of it is a scan: the whole page is read. */
  scannedShare: 0.6,
  /** A figure is drawn at its stored resolution, but at least this ... (the page rate, OCR_DPI) */
  figureMinDpi: 170,
  /** ... and at most this, dpi: past it the recogniser gains nothing and memory is lost. */
  figureMaxDpi: 300,
  /** ... and never with a side longer than this, px (OCR_MAX_EDGE: memory on a phone). */
  figureMaxEdge: 2200,
} as const;

export type OcrTuning = { [K in keyof typeof OCR_TUNING]: number };

/** The lines of words that pass the filter, empty lines left out. */
export function keptLines(page: OcrPage, tuning: OcrTuning = OCR_TUNING): OcrWord[][] {
  const out: OcrWord[][] = [];
  for (const line of page.lines) {
    if (line.conf < tuning.lineMean) continue;
    const words = line.words.filter((w) => w.conf >= tuning.wordMean && w.min >= tuning.wordMin);
    if (words.length > 0) out.push(words);
  }
  return out;
}

/** The text of a laid-out page's own characters: how many, and the area they cover (page units). */
export function nativeCoverage(layout: TextLayout): { chars: number; area: number } {
  let chars = 0;
  let area = 0;
  for (const line of layout.lines) {
    const height = line.bottom - line.top;
    for (let i = line.start; i < line.end; i++) {
      const c = layout.chars[i];
      if (c.virtual || c.ch.trim() === "") continue;
      chars++;
      area += Math.max(0, c.x1 - c.x0) * height;
    }
  }
  return { chars, area };
}

/**
 * Whether a page's own text is too little to leave it at that: a scan with
 * only a page number, a header or a stamp, or no text at all.
 */
export function isSparse(
  layout: TextLayout,
  pageWidth: number,
  pageHeight: number,
  tuning: OcrTuning = OCR_TUNING,
): boolean {
  const { chars, area } = nativeCoverage(layout);
  if (chars < tuning.sparseChars) return true;
  const page = pageWidth * pageHeight;
  return !(page > 0) || area / page < tuning.sparseAreaShare;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The page's own words as rectangles (a run of characters without a space is one). */
export function nativeRects(layout: TextLayout): Rect[] {
  const rects: Rect[] = [];
  for (const line of layout.lines) {
    let from = -1;
    const flush = (end: number): void => {
      if (from < 0) return;
      rects.push({
        x0: layout.chars[from].x0,
        x1: layout.chars[end - 1].x1,
        y0: line.top,
        y1: line.bottom,
      });
      from = -1;
    };
    for (let i = line.start; i < line.end; i++) {
      const c = layout.chars[i];
      if (c.virtual || c.ch.trim() === "") flush(i);
      else if (from < 0) from = i;
    }
    flush(line.end);
  }
  return rects;
}

function overlapShare(word: Rect, other: Rect): number {
  const w = Math.min(word.x1, other.x1) - Math.max(word.x0, other.x0);
  const h = Math.min(word.y1, other.y1) - Math.max(word.y0, other.y0);
  if (!(w > 0) || !(h > 0)) return 0;
  const inter = w * h;
  const a = (word.x1 - word.x0) * (word.y1 - word.y0);
  const b = (other.x1 - other.x0) * (other.y1 - other.y0);
  // Both measures the spec asks for: the share of the OCR word covered, and IoU.
  return Math.max(inter / a, inter / (a + b - inter));
}

/** The share of `word` that lies under `others` together (they do not overlap each other). */
function coveredShare(word: Rect, others: readonly Rect[]): number {
  const area = (word.x1 - word.x0) * (word.y1 - word.y0);
  if (!(area > 0)) return 0;
  let covered = 0;
  for (const o of others) {
    const w = Math.min(word.x1, o.x1) - Math.max(word.x0, o.x0);
    const h = Math.min(word.y1, o.y1) - Math.max(word.y0, o.y0);
    if (w > 0 && h > 0) covered += w * h;
  }
  return Math.min(1, covered / area);
}

/**
 * The OCR lines without the words that lie over the page's own text
 * (`tuning.overlap` of the word under one native word or under all of them
 * together, or as IoU): the page's own text always wins, and nothing is
 * read twice.
 */
export function dropCovered(
  lines: readonly OcrWord[][],
  native: readonly Rect[],
  tuning: OcrTuning = OCR_TUNING,
): OcrWord[][] {
  if (native.length === 0) return lines.map((l) => [...l]);
  const out: OcrWord[][] = [];
  for (const line of lines) {
    const kept = line.filter((w) => {
      const r = { x0: w.box[0], y0: w.box[1], x1: w.box[2], y1: w.box[3] };
      if (native.some((n) => overlapShare(r, n) >= tuning.overlap)) return false;
      // A word across several native words (a label read as one word over a
      // line of text) is covered by all of them together.
      return coveredShare(r, native) < tuning.overlap;
    });
    if (kept.length > 0) out.push(kept);
  }
  return out;
}

/** `m` inverted, or null when it cannot be. */
export function invertMatrix(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** The smallest gap kept between two words of a line, as a share of the line's height. */
const MIN_GAP = 0.25;
/** The font's ascent and descent used to place a word: they sum to 1, so the font size is the box height. */
const ASCENT = 0.8;
const DESCENT = 0.2;

/**
 * Text items for lines of words, in PDF user space. `viewport` is pdf.js's
 * `getViewport({ scale: 1 }).transform`, which maps user space to the space
 * the words' boxes are in; each word becomes one item whose font size is its
 * box's height and whose width is its box's, so the characters laid out
 * cover the box. Neighbours closer than a quarter of a line's height are
 * pulled apart so the layout puts a space between them.
 */
export function wordItems(lines: readonly OcrWord[][], viewport: Matrix): PdfTextItem[] {
  const inverse = invertMatrix(viewport);
  if (!inverse) return [];
  const items: PdfTextItem[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const word = line[i];
      const [, y0, , y1] = word.box;
      let [x0, , x1] = word.box;
      const height = y1 - y0;
      if (!(height > 0) || !(x1 > x0) || word.text.length === 0) continue;
      const gap = MIN_GAP * height;
      const before = line[i - 1];
      if (before && x0 - before.box[2] < gap) x0 += (gap - (x0 - before.box[2])) / 2;
      const after = line[i + 1];
      if (after && after.box[0] - x1 < gap) x1 -= (gap - (after.box[0] - x1)) / 2;
      if (!(x1 > x0)) continue;
      // The text matrix in the box's own space (y down, so the font's -size on d),
      // then back to user space.
      const baseline = y1 - DESCENT * height;
      const view: Matrix = [height, 0, 0, -height, x0, baseline];
      const t = multiplyMatrices(inverse, view);
      const scale = Math.hypot(t[0], t[1]);
      items.push({
        str: word.text,
        transform: [...t],
        width: ((x1 - x0) * scale) / height,
        height: scale,
        ascent: ASCENT,
        descent: -DESCENT,
      });
    }
  }
  return items;
}

function multiplyMatrices(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * What a page reads as: its own text items, plus the OCR words that are not
 * over that text. Which pages take OCR words: a page read whole (a scan,
 * only while its own text is still sparse) and a page whose figures were
 * read (`TEXT_WITH_FIGURES`, unless `figures` is false: the setting is off).
 * Every OCR word has passed the confidence filter and none lies over the
 * page's own text. Pages with nothing read come back unchanged.
 */
export function mergedItems(
  native: readonly PdfTextItem[],
  ocr: OcrPage | null,
  viewport: Matrix,
  source: { width: number; height: number },
  tuning: OcrTuning = OCR_TUNING,
  figures = true,
): PdfTextItem[] {
  if (!ocr || ocr.condition === "TEXT_ONLY" || ocr.condition === "BLANK") return [...native];
  const ofFigures = ocr.condition === "TEXT_WITH_FIGURES";
  if (ofFigures && !figures) return [...native];
  const toView = pdfToPage(viewport, source, source);
  const layout = layoutText(native, toView);
  if (!ofFigures && !isSparse(layout, source.width, source.height, tuning)) return [...native];
  const lines = dropCovered(keptLines(ocr, tuning), nativeRects(layout), tuning);
  return [...native, ...wordItems(lines, viewport)];
}

/**
 * Whether a page whose own text items are `native` needs OCR: it has none,
 * or too little to be what the page says (see {@link isSparse}).
 */
export function needsOcr(
  native: readonly PdfTextItem[],
  viewport: Matrix,
  source: { width: number; height: number },
  tuning: OcrTuning = OCR_TUNING,
): boolean {
  if (native.length === 0) return true;
  const layout = layoutText(native, pdfToPage(viewport, source, source));
  return isSparse(layout, source.width, source.height, tuning);
}

/** The page's own words as rectangles in the page's points, for masking them out of a raster. */
export function nativeBoxes(
  native: readonly PdfTextItem[],
  viewport: Matrix,
  source: { width: number; height: number },
): { x0: number; y0: number; x1: number; y1: number }[] {
  if (native.length === 0) return [];
  return nativeRects(layoutText(native, pdfToPage(viewport, source, source)));
}
