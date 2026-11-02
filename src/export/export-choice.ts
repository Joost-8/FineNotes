/**
 * What an export makes, where, and how its dialog opens: the format (one PDF,
 * or a picture per page as PNG or JPG), the names of the files or folder it
 * writes, and the sentence that says so (discussion #107, points 17 and 18).
 *
 * PURE: no DOM, no Obsidian.
 */

import { uniqueFileName } from "../model/new-notebook";
import { type ExportScope, exportBaseName, exportTitle, formatPageRange } from "./page-range";

export type ExportFormat = "pdf" | "png" | "jpg";

/** The dialog's format control, in order. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ["pdf", "png", "jpg"];

/** A stored format, or PDF for anything else (a setting from before formats). */
export function exportFormatOf(value: unknown): ExportFormat {
  return EXPORT_FORMATS.find((format) => format === value) ?? "pdf";
}

/** `PDF`, `PNG`, `JPG`: the control's labels and the folder's suffix. */
export function formatLabel(format: ExportFormat): string {
  return format.toUpperCase();
}

export function extensionOf(format: ExportFormat): string {
  return `.${format}`;
}

export function mimeTypeOf(format: ExportFormat): string {
  return format === "pdf" ? "application/pdf" : format === "png" ? "image/png" : "image/jpeg";
}

/**
 * The files an export writes: one file (a PDF, or the picture of a single
 * page), or a new folder holding one picture per page.
 */
export type ExportTarget =
  { kind: "file"; name: string } | { kind: "folder"; folder: string; names: string[] };

/**
 * Name what exporting `pages` of the notebook `title` as `format` writes,
 * next to the names already `taken` where it is saved. A PDF, or one page,
 * is one file named as before (`Biology (page 3).png`); several pictures go
 * into a new folder (`Biology (pages 1-3) PNG`), each named after the
 * notebook and its page ({@link pageImageName}).
 */
export function exportTarget(
  title: string,
  pages: readonly number[],
  total: number,
  format: ExportFormat,
  taken: ReadonlySet<string>,
): ExportTarget {
  const base = exportBaseName(title, pages, total);
  if (format === "pdf" || pages.length <= 1) {
    return { kind: "file", name: uniqueFileName(base, extensionOf(format), taken) };
  }
  return {
    kind: "folder",
    folder: uniqueFileName(`${base} ${formatLabel(format)}`, "", taken),
    names: pages.map((page) => pageImageName(title, page, total, format)),
  };
}

/**
 * Page `page` (0-based) of a notebook of `total` as one picture in a folder:
 * `Biology page 03.png`, the number padded to the notebook's last page so a
 * file list sorts the pages in order.
 */
export function pageImageName(
  title: string,
  page: number,
  total: number,
  format: ExportFormat,
): string {
  const digits = String(Math.max(1, total, page + 1)).length;
  const number = String(page + 1).padStart(digits, "0");
  return `${exportTitle(title)} page ${number}${extensionOf(format)}`;
}

/** How the export dialog opens. */
export interface ExportOpening {
  /**
   * Pages were chosen beforehand (the overview's selection): the dialog
   * shows them and asks only what is left, not which pages again.
   */
  preset: boolean;
  scope: ExportScope;
  /** The pages ticked under Choose pages, in export order. */
  chosen: number[];
}

/**
 * Open on the pages `chosen` beforehand when there are any (pages that no
 * longer exist dropped, each page once), else on the whole notebook (a
 * single page: that page).
 */
export function exportOpening(
  chosen: readonly number[] | undefined,
  pageCount: number,
  currentPage: number,
): ExportOpening {
  const valid = [
    ...new Set((chosen ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < pageCount)),
  ];
  if (valid.length > 0) return { preset: true, scope: "custom", chosen: valid };
  return { preset: false, scope: pageCount > 1 ? "all" : "current", chosen: [currentPage] };
}

export interface ExportSummary {
  /** The pages, in export order. */
  pages: readonly number[];
  /** Picked one by one (Choose pages, or the overview's selection): name them. */
  picked: boolean;
  target: ExportTarget;
  format: ExportFormat;
  /** The note's exports folder, or `null` when files are saved next to the note. */
  folder: string | null;
  /** "notebook" or "page". */
  noun: string;
}

/**
 * The dialog's one line on what Export will do: `3 pages (2, 5, 7), saved as
 * “Biology (pages 2,5,7).pdf” next to this notebook.`
 */
export function exportSummary(s: ExportSummary): string {
  const n = s.pages.length;
  const count = n === 1 ? "1 page" : `${n} pages`;
  let which = "";
  if (s.picked) {
    const range = formatPageRange(s.pages);
    // A folder of pictures is named by page, so their order says nothing.
    const reordered =
      s.target.kind === "file" && s.pages.some((page, i) => i > 0 && page < s.pages[i - 1]);
    which = reordered ? ` (${range}, in that order)` : ` (${range})`;
  }
  const saved =
    s.target.kind === "file"
      ? `saved as “${s.target.name}”`
      : `saved as ${n} ${formatLabel(s.format)} images in “${s.target.folder}”`;
  const where = s.folder !== null ? `in “${s.folder}”` : `next to this ${s.noun}`;
  return `${count}${which}, ${saved} ${where}.`;
}

/** What the dialog says once the files are saved. */
export function savedText(paths: readonly string[], where: string): string {
  return paths.length === 1
    ? `Saved “${paths[0]}”.`
    : `Saved ${paths.length} images in “${where}”.`;
}
