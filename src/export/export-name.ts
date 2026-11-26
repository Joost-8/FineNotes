/**
 * A PDF's name chosen in the Export dialog (FineNotes#318). Left empty, an
 * export gets a name of its own, never over an existing file. A name typed
 * there is the user's and is remembered for the notebook. The file an export
 * of that notebook wrote under it is replaced by the next one, in place (so a
 * link to it, a shared Drive file for example, keeps showing the newest
 * export). Only that file: a file of the same name that this notebook's
 * export did not write (the PDF the notebook is drawn on, another export, a
 * homework sheet) is never replaced; the export then takes a free name
 * beside it, as an empty field does.
 *
 * Pure: no DOM, no Obsidian.
 */

import { cleanName, dropPaths, movedPath } from "../model/library-style";
import { uniqueFileName } from "../model/new-notebook";

/** One notebook's PDF name, and the vault path its export last wrote under it. */
export interface ExportName {
  name: string;
  /** The file written, which the next export under this name may replace. */
  file?: string;
}

/** Names typed per notebook, by the notebook's vault path. */
export type ExportNames = Readonly<Record<string, ExportName>>;

/** Stored names as read back from settings: anything else is dropped. */
export function exportNamesOf(raw: unknown): ExportNames {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, ExportName> = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { name, file } = value as { name?: unknown; file?: unknown };
    const base = typeof name === "string" ? typedPdfName(name) : "";
    if (!base) continue;
    out[path] = typeof file === "string" && file ? { name: base, file } : { name: base };
  }
  return out;
}

/**
 * The typed text as a PDF's name, without its `.pdf` (which is added when
 * saving) and without what a file name cannot hold; "" when nothing is left.
 */
export function typedPdfName(raw: string): string {
  return cleanName(cleanName(raw).replace(/\.pdf$/i, ""));
}

/** What an export saves as: the typed name when there is one, else the free default. */
export interface PdfName {
  /** The file name, `.pdf` included. */
  name: string;
  /** An existing file of that name is replaced: the one this notebook's export wrote. */
  replaces: boolean;
}

/**
 * The file a PDF export saves as. `typed` is the dialog's field; `fallback`
 * the name the export takes without one (already free in the folder);
 * `taken` the names in the folder now; `own` the name, in this folder, of
 * the file this notebook's export last wrote (see {@link ownPdfName}).
 */
export function pdfName(
  typed: string,
  fallback: string,
  taken: ReadonlySet<string>,
  own?: string,
): PdfName {
  const base = typedPdfName(typed);
  if (!base) return { name: fallback, replaces: false };
  const name = `${base}.pdf`;
  // Vaults on iPad, Android and Windows ignore case: "notes.pdf" is "Notes.pdf".
  const lower = name.toLowerCase();
  const existing = [...taken].find((n) => n.toLowerCase() === lower);
  if (!existing) return { name, replaces: false };
  if (own !== undefined && own.toLowerCase() === lower) return { name: existing, replaces: true };
  // Someone else's file: never over it.
  return { name: uniqueFileName(base, ".pdf", taken), replaces: false };
}

/** The name in `folder` ("" the vault's root) of the file `entry`'s export last wrote, if it lies there. */
export function ownPdfName(entry: ExportName | undefined, folder: string): string | undefined {
  const file = entry?.file;
  if (!file) return undefined;
  const slash = file.lastIndexOf("/");
  const dir = slash < 0 ? "" : file.slice(0, slash);
  return dir === folder ? file.slice(slash + 1) : undefined;
}

/**
 * `names` after an export of notebook `path` with `typed` in the field,
 * which wrote `file`: the name and file remembered, or dropped when the
 * field was empty.
 */
export function rememberPdfName(
  names: ExportNames,
  path: string,
  typed: string,
  file: string,
): ExportNames {
  const base = typedPdfName(typed);
  const out: Record<string, ExportName> = { ...names };
  if (base) out[path] = { name: base, file };
  else delete out[path];
  return out;
}

/**
 * The names followed through a rename or move of `from` (a file or a
 * folder): the notebooks and the files their exports wrote. A delete (`to`
 * absent) drops a deleted notebook's entry, and a deleted file's link.
 */
export function movePdfNames(names: ExportNames, from: string, to?: string): ExportNames {
  const gone = (p: string): boolean => dropPaths([p], from).length === 0;
  const out: Record<string, ExportName> = {};
  for (const [path, entry] of Object.entries(names)) {
    if (to === undefined) {
      if (gone(path)) continue;
      out[path] = entry.file && gone(entry.file) ? { name: entry.name } : entry;
    } else {
      const file = entry.file === undefined ? undefined : movedPath(entry.file, from, to);
      out[movedPath(path, from, to)] =
        file === undefined ? { name: entry.name } : { name: entry.name, file };
    }
  }
  return out;
}
