/**
 * Notebook-level commands (contracts/api.md §6): turning a single page into a
 * notebook, and changing a cover. Invertible like every other command, and
 * an inverse restores an absent key as absent (§3). Pure.
 */

import { type Command, SetBackdrop } from "./commands";
import { coverLayout, coverMonogramColor, coverTitleColor, coverTitleFrame } from "./cover";
import {
  type InkDocument,
  type Page,
  type SyntheticBackdrop,
  type TextBoxElement,
  isCoverRuling,
} from "./document";
import { CompositeCommand } from "./page-commands";

/**
 * Set or clear `InkDocument.single`. "Convert to notebook" is
 * `new SetSingle(false)`. The flag is only ever stored as `true`, so clearing
 * it deletes the key, and undo puts back exactly what was there.
 */
export class SetSingle implements Command {
  readonly label: string;
  private previous = false;

  constructor(private readonly single: boolean) {
    this.label = single ? "Make single page" : "Convert to notebook";
  }

  apply(doc: InkDocument): void {
    this.previous = doc.single === true;
    write(doc, this.single);
  }

  invert(doc: InkDocument): void {
    write(doc, this.previous);
  }
}

function write(doc: InkDocument, single: boolean): void {
  if (single) doc.single = true;
  else delete doc.single;
}

/** Positions within this of the automatic one still count as "not moved by the user". */
const FRAME_TOLERANCE = 1;

/**
 * Keep a cover's title legible and in place across a change of design or
 * colour: every text box on the page still in the ink the old cover chose is
 * recoloured for the new one, and every box still where the old design put a
 * title (at its own font size) moves to where the new design puts it. A box
 * the user recoloured or moved is theirs, and is left alone.
 */
export class RestyleCoverTitles implements Command {
  readonly label = "Restyle cover title";
  private changed: Array<{ box: TextBoxElement; before: TitleStyle; after: TitleStyle }> = [];

  constructor(
    private readonly page: Page,
    private readonly from: SyntheticBackdrop,
    private readonly to: SyntheticBackdrop,
  ) {}

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    this.changed = [];
    // By identity, like the other page commands: ids can repeat within a file.
    if (!doc.pages.includes(this.page)) return;
    if (!isCoverRuling(this.from.kind) || !isCoverRuling(this.to.kind)) return;
    const oldInk = coverTitleColor(this.from).toLowerCase();
    const newInk = coverTitleColor(this.to);
    // A big-type letter is a tint of the cloth: it follows the cloth too.
    const oldLetter = coverMonogramColor(this.from).toLowerCase();
    const newLetter = coverMonogramColor(this.to);
    for (const box of this.page.textBoxes) {
      const before = styleOf(box);
      const after = { ...before };
      if (box.color.toLowerCase() === oldInk) after.color = newInk;
      else if (box.color.toLowerCase() === oldLetter) after.color = newLetter;
      const auto = coverTitleFrame(this.from.kind, this.page.geometry, box.fontSize);
      if (
        Math.abs(box.x - auto.x) <= FRAME_TOLERANCE &&
        Math.abs(box.y - auto.y) <= FRAME_TOLERANCE &&
        Math.abs(box.w - auto.w) <= FRAME_TOLERANCE
      ) {
        Object.assign(after, coverTitleFrame(this.to.kind, this.page.geometry, box.fontSize));
        // Still set as the old design set it: take the new design's font and alignment too.
        const was = coverLayout(this.from.kind, this.page.geometry).titleStyle;
        if (box.font === was.font && box.align === was.align) {
          const next = coverLayout(this.to.kind, this.page.geometry).titleStyle;
          after.font = next.font;
          after.align = next.align;
        }
      }
      if (sameStyle(before, after)) continue;
      setStyle(box, after);
      this.changed.push({ box, before, after });
    }
  }

  invert(doc: InkDocument): void {
    if (!doc.pages.includes(this.page)) return;
    for (let i = this.changed.length - 1; i >= 0; i--) {
      setStyle(this.changed[i].box, this.changed[i].before);
    }
    this.changed = [];
  }
}

interface TitleStyle {
  color: string;
  x: number;
  y: number;
  w: number;
  font: TextBoxElement["font"];
  align: TextBoxElement["align"];
}

function styleOf(box: TextBoxElement): TitleStyle {
  return { color: box.color, x: box.x, y: box.y, w: box.w, font: box.font, align: box.align };
}

function sameStyle(a: TitleStyle, b: TitleStyle): boolean {
  return (
    a.color === b.color &&
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.font === b.font &&
    a.align === b.align
  );
}

function setStyle(box: TextBoxElement, style: TitleStyle): void {
  box.color = style.color;
  box.x = style.x;
  box.y = style.y;
  box.w = style.w;
  // Absent stays absent: an undo must not leave `font: undefined` on a box that had none.
  if (style.font === undefined) delete box.font;
  else box.font = style.font;
  if (style.align === undefined) delete box.align;
  else box.align = style.align;
}

/**
 * "Change cover": the new design and colour through `SetBackdrop`, and the
 * title restyled to match, as one undo step. Returns `null` for a page that
 * is not a cover or a backdrop that is not one — a cover is never swapped for
 * paper this way, nor paper for a cover.
 */
export function changeCover(page: Page, backdrop: SyntheticBackdrop): Command | null {
  const from = page.backdrop;
  if (from.kind === "pdf" || !isCoverRuling(from.kind) || !isCoverRuling(backdrop.kind)) {
    return null;
  }
  return new CompositeCommand("Change cover", [
    new SetBackdrop(page.id, { ...backdrop }),
    new RestyleCoverTitles(page, { ...from }, backdrop),
  ]);
}
