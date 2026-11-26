/**
 * A PDF's name chosen in the Export dialog (FineNotes#318). Left empty, an
 * export gets a name of its own, never over an existing file. A name typed
 * there is the user's: it is used as typed, replacing a file of that name
 * when one exists (so a link to that file, a shared Drive file for example,
 * keeps showing the newest export), and remembered for the notebook, so the
 * next export of it starts from the same name.
 *
 * Pure: no DOM, no Obsidian.
 */

import { cleanName, dropPaths, movedPath } from "../model/library-style";

/** Names typed per notebook, by the notebook's vault path. */
export type ExportNames = Readonly<Record<string, string>>;

/** Stored names as read back from settings: only string values under string keys. */
export function exportNamesOf(raw: unknown): ExportNames {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [path, name] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof name === "string" && typedPdfName(name)) out[path] = typedPdfName(name);
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
  /** An existing file of that name is replaced. */
  replaces: boolean;
}

/**
 * The file a PDF export saves as. `typed` is the dialog's field; `fallback`
 * the name the export takes without one (already free in the folder);
 * `taken` the names in the folder now.
 */
export function pdfName(typed: string, fallback: string, taken: ReadonlySet<string>): PdfName {
  const base = typedPdfName(typed);
  if (!base) return { name: fallback, replaces: false };
  const name = `${base}.pdf`;
  // Vaults on iPad, Android and Windows ignore case: "notes.pdf" is "Notes.pdf".
  const lower = name.toLowerCase();
  const existing = [...taken].find((n) => n.toLowerCase() === lower);
  return existing ? { name: existing, replaces: true } : { name, replaces: false };
}

/** `names` with `path`'s typed name set, or dropped when `typed` is empty. */
export function rememberPdfName(names: ExportNames, path: string, typed: string): ExportNames {
  const base = typedPdfName(typed);
  const out: Record<string, string> = { ...names };
  if (base) out[path] = base;
  else delete out[path];
  return out;
}

/** The names followed through a rename or move of `from` (a file or a folder); dropped when `to` is absent (a delete). */
export function movePdfNames(names: ExportNames, from: string, to?: string): ExportNames {
  const paths = Object.keys(names);
  if (to === undefined) {
    const kept = new Set(dropPaths(paths, from));
    return Object.fromEntries(Object.entries(names).filter(([p]) => kept.has(p)));
  }
  return Object.fromEntries(Object.entries(names).map(([p, n]) => [movedPath(p, from, to), n]));
}
