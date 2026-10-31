/**
 * A PDF page's text in page space: what the highlighter snaps to and what
 * Copy reads. **Pure:** pdf.js text items in (`getTextContent`), characters,
 * lines, ranges and rectangles out. No DOM, no pdf.js.
 *
 * pdf.js reports text as items: a string, the matrix that places it (font
 * size and position, in PDF user space, y up), its advance width and font
 * height. It does not say where each character is, so the item's exact width
 * is shared out over its characters by their Helvetica advances, close
 * enough for most fonts to put a word boundary under the right character.
 *
 * Items are laid out into lines in the order the PDF draws them, and a
 * selection runs from line to line in that order, as in a PDF viewer.
 * Only text that runs left to right in page space is kept: rotated or
 * vertical text is left to the freehand highlighter. A scanned page has no
 * items, so its layout is empty and nothing ever snaps.
 */

/** A 2D affine matrix `[a, b, c, d, e, f]`, as pdf.js and canvas write it. */
export type Matrix = readonly [number, number, number, number, number, number];

/** One item of pdf.js `getTextContent().items`, plus its font's metrics when known. */
export interface PdfTextItem {
  str: string;
  transform: readonly number[];
  /** Advance along the baseline, PDF user space. */
  width: number;
  /** Font height, PDF user space. */
  height: number;
  /** Font ascent as a fraction of the font size (pdf.js `styles[fontName].ascent`). */
  ascent?: number;
  /** Font descent as a fraction of the font size; pdf.js gives it negative. */
  descent?: number;
  /** pdf.js `styles[fontName].vertical`: vertical writing, never snapped to. */
  vertical?: boolean;
}

/** A character placed in page space. A space between two items has `virtual` set. */
export interface TextChar {
  ch: string;
  x0: number;
  x1: number;
  virtual?: true;
}

/** A line of text: `chars[start..end)` of the layout, and the band they sit in. */
export interface TextLine {
  start: number;
  end: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface TextLayout {
  chars: TextChar[];
  lines: TextLine[];
}

/** An axis-aligned rectangle in page space. */
export interface TextRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A run of the layout's characters, `[start, end)`, in reading order. */
export interface TextRange {
  start: number;
  end: number;
}

/** What a highlighter drag over text covers. */
export interface TextSelection extends TextRange {
  /** One per line, in reading order. */
  rects: TextRect[];
  text: string;
}

/** pdf.js's own fallback when a font says nothing (`DEFAULT_FONT_ASCENT`). */
const DEFAULT_ASCENT = 0.8;
const DEFAULT_DESCENT = 0.2;
/** Text whose baseline leans more than this (dy per dx) is not run left to right. */
const MAX_SLOPE = 0.05;
/** Two items share a line when their bands overlap by this share of the shorter one. */
const LINE_OVERLAP = 0.5;
/** An item this far right of the line's end (in font heights) starts a new line. */
const MAX_LINE_GAP = 4;
/** An item this far back over the line's end (in font heights) starts a new line. */
const MAX_LINE_OVERLAP = 0.5;
/** A gap this wide (in font heights) between two items is a space. */
const SPACE_GAP = 0.12;

/**
 * Helvetica's advances (thousandths of an em) for printable ASCII, from
 * space to tilde: only their proportions within an item are used.
 */
const ASCII_ADVANCES = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const OTHER_ADVANCE = 556;
const WIDE_ADVANCE = 1000;

/** `a ∘ b`: apply `b`, then `a`. */
export function multiply(a: Matrix, b: Matrix): Matrix {
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
 * PDF user space to page space for a page drawn as the backdrop draws it:
 * scaled to fit inside the page and centred (`pdf-raster.ts`). `viewport` is
 * pdf.js `getViewport({ scale: 1 }).transform` (y flipped, rotation
 * applied), `source` that viewport's size. `area` is the page, or the frame
 * on it the PDF is fitted into (a page widened with Add space: `x`, `y` set).
 */
export function pdfToPage(
  viewport: Matrix,
  source: { width: number; height: number },
  area: { width: number; height: number; x?: number; y?: number },
): Matrix {
  const fit = Math.min(area.width / source.width, area.height / source.height);
  const dx = (area.x ?? 0) + (area.width - source.width * fit) / 2;
  const dy = (area.y ?? 0) + (area.height - source.height * fit) / 2;
  return multiply([fit, 0, 0, fit, dx, dy], viewport);
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60)
  );
}

function advance(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 32 && code <= 126) return ASCII_ADVANCES[code - 32];
  return isWide(code) ? WIDE_ADVANCE : OTHER_ADVANCE;
}

function isSpace(ch: string): boolean {
  return ch.trim() === "";
}

/** A word is a run of non-space characters; an ideograph is a word by itself. */
function joinsWord(ch: string): boolean {
  return !isSpace(ch) && !isWide(ch.codePointAt(0) ?? 0);
}

interface ItemBox {
  chars: TextChar[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

/** An item's characters and band in page space, or null when it cannot be snapped to. */
function placeItem(item: PdfTextItem, toPage: Matrix): ItemBox | null {
  if (item.vertical || item.str.length === 0) return null;
  const t = item.transform;
  if (t.length < 6 || !t.every(Number.isFinite)) return null;
  if (!(item.width > 0) || !Number.isFinite(item.width)) return null;
  const textMatrix: Matrix = [t[0], t[1], t[2], t[3], t[4], t[5]];
  const scaleX = Math.hypot(t[0], t[1]);
  if (!(scaleX > 0)) return null;
  const m = multiply(toPage, textMatrix);
  // Left to right in page space, upright: up in text is up the page (-y).
  if (!(m[0] > 0) || Math.abs(m[1]) > MAX_SLOPE * m[0] || !(m[3] < 0)) return null;
  const ascent = item.ascent !== undefined && item.ascent > 0 ? item.ascent : DEFAULT_ASCENT;
  const descent =
    item.descent !== undefined && item.descent !== 0 ? Math.abs(item.descent) : DEFAULT_DESCENT;
  const length = (item.width / scaleX) * m[0];
  const x0 = m[4];
  const x1 = x0 + length;
  const top = m[5] + ascent * m[3];
  const bottom = m[5] - descent * m[3];
  if (![x1, top, bottom].every(Number.isFinite) || !(bottom > top) || !(x1 > x0)) return null;
  const glyphs = Array.from(item.str);
  const weights = glyphs.map(advance);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const chars: TextChar[] = [];
  let at = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const from = x0 + (at / total) * length;
    at += weights[i];
    chars.push({ ch: glyphs[i], x0: from, x1: x0 + (at / total) * length });
  }
  return { chars, x0, x1, top, bottom };
}

/** Whether `box` carries on `line`: the same band, and not far before or after its end. */
function continuesLine(line: TextLine, box: ItemBox): boolean {
  const height = Math.min(line.bottom - line.top, box.bottom - box.top);
  const overlap = Math.min(line.bottom, box.bottom) - Math.max(line.top, box.top);
  if (overlap < LINE_OVERLAP * height) return false;
  const gap = box.x0 - line.x1;
  return gap >= -MAX_LINE_OVERLAP * height && gap <= MAX_LINE_GAP * height;
}

/**
 * Lay a page's text items out in page space. `toPage` maps PDF user space to
 * the page ({@link pdfToPage}). Items that cannot be placed are skipped.
 */
export function layoutText(items: readonly PdfTextItem[], toPage: Matrix): TextLayout {
  const chars: TextChar[] = [];
  const lines: TextLine[] = [];
  let line: TextLine | null = null;
  for (const item of items) {
    const box = placeItem(item, toPage);
    if (!box) continue;
    if (line && continuesLine(line, box)) {
      const last = chars[chars.length - 1];
      const gap = box.x0 - line.x1;
      const height = Math.min(line.bottom - line.top, box.bottom - box.top);
      if (gap > SPACE_GAP * height && !isSpace(last.ch) && !isSpace(box.chars[0].ch)) {
        chars.push({ ch: " ", x0: line.x1, x1: box.x0, virtual: true });
      }
      chars.push(...box.chars);
      line.end = chars.length;
      line.x1 = Math.max(line.x1, box.x1);
      line.top = Math.min(line.top, box.top);
      line.bottom = Math.max(line.bottom, box.bottom);
      continue;
    }
    const start = chars.length;
    chars.push(...box.chars);
    line = { start, end: chars.length, x0: box.x0, x1: box.x1, top: box.top, bottom: box.bottom };
    lines.push(line);
  }
  return { chars, lines };
}

/** How far `pt` is from a line's box, 0 inside it. */
function distanceToLine(line: TextLine, x: number, y: number): number {
  const dx = Math.max(line.x0 - x, 0, x - line.x1);
  const dy = Math.max(line.top - y, 0, y - line.bottom);
  return Math.hypot(dx, dy);
}

/**
 * The line `pt` is over, allowing `slop` page px all round (an on-screen
 * margin the caller converts), or -1 when it is over no text: the drag
 * then stays freehand.
 */
export function lineAt(layout: TextLayout, x: number, y: number, slop = 0): number {
  let best = -1;
  let bestDistance = Infinity;
  layout.lines.forEach((line, index) => {
    const distance = distanceToLine(line, x, y);
    if (distance <= slop && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** The line nearest `pt`, wherever it is; -1 only when the page has no text. */
function nearestLine(layout: TextLayout, x: number, y: number): number {
  let best = -1;
  let bestDistance = Infinity;
  layout.lines.forEach((line, index) => {
    const distance = distanceToLine(line, x, y);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** The caret in `line` nearest `x`: the index of the first character whose middle is past it. */
function caretIn(layout: TextLayout, line: TextLine, x: number): number {
  let at = line.start;
  while (at < line.end) {
    const ch = layout.chars[at];
    if ((ch.x0 + ch.x1) / 2 > x) break;
    at++;
  }
  return at;
}

/** The character of `line` under `x`, or the nearest one; never a space. -1 if all are. */
function charIn(layout: TextLayout, line: TextLine, x: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = line.start; i < line.end; i++) {
    const ch = layout.chars[i];
    if (isSpace(ch.ch)) continue;
    const distance = Math.max(ch.x0 - x, 0, x - ch.x1);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function lineOf(layout: TextLayout, index: number): TextLine | null {
  return layout.lines.find((line) => index >= line.start && index < line.end) ?? null;
}

/**
 * Widen `[lo, hi)` to whole words, within each end's line, and drop spaces
 * at either end. A range that holds no word becomes empty (`start === end`).
 */
function wholeWords(layout: TextLayout, lo: number, hi: number): TextRange {
  const { chars } = layout;
  const first = lineOf(layout, lo);
  if (first && lo < chars.length && joinsWord(chars[lo].ch)) {
    while (lo > first.start && joinsWord(chars[lo - 1].ch)) lo--;
  }
  const last = lineOf(layout, hi - 1);
  if (last && hi > 0 && joinsWord(chars[hi - 1].ch)) {
    while (hi < last.end && joinsWord(chars[hi].ch)) hi++;
  }
  while (lo < hi && isSpace(chars[lo].ch)) lo++;
  while (hi > lo && isSpace(chars[hi - 1].ch)) hi--;
  return { start: lo, end: hi };
}

/**
 * What a highlighter drag from `from` to `to` (page px) covers, or null when
 * it did not start over text (`slop` as in {@link lineAt}). The drag runs
 * from caret to caret in reading order and takes whole words, so a pen that
 * lands a little inside a word still takes all of it; a drag too short to
 * cross a character takes the word it started on.
 */
export function selectText(
  layout: TextLayout,
  from: { x: number; y: number },
  to: { x: number; y: number },
  slop = 0,
): TextSelection | null {
  const anchorLine = lineAt(layout, from.x, from.y, slop);
  if (anchorLine < 0) return null;
  const anchor = layout.lines[anchorLine];
  const focusLine = layout.lines[nearestLine(layout, to.x, to.y)];
  const a = caretIn(layout, anchor, from.x);
  const b = caretIn(layout, focusLine, to.x);
  let range = wholeWords(layout, Math.min(a, b), Math.max(a, b));
  if (range.start === range.end) {
    // A drag too short to cross a letter, or across space only: the word
    // under the pen-down.
    const under = charIn(layout, anchor, from.x);
    if (under < 0) return null;
    range = wholeWords(layout, under, under + 1);
  }
  return { ...range, rects: rangeRects(layout, range), text: rangeText(layout, range) };
}

/** One rectangle per line the range touches: its characters' span, the line's band. */
export function rangeRects(layout: TextLayout, range: TextRange): TextRect[] {
  const rects: TextRect[] = [];
  for (const line of layout.lines) {
    const start = Math.max(range.start, line.start);
    let end = Math.min(range.end, line.end);
    while (end > start && isSpace(layout.chars[end - 1].ch)) end--;
    let from = start;
    while (from < end && isSpace(layout.chars[from].ch)) from++;
    if (from >= end) continue;
    const x0 = layout.chars[from].x0;
    const x1 = layout.chars[end - 1].x1;
    rects.push({ x: x0, y: line.top, w: x1 - x0, h: line.bottom - line.top });
  }
  return rects;
}

/** The range's text: a line break between lines, each line trimmed. */
export function rangeText(layout: TextLayout, range: TextRange): string {
  const parts: string[] = [];
  for (const line of layout.lines) {
    const start = Math.max(range.start, line.start);
    const end = Math.min(range.end, line.end);
    if (start >= end) continue;
    const text = layout.chars
      .slice(start, end)
      .map((c) => c.ch)
      .join("")
      .trim();
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

/** Ink to read text under: a polyline (`[x, y, pressure, …]`) and its width. */
export interface InkBand {
  pts: readonly number[];
  size: number;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether a character's middle lies under the ink of `band`. */
function underBand(band: InkBand, x: number, y: number): boolean {
  const { pts } = band;
  const reach = band.size / 2;
  if (pts.length < 3) return false;
  if (pts.length < 6) return Math.hypot(x - pts[0], y - pts[1]) <= reach;
  for (let i = 0; i + 5 < pts.length; i += 3) {
    if (distanceToSegment(x, y, pts[i], pts[i + 1], pts[i + 3], pts[i + 4]) <= reach) return true;
  }
  return false;
}

/**
 * The text under highlighter ink, snapped or freehand: every character whose
 * middle the ink covers, in reading order, a line break between lines and a
 * space where uncovered words were skipped. Empty when it covers no text.
 */
export function textUnder(layout: TextLayout, bands: readonly InkBand[]): string {
  const parts: string[] = [];
  for (const line of layout.lines) {
    const y = (line.top + line.bottom) / 2;
    let text = "";
    let skipped = false;
    for (let i = line.start; i < line.end; i++) {
      const ch = layout.chars[i];
      const x = (ch.x0 + ch.x1) / 2;
      if (!bands.some((band) => underBand(band, x, y))) {
        if (text && !isSpace(ch.ch)) skipped = true;
        continue;
      }
      if (skipped && !text.endsWith(" ") && !isSpace(ch.ch)) text += " ";
      skipped = false;
      text += ch.ch;
    }
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join("\n");
}

/**
 * What the highlighter did where it came down on a PDF page, for the debug
 * overlay: snapped to text (and which), or why not — the page's text not
 * read yet, a page with no text (a scan), or the pen beside the text.
 */
export function textMarkNote(layout: TextLayout | null, selection: TextSelection | null): string {
  if (!layout) return "text not read yet";
  if (layout.chars.length === 0) return "page has no text";
  if (!selection) return `off the text (${layout.lines.length} lines)`;
  const text = selection.text.replace(/\s+/g, " ").trim();
  return `snapped "${text.length > 24 ? `${text.slice(0, 24)}…` : text}"`;
}
