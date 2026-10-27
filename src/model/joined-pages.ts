/**
 * A notebook whose pages are joined (discussion #51): no gap between them,
 * so writing runs on from one page into the next. A choice each notebook
 * makes for itself, in its settings (the gear) beside Scroll direction.
 * Stored in the document as `meta.joined`, only when on, so it follows the
 * notebook to every device and older builds simply ignore it.
 *
 * Only the layout knows pages are joined. Ink that runs over a join is
 * stored on every page it reaches, each copy in that page's own space and
 * clipped to it (`canvas/page-join.ts`), so a page never depends on the
 * page beside it.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument } from "./document";

/** Whether a document's pages are joined; only `true` is. */
export function joinedPagesOf(doc: Pick<InkDocument, "joined"> | null): boolean {
  return doc?.joined === true;
}

/**
 * Join a notebook's pages, or set them apart again. A command like every
 * other change to the note, so it saves with it; off deletes the key, and
 * undo puts back exactly what was there, key order included.
 */
export class SetJoinedPages implements Command {
  readonly label: string;
  /** The gaps come and go above the page being read: keep it in view. */
  readonly keepsReading = true;
  private previous = false;
  private keyOrder: string[] = [];

  constructor(private readonly on: boolean) {
    this.label = on ? "Join pages" : "Set pages apart";
  }

  apply(doc: InkDocument): void {
    this.previous = joinedPagesOf(doc);
    this.keyOrder = Object.keys(doc);
    write(doc, this.on);
  }

  invert(doc: InkDocument): void {
    const hadKey = "joined" in doc;
    write(doc, this.previous);
    if (this.previous && !hadKey) restoreKeyOrder(doc, this.keyOrder);
  }
}

function write(doc: InkDocument, on: boolean): void {
  if (on) doc.joined = true;
  else delete doc.joined;
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
