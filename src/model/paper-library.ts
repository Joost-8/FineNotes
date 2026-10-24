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

/** The most a downloaded or imported paper file may weigh, bytes. */
export const MAX_PAPER_BYTES = 40 * 1024 * 1024;

/**
 * What a file is, by its first bytes, never by its name: only these may
 * become paper. Everything else (SVG, zip, HTML, scripts) is refused, so a
 * template from anyone carries nothing that can run.
 */
export function paperFileKind(head: Uint8Array): "pdf" | "png" | "jpeg" | "webp" | null {
  const at = (i: number): number => head[i] ?? -1;
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) {
    return "pdf";
  }
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  const riff = at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46;
  if (riff && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "webp";
  return null;
}

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

/**
 * Whether a page's PDF is paper from My templates, which a page added after
 * it repeats, rather than content such as a lecture's slides. A page made
 * from My templates says so (`template`). One made before it did is known
 * by its copy's name, `Paper <name>.pdf` (or `… 2.pdf`), and only while a
 * template of that name is still in My templates (`templateNames`, as
 * {@link paperName} gives them): an imported "Paper 2.pdf" is not paper.
 */
export function isTemplatePaper(
  backdrop: PdfBackdrop,
  templateNames: ReadonlySet<string>,
): boolean {
  if (backdrop.template === true) return true;
  const leaf = backdrop.path.slice(backdrop.path.lastIndexOf("/") + 1);
  if (!leaf.startsWith(PAPER_COPY_PREFIX) || !leaf.toLowerCase().endsWith(".pdf")) return false;
  const stem = leaf.slice(PAPER_COPY_PREFIX.length, -".pdf".length);
  // The copy's own name, or that name with the number a second copy gets.
  const name = stem.replace(/ \d+$/, "");
  return templateNames.has(stem) || templateNames.has(name);
}

/** The page backdrop for page `page` of the notebook's copy at `path`: marked as a template's. */
export function paperBackdrop(path: string, page: number): PdfBackdrop {
  return { kind: "pdf", path, page, template: true };
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
