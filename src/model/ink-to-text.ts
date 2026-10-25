/**
 * Turn into › Text (FineNotes#42): lassoed handwriting is replaced by a text
 * box saying what it says, as Goodnotes and OneNote convert ink. The ink
 * goes; undo brings exactly those strokes back where they were, and takes
 * the box away.
 *
 * The box sits where the ink began, at a size its handwritten lines suggest:
 * one line fits its text (it grows as typed, as a new box does), several
 * keep the ink's width so the words wrap as they were written.
 *
 * Page, strokes and box are all held by identity (CLAUDE.md, "Resolve an
 * inverse by identity, not by a key that can repeat"). Pure.
 */

import type { Command } from "./commands";
import type { Bounds, InkDocument, Page, Stroke, TextBoxElement } from "./document";
import { type Removed, removeFrom, restoreTo } from "./selection-commands";
import {
  DEFAULT_LINE_HEIGHT,
  MIN_TEXT_BOX_WIDTH,
  type TextStyle,
  roundTextSize,
  textStyleOf,
} from "./text-style";

/** The lines of the text a box made from ink holds, trimmed, blank ones dropped. */
export function inkTextLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

/**
 * The text box that replaces ink spanning `bounds` with `text`: at the ink's
 * top-left, its font sized so each typed line is as tall as a written one,
 * in `style` (the Text tool's) but the ink's own colour. `null` when the
 * text is blank. `pageWidth` keeps the box on the page.
 */
export function inkTextBox(input: {
  id: string;
  bounds: Bounds;
  text: string;
  style: TextStyle;
  /** The ink's colour; the style's when the strokes differ or there are none. */
  inkColor?: string | null;
  pageWidth: number;
}): TextBoxElement | null {
  const lines = inkTextLines(input.text);
  if (lines.length === 0) return null;
  const { bounds, pageWidth } = input;
  const style = textStyleOf(input.style);
  if (input.inkColor) style.color = input.inkColor;
  const lineHeight = style.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const tall = Math.max(0, bounds.maxY - bounds.minY) / lines.length;
  style.fontSize = roundTextSize(tall / lineHeight);
  const inkWidth = Math.max(MIN_TEXT_BOX_WIDTH, bounds.maxX - bounds.minX);
  const w = Math.min(inkWidth, Math.max(MIN_TEXT_BOX_WIDTH, pageWidth));
  return {
    id: input.id,
    x: Math.min(Math.max(0, bounds.minX), Math.max(0, pageWidth - w)),
    y: Math.max(0, bounds.minY),
    w,
    ...(lines.length === 1 ? { fit: true as const } : {}),
    text: lines.join("\n"),
    ...style,
  };
}

/** The colour every stroke shares, or `null` when they differ or there are none. */
export function sharedInkColor(strokes: readonly Stroke[]): string | null {
  const first = strokes[0]?.color;
  if (first === undefined) return null;
  return strokes.every((stroke) => stroke.color === first) ? first : null;
}

/**
 * Take `strokes` off `page` and put `box` on it, as one undo step. Strokes
 * that are no longer on the page are skipped; when none is left, nothing
 * changes (the ink went while the dialog was open).
 */
export class TurnInkIntoText implements Command {
  readonly label = "Turn into text";
  readonly pageId: string;
  private removed: Array<Removed<Stroke>> | null = null;

  constructor(
    private readonly page: Page,
    private readonly strokes: readonly Stroke[],
    private readonly box: TextBoxElement,
  ) {
    this.pageId = page.id;
  }

  apply(doc: InkDocument): void {
    this.removed = null;
    if (!doc.pages.includes(this.page)) return;
    const removed = removeFrom(this.page.strokes, this.strokes);
    if (removed.length === 0) return;
    this.removed = removed;
    this.page.textBoxes.push(this.box);
  }

  invert(doc: InkDocument): void {
    const removed = this.removed;
    if (!removed || !doc.pages.includes(this.page)) return;
    const at = this.page.textBoxes.indexOf(this.box);
    if (at >= 0) this.page.textBoxes.splice(at, 1);
    restoreTo(this.page.strokes, removed);
    this.removed = null;
  }

  /** Whether the last `apply` changed the page. */
  get applied(): boolean {
    return this.removed !== null;
  }
}
