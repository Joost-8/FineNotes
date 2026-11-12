/**
 * Layout of a Markdown text box at rest (discussion #107). PURE.
 *
 * `model/markdown-text.ts` reads the box's text into blocks of styled spans;
 * this places them: each block's font size (headings larger), its indent
 * (lists, quotes), where its marker goes (a bullet, a number, a task's box),
 * and where each line breaks. The renderer paints the result
 * (`paintMarkdownText`) for the page itself, its thumbnails, exports and the
 * AI's page render alike, so a box breaks at the same words everywhere.
 *
 * The rules follow `text-layout.ts` where they overlap: the same padding and
 * border inset, break at spaces with trailing spaces hanging, break inside a
 * word only when it alone is wider than the line, and a line box of
 * `size × lineHeight` with the glyphs in its middle. Alignment applies to
 * paragraphs and headings; lists, quotes and code keep to the left, as in a
 * note. A box's own bold, italic, underline and strike apply under the
 * Markdown, and capitals (`caps`) to the shown text, never to a link's target.
 *
 * Pure: the caller injects `measure(text, font)`.
 */

import { type MdBlock, type MdSpan, parseMarkdown } from "../model/markdown-text";
import { type TextStyle, lineHeightOf } from "../model/text-style";
import { textInset } from "./text-layout";

/** The face a run is drawn in. */
export interface MdFont {
  /** Page px. */
  size: number;
  bold: boolean;
  italic: boolean;
  /** Inline code and code blocks: the box's monospace face. */
  mono: boolean;
}

/** Width of `text` drawn in `font`. */
export type MdMeasure = (text: string, font: MdFont) => number;

/** A piece of a line in one look, at `x` from the content box's left. */
export interface MdRun {
  text: string;
  x: number;
  /** Its measured width. */
  w: number;
  font: MdFont;
  /** Drawn in the link colour, underlined; a tap opens `target`. */
  target?: string;
  /** Drawn on a tint, as inline code. */
  code?: true;
  /** Drawn on a highlighter's yellow. */
  mark?: true;
  strike?: true;
  underline?: true;
  /** Drawn faint: a ticked task's words. */
  muted?: true;
}

/** One line, `top` below the content box's top. */
export interface MdLine {
  top: number;
  /** Its line box's height. */
  height: number;
  /** The font size its glyphs are centred for (the block's). */
  size: number;
  runs: MdRun[];
}

/**
 * What is drawn round the words, in the content box's coordinates: a list
 * item's marker (on its first line), a quote's bar, a code block's tint, a
 * rule.
 */
export type MdMark =
  | { kind: "bullet"; x: number; y: number; size: number; depth: number }
  | { kind: "number"; x: number; y: number; size: number; text: string }
  | { kind: "task"; x: number; y: number; size: number; done: boolean; line: number }
  | { kind: "quote" | "code" | "rule"; x: number; y: number; w: number; h: number };

export interface MarkdownLayout {
  /** Top-left of the content box, page px. */
  x: number;
  y: number;
  /** Width the lines are wrapped to. */
  width: number;
  /** The box's height: its own for a fixed box, grown to its lines otherwise. */
  height: number;
  lines: MdLine[];
  marks: MdMark[];
}

/**
 * Heading sizes as a share of the box's font size: Obsidian's default theme
 * (`--h1-size` 1.802em … `--h6-size` 1em).
 */
export const HEADING_SCALE: readonly number[] = [1.802, 1.602, 1.424, 1.266, 1.125, 1];

/** A list level's indent, and the column its marker sits in, in ems of the block. */
export const LIST_INDENT_EM = 1.5;
/** A quote level's indent, in ems of the box's font. */
const QUOTE_INDENT_EM = 1;
/** Room before a code block's text, in ems. */
const CODE_PAD_EM = 0.5;
/** A quote bar's width as a share of the box's font size, at least 2 px. */
const QUOTE_BAR_EM = 0.12;

/** A box as this layout reads it. */
export type MarkdownBox = TextStyle & { x: number; y: number; w: number; h?: number; text: string };

interface Piece {
  text: string;
  w: number;
  /** Width without trailing spaces, which hang past the edge. */
  trim: number;
  font: MdFont;
  span: Omit<MdSpan, "text">;
  muted: boolean;
}

/** A span's look without its text. */
function lookOf(span: MdSpan): Omit<MdSpan, "text"> {
  const look: Omit<MdSpan, "text"> = {};
  if (span.bold) look.bold = true;
  if (span.italic) look.italic = true;
  if (span.strike) look.strike = true;
  if (span.code) look.code = true;
  if (span.mark) look.mark = true;
  if (span.target !== undefined) look.target = span.target;
  return look;
}

/** Each word with the spaces after it, split where a line may break. */
function wordsOf(pieces: readonly Piece[]): Piece[][] {
  const words: Piece[][] = [];
  let word: Piece[] = [];
  for (const piece of pieces) {
    word.push(piece);
    if (/\s$/.test(piece.text)) {
      words.push(word);
      word = [];
    }
  }
  if (word.length > 0) words.push(word);
  return words;
}

function sameRun(a: Piece, b: Piece): boolean {
  return (
    a.font.size === b.font.size &&
    a.font.bold === b.font.bold &&
    a.font.italic === b.font.italic &&
    a.font.mono === b.font.mono &&
    a.span.target === b.span.target &&
    a.span.code === b.span.code &&
    a.span.mark === b.span.mark &&
    a.span.strike === b.span.strike &&
    a.muted === b.muted
  );
}

/**
 * Greedy wrap of a block's pieces to `width`: lines of pieces, each line's
 * pieces still in order.
 */
function wrapPieces(pieces: readonly Piece[], width: number, measure: MdMeasure): Piece[][] {
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let used = 0;
  let usedTrim = 0;
  const breakLine = (): void => {
    lines.push(line);
    line = [];
    used = 0;
    usedTrim = 0;
  };
  for (const word of wordsOf(pieces)) {
    const w = word.reduce((n, p) => n + p.w, 0);
    const trim = w - word[word.length - 1].w + word[word.length - 1].trim;
    if (used + trim <= width || (line.length === 0 && trim <= width)) {
      line.push(...word);
      used += w;
      usedTrim = used - w + trim;
      continue;
    }
    if (line.length > 0) breakLine();
    if (trim <= width) {
      line.push(...word);
      used = w;
      usedTrim = trim;
      continue;
    }
    // Alone and still too wide: break inside it, a character at a time,
    // keeping at least one per line so a narrow box cannot loop.
    for (const piece of word) {
      for (const char of Array.from(piece.text)) {
        const cw = measure(char, piece.font);
        const blank = /\s/.test(char);
        if (line.length > 0 && !blank && usedTrim + cw > width) breakLine();
        line.push({ ...piece, text: char, w: cw, trim: blank ? 0 : cw });
        used += cw;
        if (!blank) usedTrim = used;
      }
    }
  }
  if (line.length > 0 || lines.length === 0) lines.push(line);
  return lines;
}

/** A line's pieces as runs from `x0`, neighbours in one look joined. */
function runsOf(line: readonly Piece[], x0: number, measure: MdMeasure, base: TextStyle): MdRun[] {
  const runs: MdRun[] = [];
  let x = x0;
  let last: Piece | null = null;
  for (const piece of line) {
    const prev = runs[runs.length - 1];
    if (prev && last && sameRun(last, piece)) {
      prev.text += piece.text;
      prev.w = measure(prev.text, prev.font);
    } else {
      const run: MdRun = { text: piece.text, x, w: piece.w, font: piece.font };
      if (piece.span.target !== undefined) run.target = piece.span.target;
      if (piece.span.code) run.code = true;
      if (piece.span.mark) run.mark = true;
      if (piece.span.strike || base.strike || piece.muted) run.strike = true;
      if (base.underline || piece.span.target !== undefined) run.underline = true;
      if (piece.muted) run.muted = true;
      runs.push(run);
    }
    last = piece;
    const tail = runs[runs.length - 1];
    x = tail.x + tail.w;
  }
  return runs;
}

/** Where a laid-out line's ink ends, trailing spaces aside. */
function inkRight(runs: readonly MdRun[], measure: MdMeasure): number {
  const last = runs[runs.length - 1];
  if (!last) return 0;
  return last.x + measure(last.text.trimEnd(), last.font);
}

/** A block's font size: a heading's scale of the box's, else the box's. */
function sizeOf(block: MdBlock, base: number): number {
  return block.kind === "heading" ? base * (HEADING_SCALE[block.level - 1] ?? 1) : base;
}

/** Lay out a Markdown box: its blocks, their markers and lines, and its height. */
export function layoutMarkdownBox(box: MarkdownBox, measure: MdMeasure): MarkdownLayout {
  const inset = textInset(box);
  const width = Math.max(0, box.w - 2 * inset.x);
  const lines: MdLine[] = [];
  const marks: MdMark[] = [];
  const lineHeight = lineHeightOf(box);
  const caps = box.caps === true;
  let top = 0;
  for (const block of parseMarkdown(box.text)) {
    const size = sizeOf(block, box.fontSize);
    const lineBox = size * lineHeight;
    const quoteX = block.quote * box.fontSize * QUOTE_INDENT_EM;
    const blockTop = top;
    let left = quoteX;
    const listed = block.kind === "bullet" || block.kind === "number" || block.kind === "task";
    if (listed) {
      const column = size * LIST_INDENT_EM;
      const markX = quoteX + block.depth * column;
      left = markX + column;
      if (block.kind === "bullet") {
        marks.push({ kind: "bullet", x: markX, y: blockTop, size, depth: block.depth });
      } else if (block.kind === "task") {
        marks.push({
          kind: "task",
          x: markX,
          y: blockTop,
          size,
          done: block.done,
          line: block.line,
        });
      } else {
        // A long number pushes the text over rather than run into it.
        const numberW = measure(block.marker, { size, bold: false, italic: false, mono: false });
        left = Math.max(left, markX + numberW + size * 0.3);
        marks.push({ kind: "number", x: markX, y: blockTop, size, text: block.marker });
      }
    }
    if (block.kind === "code") left = quoteX + size * CODE_PAD_EM;
    const room = Math.max(0, width - left);
    const muted = block.kind === "task" && block.done;
    const heading = block.kind === "heading";
    const mono = block.kind === "code";
    const pieces: Piece[] = [];
    for (const span of block.spans) {
      const font: MdFont = {
        size,
        bold: box.bold === true || span.bold === true || heading,
        italic: box.italic === true || span.italic === true,
        mono: mono || span.code === true,
      };
      const text = caps ? span.text.toUpperCase() : span.text;
      const look = lookOf(span);
      for (const part of text.match(/\S+\s*|\s+/g) ?? []) {
        const w = measure(part, font);
        const trimmed = part.trimEnd();
        pieces.push({
          text: part,
          w,
          trim: trimmed === part ? w : measure(trimmed, font),
          font,
          span: look,
          muted,
        });
      }
    }
    const wrapped = block.kind === "rule" ? [[]] : wrapPieces(pieces, room, measure);
    const align = box.align ?? "left";
    const aligned =
      (block.kind === "paragraph" || heading) && align !== "left" && align !== "justify";
    for (const piecesOfLine of wrapped) {
      let runs = runsOf(piecesOfLine, left, measure, box);
      if (aligned && runs.length > 0) {
        const spare = room - (inkRight(runs, measure) - left);
        const shift = spare > 0 ? (align === "center" ? spare / 2 : spare) : 0;
        if (shift > 0) runs = runs.map((run) => ({ ...run, x: run.x + shift }));
      }
      lines.push({ top, height: lineBox, size, runs });
      top += lineBox;
    }
    const blockH = top - blockTop;
    if (block.kind === "rule") {
      const thick = Math.max(1, box.fontSize / 16);
      marks.push({
        kind: "rule",
        x: quoteX,
        y: blockTop + (blockH - thick) / 2,
        w: Math.max(0, width - quoteX),
        h: thick,
      });
    }
    if (block.kind === "code") {
      marks.push({
        kind: "code",
        x: quoteX,
        y: blockTop,
        w: Math.max(0, width - quoteX),
        h: blockH,
      });
    }
    for (let q = 0; q < block.quote; q++) {
      const bar = Math.max(2, box.fontSize * QUOTE_BAR_EM);
      marks.push({
        kind: "quote",
        x: q * box.fontSize * QUOTE_INDENT_EM,
        y: blockTop,
        w: bar,
        h: blockH,
      });
    }
  }
  // Never shorter than one line, as a plain box.
  const content = Math.max(top, box.fontSize * lineHeight);
  const height = box.h ?? content + 2 * inset.y;
  return { x: box.x + inset.x, y: box.y + inset.y, width, height, lines, marks };
}

/**
 * How wide a Markdown box that fits its text must be for no line to wrap:
 * its widest line laid out unwrapped, padding included, between `minWidth`
 * and `maxWidth` (where the page ends).
 */
export function fitMarkdownWidth(
  box: MarkdownBox,
  minWidth: number,
  maxWidth: number,
  measure: MdMeasure,
  slack: number,
): number {
  const inset = textInset(box);
  const open = layoutMarkdownBox({ ...box, w: 1e7, h: undefined }, measure);
  let widest = 0;
  for (const line of open.lines) widest = Math.max(widest, inkRight(line.runs, measure));
  const natural = Math.ceil(widest + 2 * inset.x + slack);
  return Math.max(minWidth, Math.min(natural, maxWidth));
}

/** Every link on a laid-out box, as rectangles in page px (unturned) and where each leads. */
export function markdownLinkRects(
  layout: MarkdownLayout,
): Array<{ x: number; y: number; w: number; h: number; target: string }> {
  const out: Array<{ x: number; y: number; w: number; h: number; target: string }> = [];
  for (const line of layout.lines) {
    for (const run of line.runs) {
      if (run.target === undefined) continue;
      out.push({
        x: layout.x + run.x,
        y: layout.y + line.top,
        w: run.w,
        h: line.height,
        target: run.target,
      });
    }
  }
  return out;
}

/** The side of a task's box, page px, for a block at font size `size`. */
export function taskBoxSize(size: number): number {
  return size * 0.78;
}
