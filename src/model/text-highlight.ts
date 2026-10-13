/**
 * A highlight snapped to a PDF's text, as stored. **Pure.**
 *
 * It is ordinary highlighter ink: one straight stroke per line of text, as
 * wide as the line is tall, in page space like every stroke. So it is drawn,
 * erased, lassoed, recoloured, exported and synced with no special case, and
 * a reader without this feature shows it exactly as it was drawn. The text
 * it covers is not stored: it is read from the PDF again when copied
 * (`canvas/pdf-text.ts`, `textUnder`), which is what lets a freehand
 * highlight be copied too.
 */

import type { Command } from "./commands";
import { POINT_STRIDE, type Page, type Stroke } from "./document";
import { addStrokesTimed } from "./recording-commands";

/** The undo step's name. */
export const HIGHLIGHT_TEXT_LABEL = "Highlight text";

/**
 * How far in from each end of a line's text the stroke's ends sit, as a share
 * of the line's height. The nib is round, so its cap reaches half a height
 * past each end: set in by 0.3, the highlight runs a fifth of a height past
 * the first and last letters, as a marker drawn along them would.
 */
const END_INSET = 0.3;

/** A highlighter stroke's pressure; the highlighter keeps one width, so it is never read. */
const PRESSURE = 0.5;

/** Stored geometry is rounded to hundredths of a page px, so a highlight saves the same everywhere. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The stroke covering one line's rectangle (page px): its centreline and width. */
export function highlightBand(rect: { x: number; y: number; w: number; h: number }): {
  pts: number[];
  size: number;
} {
  const inset = Math.min(rect.w / 2, rect.h * END_INSET);
  const y = round2(rect.y + rect.h / 2);
  return {
    pts: [round2(rect.x + inset), y, PRESSURE, round2(rect.x + rect.w - inset), y, PRESSURE],
    size: round2(rect.h),
  };
}

/** The strokes of a text highlight, one per rectangle, with ids from `nextId`. */
export function textHighlightStrokes(
  rects: readonly { x: number; y: number; w: number; h: number }[],
  color: string,
  nextId: () => string,
): Stroke[] {
  return rects
    .filter((rect) => rect.w > 0 && rect.h > 0)
    .map((rect) => {
      const { pts, size } = highlightBand(rect);
      return { id: nextId(), color, size, tool: "highlighter", pts, shape: "line" };
    });
}

/**
 * Add a text highlight to `page` as one undo step, timestamped with its
 * pen-down as any ink is (`addStrokesTimed`). Undo takes every line of it.
 */
export function highlightText(
  page: Page,
  strokes: readonly Stroke[],
  penDown: number | null | undefined,
): Command {
  return addStrokesTimed(page, strokes, penDown, HIGHLIGHT_TEXT_LABEL);
}

/** Whether a stroke is highlighter ink with points: what Copy text reads under. */
export function isHighlight(stroke: Stroke): boolean {
  return stroke.tool === "highlighter" && stroke.pts.length >= POINT_STRIDE;
}
