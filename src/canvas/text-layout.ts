/**
 * Line layout for page text boxes.
 *
 * A text box is edited in a DOM `<textarea>` and painted onto canvas in the
 * page thumbnails, and the two must agree on where every line breaks — a box
 * that wraps "on the page" after one word and "in the thumbnail" after
 * another is the cross-device drift pages exist to prevent, in miniature.
 * So this module states the textarea's rules once, in page px:
 *
 * - The box is `w` wide with {@link TEXT_PAD_X} / {@link TEXT_PAD_Y} of
 *   padding. The view scales that padding with the page (ink-surface.ts), so
 *   the textarea's wrap width is zoom-invariant, as the canvas's is.
 * - Wrapping is `white-space: pre-wrap` plus `overflow-wrap: break-word`, a
 *   textarea's defaults: break at spaces, keep runs of spaces, let trailing
 *   spaces hang past the edge, and break inside a word only when it alone is
 *   wider than the line.
 * - A line box is `fontSize × lineHeight` tall and the glyphs sit in its
 *   middle (CSS half-leading).
 * - `justify` spreads the spare width over a line's word gaps, except on the
 *   last line of a paragraph, which stays left-aligned; content wider than the
 *   line is start-aligned whatever the alignment (CSS Text 3).
 *
 * Pure: the caller injects `measure(text) => width` — canvas `measureText` in
 * the renderer, a fake in the tests.
 */

import type { TextAlign } from "../model/document";
import { type TextStyle, fontFamilyOf, lineHeightOf } from "../model/text-style";

/** Horizontal padding inside a text box, in page px (the textarea's own, at 1:1). */
export const TEXT_PAD_X = 4;
/** Vertical padding inside a text box, in page px. */
export const TEXT_PAD_Y = 2;

/** Width of `text` in the font being laid out. */
export type Measure = (text: string) => number;

export interface WrappedLine {
  text: string;
  /** Ends its paragraph (a newline or the end of the text), so is never justified. */
  last: boolean;
}

/** One piece of a line drawn at `x`, relative to the start of the content box. */
export interface TextRun {
  text: string;
  x: number;
}

export interface LaidOutLine {
  runs: TextRun[];
  /** Where the line's ink starts and ends, for underline and strikethrough. */
  left: number;
  right: number;
}

/** A whole box, laid out: content origin, line pitch and every line. */
export interface TextBoxLayout {
  /** Top-left of the content box (inside the padding), page px. */
  x: number;
  y: number;
  /** Width lines are wrapped and aligned to. */
  width: number;
  /** Height of one line box: font size × line height. */
  lineBox: number;
  /** The box's height: its own for a fixed box, grown to its lines otherwise. */
  height: number;
  lines: LaidOutLine[];
}

/** Greedy wrap with a textarea's rules (see the module comment). */
export function wrapText(text: string, maxWidth: number, measure: Measure): WrappedLine[] {
  const width = Math.max(0, maxWidth);
  const lines: WrappedLine[] = [];
  for (const paragraph of text.split("\n")) {
    // Each word with the spaces after it; leading spaces are a token of their own.
    const tokens = paragraph.match(/\S+\s*|\s+/g) ?? [];
    let line = "";
    for (let token of tokens) {
      for (;;) {
        // Trailing spaces hang past the edge: they never force a break.
        if (measure((line + token).trimEnd()) <= width) {
          line += token;
          break;
        }
        if (line !== "") {
          lines.push({ text: line, last: false });
          line = "";
          continue;
        }
        // Alone on a line and still too wide: break inside the word, keeping
        // at least one character per line so a narrow box cannot loop.
        const chars = Array.from(token);
        let fit = 1;
        while (
          fit < chars.length &&
          measure(
            chars
              .slice(0, fit + 1)
              .join("")
              .trimEnd(),
          ) <= width
        ) {
          fit++;
        }
        let piece = chars.slice(0, fit).join("");
        let rest = chars.slice(fit).join("");
        // Spaces left after the break hang on the broken line, as in CSS.
        if (rest.trim() === "") {
          piece += rest;
          rest = "";
        }
        if (rest === "") {
          // The word's last piece is the start of a line like any other.
          line = piece;
          break;
        }
        lines.push({ text: piece, last: false });
        token = rest;
      }
    }
    lines.push({ text: line, last: true });
  }
  return lines;
}

/** Position every wrapped line within `width` for an alignment. */
export function alignLines(
  lines: readonly WrappedLine[],
  width: number,
  align: TextAlign,
  measure: Measure,
): LaidOutLine[] {
  return lines.map((line) => {
    const text = line.text.trimEnd();
    const used = measure(text);
    const spare = width - used;
    if (align === "justify" && !line.last && spare > 0) {
      const justified = justify(text, spare, measure);
      if (justified) return { runs: justified, left: justified[0]?.x ?? 0, right: width };
    }
    let offset = 0;
    if (spare > 0 && align === "center") offset = spare / 2;
    else if (spare > 0 && align === "right") offset = spare;
    return { runs: text ? [{ text, x: offset }] : [], left: offset, right: offset + used };
  });
}

/**
 * Spread `spare` evenly over the gaps between a line's words. `null` when the
 * line has no gap to spread it over (one word), which then aligns left.
 */
function justify(text: string, spare: number, measure: Measure): TextRun[] | null {
  const words: Array<{ text: string; start: number }> = [];
  const pattern = /\S+/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    words.push({ text: match[0], start: match.index });
  }
  if (words.length < 2) return null;
  const extra = spare / (words.length - 1);
  return words.map((word, i) => ({
    text: word.text,
    x: measure(text.slice(0, word.start)) + extra * i,
  }));
}

/**
 * Width a fitted box keeps beyond its widest line, page px: room for the
 * caret, and for the textarea measuring a hair wider than canvas does. Without
 * it the last character typed wraps onto a line of its own.
 */
export const TEXT_FIT_SLACK = 3;

/**
 * The width of a box that fits its text (GoodNotes' default): as wide as its
 * widest paragraph, padding included, never under `minWidth` and never past
 * `maxWidth` — where the page ends, after which the text wraps. Trailing
 * spaces hang, as they do in the textarea, so they do not widen the box.
 */
export function fitTextWidth(
  text: string,
  minWidth: number,
  maxWidth: number,
  measure: Measure,
): number {
  let widest = 0;
  for (const paragraph of text.split("\n")) {
    widest = Math.max(widest, measure(paragraph.trimEnd()));
  }
  const natural = Math.ceil(widest + 2 * TEXT_PAD_X + TEXT_FIT_SLACK);
  return Math.max(minWidth, Math.min(natural, maxWidth));
}

/** Lay out a whole box: its padding, wrap width, line pitch and height. */
export function layoutTextBox(
  box: TextStyle & { x: number; y: number; w: number; h?: number; text: string },
  measure: Measure,
): TextBoxLayout {
  const width = Math.max(0, box.w - 2 * TEXT_PAD_X);
  const lineBox = box.fontSize * lineHeightOf(box);
  const lines = alignLines(wrapText(box.text, width, measure), width, box.align ?? "left", measure);
  // An auto-height box is at least one line tall, as the textarea is.
  const height = box.h ?? 2 * TEXT_PAD_Y + Math.max(1, lines.length) * lineBox;
  return { x: box.x + TEXT_PAD_X, y: box.y + TEXT_PAD_Y, width, lineBox, height, lines };
}

/**
 * How far below the top of its line box a line's alphabetic baseline sits:
 * the glyph box (ascent + descent) is centred in the line box, as CSS does.
 */
export function baselineOffset(lineBox: number, ascent: number, descent: number): number {
  return (lineBox - (ascent + descent)) / 2 + ascent;
}

/** Underline and strikethrough placement relative to the baseline, and thickness. */
export function decorationMetrics(fontSize: number): {
  underline: number;
  strike: number;
  thickness: number;
} {
  return {
    underline: fontSize * 0.12,
    strike: -fontSize * 0.28,
    thickness: Math.max(1, fontSize / 16),
  };
}

/** A canvas `font` shorthand for a style: `italic bold 22px <families>`. */
export function canvasFont(style: TextStyle, px: number): string {
  const italic = style.italic ? "italic " : "";
  const bold = style.bold ? "bold " : "";
  return `${italic}${bold}${px}px ${fontFamilyOf(style)}`;
}

/** The CSS `text-decoration` for a style. */
export function textDecorationOf(style: TextStyle): string {
  const lines = [style.underline ? "underline" : "", style.strike ? "line-through" : ""];
  return lines.filter(Boolean).join(" ") || "none";
}
