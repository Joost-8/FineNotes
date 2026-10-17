/**
 * "My templates": papers a user brought in once and picks like any built-in
 * paper. Each is a PDF in the `Papers` folder of the templates folder, and
 * each of its pages is a paper, so a 12-page planner is twelve papers
 * (Goodnotes keeps only a PDF's first page). A picture is turned into a
 * one-page PDF on the way in (`import/image-pdf.ts`), so every paper is
 * drawn by the same PDF backdrop code.
 *
 * A notebook that uses a paper gets its own copy of the PDF beside it, as
 * every picture and PDF of a notebook is (Joost, 2026-10-17): deleting a
 * template never blanks a page, and a shared notebook keeps its paper.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { PageGeometry, PdfBackdrop } from "./document";

/** The library's folder inside the templates folder. */
export const PAPERS_FOLDER = "Papers";

/** What may be imported as paper: a PDF, or a picture made into one. */
export const PAPER_SOURCE_EXTENSIONS: readonly string[] = ["pdf", "png", "jpg", "jpeg", "webp"];

/** The prefix a notebook's own copy of a library paper is saved under. */
export const PAPER_COPY_PREFIX = "Paper ";

export interface PaperEntry {
  /** Vault path of the library's PDF. */
  path: string;
  /** 0-based page of that PDF. */
  page: number;
  /** The PDF page's size, in its own units: only the shape matters. */
  width: number;
  height: number;
  /** What the picker shows under it. */
  name: string;
}

/** The library's folder for templates folder `templateFolder`. */
export function papersFolderOf(templateFolder: string): string {
  const base = templateFolder.replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${PAPERS_FOLDER}` : PAPERS_FOLDER;
}

/** Whether a file with extension `ext` can be imported as paper. */
export function isPaperSource(ext: string): boolean {
  return PAPER_SOURCE_EXTENSIONS.includes(ext.toLowerCase());
}

/** A file name's stem, tidied into a paper's name: no extension, no characters a vault refuses. */
export function paperName(fileName: string): string {
  const leaf = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
  const dot = leaf.lastIndexOf(".");
  // A name that is only an extension (".pdf") has no stem.
  const stem = (dot >= 0 ? leaf.slice(0, dot) : leaf)
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stem || "Paper";
}

/** The papers of one library PDF at `path`, a page each, from its page sizes. */
export function paperEntries(
  path: string,
  sizes: ReadonlyArray<{ width: number; height: number }>,
): PaperEntry[] {
  const name = paperName(path);
  return sizes.flatMap((size, page) =>
    size.width > 0 && size.height > 0
      ? [
          {
            path,
            page,
            width: size.width,
            height: size.height,
            name: sizes.length > 1 ? `${name} · ${page + 1}` : name,
          },
        ]
      : [],
  );
}

/**
 * A page for `entry` in a notebook whose pages are `width` page px across:
 * that width, and the paper's own shape, to whole page px.
 */
export function paperGeometry(
  entry: Pick<PaperEntry, "width" | "height">,
  width: number,
): PageGeometry {
  return { width, height: Math.round((width * entry.height) / entry.width) };
}

/** The page backdrop for page `page` of the notebook's copy at `path`. */
export function paperBackdrop(path: string, page: number): PdfBackdrop {
  return { kind: "pdf", path, page };
}

/**
 * Of the PDFs a notebook already shows, one that is its copy of library file
 * `name` (saved as `Paper <name> …`, see {@link PAPER_COPY_PREFIX}) and
 * holds `size` bytes, so a paper used again is not copied again.
 */
export function existingCopy(
  shown: ReadonlyArray<{ path: string; size: number }>,
  name: string,
  size: number,
): string | null {
  const prefix = `${PAPER_COPY_PREFIX}${name}`;
  for (const file of shown) {
    const leaf = file.path.slice(file.path.lastIndexOf("/") + 1);
    if (leaf.startsWith(prefix) && leaf.toLowerCase().endsWith(".pdf") && file.size === size) {
      return file.path;
    }
  }
  return null;
}
