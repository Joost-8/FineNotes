/**
 * A notebook made read-only from its settings (the gear): the pen, the
 * eraser and every other edit leave it alone, while its pages still scroll,
 * zoom, search and export — GoodNotes' "Read-only mode", for a finished
 * notebook a stray Pencil or palm should not mark. Stored in the document as
 * `meta.readOnly`, only when on, so it follows the notebook to every device
 * and older builds simply ignore it.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument } from "./document";

/** Whether a document is read-only; only `true` is. */
export function isReadOnly(doc: Pick<InkDocument, "readOnly"> | null): boolean {
  return doc?.readOnly === true;
}

/**
 * Turn read-only on or off. A command like every other change to the note,
 * so it saves with it; off deletes the key, and undo puts back exactly what
 * was there, key order included.
 */
export class SetReadOnly implements Command {
  readonly label: string;
  private previous = false;
  private keyOrder: string[] = [];

  constructor(private readonly on: boolean) {
    this.label = on ? "Make read-only" : "Allow editing";
  }

  apply(doc: InkDocument): void {
    this.previous = isReadOnly(doc);
    this.keyOrder = Object.keys(doc);
    write(doc, this.on);
  }

  invert(doc: InkDocument): void {
    const hadKey = "readOnly" in doc;
    write(doc, this.previous);
    if (this.previous && !hadKey) restoreKeyOrder(doc, this.keyOrder);
  }
}

function write(doc: InkDocument, on: boolean): void {
  if (on) doc.readOnly = true;
  else delete doc.readOnly;
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
