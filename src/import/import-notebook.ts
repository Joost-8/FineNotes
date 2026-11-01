/**
 * Importing notebooks from other apps: the one entry point the UI calls.
 * Pure — the caller reads the picked files, measures PDFs and saves what
 * comes back.
 *
 * Which converter reads a file is decided from its bytes, never from its
 * name: `.note` is both Notability (a zip) and Supernote (not one), and a
 * backup zip can hold any mix. Accepted:
 *
 * - Goodnotes (`.goodnotes`) and Notability (`.note`): zips.
 * - Noteful (`.noteful`): its own binary format; a backup is a folder of them.
 * - FreeNotes (`.freenotes`): a zip around one `.frnote` folder.
 * - Xournal++ and Xournal (`.xopp`, `.xoj`): gzipped XML, or plain XML.
 * - Saber (`.sbn2`, `.sbn`): BSON or JSON; an `.sba` is a zip around one.
 * - reMarkable: one page (`.rm`), or a whole document (`.rmdoc`, a zip).
 * - Supernote (`.note`): its own binary format.
 * - A zip of any of these: Goodnotes' library backup, a zipped Notability
 *   backup folder, a folder of notebooks someone zipped.
 *
 * (PDFs need pdf.js, so the dialog reads them with `import/pdf.ts` itself.)
 *
 * A backup's folders come back on each notebook (`ImportResult.folder`), so
 * the dialog can rebuild them. A wrapper folder that holds everything is
 * left out, and a backup zip inside a backup is a folder of its own.
 *
 * A backup can be gigabytes, so nothing is unpacked up front: the zip's
 * names are listed first, and each notebook's entries are inflated only when
 * that notebook is converted. With `onResult` a notebook is handed over (and
 * its files released) before the next one is read.
 */

import { unzipSync } from "fflate";
import { isFreenotes, readFreenotes } from "./freenotes";
import { isGoodnotes, readGoodnotes } from "./goodnotes";
import { plural, type ImportResult } from "./import-types";
import type { TextBoxElement } from "../model/document";
import { isNotability, notabilityPdfFiles, readNotability, type PdfPageSize } from "./notability";
import { isNoteful, readNoteful } from "./noteful";
import { annotationStrokes, type PdfPageReading } from "./pdf";
import {
  isRemarkableDocument,
  isRemarkableLines,
  readRemarkableDocument,
  readRemarkableLines,
} from "./remarkable";
import { isSaber, isSaberArchive, readSaber, readSaberArchive } from "./saber";
import { isSupernote, readSupernote } from "./supernote";
import { isXournal, readXournal } from "./xournal";
import { TEMPLATE_EXTENSION, isTemplatePackage, readTemplatePackage } from "./template-package";

export type { ImportAttachment, ImportResult, ImportSource } from "./import-types";
export { relinkAttachments } from "./import-types";
export type { PdfPageSize } from "./notability";

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
  "freenotes",
  TEMPLATE_EXTENSION,
];

/** Whether a file name has one of {@link IMPORT_EXTENSIONS}. */
export function isImportFileName(name: string): boolean {
  return extensionOf(name) !== null;
}

/** A file name's import extension, lower case, or `null` when it has none of ours. */
function extensionOf(name: string): string | null {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const dot = leaf.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = leaf.slice(dot + 1).toLowerCase();
  return IMPORT_EXTENSIONS.includes(ext) ? ext : null;
}

const NOT_A_NOTEBOOK = "It is not a notebook FineNotes can import.";

/** A converter for a file read whole: whether it is one, and how to read it. */
interface SingleFile {
  is: (bytes: Uint8Array) => boolean;
  read: (bytes: Uint8Array, title: string) => ImportResult;
}

/**
 * Formats that are one file, tried before a file is opened as a zip. Order
 * matters only where one format can contain another's signature: Xournal++
 * also saves a zip, which only it recognises, so it goes before the zips.
 */
const SINGLE_FILES: readonly SingleFile[] = [
  { is: isNoteful, read: readNoteful },
  { is: isXournal, read: readXournal },
  { is: isSupernote, read: readSupernote },
  { is: isRemarkableLines, read: readRemarkableLines },
  { is: isSaber, read: (bytes, title) => readSaber(bytes, title) },
];

/** A sniffing test that throws is a "no". */
function safely(test: () => boolean): boolean {
  try {
    return test();
  } catch {
    return false;
  }
}

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
   * Every page of a PDF with its ink and highlight annotations (pdf.js, in
   * the plugin), for handwriting saved in a notebook's paper. Without it, or
   * when it fails, that handwriting stays part of the paper.
   */
  readPdfInk?: (bytes: Uint8Array) => Promise<readonly PdfPageReading[]>;
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
  await fromBytes(bytes, fileName, batch, 0, options, []);
  if (batch.results.length === 0 && batch.failures.length === 0 && !options.cancelled?.()) {
    batch.failures.push({
      name: fileName,
      reason: "No notebook FineNotes can import was found in it.",
    });
  }
  return batch;
}

/**
 * One file's bytes: a single-file notebook, or a zip to look into. `folder`
 * is where the file sits inside the picked zip, one name per folder.
 */
async function fromBytes(
  bytes: Uint8Array,
  fileName: string,
  batch: ImportBatch,
  depth: number,
  options: ImportOptions,
  folder: readonly string[],
): Promise<void> {
  const single = SINGLE_FILES.find((format) => safely(() => format.is(bytes)));
  if (single) {
    let result: ImportResult;
    try {
      result = single.read(bytes, baseName(fileName) || "Imported notebook");
    } catch (e) {
      batch.failures.push({ name: fileName, reason: `It could not be read (${errorText(e)}).` });
      return;
    }
    await deliver(result, folder, batch, options);
    return;
  }
  const names = entryNames(bytes);
  if (!names) {
    batch.failures.push({ name: fileName, reason: NOT_A_NOTEBOOK });
    return;
  }
  await collect(bytes, names, fileName, batch, depth, options, folder);
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
  folder: readonly string[],
): Promise<void> {
  // Whether this zip is itself one notebook: the readers decide from names alone.
  const index: Files = new Map(names.map((name) => [name, EMPTY]));
  // A reMarkable document is told by its `.content` file's JSON, so that one is read.
  const remarkable =
    names.some((name) => name.endsWith(".content")) &&
    safely(() => isRemarkableDocument(readEntries(bytes, (n) => n.endsWith(".content"))));
  if (
    isTemplatePackage(index) ||
    isGoodnotes(index) ||
    isNotability(index) ||
    isSaberArchive(index) ||
    isFreenotes(index) ||
    remarkable
  ) {
    if (options.cancelled?.()) return;
    let files: Files;
    try {
      files = readEntries(bytes, () => true);
    } catch (e) {
      batch.failures.push({ name: fileName, reason: `It could not be read (${errorText(e)}).` });
      return;
    }
    await convert(files, fileName, batch, options, folder);
    return;
  }
  if (depth >= MAX_NESTING) return;

  // A backup: notebooks packed inside as files, or as unzipped package folders.
  // PDFs inside a backup need pdf.js; they are left for the dialog's own PDF path.
  const packed = names
    .filter(
      (name) => isImportFileName(name) && extensionOf(name) !== "pdf" && !isMacResource(name),
    )
    .sort();
  const packages = packageFolders(names.filter((name) => !isMacResource(name)));
  // A backup inside the picked one is a folder named after it.
  const here = depth > 0 && baseName(fileName) ? [...folder, baseName(fileName)] : [...folder];
  const wrapper = wrapperDepth([...packed, ...packages]);
  const folderOf = (path: string): string[] => [...here, ...path.split("/").slice(wrapper, -1)];
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
    await fromBytes(inner, name, batch, depth + 1, options, folderOf(name));
  }
  for (const pkg of packages) {
    if (options.cancelled?.()) return;
    const prefix = `${pkg}/`;
    let files: Files;
    try {
      const entries = readEntries(bytes, (n) => n.startsWith(prefix) && !n.endsWith("/"));
      files = new Map([...entries].map(([n, data]) => [n.slice(prefix.length), data]));
    } catch (e) {
      batch.failures.push({ name: pkg, reason: `It could not be read (${errorText(e)}).` });
      continue;
    }
    if (
      isGoodnotes(files) ||
      isNotability(files) ||
      isSaberArchive(files) ||
      isFreenotes(files) ||
      safely(() => isRemarkableDocument(files))
    ) {
      await convert(files, pkg, batch, options, folderOf(pkg));
    }
  }
}

/**
 * How many leading folders every notebook in a backup shares, as a wrapper
 * to leave out: `Library/Math/A.goodnotes` and `Library/B.goodnotes` share
 * one. A notebook at the top of the zip means none.
 */
function wrapperDepth(paths: readonly string[]): number {
  const dirs = paths.map((path) => path.split("/").slice(0, -1));
  let depth = 0;
  while (
    dirs.length > 0 &&
    dirs.every((dir) => dir.length > depth && dir[depth] === dirs[0][depth])
  ) {
    depth++;
  }
  return depth;
}

/** The resource forks a Mac adds to the zips it makes (`__MACOSX/…`, `._X.goodnotes`). */
function isMacResource(name: string): boolean {
  return name.startsWith("__MACOSX/") || (name.split("/").pop() ?? "").startsWith("._");
}

/** Convert one notebook's entries and hand the result over. */
async function convert(
  files: Files,
  fileName: string,
  batch: ImportBatch,
  options: ImportOptions,
  folder: readonly string[],
): Promise<void> {
  const title = baseName(fileName);
  let result: ImportResult;
  try {
    if (isTemplatePackage(files)) {
      result = readTemplatePackage(files, title || "Template");
    } else if (isGoodnotes(files)) {
      result = readGoodnotes(files, title);
    } else if (isFreenotes(files)) {
      result = readFreenotes(files, title || "Imported notebook");
    } else if (isSaberArchive(files)) {
      result = readSaberArchive(files, title || "Imported notebook");
    } else if (safely(() => isRemarkableDocument(files))) {
      result = readRemarkableDocument(files, title || "Imported notebook");
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
  await deliver(result, folder, batch, options);
}

/**
 * Hand one converted notebook over: its folder set, the paper's handwriting
 * made strokes, PDF pictures made images, then `onResult`.
 */
async function deliver(
  result: ImportResult,
  folder: readonly string[],
  batch: ImportBatch,
  options: ImportOptions,
): Promise<void> {
  if (folder.length > 0) result.folder = folder.join("/");
  await inkFromPaper(result, options.readPdfInk);
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

/** `X.goodnotes/…`, `X.note/…`, `X.rmdoc/…`, `X.sba/…` or `X.frnote/…` folders, in name order. */
function packageFolders(names: string[]): string[] {
  const folders = new Set<string>();
  for (const name of names) {
    const match = /^(.*?\.(?:goodnotes|note|rmdoc|sba|frnote))\/(.+)$/i.exec(name);
    if (match && !match[2].endsWith("/")) folders.add(match[1]);
  }
  return [...folders].sort();
}

/** A file name without folders and without its notebook extension; "" when nothing is left. */
function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  const ext = extensionOf(last);
  return (ext ? last.slice(0, -ext.length - 1) : last).trim();
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** "page 3" or "pages 1, 4". */
function pagesText(pages: ReadonlySet<number>): string {
  return pages.size === 1
    ? `page ${[...pages][0]}`
    : `pages ${[...pages].sort((a, b) => a - b).join(", ")}`;
}

/**
 * Handwriting saved in a page's paper PDF as ink or highlight annotations (a
 * sheet written on in another app, or a notebook exported to PDF and brought
 * back in) as strokes, as a PDF import brings it over. That paper is then
 * drawn without its annotations, so the handwriting is not there twice.
 *
 * pdf.js draws a PDF's annotations all or none, so a PDF that also holds
 * annotations a stroke cannot be (typed text, shapes, form fields) keeps all
 * of them as part of its paper.
 */
async function inkFromPaper(
  result: ImportResult,
  read: ImportOptions["readPdfInk"],
): Promise<void> {
  if (!read) return;
  const pdfs = new Map(
    result.attachments.filter((a) => a.mime === "application/pdf").map((a) => [a.name, a]),
  );
  const papers = new Set(
    result.doc.pages.flatMap((page) =>
      page.backdrop.kind === "pdf" && pdfs.has(page.backdrop.path) ? [page.backdrop.path] : [],
    ),
  );
  let strokeN = Math.max(
    0,
    ...result.doc.pages.flatMap((page) =>
      page.strokes.map((stroke) => Number(/^s(\d+)$/.exec(stroke.id)?.[1] ?? 0)),
    ),
  );
  const moved = new Set<number>();
  const kept = new Set<number>();
  for (const path of papers) {
    let readings: readonly PdfPageReading[];
    try {
      readings = await read(pdfs.get(path)?.bytes ?? new Uint8Array());
    } catch {
      continue;
    }
    const keep = readings.some((reading) => (reading.others ?? 0) > 0);
    result.doc.pages.forEach((page, index) => {
      const backdrop = page.backdrop;
      if (backdrop.kind !== "pdf" || backdrop.path !== path) return;
      const reading = readings[backdrop.page];
      if (keep) {
        if (reading && reading.inks.length > 0) kept.add(index + 1);
        return;
      }
      if (!readings.some((r) => r.inks.length > 0)) return;
      backdrop.annotations = false;
      if (!reading) return;
      const strokes = annotationStrokes(reading, page.geometry.width, page.geometry.height);
      if (strokes.length === 0) return;
      // Under what was written in the notebook itself, as the paper was.
      page.strokes.unshift(...strokes.map((stroke) => ({ id: `s${++strokeN}`, ...stroke })));
      moved.add(index + 1);
    });
  }
  if (moved.size > 0) {
    result.warnings.push(
      "Handwriting saved in the paper PDF as annotations came over as strokes " +
        `(${pagesText(moved)}).`,
    );
  }
  if (kept.size > 0) {
    result.warnings.push(
      "Handwriting saved in the paper PDF as annotations stays part of the paper, " +
        `as the PDF also holds typed text, shapes or form fields (${pagesText(kept)}).`,
    );
  }
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
