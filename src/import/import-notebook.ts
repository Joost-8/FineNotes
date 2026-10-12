/**
 * Importing notebooks from other apps: the one entry point the UI calls.
 * Pure — the caller reads the picked files and saves what comes back.
 *
 * Accepted: a Goodnotes notebook (`.goodnotes`), a Notability note
 * (`.note`), or a zip of either — Goodnotes' library backup is a zip of
 * `.goodnotes` files, and a zipped Notability backup folder holds `.note`s.
 */

import { unzipSync } from "fflate";
import { isGoodnotes, readGoodnotes } from "./goodnotes";
import type { ImportResult } from "./import-types";
import { isNotability, readNotability } from "./notability";

export type { ImportAttachment, ImportResult, ImportSource } from "./import-types";
export { relinkAttachments } from "./import-types";

/** The file extensions the picker should accept. */
export const IMPORT_EXTENSIONS: readonly string[] = ["goodnotes", "note", "zip"];

/** One file that could not be imported, and why, in a sentence for the user. */
export interface ImportFailure {
  name: string;
  reason: string;
}

export interface ImportBatch {
  results: ImportResult[];
  failures: ImportFailure[];
}

/** How deep zips inside zips are opened. */
const MAX_NESTING = 2;

type Files = Map<string, Uint8Array>;

/**
 * Convert every notebook in one picked file. A single notebook gives one
 * result; a backup zip gives one per notebook inside, in name order. Never
 * throws: what cannot be read is reported in `failures`.
 */
export function importNotebooks(bytes: Uint8Array, fileName: string): ImportBatch {
  const batch: ImportBatch = { results: [], failures: [] };
  const files = unzip(bytes);
  if (!files) {
    batch.failures.push({ name: fileName, reason: "It is not a Goodnotes or Notability file." });
    return batch;
  }
  collect(files, fileName, batch, 0);
  if (batch.results.length === 0 && batch.failures.length === 0) {
    batch.failures.push({
      name: fileName,
      reason: "No Goodnotes or Notability notebook was found in it.",
    });
  }
  return batch;
}

function unzip(bytes: Uint8Array): Files | null {
  try {
    return new Map(Object.entries(unzipSync(bytes)));
  } catch {
    return null;
  }
}

function collect(files: Files, fileName: string, batch: ImportBatch, depth: number): void {
  const title = baseName(fileName);
  try {
    if (isGoodnotes(files)) {
      batch.results.push(readGoodnotes(files, title));
      return;
    }
    if (isNotability(files)) {
      batch.results.push(readNotability(files, title));
      return;
    }
  } catch (e) {
    batch.failures.push({
      name: fileName,
      reason: `It could not be read (${(e as Error).message}).`,
    });
    return;
  }
  if (depth >= MAX_NESTING) return;

  // A backup: notebooks packed inside as files, or as unzipped package folders.
  const packed = [...files.keys()].filter((name) => /\.(goodnotes|note|zip)$/i.test(name)).sort();
  for (const name of packed) {
    const data = files.get(name);
    if (!data || data.length === 0) continue;
    const inner = unzip(data);
    if (inner) collect(inner, name, batch, depth + 1);
    else batch.failures.push({ name, reason: "It is not a Goodnotes or Notability file." });
  }
  for (const [folder, entries] of packageFolders(files)) collect(entries, folder, batch, depth + 1);
}

/** `X.goodnotes/…` or `X.note/…` folders, each with its entries relative to the folder. */
function packageFolders(files: Files): Map<string, Files> {
  const folders = new Map<string, Files>();
  for (const [name, data] of files) {
    const match = /^(.*?\.(?:goodnotes|note))\/(.+)$/i.exec(name);
    if (!match || match[2].endsWith("/")) continue;
    let entries = folders.get(match[1]);
    if (!entries) {
      entries = new Map<string, Uint8Array>();
      folders.set(match[1], entries);
    }
    entries.set(match[2], data);
  }
  return new Map<string, Files>([...folders].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A file name without folders and without its notebook extension. */
function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  return last.replace(/\.(goodnotes|note|zip)$/i, "") || "Imported notebook";
}
