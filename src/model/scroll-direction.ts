/**
 * Which way a notebook's pages run: down (the default) or across, one page
 * per screen — GoodNotes' "Scroll direction" setting, and like there, a
 * choice each notebook makes for itself. Stored in the document as
 * `meta.scroll`, only when horizontal, so it follows the notebook to every
 * device and older builds simply ignore it.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument, ScrollDirection } from "./document";

/** The direction a document scrolls in; anything but `"horizontal"` is vertical. */
export function scrollDirectionOf(doc: Pick<InkDocument, "scroll"> | null): ScrollDirection {
  return doc?.scroll === "horizontal" ? "horizontal" : "vertical";
}

/**
 * Set a notebook's scroll direction. Undoable like any other change to the
 * note; vertical deletes the key, and undo puts back exactly what was there,
 * key order included.
 */
export class SetScrollDirection implements Command {
  readonly label = "Change scroll direction";
  private previous: ScrollDirection = "vertical";
  private keyOrder: string[] = [];

  constructor(private readonly direction: ScrollDirection) {}

  apply(doc: InkDocument): void {
    this.previous = scrollDirectionOf(doc);
    this.keyOrder = Object.keys(doc);
    write(doc, this.direction);
  }

  invert(doc: InkDocument): void {
    const hadKey = "scroll" in doc;
    write(doc, this.previous);
    if (this.previous === "horizontal" && !hadKey) restoreKeyOrder(doc, this.keyOrder);
  }
}

function write(doc: InkDocument, direction: ScrollDirection): void {
  if (direction === "horizontal") doc.scroll = "horizontal";
  else delete doc.scroll;
}

/** Re-adding a deleted key appends it; put the document's keys back in `order`. */
function restoreKeyOrder(doc: InkDocument, order: readonly string[]): void {
  const record = doc as unknown as Record<string, unknown>;
  const entries = Object.entries(record);
  for (const [key] of entries) delete record[key];
  const rank = (key: string): number => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  entries.sort((a, b) => rank(a[0]) - rank(b[0]));
  for (const [key, value] of entries) record[key] = value;
}
