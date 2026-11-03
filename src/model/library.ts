/**
 * The notebook library: what the library view lists, and how it arranges it.
 *
 * A library entry is one ink note in the vault, read down to what a cover
 * and a caption need: its title, its folder, its page count and the colour
 * of its cover. The folder structure is the vault's own.
 *
 * No DOM, no Obsidian.
 */

import { isCoverRuling } from "./document";
import { stripInkSuffix } from "./new-notebook";
import { parseInkFile } from "./serialize";

/** What the library knows of one notebook. */
export interface LibraryEntry {
  /** Vault path, e.g. `Uni/Algebra.notebook.md`. */
  path: string;
  /** The file's name without its ink suffix. */
  title: string;
  /** The folder it sits in; empty at the vault's root. */
  folder: string;
  /** Pages, not counting a cover. */
  pages: number;
  /** The cover's cloth, or the first page's paper, as `#rrggbb`. */
  color: string;
  /** Whether any page is a PDF. */
  hasPdf: boolean;
  /** Whether the first page is a cover, which `pages` does not count. */
  covered: boolean;
  /** Last edit, ms since the epoch. */
  edited: number;
}

/** A notebook the library has not read yet: its file's facts only. */
export function placeholderEntry(path: string, edited: number): LibraryEntry {
  return {
    path,
    title: stripInkSuffix(baseName(path)),
    folder: folderOf(path),
    pages: 0,
    color: FALLBACK_COLOR,
    hasPdf: false,
    covered: false,
    edited,
  };
}

/** Cover colour for a notebook with none to read. */
export const FALLBACK_COLOR = "#6b7280";

const HEX = /^#[0-9a-f]{6}$/i;

/** The file name of a vault path. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The folder of a vault path; empty for the root. */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** `entry` read from the note's text. An unreadable note keeps its placeholder. */
export function entryFromText(path: string, edited: number, markdown: string): LibraryEntry {
  const base = placeholderEntry(path, edited);
  const doc = parseInkFile(markdown).doc;
  if (!doc || doc.pages.length === 0) return base;
  const first = doc.pages[0];
  const covered = first !== undefined && isCoverRuling(first.backdrop.kind);
  const tint = first && "paperColor" in first.backdrop ? first.backdrop.paperColor : undefined;
  return {
    ...base,
    pages: doc.pages.length - (covered ? 1 : 0),
    color: tint !== undefined && HEX.test(tint) ? tint.toLowerCase() : FALLBACK_COLOR,
    hasPdf: doc.pages.some((p) => p.backdrop.kind === "pdf"),
    covered,
  };
}

// --- Browsing ---------------------------------------------------------------

export interface LibraryFolder {
  name: string;
  path: string;
  /** Notebooks in it and in every folder below it. */
  count: number;
}

export interface Listing {
  folders: LibraryFolder[];
  notebooks: LibraryEntry[];
}

/** Whether `path` lies in `folder` or below it. The root holds everything. */
function within(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

/** The folders directly inside `folder`, and the notebooks directly in it. */
export function browse(entries: readonly LibraryEntry[], folder: string): Listing {
  const counts = new Map<string, number>();
  const notebooks: LibraryEntry[] = [];
  const prefix = folder === "" ? "" : `${folder}/`;
  for (const entry of entries) {
    if (!within(entry.folder, folder)) continue;
    if (entry.folder === folder) {
      notebooks.push(entry);
      continue;
    }
    const next = entry.folder.slice(prefix.length).split("/")[0] ?? "";
    counts.set(next, (counts.get(next) ?? 0) + 1);
  }
  const folders = [...counts]
    .map(([name, count]) => ({ name, path: `${prefix}${name}`, count }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  return { folders, notebooks };
}

/**
 * The notebooks as the library files them: a folder that holds a single
 * notebook (a notebook in a folder of its own, say) is not worth a visit, so
 * its notebook is filed in the folder above, and above that while that one
 * holds no other either. Only `folder` changes, never `path`.
 */
export function hoistSingles(entries: readonly LibraryEntry[]): LibraryEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (let at = entry.folder; at !== ""; at = folderOf(at))
      counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  return entries.map((entry) => {
    let folder = entry.folder;
    while (folder !== "" && counts.get(folder) === 1) folder = folderOf(folder);
    return folder === entry.folder ? entry : { ...entry, folder };
  });
}

/** The folders leading to `folder`, outermost first: "A/B" gives A, A/B. */
export function crumbs(folder: string): LibraryFolder[] {
  const parts = folder === "" ? [] : folder.split("/");
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/"), count: 0 }));
}

export type LibrarySort = "edited" | "name" | "pages";

/** A sorted copy: newest first, A to Z, or most pages first. Ties fall back to the name. */
export function sortEntries(entries: readonly LibraryEntry[], by: LibrarySort): LibraryEntry[] {
  const name = (a: LibraryEntry, b: LibraryEntry): number =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
  const order: Record<LibrarySort, (a: LibraryEntry, b: LibraryEntry) => number> = {
    edited: (a, b) => b.edited - a.edited || name(a, b),
    name,
    pages: (a, b) => b.pages - a.pages || name(a, b),
  };
  return [...entries].sort(order[by]);
}

/** Notebooks whose title or folder holds every word of `query`; all of them for an empty query. */
export function searchEntries(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const hay = `${e.title} ${e.folder}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * The `count` notebooks touched last, newest first: edited, or read to the
 * time `readAt` gives for it, whichever is later.
 */
export function continueEntries(
  entries: readonly LibraryEntry[],
  count = 3,
  readAt: (path: string) => number = () => 0,
): LibraryEntry[] {
  const last = (e: LibraryEntry): number => Math.max(e.edited, readAt(e.path));
  return [...entries]
    .sort((a, b) => last(b) - last(a) || a.title.localeCompare(b.title))
    .slice(0, count);
}

/** How far into a notebook the reader got. */
export interface Progress {
  /** The page being read, 1-based, not counting a cover. */
  page: number;
  /** Of how many. */
  of: number;
  /** `page / of`, 0 to 1. */
  ratio: number;
}

/**
 * Where the reader is in `entry`, from the index of the page they left it on
 * (a cover counts as index 0). `null` when there is no record, the notebook
 * has no pages yet, or the reader never got past the cover.
 */
export function readProgress(entry: LibraryEntry, leftAt: number | undefined): Progress | null {
  if (leftAt === undefined || entry.pages < 1) return null;
  const page = Math.min(entry.pages, leftAt + 1 - (entry.covered ? 1 : 0));
  if (page < 1) return null;
  return { page, of: entry.pages, ratio: page / entry.pages };
}

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2 h ago", "Yesterday", "Mon" within the week, then "Oct 30" (and the year once it is not this one). */
export function whenText(edited: number, now: number): string {
  const ago = now - edited;
  if (ago < 60_000) return "Just now";
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)} min ago`;
  const then = new Date(edited);
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (edited >= midnight) return `${Math.floor(ago / 3_600_000)} h ago`;
  if (edited >= midnight - DAY) return "Yesterday";
  if (edited >= midnight - 6 * DAY) return WEEKDAYS[then.getDay()] ?? "";
  const day = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === today.getFullYear() ? day : `${day}, ${then.getFullYear()}`;
}
