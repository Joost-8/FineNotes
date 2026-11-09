/**
 * The notebook library: what the library view lists, and how it arranges it.
 *
 * A library entry is one ink note in the vault, read down to what a cover
 * and a caption need: its title, its folder, its page count and the colour
 * of its cover; or one of the vault's other files, shown beside the
 * notebooks in its folder. The folder structure is the vault's own.
 *
 * No DOM, no Obsidian.
 */

import { localeTag, t, tn } from "../i18n/translate";
import { type InkDocument, type PageGeometry, type PdfBackdrop, isCoverRuling } from "./document";
import { inkFileSuffix, stripInkSuffix } from "./new-notebook";
import { previewCaption, previewPageIndexes } from "./preview-pages";
import { parseInkFile } from "./serialize";

/**
 * What a library item is: a notebook, or one of the vault's other files,
 * which the library shows by what it holds (a note's first page, a PDF's
 * first page, the picture itself) or, for the rest, by a symbol.
 */
export type EntryKind = "notebook" | "note" | "pdf" | "image" | "file";

/** What the library knows of one notebook or file. */
export interface LibraryEntry {
  kind: EntryKind;
  /** Vault path, e.g. `Uni/Algebra.notebook.md`. */
  path: string;
  /** The file's name without its ink suffix, or a file's without its extension. */
  title: string;
  /** The folder it sits in; empty at the vault's root. */
  folder: string;
  /** Pages, not counting a cover. */
  pages: number;
  /** The cover's cloth, or the first page's paper, as `#rrggbb`. */
  color: string;
  /** Whether any page is a PDF. */
  hasPdf: boolean;
  /** The PDF page a notebook opens on (its first page past the cover), when that page is a PDF's: its cover picture. */
  pdf: LibraryPdf | null;
  /** Whether the first page is a cover, which `pages` does not count. */
  covered: boolean;
  /** Last edit, ms since the epoch. */
  edited: number;
  /** When the file was made, ms since the epoch; the library fills it from the file. */
  created?: number;
  /**
   * The pages the preview's strip shows, when the notebook has more than
   * fit (`homePreviewPages`); absent, the strip shows its pages from the
   * first.
   */
  preview?: PreviewSheet[];
}

/** How many pages the strip of Home's preview shows, not counting a cover. */
export const HOME_PREVIEW_PAGES = 12;

/** One page of a shortened strip: which page, and what says which it is. */
export interface PreviewSheet {
  /** Its place among all the notebook's pages, the cover included. */
  index: number;
  /** Its line in the contents, when it has one. */
  title?: string;
  bookmarked?: true;
}

/**
 * The pages the strip of Home's preview shows for a notebook too long to
 * show from its first page: the first page past the cover, then the pages
 * its chapters, bookmarks and contents point to (`previewPageIndexes`, the
 * hover preview's choice), at most `HOME_PREVIEW_PAGES`. A cover is never
 * among them: the preview shows it above the strip. `undefined` when every
 * page fits.
 */
export function homePreviewPages(
  pages: InkDocument["pages"],
  covered: boolean,
): PreviewSheet[] | undefined {
  const first = covered ? 1 : 0;
  const rest = pages.slice(first);
  if (rest.length <= HOME_PREVIEW_PAGES) return undefined;
  return previewPageIndexes(rest, HOME_PREVIEW_PAGES).map((i) => {
    const page = rest[i];
    const title = previewCaption(page);
    return {
      index: first + i,
      ...(title !== undefined ? { title } : {}),
      ...(page.bookmarked ? { bookmarked: true as const } : {}),
    };
  });
}

/** A notebook the library has not read yet: its file's facts only. */
export function placeholderEntry(path: string, edited: number): LibraryEntry {
  return {
    kind: "notebook",
    path,
    title: titleOf(baseName(path)),
    folder: folderOf(path),
    pages: 0,
    color: FALLBACK_COLOR,
    hasPdf: false,
    pdf: null,
    covered: false,
    edited,
  };
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);

/** What kind of item a file that is not a notebook is, by its extension. */
export function fileKind(extension: string): Exclude<EntryKind, "notebook"> {
  const ext = extension.toLowerCase();
  if (ext === "md") return "note";
  if (ext === "pdf") return "pdf";
  return IMAGE_EXTENSIONS.has(ext) ? "image" : "file";
}

/** A file name's extension, without the dot; empty for none (a leading dot is part of the name). */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

/**
 * A file of the vault's that is not a notebook, as the library shows it:
 * named without its extension, a PDF with its first page as its cover.
 */
export function fileEntry(path: string, edited: number): LibraryEntry {
  const name = baseName(path);
  const extension = extensionOf(name);
  const kind = fileKind(extension);
  return {
    ...placeholderEntry(path, edited),
    kind,
    title: extension === "" ? name : name.slice(0, -extension.length - 1),
    // The page keeps the PDF's own size; the cover reads it as it draws.
    pdf: kind === "pdf" ? { path, page: 0, width: 0, height: 0 } : null,
  };
}

/** A file's extension, upper case, as a caption names it: "PDF", "CANVAS"; empty for none. */
export function extensionLabel(path: string): string {
  return extensionOf(baseName(path)).toUpperCase();
}

const FILE_ICONS: ReadonlyArray<[icon: string, extensions: readonly string[]]> = [
  ["layout-dashboard", ["canvas"]],
  ["file-audio", ["mp3", "m4a", "wav", "ogg", "flac", "aac", "3gp"]],
  ["file-video", ["mp4", "mov", "mkv", "webm", "ogv", "avi"]],
  ["file-archive", ["zip", "rar", "7z", "tar", "gz"]],
  ["file-spreadsheet", ["csv", "xlsx", "xls", "ods"]],
  ["file-code", ["js", "ts", "py", "json", "css", "html", "c", "cpp", "java", "tex"]],
];

/** The Lucide symbol for a file the library cannot draw a page of. */
export function fileIcon(path: string): string {
  const ext = extensionOf(baseName(path)).toLowerCase();
  return FILE_ICONS.find(([, list]) => list.includes(ext))?.[0] ?? "file";
}

/** About a page of text: past it the preview, a small page, shows nothing more. */
const PREVIEW_CHARS = 1800;
const PREVIEW_LINES = 60;

/**
 * The part of a note its preview renders: the first page's worth, without
 * the frontmatter, and without embeds other than pictures, so a preview
 * never opens a PDF or another note inside it. Cut at a line, and never
 * inside a code or math block (a block left open would swallow nothing, but
 * renders as a box of raw text).
 */
export function notePreviewText(markdown: string): string {
  const bare = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  let text = bare.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  text = text.replace(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, (embed, target: string) =>
    IMAGE_EXTENSIONS.has(extensionOf(target.trim()).toLowerCase()) ? embed : "",
  );
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let length = 0;
  let fence: string | null = null;
  for (const line of lines) {
    const full = length > PREVIEW_CHARS || kept.length >= PREVIEW_LINES;
    // An open block may run on to its end, but not past twice the page.
    if ((full && fence === null) || kept.length >= 2 * PREVIEW_LINES) break;
    kept.push(line);
    length += line.length + 1;
    const trimmed = line.trim();
    const opener = /^(```+|~~~+|\$\$)/.exec(trimmed)?.[1];
    if (fence === null) {
      // `$$ x $$` on one line opens and closes.
      if (opener && !(opener === "$$" && trimmed.length > 2 && trimmed.endsWith("$$"))) {
        fence = opener;
      }
    } else if (opener !== undefined && trimmed.startsWith(fence)) fence = null;
  }
  if (fence !== null) kept.push(fence);
  return kept.join("\n").trim();
}

/** A notebook's name: its file's without the ink suffix, or the ".md" of one marked ink in its frontmatter. */
function titleOf(name: string): string {
  return inkFileSuffix(name) ? stripInkSuffix(name) : name.replace(/.md$/i, "");
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

/** A PDF page in the vault, and the size of the notebook page it fills. */
export interface LibraryPdf {
  path: string;
  /** 0-based. */
  page: number;
  /** 0, with `height`, for a PDF of the vault's own: the page keeps its own size. */
  width: number;
  height: number;
}

/**
 * Where a PDF cover is kept: the page, the PDF file's own mtime and size (a
 * changed PDF misses) and the cover's width in device px (a new screen
 * misses).
 */
export function coverKey(
  pdf: LibraryPdf,
  file: { mtime: number; size: number },
  px: number,
): string {
  return `${pdf.path}#${pdf.page}@${file.mtime}:${file.size}:${Math.round(px)}`;
}

function firstPdf(
  page: { backdrop: { kind: string }; geometry: PageGeometry } | undefined,
): LibraryPdf | null {
  const backdrop = page?.backdrop;
  if (!page || !backdrop || backdrop.kind !== "pdf") return null;
  const pdf = backdrop as unknown as PdfBackdrop;
  const { width, height } = page.geometry;
  if (!(width > 0) || !(height > 0)) return null;
  return { path: pdf.path, page: pdf.page, width, height };
}

/** `entry` read from the note's text. An unreadable note keeps its placeholder. */
export function entryFromText(path: string, edited: number, markdown: string): LibraryEntry {
  return entryFromDoc(path, edited, parseInkFile(markdown).doc);
}

/** `entry` of a notebook already read (`null`: unreadable, it keeps its placeholder). */
export function entryFromDoc(path: string, edited: number, doc: InkDocument | null): LibraryEntry {
  const base = placeholderEntry(path, edited);
  if (!doc || doc.pages.length === 0) return base;
  const first = doc.pages[0];
  const covered = first !== undefined && isCoverRuling(first.backdrop.kind);
  const tint = first && "paperColor" in first.backdrop ? first.backdrop.paperColor : undefined;
  const preview = homePreviewPages(doc.pages, covered);
  return {
    ...base,
    pages: doc.pages.length - (covered ? 1 : 0),
    color: tint !== undefined && HEX.test(tint) ? tint.toLowerCase() : FALLBACK_COLOR,
    hasPdf: doc.pages.some((p) => p.backdrop.kind === "pdf"),
    pdf: firstPdf(doc.pages[covered ? 1 : 0]),
    covered,
    ...(preview ? { preview } : {}),
  };
}

// --- Browsing ---------------------------------------------------------------

export interface LibraryFolder {
  name: string;
  path: string;
  /** Items (notebooks and files) in it and in every folder below it. */
  count: number;
  /** How many of them are notebooks. */
  notebooks: number;
}

export interface Listing {
  folders: LibraryFolder[];
  /** The notebooks and files directly in the folder. */
  notebooks: LibraryEntry[];
}

/** Whether `path` lies in `folder` or below it. The root holds everything. */
function within(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

/** The folders directly inside `folder`, and the notebooks and files directly in it. */
export function browse(entries: readonly LibraryEntry[], folder: string): Listing {
  const counts = new Map<string, number>();
  const books = new Map<string, number>();
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
    if (entry.kind === "notebook") books.set(next, (books.get(next) ?? 0) + 1);
  }
  const folders = [...counts]
    .map(([name, count]) => ({
      name,
      path: `${prefix}${name}`,
      count,
      notebooks: books.get(name) ?? 0,
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  return { folders, notebooks };
}

/**
 * The notebooks as the library files them: a folder that holds a single
 * notebook and nothing else (a notebook in a folder of its own, say) is not
 * worth a visit, so its notebook is filed in the folder above, and above that
 * while that one holds no other item either. A folder in `kept` (one the user
 * made or styled in the library) stays a folder however few it holds. Files
 * stay where they are: a folder holding one is the vault's own. Only
 * `folder` changes, never `path`.
 */
export function hoistSingles(
  entries: readonly LibraryEntry[],
  kept: (folder: string) => boolean = () => false,
): LibraryEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (let at = entry.folder; at !== ""; at = folderOf(at))
      counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  return entries.map((entry) => {
    if (entry.kind !== "notebook") return entry;
    let folder = entry.folder;
    while (folder !== "" && counts.get(folder) === 1 && !kept(folder)) folder = folderOf(folder);
    return folder === entry.folder ? entry : { ...entry, folder };
  });
}

/** The folders leading to `folder`, outermost first: "A/B" gives A, A/B. */
export function crumbs(folder: string): LibraryFolder[] {
  const parts = folder === "" ? [] : folder.split("/");
  return parts.map((name, i) => ({
    name,
    path: parts.slice(0, i + 1).join("/"),
    count: 0,
    notebooks: 0,
  }));
}

export type LibrarySort = "edited" | "created" | "name" | "pages";

/** A sorted copy: newest first, A to Z, or most pages first. Ties fall back to the name. */
export function sortEntries(
  entries: readonly LibraryEntry[],
  by: LibrarySort,
  reverse = false,
): LibraryEntry[] {
  const name = (a: LibraryEntry, b: LibraryEntry): number =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
  const order: Record<LibrarySort, (a: LibraryEntry, b: LibraryEntry) => number> = {
    edited: (a, b) => b.edited - a.edited || name(a, b),
    created: (a, b) => (b.created ?? b.edited) - (a.created ?? a.edited) || name(a, b),
    name,
    pages: (a, b) => b.pages - a.pages || name(a, b),
  };
  const sorted = [...entries].sort(order[by]);
  return reverse ? sorted.reverse() : sorted;
}

/** Notebooks and files whose title or folder holds every word of `query`; all of them for an empty query. */
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

/**
 * "2 h ago", "Yesterday", "Mon" within the week, then "Oct 30" (and the year
 * once it is not this one), in the interface language.
 */
export function whenText(edited: number, now: number): string {
  const ago = now - edited;
  if (ago < 60_000) return t("notebooks.home.when.justNow");
  if (ago < 3_600_000) return tn("notebooks.home.when.minutes", Math.floor(ago / 60_000));
  const then = new Date(edited);
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (edited >= midnight) return tn("notebooks.home.when.hours", Math.floor(ago / 3_600_000));
  if (edited >= midnight - DAY) return t("notebooks.home.when.yesterday");
  if (edited >= midnight - 6 * DAY) return dateText(then, { weekday: "short" });
  const year = then.getFullYear() === today.getFullYear() ? {} : { year: "numeric" as const };
  return dateText(then, { month: "short", day: "numeric", ...year });
}

/** A date as the interface language writes it; US English when `Intl` does not know the language. */
function dateText(date: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(localeTag(), options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }
}
