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
/** A piece of a formula this far above or below the line's band (in font heights) still joins it. */
const FORMULA_GAP = 1;
/** A piece of a formula this far right of the piece before it (in font heights) still joins it. */
const FORMULA_STEP = 1.5;
/** Clear of the line's band, a piece joins only when its font is at most this share of the line's. */
const FORMULA_SMALLER = 0.85;
/** A run of glyphs wider than this (in font heights) is text, never a piece to stack a formula's under. */
const FORMULA_RUN = 6;
/** Two glyphs on one baseline overlapping by more than this share of the narrower are printed over each other. */
const OVERPRINT = 0.5;
/** How many times pieces attach to rows: a second round takes a numerator past its row's end. */
const PIECE_ROUNDS = 2;
/** A formula's piece is set at most this much larger than the line it hangs on. */
const PIECE_FONT = 1.05;
/** Lines drawn apart join as a formula's piece when their bands overlap by at least this share of the shorter. */
const ROW_PART = 0.25;
/** A bracket's line joins the text inside it only when its band is at least this much taller. */
const TALLER = 1.3;
/** A line on another's band without sharing its baseline keeps its middle this share of its height inside that band. */
const BAND_MARGIN = 0.2;
/** Glyphs whose bottoms differ by at most this (in font heights) share a baseline run. */
const RUN_BASELINE = 0.25;
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
  /** Where its glyphs stand (y, page space). */
  baseline: number;
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
    item.descent !== undefined && Number.isFinite(item.descent) && item.descent !== 0
      ? Math.abs(item.descent)
      : DEFAULT_DESCENT;
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
  return { chars, x0, x1, top, bottom, baseline: m[5] };
}

/**
 * The glyphs drawn last on one baseline: where that run starts and ends,
 * and whether it is a piece of a formula off the line's own text (a limit,
 * a numerator) rather than the line's text.
 */
interface Run {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  piece: boolean;
}

/** `box` added to `run` when it sits on the same baseline, else a new run of it alone. */
function extendRun(run: Run | null, box: ItemBox, piece: boolean): Run {
  const height = Math.min(box.bottom - box.top, run ? run.bottom - run.top : Infinity);
  if (run && Math.abs(box.bottom - run.bottom) <= RUN_BASELINE * height) {
    return { ...run, x0: Math.min(run.x0, box.x0), x1: Math.max(run.x1, box.x1) };
  }
  return { x0: box.x0, x1: box.x1, top: box.top, bottom: box.bottom, piece };
}

/** Where a line's ink ends: its last character that is not a space (a space item can be page-wide). */
function inkEnd(chars: readonly TextChar[], line: TextLine): number {
  for (let i = line.end - 1; i >= line.start; i--) {
    if (!isSpace(chars[i].ch)) return chars[i].x1;
  }
  return line.x0;
}

/**
 * Whether `box` carries on `line`: as text on its band, not far before or
 * after its end, or as a piece of a formula in it ({@link continuesFormula}).
 */
function continuesLine(
  line: TextLine,
  box: ItemBox,
  previous: Run | null,
  lineFont: number,
  inkX1: number,
): boolean {
  const height = Math.min(line.bottom - line.top, box.bottom - box.top);
  const overlap = Math.min(line.bottom, box.bottom) - Math.max(line.top, box.top);
  const gap = box.x0 - line.x1;
  if (
    overlap >= LINE_OVERLAP * height &&
    gap >= -MAX_LINE_OVERLAP * height &&
    gap <= MAX_LINE_GAP * height
  ) {
    return true;
  }
  // Clear of the band, only a smaller piece (a sum's limits) is the
  // formula's; a stacked label or the next bullet is set as large.
  if (overlap <= 0 && box.bottom - box.top > FORMULA_SMALLER * lineFont) return false;
  return continuesFormula(box, previous, overlap, box.x0 - inkX1, height);
}

/**
 * Whether `box` is a piece of the formula the line is in, though it sits
 * above or below the line's band: a fraction's top or bottom, a sum's
 * limits. pdf.js gives each such piece as items of its own, and without
 * this every one was a line of its own, so the highlighter marked an
 * equation in scraps (FineNotes#159). It joins when it is within half a
 * height of the band (partly in it, or clear of it in a smaller font) and
 * either starts just after the line's last glyph, or stands over or under
 * the piece drawn before it (a sum's lower limit starts under the first
 * glyph of the upper one). Only under a short piece: the line's own text
 * above is a heading or the line before in a paragraph, never a numerator.
 */
function continuesFormula(
  box: ItemBox,
  previous: Run | null,
  overlap: number,
  gap: number,
  height: number,
): boolean {
  if (!previous || overlap < -FORMULA_GAP * height) return false;
  const after = gap >= -MAX_LINE_OVERLAP * height && gap <= FORMULA_STEP * height;
  const stacked =
    previous.piece &&
    previous.x1 - previous.x0 <= FORMULA_RUN * height &&
    box.x0 >= previous.x0 - MAX_LINE_OVERLAP * height &&
    box.x0 <= previous.x1 + FORMULA_STEP * height;
  return after || stacked;
}

/**
 * Lay a page's text items out in page space. `toPage` maps PDF user space to
 * the page ({@link pdfToPage}). Items that cannot be placed are skipped.
 */
export function layoutText(items: readonly PdfTextItem[], toPage: Matrix): TextLayout {
  const chars: TextChar[] = [];
  const lines: TextLine[] = [];
  let line: TextLine | null = null;
  let previous: Run | null = null;
  let lineFont = 0;
  let base = { top: 0, bottom: 0 };
  const fonts: number[] = [];
  const baselines: number[] = [];
  for (const item of items) {
    const box = placeItem(item, toPage);
    if (!box) continue;
    const joins = line ? continuesLine(line, box, previous, lineFont, inkEnd(chars, line)) : false;
    if (line && joins) {
      // A piece when it sits off the band of the glyph the line began with.
      const height = box.bottom - box.top;
      const onBase = Math.min(base.bottom, box.bottom) - Math.max(base.top, box.top);
      previous = extendRun(previous, box, onBase < LINE_OVERLAP * height);
      const last = chars[chars.length - 1];
      const gap = box.x0 - line.x1;
      const shorter = Math.min(line.bottom - line.top, height);
      if (gap > SPACE_GAP * shorter && !isSpace(last.ch) && !isSpace(box.chars[0].ch)) {
        chars.push({ ch: " ", x0: line.x1, x1: box.x0, virtual: true });
      }
      chars.push(...box.chars);
      line.end = chars.length;
      line.x1 = Math.max(line.x1, box.x1);
      line.top = Math.min(line.top, box.top);
      line.bottom = Math.max(line.bottom, box.bottom);
      continue;
    }
    lineFont = box.bottom - box.top;
    base = { top: box.top, bottom: box.bottom };
    previous = extendRun(null, box, false);
    const start = chars.length;
    chars.push(...box.chars);
    line = { start, end: chars.length, x0: box.x0, x1: box.x1, top: box.top, bottom: box.bottom };
    lines.push(line);
    fonts.push(lineFont);
    baselines.push(box.baseline);
  }
  return joinRows({ chars, lines }, fonts, baselines);
}
/**
 * Whether two lines (fonts `fa`, `fb`, baselines `ba`, `bb`: those of the
 * glyph each began with) stand together and near each other: on one
 * baseline, or the shorter well inside the taller's band (Word sets a big
 * bracket on a baseline of its own). Well inside, not half: a tall bracket
 * stretches its band over half the line above, and a denominator there is
 * not on its line.
 */
function sameBand(
  chars: readonly TextChar[],
  a: TextLine,
  fa: number,
  ba: number,
  b: TextLine,
  fb: number,
  bb: number,
): boolean {
  const font = Math.min(fa, fb);
  const gap = Math.max(b.x0 - a.x1, a.x0 - b.x1);
  // On one baseline, side by side, as the pass in drawing order joins items;
  // text printed over text is not one line.
  if (Math.abs(ba - bb) <= RUN_BASELINE * font) {
    return gap <= MAX_LINE_GAP * font && !overprinted(chars, a, b);
  }
  // Off the baseline only close, as a formula's pieces are.
  if (gap > FORMULA_STEP * font) return false;
  // A bracket set on its own baseline: the shorter line well inside the
  // taller one's band, and the taller one really taller.
  const [short, tall] = a.bottom - a.top <= b.bottom - b.top ? [a, b] : [b, a];
  const height = short.bottom - short.top;
  if (tall.bottom - tall.top < TALLER * height) return false;
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const middle = (short.top + short.bottom) / 2;
  return (
    overlap >= LINE_OVERLAP * height &&
    middle >= tall.top + BAND_MARGIN * height &&
    middle <= tall.bottom - BAND_MARGIN * height
  );
}

/**
 * Whether glyphs of two lines on one baseline stand on each other: text
 * printed over text. Glyph by glyph, not by the lines' spans: a line drawn
 * out of order has holes that the other line's glyphs fill.
 */
function overprinted(chars: readonly TextChar[], a: TextLine, b: TextLine): boolean {
  for (let i = a.start; i < a.end; i++) {
    const p = chars[i];
    if (isSpace(p.ch)) continue;
    for (let j = b.start; j < b.end; j++) {
      const q = chars[j];
      if (isSpace(q.ch)) continue;
      const overlap = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
      if (overlap > OVERPRINT * Math.min(p.x1 - p.x0, q.x1 - q.x0)) return true;
    }
  }
  return false;
}

/**
 * Whether line `p` (font `fp`) can be a piece of a formula on line `on`
 * (font `fon`): partly in its band, starting within its width or just after
 * it (a fraction ending a formula), and no larger.
 * Clear of the band it is not one: a formula's big bracket on one line would
 * reach the letters of the next (Word sets brackets in a font twice the
 * text's). Nor larger: a tall bracket reaching a denominator is not that
 * fraction's.
 */
function pieceOf(p: TextLine, fp: number, on: TextLine, fon: number): boolean {
  const height = Math.min(p.bottom - p.top, on.bottom - on.top);
  const overlap = Math.min(p.bottom, on.bottom) - Math.max(p.top, on.top);
  return (
    overlap >= ROW_PART * height &&
    fp <= PIECE_FONT * fon &&
    p.x0 >= on.x0 - FORMULA_STEP * fp &&
    p.x0 <= on.x1 + FORMULA_STEP * fp
  );
}

/**
 * Join the lines that sit together on the page, whatever order the PDF drew
 * them in, and put each joined line's characters left to right. A formula
 * set by Word or MathType is drawn a font at a time (its brackets, then its
 * letters, then its digits), so the pass in drawing order above makes a
 * line of nearly every glyph, and the highlighter marked it glyph by glyph
 * (FineNotes#159). First the lines on one band become rows; then each short
 * piece above or below (a fraction's top or bottom) goes to one row, the one
 * whose text runs nearest it, so a piece between two rows never joins them.
 * Lines keep the reading order of the first of each.
 */
function joinRows(
  layout: TextLayout,
  fonts: readonly number[],
  baselines: readonly number[],
): TextLayout {
  const { lines } = layout;
  const n = lines.length;
  if (n < 2) return layout;
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // A fragment: a line short for its font (a bracket, a letter, "dx"), what
  // a formula drawn out of order is made of. Text drawn whole comes as long
  // lines, and is only ever joined to fragments: two long lines side by side
  // are columns, or a diagram's labels.
  const fragment = lines.map((line, i) => line.x1 - line.x0 <= FORMULA_RUN * fonts[i]);
  let joined = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (find(i) === find(j) || !(fragment[i] || fragment[j])) continue;
      if (
        !sameBand(layout.chars, lines[i], fonts[i], baselines[i], lines[j], fonts[j], baselines[j])
      ) {
        continue;
      }
      parent[find(j)] = find(i);
      joined = true;
    }
  }
  // Twice: a numerator centred over its denominator lies past the row's end
  // until the denominator has joined it.
  for (let round = 0; round < PIECE_ROUNDS; round++) {
    // Each row after the first step: its box, its largest font, and where its
    // text runs (the middle of its lines, weighted by characters).
    interface Row {
      box: TextLine;
      font: number;
      sum: number;
      count: number;
      /** Made of fragments only: it may be a piece of another row. */
      loose: boolean;
      /** The baseline of its widest line. */
      baseline: number;
      widest: number;
    }
    const rows = new Map<number, Row>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      const line = lines[i];
      const count = Math.max(1, line.end - line.start);
      const row = rows.get(root);
      if (!row) {
        rows.set(root, {
          box: { ...line },
          font: fonts[i],
          sum: ((line.top + line.bottom) / 2) * count,
          count,
          loose: fragment[i],
          baseline: baselines[i],
          widest: line.x1 - line.x0,
        });
        continue;
      }
      row.loose &&= fragment[i];
      if (line.x1 - line.x0 > row.widest) {
        row.widest = line.x1 - line.x0;
        row.baseline = baselines[i];
      }
      row.box.x0 = Math.min(row.box.x0, line.x0);
      row.box.x1 = Math.max(row.box.x1, line.x1);
      row.box.top = Math.min(row.box.top, line.top);
      row.box.bottom = Math.max(row.box.bottom, line.bottom);
      row.font = Math.max(row.font, fonts[i]);
      row.sum += ((line.top + line.bottom) / 2) * count;
      row.count += count;
    }
    // A short row (a fraction's top or bottom) goes to the row whose text runs
    // nearest it, among those it is a piece of; as the rows stood after the
    // first step, so no piece chains two rows together.
    const attach: Array<[number, number]> = [];
    for (const [own, piece] of rows) {
      if (!piece.loose) continue;
      const centre = (piece.box.top + piece.box.bottom) / 2;
      let best = -1;
      let bestDistance = Infinity;
      for (const [target, row] of rows) {
        if (target === own || !pieceOf(piece.box, piece.font, row.box, row.font)) continue;
        // Above or below it: on its own baseline it is text printed over it.
        if (Math.abs(row.baseline - piece.baseline) <= RUN_BASELINE * piece.font) continue;
        // Only onto a wider row: of two that overlap, the narrower is the piece.
        if (row.box.x1 - row.box.x0 <= piece.box.x1 - piece.box.x0) continue;
        const distance = Math.abs(row.sum / row.count - centre);
        if (distance < bestDistance) {
          best = target;
          bestDistance = distance;
        }
      }
      if (best >= 0) attach.push([own, best]);
    }
    for (const [piece, row] of attach) {
      parent[find(piece)] = find(row);
      joined = true;
    }
  }
  if (!joined) return layout;
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const members = groups.get(root);
    if (members) members.push(i);
    else groups.set(root, [i]);
  }
  const chars: TextChar[] = [];
  const out: TextLine[] = [];
  for (const members of [...groups.values()].sort((a, b) => a[0] - b[0])) {
    const start = chars.length;
    if (members.length === 1) {
      const line = lines[members[0]];
      chars.push(...layout.chars.slice(line.start, line.end));
      out.push({ ...line, start, end: chars.length });
      continue;
    }
    const font = Math.min(...members.map((i) => fonts[i]));
    const own = members
      .flatMap((i) => layout.chars.slice(lines[i].start, lines[i].end))
      .filter((c) => !c.virtual)
      .sort((a, b) => a.x0 - b.x0);
    for (const ch of own) {
      const last = chars.length > start ? chars[chars.length - 1] : null;
      // A space where pieces stand apart, as between items on one line.
      if (last && ch.x0 - last.x1 > SPACE_GAP * font && !isSpace(last.ch) && !isSpace(ch.ch)) {
        chars.push({ ch: " ", x0: last.x1, x1: ch.x0, virtual: true });
      }
      chars.push(ch);
    }
    const box = members.map((i) => lines[i]);
    out.push({
      start,
      end: chars.length,
      x0: Math.min(...box.map((l) => l.x0)),
      x1: Math.max(...box.map((l) => l.x1)),
      top: Math.min(...box.map((l) => l.top)),
      bottom: Math.max(...box.map((l) => l.bottom)),
    });
  }
  return { chars, lines: out };
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

/**
 * The caret nearest page point (`x`, `y`): in the line nearest it, before
 * the first character whose middle is past `x`. -1 when the page has no text.
 */
export function caretAt(layout: TextLayout, x: number, y: number): number {
  const index = nearestLine(layout, x, y);
  return index < 0 ? -1 : caretIn(layout, layout.lines[index], x);
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
