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
  page: number;
  /** `![[Physics.notebook]]`: page 1 is shown, and a click opens the notebook as any link does. */
  whole: boolean;
}

/**
 * What an embed of a notebook with this subpath shows: the page it names, or
 * page 1 for the notebook itself (no subpath). `null` for any other subpath,
 * such as a heading: those stay Obsidian's.
 */
export function embedTarget(subpath: string): EmbedTarget | null {
  if (/^#?\s*$/.test(subpath)) return { page: 1, whole: true };
  const page = embeddedPageNumber(subpath);
  return page === null ? null : { page, whole: false };
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
