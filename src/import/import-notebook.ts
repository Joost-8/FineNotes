/**
 * Importing notebooks from other apps: the one entry point the UI calls.
 * Pure — the caller reads the picked files and saves what comes back.
 * (PDFs are the exception: they need pdf.js, so the dialog reads them with
 * `import/pdf.ts` itself.)
 *
 * Which converter reads a file is decided from its bytes, never from its
 * name: `.note` is both Notability (a zip) and Supernote (not one), and a
 * backup zip can hold any mix. Accepted:
 *
 * - Goodnotes (`.goodnotes`) and Notability (`.note`): zips.
 * - Xournal++ and Xournal (`.xopp`, `.xoj`): gzipped XML, or plain XML.
 * - Saber (`.sbn2`, `.sbn`): BSON or JSON; an `.sba` is a zip around one.
 * - reMarkable: one page (`.rm`), or a whole document (`.rmdoc`, a zip).
 * - Supernote (`.note`): its own binary format.
 * - Noteful (`.noteful`): its own binary format; a backup is a folder of them.
 * - A zip of any of these: Goodnotes' library backup, a zipped Notability
 *   backup folder, a folder of notebooks someone zipped.
 */

import { unzipSync } from "fflate";
import { isGoodnotes, readGoodnotes } from "./goodnotes";
import type { ImportResult } from "./import-types";
import { isNotability, readNotability } from "./notability";
import { isNoteful, readNoteful } from "./noteful";
import {
  isRemarkableDocument,
  isRemarkableLines,
  readRemarkableDocument,
  readRemarkableLines,
} from "./remarkable";
import { isSaber, isSaberArchive, readSaber, readSaberArchive } from "./saber";
import { isSupernote, readSupernote } from "./supernote";
import { isXournal, readXournal } from "./xournal";

export type { ImportAttachment, ImportResult, ImportSource } from "./import-types";
export { relinkAttachments } from "./import-types";

/**
 * The file extensions the picker and drag-and-drop accept. Which converter
 * reads a file is decided from its bytes, not from this list.
 */
export const IMPORT_EXTENSIONS: readonly string[] = [
  "goodnotes",
  "note",
  "noteful",
  "zip",
  "pdf",
  "xopp",
  "xoj",
  "sbn2",
  "sbn",
  "sba",
  "rm",
  "rmdoc",
];

/** Whether a file name has one of {@link IMPORT_EXTENSIONS}. */
export function isImportFileName(name: string): boolean {
  return extensionOf(name) !== null;
}

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

const NOT_A_NOTEBOOK = "It is not a notebook FineNotes can import.";

type Files = Map<string, Uint8Array>;

/** A converter for a file read whole: whether it is one, and how to read it. */
interface SingleFile {
  is: (bytes: Uint8Array) => boolean;
  read: (bytes: Uint8Array, title: string) => ImportResult;
}

/**
 * Formats that are one file, tried before a file is opened as a zip. Order
 * matters only where one format can contain another's signature: Xournal++
 * also saves a zip, which only it recognises, so it goes first.
 */
const SINGLE_FILES: readonly SingleFile[] = [
  { is: isNoteful, read: readNoteful },
  { is: isXournal, read: readXournal },
  { is: isSupernote, read: readSupernote },
  { is: isRemarkableLines, read: readRemarkableLines },
  { is: isSaber, read: (bytes, title) => readSaber(bytes, title) },
];

/** A converter for a notebook that is a set of files (a zip, or a folder in one). */
interface Package {
  is: (files: Files) => boolean;
  read: (files: Files, title: string) => ImportResult;
}

const PACKAGES: readonly Package[] = [
  { is: isGoodnotes, read: readGoodnotes },
  { is: isNotability, read: readNotability },
  { is: isSaberArchive, read: readSaberArchive },
  { is: isRemarkableDocument, read: readRemarkableDocument },
];

/**
 * Convert every notebook in one picked file. A single notebook gives one
 * result; a backup zip gives one per notebook inside, in name order. Never
 * throws: what cannot be read is reported in `failures`.
 */
export function importNotebooks(bytes: Uint8Array, fileName: string): ImportBatch {
  const batch: ImportBatch = { results: [], failures: [] };
  const before = batch.failures.length;
  fromBytes(bytes, fileName, batch, 0);
  if (batch.results.length === 0 && batch.failures.length === before) {
    batch.failures.push({
      name: fileName,
      reason: "No notebook FineNotes can import was found in it.",
    });
  }
  return batch;
}

/** One file's bytes: a single-file notebook, or a zip to look into. */
function fromBytes(bytes: Uint8Array, fileName: string, batch: ImportBatch, depth: number): void {
  const title = baseName(fileName);
  const single = SINGLE_FILES.find((format) => safely(() => format.is(bytes)));
  if (single) {
    convert(() => single.read(bytes, title), fileName, batch);
    return;
  }
  const files = unzip(bytes);
  if (!files) {
    batch.failures.push({ name: fileName, reason: NOT_A_NOTEBOOK });
    return;
  }
  collect(files, fileName, batch, depth);
}

function collect(files: Files, fileName: string, batch: ImportBatch, depth: number): void {
  const title = baseName(fileName);
  const format = PACKAGES.find((p) => safely(() => p.is(files)));
  if (format) {
    convert(() => format.read(files, title), fileName, batch);
    return;
  }
  if (depth >= MAX_NESTING) return;

  // A backup: notebooks packed inside as files, or as unzipped package folders.
  const packed = [...files.keys()].filter((name) => isImportFileName(name)).sort();
  for (const name of packed) {
    const data = files.get(name);
    if (!data || data.length === 0) continue;
    // PDFs inside a backup need pdf.js; they are left for the dialog's own PDF path.
    if (extensionOf(name) === "pdf") continue;
    fromBytes(data, name, batch, depth + 1);
  }
  for (const [folder, entries] of packageFolders(files)) collect(entries, folder, batch, depth + 1);
}

/** Run one converter, recording a failure instead of throwing. */
function convert(read: () => ImportResult, fileName: string, batch: ImportBatch): void {
  try {
    batch.results.push(read());
  } catch (e) {
    batch.failures.push({
      name: fileName,
      reason: `It could not be read (${(e as Error).message}).`,
    });
  }
}

/** A sniffing test that throws is a "no". */
function safely(test: () => boolean): boolean {
  try {
    return test();
  } catch {
    return false;
  }
}

function unzip(bytes: Uint8Array): Files | null {
  try {
    return new Map(Object.entries(unzipSync(bytes)));
  } catch {
    return null;
  }
}

/** `X.goodnotes/…`, `X.note/…` or `X.rmdoc/…` folders, each with its entries relative to the folder. */
function packageFolders(files: Files): Map<string, Files> {
  const folders = new Map<string, Files>();
  for (const [name, data] of files) {
    const match = /^(.*?\.(?:goodnotes|note|rmdoc|sba))\/(.+)$/i.exec(name);
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

/** A file name's import extension, lower case, or `null` when it has none of ours. */
function extensionOf(name: string): string | null {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const dot = leaf.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = leaf.slice(dot + 1).toLowerCase();
  return IMPORT_EXTENSIONS.includes(ext) ? ext : null;
}

/** A file name without folders and without its notebook extension. */
function baseName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? fileName;
  const ext = extensionOf(leaf);
  return (ext ? leaf.slice(0, -ext.length - 1) : leaf) || "Imported notebook";
}
