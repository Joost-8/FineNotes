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
import type { InkDocument, Page, PageSection } from "./document";

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

/**
 * One line of the contents: a titled page, by its index in the page list,
 * or a section inside a page, which also carries the section.
 */
export interface ContentsEntry {
  index: number;
  title: string;
  section?: PageSection;
}

/** The contents, in page order: each page's title, then its sections top to bottom. */
export function contentsEntries(doc: InkDocument): ContentsEntry[] {
  const out: ContentsEntry[] = [];
  doc.pages.forEach((page, index) => {
    if (page.title !== undefined) out.push({ index, title: page.title });
    for (const section of page.sections ?? []) out.push({ index, title: section.title, section });
  });
  return out;
}

/**
 * Which entry the reader is under: the last one starting at or before page
 * `page`, and on that page at or above `y` (page px; a page title starts at
 * its top), or -1 when it comes before the first entry. Without `y`, every
 * entry on the page counts as reached.
 */
export function currentContentsEntry(
  entries: readonly ContentsEntry[],
  page: number,
  y = Infinity,
): number {
  let found = -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.index > page) break;
    if (entry.index === page && (entry.section?.y ?? -Infinity) > y) break;
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

// --- Sections: headings inside a page (FineNotes#20) --------------------------

/** The next free section id in the notebook: `c<N>`. */
export function nextSectionId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const section of page.sections ?? []) {
      const m = /^c(\d+)$/.exec(section.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `c${max + 1}`;
}

/**
 * Add, move, rename or (with `null`) remove one section of a page, by id.
 * The page's sections stay in order top to bottom. One undo step, which
 * puts back exactly the list the page had.
 */
export class SetSection implements Command {
  readonly label: string;
  private previous: { sections: PageSection[] | undefined } | null = null;

  constructor(
    private readonly page: Page,
    private readonly id: string,
    private readonly value: Omit<PageSection, "id"> | null,
  ) {
    const exists = page.sections?.some((s) => s.id === id) === true;
    if (value === null) this.label = "Remove from contents";
    else this.label = exists ? "Change contents" : "Add to contents";
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    if (!doc.pages.includes(this.page)) return;
    const before = this.page.sections;
    this.previous = { sections: before };
    const rest = (before ?? []).filter((s) => s.id !== this.id);
    const value = this.value;
    const title = value ? normalizePageTitle(value.title) : undefined;
    const keep =
      value !== null && title !== undefined && Number.isFinite(value.x) && Number.isFinite(value.y);
    const next = keep
      ? sortSections([...rest, { id: this.id, x: value.x, y: value.y, title }])
      : rest;
    if (next.length > 0) this.page.sections = next;
    else delete this.page.sections;
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    const { sections } = this.previous;
    if (sections === undefined) delete this.page.sections;
    else this.page.sections = sections;
    this.previous = null;
  }
}

/** Sections top to bottom, then left to right. */
export function sortSections(sections: PageSection[]): PageSection[] {
  return sections.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * A page's sections as stored, or none: each needs an id, a finite point
 * and a title that survives `normalizePageTitle`, and an id already seen in
 * the notebook is dropped. Top to bottom.
 */
export function normalizeSections(raw: unknown, seen: Set<string>): PageSection[] {
  if (!Array.isArray(raw)) return [];
  const out: PageSection[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { id, x, y, title } = item as Record<string, unknown>;
    const name = normalizePageTitle(title);
    if (typeof id !== "string" || id === "" || seen.has(id) || name === undefined) continue;
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof y !== "number" || !Number.isFinite(y)) continue;
    seen.add(id);
    out.push({ id, x, y, title: name });
  }
  return sortSections(out);
}

/** One heading of the contents, with the entries it holds when it is folded open. */
export interface ContentsNode {
  /** Where the entry is in `contentsEntries`. */
  at: number;
  entry: ContentsEntry;
  children: ContentsNode[];
}

/**
 * The contents as headings and subheadings: a page's title is a heading,
 * and every section after it, on its page and on the pages that follow up
 * to the next titled page, is a subheading under it. A section with no
 * titled page before it stands on its own.
 */
export function contentsTree(entries: readonly ContentsEntry[]): ContentsNode[] {
  const roots: ContentsNode[] = [];
  let heading: ContentsNode | null = null;
  entries.forEach((entry, at) => {
    const node: ContentsNode = { at, entry, children: [] };
    if (entry.section && heading) {
      heading.children.push(node);
      return;
    }
    roots.push(node);
    if (!entry.section) heading = node;
  });
  return roots;
}
