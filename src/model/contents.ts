/**
 * A notebook's contents: the table the page sidebar's Contents tab lists.
 * An entry is a page with a `title`, so it moves, duplicates (without the
 * title) and deletes with its page, and undoing a page delete brings its
 * entry back. Pages without one simply run on under the entry above them,
 * which is what makes a titled page the start of a section.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument, Page } from "./document";

/** Longest title kept, in UTF-16 units; longer ones are cut on save and load. */
export const MAX_PAGE_TITLE_LENGTH = 80;

/**
 * A title as it is stored, or `undefined` for none: runs of whitespace
 * (line breaks included) become one space, the ends are trimmed, and it is
 * cut to `MAX_PAGE_TITLE_LENGTH` without splitting a surrogate pair.
 */
export function normalizePageTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let title = raw.replace(/\s+/g, " ").trim();
  if (title.length > MAX_PAGE_TITLE_LENGTH) {
    let end = MAX_PAGE_TITLE_LENGTH;
    const last = title.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    title = title.slice(0, end).trimEnd();
  }
  return title.length > 0 ? title : undefined;
}

/** One line of the contents: a titled page, by its index in the page list. */
export interface ContentsEntry {
  index: number;
  title: string;
}

/** The contents, in page order. */
export function contentsEntries(doc: InkDocument): ContentsEntry[] {
  const out: ContentsEntry[] = [];
  doc.pages.forEach((page, index) => {
    if (page.title !== undefined) out.push({ index, title: page.title });
  });
  return out;
}

/**
 * Which entry the page being read falls under: the last one starting at or
 * before it, or -1 when it comes before the first entry.
 */
export function currentContentsEntry(entries: readonly ContentsEntry[], page: number): number {
  let found = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].index > page) break;
    found = i;
  }
  return found;
}

/**
 * Give a page a title in the contents, rename it, or (with `null`, or a title
 * that normalises to nothing) take it out. One undo step.
 */
export class SetPageTitle implements Command {
  readonly label: string;
  private readonly title: string | undefined;
  /** What the page had before `apply`; `null` until it has run. */
  private previous: { title: string | undefined } | null = null;

  constructor(
    private readonly page: Page,
    title: string | null,
  ) {
    this.title = normalizePageTitle(title);
    if (this.title === undefined) this.label = "Remove from contents";
    else this.label = page.title === undefined ? "Add to contents" : "Rename in contents";
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    // By identity, like the other page commands: ids can repeat within a file.
    if (!doc.pages.includes(this.page)) return;
    this.previous = { title: this.page.title };
    setTitle(this.page, this.title);
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    setTitle(this.page, this.previous.title);
    this.previous = null;
  }
}

function setTitle(page: Page, title: string | undefined): void {
  if (title === undefined) delete page.title;
  else page.title = title;
}
