/**
 * Cover tape snapped to a PDF's text (FineNotes#164). **Pure.**
 *
 * A tape dragged along a line of text covers that line's band: one level
 * strip per line the drag runs over, a little taller and longer than the
 * letters so none of them shows at its edges. Each strip is an ordinary tape
 * (`model/cover-tape.ts`), so it is revealed, moved, stretched and erased as
 * any tape is, and a reader without this feature shows it as it was laid.
 */

import type { Stroke } from "./document";

/**
 * How far a strip reaches past its line's letters, above and below and at
 * each end, as a share of the line's height: enough to hide ascenders,
 * descenders and anti-aliasing, not so much that it covers the next line
 * (lines sit about half a height apart).
 */
export const TEXT_TAPE_PAD = 0.15;

/** A tape's sample pressure; a tape has one height, so it is never read. */
const PRESSURE = 0.5;

/** Stored geometry is rounded to hundredths of a page px, as every snapped mark is. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The tape covering one line's rectangle (page px): its centreline, from the
 * middle of one square end to the other, and its height. Null for an empty
 * or broken rectangle.
 */
export function textTapeBand(rect: { x: number; y: number; w: number; h: number }): {
  pts: number[];
  size: number;
} | null {
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) return null;
  const pad = h * TEXT_TAPE_PAD;
  const mid = round2(y + h / 2);
  return {
    pts: [round2(x - pad), mid, PRESSURE, round2(x + w + pad), mid, PRESSURE],
    size: round2(h + 2 * pad),
  };
}

/** The tapes covering `rects`, one per line, in `color`, with ids from `nextId`. */
export function textTapeStrokes(
  rects: readonly { x: number; y: number; w: number; h: number }[],
  color: string,
  nextId: () => string,
): Stroke[] {
  const strokes: Stroke[] = [];
  for (const rect of rects) {
    const band = textTapeBand(rect);
    if (band) strokes.push({ id: nextId(), color, size: band.size, tool: "tape", pts: band.pts });
  }
  return strokes;
}
