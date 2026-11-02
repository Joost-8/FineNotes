/**
 * Selecting a PDF page's text as iPadOS selects text (discussion #107): a
 * hold on a word takes the word, and the handles at either end of the
 * selection drag to take more or less of it, a character at a time.
 * **Pure:** a `TextLayout` and ranges of it in; ranges, the handles' places
 * and the text out. No DOM.
 *
 * The highlighter's snapping (`selectText`) finds the word; a handle moves
 * by caret (`caretAt`), so it can stop inside a word, as the system's do.
 */

import {
  type TextLayout,
  type TextRange,
  type TextRect,
  caretAt,
  rangeRects,
  rangeText,
  selectText,
} from "./pdf-text";

/** Which end of a selection a handle holds. */
export type PickEnd = "start" | "end";

/** A run of selected text, with what it covers and what Copy takes. */
export interface TextPick extends TextRange {
  /** One per line, in reading order. */
  rects: TextRect[];
  text: string;
}

/** A handle's line: where it stands, and the band of the line it is on, page px. */
export interface PickHandle {
  x: number;
  top: number;
  bottom: number;
}

function pickOf(layout: TextLayout, range: TextRange): TextPick {
  return { ...range, rects: rangeRects(layout, range), text: rangeText(layout, range) };
}

/**
 * The word at page point `at`, or null when it is over no text (`slop`
 * page px all round, as the highlighter allows).
 */
export function pickWord(
  layout: TextLayout,
  at: { x: number; y: number },
  slop = 0,
): TextPick | null {
  const word = selectText(layout, at, at, slop);
  return word && word.rects.length > 0 ? word : null;
}

/** Whether a pick holds anything: a character that is not a space. */
export function isEmptyPick(pick: TextPick): boolean {
  return pick.rects.length === 0;
}

/**
 * Drag one end of `range` to page point `to`: that end goes to the caret
 * nearest `to`, the other stays where it is. The ends never cross: a handle
 * stops a character short of the other, as iPadOS' handles do. A range that
 * would hold only spaces keeps the one it had.
 */
export function dragPickEnd(
  layout: TextLayout,
  range: TextRange,
  end: PickEnd,
  to: { x: number; y: number },
): TextPick {
  const caret = caretAt(layout, to.x, to.y);
  if (caret < 0) return pickOf(layout, range);
  const next =
    end === "start"
      ? { start: Math.min(caret, range.end - 1), end: range.end }
      : { start: range.start, end: Math.max(caret, range.start + 1) };
  const pick = pickOf(layout, next);
  return isEmptyPick(pick) ? pickOf(layout, range) : pick;
}

/**
 * Where the handles stand: the start before the first character, on the
 * first line's band; the end after the last, on the last line's. Null for an
 * empty pick.
 */
export function pickHandles(pick: TextPick): { start: PickHandle; end: PickHandle } | null {
  const first = pick.rects[0];
  const last = pick.rects[pick.rects.length - 1];
  if (!first || !last) return null;
  return {
    start: { x: first.x, top: first.y, bottom: first.y + first.h },
    end: { x: last.x + last.w, top: last.y, bottom: last.y + last.h },
  };
}

/** What the selection covers, page px: the box round all its lines. Null when empty. */
export function pickBounds(
  pick: TextPick,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (pick.rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of pick.rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The page point a handle drag reads, for a pointer at `pointer`: offset by
 * where the pointer took the handle (`grab`, the handle's middle less the
 * press), so the handle does not jump under the finger.
 */
export function handleTarget(
  pointer: { x: number; y: number },
  grab: { x: number; y: number },
): { x: number; y: number } {
  return { x: pointer.x + grab.x, y: pointer.y + grab.y };
}
