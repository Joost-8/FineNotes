/**
 * The words the import dialog shows: what was picked, what came over. Pure,
 * so the dialog's text is tested without a DOM.
 */

import type { InkDocument } from "../model/document";
import {
  pageContentHash,
  pageKeys,
  updatePageTranscripts,
  type TranscriptUpdate,
} from "../recognition/page-transcripts";
import { writeTextSection } from "../recognition/text-layer";
import { type ImportBatch, isImportFileName } from "./import-notebook";
import type { ImportResult, ImportSource } from "./import-types";

export const SOURCE_NAMES: Readonly<Record<ImportSource, string>> = {
  goodnotes: "Goodnotes",
  notability: "Notability",
  noteful: "Noteful",
  xournal: "Xournal++",
  saber: "Saber",
  remarkable: "reMarkable",
  supernote: "Supernote",
  pdf: "a PDF",
};

/** "5 pages · from Goodnotes · 12 pictures" for one imported notebook. */
export function describeImport(result: ImportResult): string {
  const pages = result.doc.pages.length;
  const pictures = result.doc.pages.reduce((n, p) => n + p.images.length, 0);
  const parts = [
    `${pages} page${pages === 1 ? "" : "s"}`,
    `from ${result.app ?? SOURCE_NAMES[result.source]}`,
  ];
  if (pictures > 0) parts.push(`${pictures} picture${pictures === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The results screen's heading. */
export function importHeading(batch: ImportBatch): string {
  const done = batch.results.length;
  if (done === 0) return "Nothing was imported";
  return `Imported ${done} notebook${done === 1 ? "" : "s"}`;
}

export { isImportFileName };

/**
 * Files dropped on the import dialog: the ones it can import, and a line for
 * the rest ("" when every file was taken), naming at most two of them.
 */
export function sortDropped<T extends { name: string }>(
  files: readonly T[],
): { accepted: T[]; refused: string } {
  const accepted = files.filter((f) => isImportFileName(f.name));
  const others = files.filter((f) => !isImportFileName(f.name)).map((f) => f.name);
  if (others.length === 0) return { accepted, refused: "" };
  const named =
    others.slice(0, 2).join(", ") + (others.length > 2 ? ` and ${others.length - 2} more` : "");
  const one = others.length === 1;
  return {
    accepted,
    refused: `${named} ${one ? "is not a notebook" : "are not notebooks"} FineNotes can import, so ${
      one ? "it was" : "they were"
    } left out.`,
  };
}

/** "Importing 2 of 5…" while files are read. */
export function progressText(index: number, total: number, name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  return total > 1 ? `Importing ${index + 1} of ${total}: ${leaf}…` : `Importing ${leaf}…`;
}

/**
 * A new note's body with what the other app's recogniser read on each page,
 * as that page's transcription. It is marked as read on the device, so the
 * notebook is searchable at once and transcribing still replaces it.
 * `doc` must already point at the saved files: the page hash covers them.
 */
export function withPageText(body: string, doc: InkDocument, pageText?: readonly string[]): string {
  if (!pageText || pageText.every((text) => !text.trim())) return body;
  const keys = pageKeys(doc.pages);
  const updates: TranscriptUpdate[] = [];
  doc.pages.forEach((page, index) => {
    const text = pageText[index]?.trim();
    if (text) updates.push({ key: keys[index], text, hash: pageContentHash(page), device: true });
  });
  return writeTextSection(body, updatePageTranscripts(null, keys, updates));
}
