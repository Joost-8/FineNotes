/**
 * The words the import dialog shows: what was picked, what came over. Pure,
 * so the dialog's text is tested without a DOM.
 */

import type { ImportBatch } from "./import-notebook";
import type { ImportResult, ImportSource } from "./import-types";

export const SOURCE_NAMES: Readonly<Record<ImportSource, string>> = {
  goodnotes: "Goodnotes",
  notability: "Notability",
};

/** "5 pages · from Goodnotes · 12 pictures" for one imported notebook. */
export function describeImport(result: ImportResult): string {
  const pages = result.doc.pages.length;
  const pictures = result.doc.pages.reduce((n, p) => n + p.images.length, 0);
  const parts = [`${pages} page${pages === 1 ? "" : "s"}`, `from ${SOURCE_NAMES[result.source]}`];
  if (pictures > 0) parts.push(`${pictures} picture${pictures === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The results screen's heading. */
export function importHeading(batch: ImportBatch): string {
  const done = batch.results.length;
  if (done === 0) return "Nothing was imported";
  return `Imported ${done} notebook${done === 1 ? "" : "s"}`;
}

/** Whether a file name looks like something the importer reads. */
export function isImportFileName(name: string): boolean {
  return /\.(goodnotes|note|zip)$/i.test(name);
}

/** "Importing 2 of 5…" while files are read. */
export function progressText(index: number, total: number, name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  return total > 1 ? `Importing ${index + 1} of ${total}: ${leaf}…` : `Importing ${leaf}…`;
}
