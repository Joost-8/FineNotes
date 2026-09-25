/**
 * Ids for elements the surface creates: a letter and a number, `s12` for a
 * stroke and `t3` for a text box. That shape is part of the file format, and
 * nothing else in the code reads the number back.
 *
 * A new number is always higher than every one already in the document. The
 * number of elements would not do: a page holding s1…s10 with two erased has
 * eight strokes, and "s9" would name a stroke that is still there.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { InkDocument } from "../model/document";

const DIGITS = /^[0-9]+$/;

/** The highest `n` among ids spelled exactly `<prefix><n>`, or 0 when none is. */
export function highestIdNumber(ids: Iterable<string>, prefix: string): number {
  let highest = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const digits = id.slice(prefix.length);
    if (!DIGITS.test(digits)) continue;
    const n = Number(digits);
    if (n > highest) highest = n;
  }
  return highest;
}

/** Hands out `<prefix><n>` ids, counting up from the highest it has been shown. */
export class IdSequence {
  private last = 0;

  constructor(private readonly prefix: string) {}

  /** Count on from the ids of a document just opened, whatever came before. */
  restart(inUse: Iterable<string>): void {
    this.last = highestIdNumber(inUse, this.prefix);
  }

  /** Move past ids that arrived from elsewhere; never back. */
  catchUp(inUse: Iterable<string>): void {
    this.last = Math.max(this.last, highestIdNumber(inUse, this.prefix));
  }

  next(): string {
    this.last += 1;
    return `${this.prefix}${this.last}`;
  }
}

/** Every stroke id in the document, page by page. */
export function strokeIdsOf(doc: InkDocument): string[] {
  return doc.pages.flatMap((page) => page.strokes.map((stroke) => stroke.id));
}

/** Every text box id in the document, page by page. */
export function textBoxIdsOf(doc: InkDocument): string[] {
  return doc.pages.flatMap((page) => page.textBoxes.map((textBox) => textBox.id));
}
