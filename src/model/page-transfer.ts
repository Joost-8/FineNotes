/**
 * Pages travelling from one notebook to another (FineNotes#33).
 *
 * A notebook is one file, so a page that goes elsewhere is a copy made
 * for the destination: element ids are unique across a whole notebook, and
 * the page being moved was numbered for the one it came from. The copy takes
 * fresh ids above the destination's own; pictures and PDF backdrops point at
 * vault paths, so they keep working wherever the page lands. Moving is the
 * copy followed by deleting the originals (the host's job, with the
 * source's own undo).
 *
 * Pure: no DOM, no Obsidian, no file system.
 */

import type { Command } from "./commands";
import { type InkDocument, type Page, insertPage } from "./document";
import { relinkNoteInk } from "./sticky-notes";

/** Why a notebook takes no pages, or `null` when it does. */
export function transferRefusal(doc: InkDocument): string | null {
  if (doc.single) return "That is a single page, which takes no more pages.";
  if (doc.practice) return "A practice set has fixed pages.";
  if (doc.readOnly) return "That notebook is read-only.";
  return null;
}

/** Highest `<prefix><N>` among the ids `items` yields, over every page. */
function maxId(
  pages: readonly Page[],
  items: (page: Page) => readonly { id: string }[],
  prefix: string,
): number {
  let max = 0;
  for (const page of pages) {
    for (const item of items(page)) {
      if (!item.id.startsWith(prefix)) continue;
      const digits = item.id.slice(prefix.length);
      if (digits === "" || !/^[0-9]+$/.test(digits)) continue;
      max = Math.max(max, Number(digits));
    }
  }
  return max;
}

/**
 * Copies of `pages` that can be inserted into `dest`: every page, stroke,
 * text box, picture, table, graph, comment and link renumbered above what
 * `dest` already holds (and links kept pointing at the renumbered strokes).
 * A bookmark, a contents title, headings and a page tab stay with the page.
 * `dest` is not changed.
 */
export function prepareTransfer(pages: readonly Page[], dest: InkDocument): Page[] {
  const all = dest.pages;
  let pageSeq = 0;
  for (const page of all) {
    const digits = /^p(\d+)$/.exec(page.id);
    if (digits) pageSeq = Math.max(pageSeq, Number(digits[1]));
  }
  let strokeSeq = maxId(all, (p) => p.strokes, "s");
  let textSeq = maxId(all, (p) => p.textBoxes, "t");
  let imageSeq = maxId(all, (p) => p.images, "i");
  let tableSeq = maxId(all, (p) => p.tables ?? [], "g");
  let graphSeq = maxId(all, (p) => p.graphs ?? [], "f");
  let commentSeq = maxId(all, (p) => p.comments ?? [], "cm");
  let linkSeq = maxId(all, (p) => p.links ?? [], "l");
  let taskSeq = maxId(all, (p) => p.tasks ?? [], "ck");

  return pages.map((source) => {
    const copy = structuredClone(source);
    copy.id = `p${++pageSeq}`;
    const strokeIds = new Map<string, string>();
    for (const stroke of copy.strokes) {
      const id = `s${++strokeSeq}`;
      strokeIds.set(stroke.id, id);
      stroke.id = id;
    }
    for (const box of copy.textBoxes) box.id = `t${++textSeq}`;
    const imageIds = new Map<string, string>();
    for (const image of copy.images) {
      const id = `i${++imageSeq}`;
      imageIds.set(image.id, id);
      image.id = id;
    }
    // The ink on a note follows the note's new id.
    relinkNoteInk(copy.strokes, imageIds);
    for (const table of copy.tables ?? []) table.id = `g${++tableSeq}`;
    for (const graph of copy.graphs ?? []) graph.id = `f${++graphSeq}`;
    for (const comment of copy.comments ?? []) comment.id = `cm${++commentSeq}`;
    if (copy.links) {
      const links = copy.links.flatMap((link) => {
        const strokes = link.strokes.flatMap((id) => strokeIds.get(id) ?? []);
        return strokes.length > 0 ? [{ ...link, id: `l${++linkSeq}`, strokes }] : [];
      });
      if (links.length > 0) copy.links = links;
      else delete copy.links;
    }
    if (copy.tasks) {
      const tasks = copy.tasks.flatMap((task) => {
        const strokes = task.strokes.flatMap((id) => strokeIds.get(id) ?? []);
        return strokes.length > 0 ? [{ ...task, id: `ck${++taskSeq}`, strokes }] : [];
      });
      if (tasks.length > 0) copy.tasks = tasks;
      else delete copy.tasks;
    }
    return copy;
  });
}

/**
 * Add copies of `sources` to the end of a notebook. The copies are made on
 * the first apply (against the notebook as it is then) and kept, so a redo
 * puts back the very same pages; `invert` takes them out again.
 */
export class ReceivePages implements Command {
  readonly label: string;
  readonly keepsReading = true;
  private copies: Page[] | null = null;

  constructor(private readonly sources: readonly Page[]) {
    this.label = sources.length === 1 ? "Receive page" : "Receive pages";
  }

  /** The pages this command put in the notebook (empty before it ran). */
  get added(): readonly Page[] {
    return this.copies ?? [];
  }

  apply(doc: InkDocument): void {
    this.copies ??= prepareTransfer(this.sources, doc);
    for (const copy of this.copies) {
      if (!doc.pages.includes(copy)) insertPage(doc, doc.pages.length, copy);
    }
  }

  invert(doc: InkDocument): void {
    if (!this.copies) return;
    for (const copy of this.copies) {
      const at = doc.pages.indexOf(copy);
      // A notebook keeps one page, whatever was asked.
      if (at >= 0 && doc.pages.length > 1) doc.pages.splice(at, 1);
    }
  }
}

/**
 * Take pages out of a notebook by id, for a file read back from disk (whose
 * page objects are not the ones that were added). A notebook keeps at least
 * one page. Returns how many went.
 */
export function removePagesById(doc: InkDocument, ids: readonly string[]): number {
  const gone = new Set(ids);
  let removed = 0;
  for (let i = doc.pages.length - 1; i >= 0 && doc.pages.length > 1; i--) {
    if (!gone.has(doc.pages[i].id)) continue;
    doc.pages.splice(i, 1);
    removed++;
  }
  return removed;
}

/** One notebook the pages could go to. */
export interface TransferTarget {
  path: string;
  /** What it is called: its file name without the suffix. */
  title: string;
  /** Last modified, ms since the Unix epoch. */
  mtime: number;
}

/**
 * The notebooks to offer, best first: those matching `query` (every word of
 * it, anywhere in the title or folder, ignoring case), the ones moved to
 * last time first (most recent first), then the rest by when they were
 * last edited. `exclude` is the notebook the pages are in.
 */
export function orderTargets(
  targets: readonly TransferTarget[],
  recent: readonly string[],
  query: string,
  exclude: string,
): TransferTarget[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (path: string): number => {
    const at = recent.indexOf(path);
    return at < 0 ? Number.POSITIVE_INFINITY : at;
  };
  return targets
    .filter((t) => t.path !== exclude)
    .filter((t) => {
      const haystack = `${t.title} ${t.path}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort(
      (a, b) => rank(a.path) - rank(b.path) || b.mtime - a.mtime || a.title.localeCompare(b.title),
    );
}

/** `path` first in the list of recent destinations, without repeats, at most `limit` long. */
export function rememberTarget(recent: readonly string[], path: string, limit = 5): string[] {
  return [path, ...recent.filter((p) => p !== path)].slice(0, limit);
}

/** The notice after a transfer: "Moved 3 pages to Maths." */
export function transferNotice(count: number, destination: string, copied: boolean): string {
  const what = count === 1 ? "1 page" : `${count} pages`;
  return `${copied ? "Copied" : "Moved"} ${what} to ${destination}.`;
}
