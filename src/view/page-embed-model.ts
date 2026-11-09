/**
 * The pure half of page embeds: `![[Physics.notebook#page=3]]` in an
 * ordinary note shows that page, read-only (see `page-embed.ts`).
 *
 * What a link asks for, the size a page is painted at, which painted pages
 * give their pixels back when there are too many, and the decoded notebooks
 * every embed of the same file shares.
 *
 * No DOM, no Obsidian.
 */

import { stripInkSuffix } from "../model/new-notebook";
import { pageFromSubpath } from "../search/notebook-search";

/**
 * The page a link's subpath names, 1-based, in every form `pageFromSubpath`
 * reads (`#page=3`, `#Page 3`, `#p3`), whether or not the notebook has it.
 * `null` for any other subpath, such as a heading: those stay Obsidian's.
 */
export function embeddedPageNumber(subpath: string): number | null {
  const index = pageFromSubpath(subpath, Number.MAX_SAFE_INTEGER);
  return index === null ? null : index + 1;
}

/** What an embed of a notebook shows: page `page` (1-based); `whole` for a link to the notebook itself. */
export interface EmbedTarget {
  /** The page named; 1 for a notebook embedded whole. */
  page: number;
  /** `![[Physics.notebook]]`: every page is shown, one under the other. */
  whole: boolean;
}

/**
 * What an embed of a notebook with this subpath shows: the page it names, or
 * the whole notebook (no subpath). `null` for any other subpath,
 * such as a heading: those stay Obsidian's.
 */
export function embedTarget(subpath: string): EmbedTarget | null {
  if (/^#?\s*$/.test(subpath)) return { page: 1, whole: true };
  const page = embeddedPageNumber(subpath);
  return page === null ? null : { page, whole: false };
}

/**
 * What choosing the pages of a whole-notebook embed reads of a page: its
 * place in the contents and its bookmark. Levels are 1 a chapter, 2 a section
 * of it, 3 a part of that; a title without one is a chapter, and a heading
 * without one sits one below its page's title, or is a chapter on a page
 * without a title (discussion #185, as `contentsEntries` reads them). A
 * chapter that is only a name starts at the page it stands before; one
 * standing `after` the last page starts nothing.
 */
export interface PreviewPage {
  title?: string;
  titleLevel?: number;
  sections?: readonly { title: string; level?: number }[];
  chapters?: readonly { title: string; level?: number; after?: true }[];
  bookmarked?: true;
}

/**
 * The most pages a whole-notebook embed shows; a notebook with more shows
 * its cover and the pages `embedPageNumbers` picks, then how many it left
 * out. Set by memory on an iPad. Pages on screen paint lazily and those off
 * screen give their canvas back past `EMBED_CANVAS_BUDGET`, so scrolling
 * holds about the same whatever the count; Export to PDF does not, as it
 * paints every page at once and keeps them all (`PRINT_DPR`, a 704 px box:
 * 1408 × 1991 device px, 11.2 MB for an A4 page). WebKit on iOS caps all
 * canvases together at a quarter of the RAM, 256 to 384 MB on the iPads
 * reported, and the open notebook's tiles and PDF rasters share that, so
 * one embed holds at most half the lowest: 9 × 11.2 MB = 101 MB (12 would
 * be 134 MB). A test pins the sum.
 */
export const MAX_PREVIEW_PAGES = 9;

/** Places a shortened embed keeps for bookmarked pages, however many chapters there are. */
export const PREVIEW_BOOKMARK_PLACES = 2;

/** A page's contents entries with their levels, as the contents lists them. */
function previewEntries(page: PreviewPage): { title: string; level: number }[] {
  const out: { title: string; level: number }[] = [];
  for (const chapter of page.chapters ?? []) {
    if (!chapter.after) out.push({ title: chapter.title, level: chapter.level ?? 1 });
  }
  const titleLevel = page.titleLevel ?? 1;
  if (page.title !== undefined) out.push({ title: page.title, level: titleLevel });
  const sectionLevel = page.title !== undefined ? Math.min(3, titleLevel + 1) : 1;
  for (const section of page.sections ?? []) {
    out.push({ title: section.title, level: section.level ?? sectionLevel });
  }
  return out;
}

/** `k` of `items`, evenly spread from the first, in order. */
function spread<T>(items: readonly T[], k: number): T[] {
  if (k >= items.length) return [...items];
  return Array.from({ length: k }, (_, i) => items[Math.floor((i * items.length) / k)]);
}

/**
 * The pages an embed shows, 1-based, in order. A single page names itself,
 * whether or not the notebook has it (the embed then says it is missing). A
 * notebook embedded whole shows every page, one under the other, while it
 * has at most `limit`. A longer one (a textbook PDF) shows its cover, then
 * the pages its contents and bookmarks point to, chosen in this order:
 * chapters, bookmarked pages, then the deeper entries of the contents, except
 * that chapters always leave `PREVIEW_BOOKMARK_PLACES` for bookmarks. Where
 * one kind has more pages than are left, they are spread evenly through the
 * notebook. With neither contents nor bookmarks, its first `limit` pages.
 */
export function embedPageNumbers(
  target: EmbedTarget,
  pages: readonly PreviewPage[],
  limit = MAX_PREVIEW_PAGES,
): number[] {
  if (!target.whole) return [target.page];
  const count = pages.length;
  const max = Math.max(1, Math.floor(limit));
  if (count <= max) return Array.from({ length: count }, (_, i) => i + 1);
  const chapters: number[] = [];
  const bookmarked: number[] = [];
  const outlined: number[] = [];
  // The cover is always shown, so it is never one of the picks.
  for (let i = 1; i < count; i++) {
    const page = pages[i];
    const entries = previewEntries(page);
    if (entries.some((entry) => entry.level <= 1)) chapters.push(i);
    else if (page.bookmarked) bookmarked.push(i);
    else if (entries.length > 0) outlined.push(i);
  }
  // Chapters leave room for a few bookmarks, which the user chose by hand.
  const kept = Math.min(PREVIEW_BOOKMARK_PLACES, bookmarked.length, max - 1);
  const picked = spread(chapters, max - 1 - kept);
  for (const kind of [bookmarked, outlined]) {
    picked.push(...spread(kind, max - 1 - picked.length));
  }
  if (picked.length === 0) return Array.from({ length: max }, (_, i) => i + 1);
  return [1, ...picked.sort((a, b) => a - b).map((i) => i + 1)];
}

/**
 * What a page reads as above it in a shortened whole-notebook embed: its
 * highest entry in the contents (the first chapter on it, else its first
 * entry), or `undefined` for a page the contents does not list.
 */
export function previewCaption(page: PreviewPage): string | undefined {
  let best: { title: string; level: number } | undefined;
  for (const entry of previewEntries(page)) if (!best || entry.level < best.level) best = entry;
  return best?.title;
}

/**
 * The link a click on page `page` of an embed opens: the embed's own link
 * for a single page, and that page of the notebook for one embedded whole
 * (`Physics.notebook` → `Physics.notebook#page=3`), so the notebook opens
 * where the click was.
 */
export function embedPageLink(linktext: string, target: EmbedTarget, page: number): string {
  if (!target.whole) return linktext;
  const hash = linktext.indexOf("#");
  const path = hash < 0 ? linktext : linktext.slice(0, hash);
  return `${path}#page=${page}`;
}

/** A page's label in an embed: "Physics, page 3", or the notebook's name for its only page. */
export function embedPageLabel(
  basename: string,
  target: EmbedTarget,
  page: number,
  pageCount: number,
): string {
  return target.whole && pageCount <= 1
    ? embedLabel(basename, target)
    : pageLinkLabel(basename, page);
}

/**
 * The width a page is painted at for a PDF export, CSS px, when the print
 * layout gives the box none (a page box measures 0 until it is laid out):
 * about a portrait A4 page's text column.
 */
export const PRINT_FALLBACK_WIDTH = 680;
/** Device px per CSS px when painting for a PDF export: sharp on paper, not a screen's ratio. */
export const PRINT_DPR = 2;

/** The size to paint at for a PDF export of a box `cssWidth` wide (0 when unknown). */
export function printPaintSize(cssWidth: number): { cssWidth: number; dpr: number } {
  const width = cssWidth > 0 && Number.isFinite(cssWidth) ? cssWidth : PRINT_FALLBACK_WIDTH;
  // Never null: the width is positive.
  return embedPaintSize(width, PRINT_DPR) ?? { cssWidth: PRINT_FALLBACK_WIDTH, dpr: 1 };
}

/**
 * The text that embeds a new notebook at the cursor: `link` (as Obsidian's
 * `generateMarkdownLink` wrote it, `[[…]]` or `[…](…)`) made an embed, on a
 * paragraph of its own: a blank line from text `before` and `after` the
 * cursor on its line, and from the lines above (`above`) and below
 * (`below`) when they hold text, so the embed shows as a block and the text
 * around it stays where it was.
 */
export function embedInsertion(
  link: string,
  before: string,
  after: string,
  above = "",
  below = "",
): string {
  const embed = link.startsWith("!") ? link : `!${link}`;
  const head = before.trim() ? "\n\n" : above.trim() ? "\n" : "";
  const tail = after.trim() ? "\n\n" : below.trim() ? "\n" : "";
  return `${head}${embed}${tail}`;
}

/** What an embed reads as when it is a link: "Physics" for the whole notebook, else "Physics, page 3". */
export function embedLabel(basename: string, target: EmbedTarget): string {
  return target.whole ? stripInkSuffix(basename) : pageLinkLabel(basename, target.page);
}

/** What a link to page `page` (1-based) of a notebook reads as: "Physics, page 3". */
export function pageLinkLabel(basename: string, page: number): string {
  return `${stripInkSuffix(basename)}, page ${page}`;
}

/**
 * The width an embed asks for, CSS px: Obsidian's size syntax,
 * `![[Physics.notebook#page=3|300]]` (or `|300x200`, whose height the page's
 * own shape overrides). Live preview hands it over as a `width` attribute,
 * reading view as the `alt` text. `null` for none, or an alias.
 */
export function embedWidth(widthAttr: string | null, alt: string | null): number | null {
  for (const text of [widthAttr, alt]) {
    const match = /^\s*(\d+)(?:\s*x\s*\d*)?\s*$/i.exec(text ?? "");
    const width = match ? Number(match[1]) : 0;
    if (width > 0) return width;
  }
  return null;
}

/** Steps an embed's painted width snaps to, CSS px, so a resize repaints only past one. */
export const EMBED_WIDTH_STEP = 64;
/** The widest an embed is painted, device px: past it the canvas only costs memory. */
export const MAX_EMBED_DEVICE_WIDTH = 2048;

/**
 * The size to paint at for a box `cssWidth` CSS px wide on a screen of
 * `dpr`: the width rounded up to the next step (the canvas is shown at the
 * box's width, so a little larger is sharp and a little smaller is not), and
 * the pixel ratio lowered so the canvas stays within
 * `MAX_EMBED_DEVICE_WIDTH`. `null` while the box has no width yet.
 */
export function embedPaintSize(
  cssWidth: number,
  dpr: number,
): { cssWidth: number; dpr: number } | null {
  if (!(cssWidth > 0)) return null;
  const width = Math.ceil(cssWidth / EMBED_WIDTH_STEP) * EMBED_WIDTH_STEP;
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  return { cssWidth: width, dpr: Math.min(ratio, MAX_EMBED_DEVICE_WIDTH / width) };
}

/** One painted embed, as the budget sees it. */
export interface PaintedEmbed<K> {
  key: K;
  /** Its canvas' backing store: width × height × 4. */
  bytes: number;
  /** On screen now. */
  visible: boolean;
  /** When it was last on screen, ms on any clock that only goes up. */
  lastSeen: number;
}

/**
 * All painted embeds together may hold this many bytes of canvas. A note
 * that embeds thirty pages would otherwise keep thirty page-sized canvases,
 * and WebKit on an older iPad kills a page past a few hundred MB of them.
 */
export const EMBED_CANVAS_BUDGET = 64 * 1024 * 1024;

/**
 * The embeds to give their canvas back so the rest fit in `budget`: those
 * off screen, the longest gone first. One on screen is never chosen, even
 * when the screen alone is over budget.
 */
export function embedsToRelease<K>(painted: readonly PaintedEmbed<K>[], budget: number): K[] {
  let total = 0;
  for (const entry of painted) total += entry.bytes;
  const out: K[] = [];
  const offScreen = painted.filter((entry) => !entry.visible);
  offScreen.sort((a, b) => a.lastSeen - b.lastSeen);
  for (const entry of offScreen) {
    if (total <= budget) break;
    out.push(entry.key);
    total -= entry.bytes;
  }
  return out;
}

/**
 * Decoded notebooks by path, for every embed of the same file to share: one
 * read and one decode however many of its pages a note shows, and again only
 * when the file changes (its `version`, the modification time). A load in
 * flight is shared too. Holds at most `limit` notebooks, the least recently
 * asked for leaving first; an embed keeps only its own page.
 */
export class SharedNotebooks<T> {
  private readonly entries = new Map<string, { version: number; value: Promise<T> }>();

  constructor(private readonly limit = 4) {}

  /** The notebook at `path` as of `version`, loading it if that is not what is held. */
  get(path: string, version: number, load: () => Promise<T>): Promise<T> {
    const held = this.entries.get(path);
    if (held && held.version === version) {
      // Most recently used goes to the end.
      this.entries.delete(path);
      this.entries.set(path, held);
      return held.value;
    }
    const value = load();
    const entry = { version, value };
    this.entries.delete(path);
    this.entries.set(path, entry);
    // A load that fails is not kept: the next ask tries again.
    value.catch(() => {
      if (this.entries.get(path) === entry) this.entries.delete(path);
    });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return value;
  }

  /** The file at `path` changed, moved or went: the next ask reads it again. */
  forget(path: string): boolean {
    return this.entries.delete(path);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
