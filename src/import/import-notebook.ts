/**
 * Importing notebooks from other apps: the one entry point the UI calls.
 * Pure — the caller reads the picked files, measures PDFs and saves what
 * comes back.
 *
 * Accepted: a Goodnotes notebook (`.goodnotes`), a Notability note
 * (`.note`), or a zip of either — Goodnotes' library backup is a zip of
 * `.goodnotes` files, and a zipped Notability backup folder holds `.note`s.
 *
 * A backup can be gigabytes, so nothing is unpacked up front: the zip's
 * names are listed first, and each notebook's entries are inflated only when
 * that notebook is converted. With `onResult` a notebook is handed over (and
 * its files released) before the next one is read.
 */

import { unzipSync } from "fflate";
import { isGoodnotes, readGoodnotes } from "./goodnotes";
import { plural, type ImportResult } from "./import-types";
import type { TextBoxElement } from "../model/document";
import { isNotability, notabilityPdfFiles, readNotability, type PdfPageSize } from "./notability";

export type { ImportAttachment, ImportResult, ImportSource } from "./import-types";
export { relinkAttachments } from "./import-types";
export type { PdfPageSize } from "./notability";

/** The file extensions the picker should accept. */
export const IMPORT_EXTENSIONS: readonly string[] = ["goodnotes", "note", "zip"];

/** One file that could not be imported, and why, in a sentence for the user. */
export interface ImportFailure {
  name: string;
  reason: string;
}

export interface ImportBatch {
  /**
   * Every notebook converted. When the import was given `onResult`, each
   * one's `attachments` are emptied once `onResult` has finished with them.
   */
  results: ImportResult[];
  failures: ImportFailure[];
}

export interface ImportOptions {
  /**
   * The page sizes of a PDF (pdf.js, in the plugin). Without it, or when it
   * fails, a Notability note's PDF pages are taken for Letter.
   */
  measurePdf?: (bytes: Uint8Array) => Promise<readonly PdfPageSize[]>;
  /**
   * The first page of a PDF as a PNG (pdf.js, in the plugin), for a PDF
   * placed on a page as a picture. Without it, or when it fails, a note on
   * the page says where the PDF went, and the PDF is saved all the same.
   */
  rasterizePdf?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /**
   * Called with each notebook as soon as it is converted; the next notebook
   * is read only after it settles. A rejection is reported as a failure of
   * that notebook.
   */
  onResult?: (result: ImportResult) => Promise<void>;
  /** Asked before each notebook: true stops the import there. */
  cancelled?: () => boolean;
}

/** How deep zips inside zips are opened. */
const MAX_NESTING = 2;

type Files = Map<string, Uint8Array>;

const EMPTY = new Uint8Array();

/**
 * Convert every notebook in one picked file. A single notebook gives one
 * result; a backup zip gives one per notebook inside, in name order. Never
 * rejects: what cannot be read is reported in `failures`.
 */
export async function importNotebooks(
  bytes: Uint8Array,
  fileName: string,
  options: ImportOptions = {},
): Promise<ImportBatch> {
  const batch: ImportBatch = { results: [], failures: [] };
  const names = entryNames(bytes);
  if (!names) {
    batch.failures.push({ name: fileName, reason: "It is not a Goodnotes or Notability file." });
    return batch;
  }
  await collect(bytes, names, fileName, batch, 0, options);
  if (batch.results.length === 0 && batch.failures.length === 0 && !options.cancelled?.()) {
    batch.failures.push({
      name: fileName,
      reason: "No Goodnotes or Notability notebook was found in it.",
    });
  }
  return batch;
}

/** A zip's entry names, without inflating anything; null when it is not a zip. */
function entryNames(bytes: Uint8Array): string[] | null {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    return null;
  }
  return names;
}

/** The entries `keep` accepts, inflated. */
function readEntries(bytes: Uint8Array, keep: (name: string) => boolean): Files {
  return new Map(Object.entries(unzipSync(bytes, { filter: (file) => keep(file.name) })));
}

async function collect(
  bytes: Uint8Array,
  names: string[],
  fileName: string,
  batch: ImportBatch,
  depth: number,
  options: ImportOptions,
): Promise<void> {
  // Whether this zip is itself one notebook: the readers decide from names alone.
  const index: Files = new Map(names.map((name) => [name, EMPTY]));
  if (isGoodnotes(index) || isNotability(index)) {
    if (options.cancelled?.()) return;
    let files: Files;
    try {
      files = readEntries(bytes, () => true);
    } catch (e) {
      batch.failures.push({ name: fileName, reason: `It could not be read (${errorText(e)}).` });
      return;
    }
    await convert(files, fileName, batch, options);
    return;
  }
  if (depth >= MAX_NESTING) return;

  // A backup: notebooks packed inside as files, or as unzipped package folders.
  const packed = names.filter((name) => /\.(goodnotes|note|zip)$/i.test(name)).sort();
  for (const name of packed) {
    if (options.cancelled?.()) return;
    let inner: Uint8Array | undefined;
    try {
      inner = readEntries(bytes, (n) => n === name).get(name);
    } catch (e) {
      batch.failures.push({ name, reason: `It could not be read (${errorText(e)}).` });
      continue;
    }
    if (!inner || inner.length === 0) continue;
    const innerNames = entryNames(inner);
    if (innerNames) await collect(inner, innerNames, name, batch, depth + 1, options);
    else batch.failures.push({ name, reason: "It is not a Goodnotes or Notability file." });
  }
  for (const folder of packageFolders(names)) {
    if (options.cancelled?.()) return;
    const prefix = `${folder}/`;
    let files: Files;
    try {
      const entries = readEntries(bytes, (n) => n.startsWith(prefix) && !n.endsWith("/"));
      files = new Map([...entries].map(([n, data]) => [n.slice(prefix.length), data]));
    } catch (e) {
      batch.failures.push({ name: folder, reason: `It could not be read (${errorText(e)}).` });
      continue;
    }
    if (isGoodnotes(files) || isNotability(files)) await convert(files, folder, batch, options);
  }
}

/** Convert one notebook's entries and hand the result over. */
async function convert(
  files: Files,
  fileName: string,
  batch: ImportBatch,
  options: ImportOptions,
): Promise<void> {
  const title = baseName(fileName);
  let result: ImportResult;
  try {
    if (isGoodnotes(files)) {
      result = readGoodnotes(files, title);
    } else {
      const sizes = new Map<string, readonly PdfPageSize[]>();
      if (options.measurePdf) {
        for (const pdf of notabilityPdfFiles(files)) {
          try {
            sizes.set(pdf.name, await options.measurePdf(pdf.bytes));
          } catch {
            // Unmeasured: the reader takes its pages for Letter and says so.
          }
        }
      }
      result = readNotability(files, title, sizes);
    }
  } catch (e) {
    batch.failures.push({ name: fileName, reason: `It could not be read (${errorText(e)}).` });
    return;
  }
  await picturesFromPdfs(result, options.rasterizePdf);
  if (options.onResult) {
    try {
      await options.onResult(result);
    } catch (e) {
      batch.failures.push({
        name: result.title,
        reason: `It could not be saved (${errorText(e)}).`,
      });
      return;
    } finally {
      result.attachments = [];
    }
  }
  batch.results.push(result);
}

/** `X.goodnotes/…` or `X.note/…` folders, in name order. */
function packageFolders(names: string[]): string[] {
  const folders = new Set<string>();
  for (const name of names) {
    const match = /^(.*?\.(?:goodnotes|note))\/(.+)$/i.exec(name);
    if (match && !match[2].endsWith("/")) folders.add(match[1]);
  }
  return [...folders].sort();
}

/** A file name without folders and without its notebook extension; "" when nothing is left. */
function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  return last.replace(/\.(goodnotes|note|zip)$/i, "").trim();
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Pictures that are PDFs (Goodnotes lets a PDF be placed like a photo) as
 * images: the PDF's first page as a PNG beside it. When that cannot be made,
 * the picture becomes a note on the page naming the PDF, which is saved with
 * the notebook either way, so nothing is lost.
 */
async function picturesFromPdfs(
  result: ImportResult,
  rasterize: ImportOptions["rasterizePdf"],
): Promise<void> {
  const pdfs = new Map(
    result.attachments.filter((a) => a.mime === "application/pdf").map((a) => [a.name, a]),
  );
  const pictures = result.doc.pages.flatMap((page, index) =>
    page.images.filter((image) => pdfs.has(image.path)).map((image) => ({ page, index, image })),
  );
  if (pictures.length === 0) return;

  const pngs = new Map<string, string | null>();
  for (const name of new Set(pictures.map((p) => p.image.path))) {
    const pdf = pdfs.get(name);
    let png: string | null = null;
    if (pdf && rasterize) {
      try {
        const bytes = await rasterize(pdf.bytes);
        png = `${name.replace(/\.pdf$/i, "")}.png`;
        result.attachments.push({ name: png, bytes, mime: "image/png" });
      } catch {
        png = null;
      }
    }
    pngs.set(name, png);
  }

  let textN = Math.max(
    0,
    ...result.doc.pages.flatMap((page) =>
      page.textBoxes.map((box) => Number(/^t(\d+)$/.exec(box.id)?.[1] ?? 0)),
    ),
  );
  const shown = new Set<number>();
  const noted = new Set<number>();
  let shownCount = 0;
  for (const { page, index, image } of pictures) {
    const png = pngs.get(image.path);
    if (png) {
      image.path = png;
      shown.add(index + 1);
      shownCount++;
      continue;
    }
    page.images = page.images.filter((other) => other !== image);
    const note: TextBoxElement = {
      id: `t${++textN}`,
      x: image.x,
      y: image.y,
      w: Math.max(80, image.w),
      h: Math.max(24, image.h),
      text: `A PDF was placed here: ${image.path}, saved next to this notebook.`,
      color: "#444444",
      fontSize: 16,
      fill: "#f2f2f2",
    };
    page.textBoxes.push(note);
    noted.add(index + 1);
  }
  // A PDF now shown as a PNG, and not the paper of any page, need not be saved twice.
  const papers = new Set(
    result.doc.pages.map((page) => (page.backdrop.kind === "pdf" ? page.backdrop.path : "")),
  );
  result.attachments = result.attachments.filter((a) => !(pngs.get(a.name) && !papers.has(a.name)));
  const pagesText = (pages: Set<number>): string =>
    pages.size === 1
      ? `page ${[...pages][0]}`
      : `pages ${[...pages].sort((a, b) => a - b).join(", ")}`;
  if (shown.size > 0) {
    result.warnings.push(
      `${plural(shownCount, "PDF placed as a picture", "PDFs placed as pictures")} came over ` +
        `as an image of its first page (${pagesText(shown)}).`,
    );
  }
  if (noted.size > 0) {
    result.warnings.push(
      `${plural(pictures.length - shownCount, "PDF placed as a picture", "PDFs placed as pictures")} could not ` +
        `be shown; a note on the page says where it was saved (${pagesText(noted)}).`,
    );
  }
}
