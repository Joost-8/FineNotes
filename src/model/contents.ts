/**
 * A notebook's contents: the table the page sidebar's Contents tab lists.
 * An entry is a page with a `title`, so it moves, duplicates (without the
 * title) and deletes with its page, and undoing a page delete brings its
 * entry back. Pages without one simply run on under the entry above them,
 * which is what makes a titled page the start of a section.
 *
 * Entries have a level (discussion #185): 1 a chapter, 2 a section of it, 3
 * a part of that. Levels only group the entries, which stay in page order;
 * without any set, the contents read exactly as they did before levels.
 *
 * PURE: no DOM, no Obsidian.
 */

import { t } from "../i18n/translate";
import type { Command } from "./commands";
import type { ContentsLevel, InkDocument, Page, PageChapter, PageSection } from "./document";

/** Longest title kept, in UTF-16 units; longer ones are cut on save and load. */
export const MAX_PAGE_TITLE_LENGTH = 80;

/** The deepest level the contents nests to. */
export const MAX_CONTENTS_LEVEL = 3;

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

/** A stored level, or `undefined` for anything but 1, 2 or 3. */
export function readContentsLevel(raw: unknown): ContentsLevel | undefined {
  return raw === 1 || raw === 2 || raw === 3 ? raw : undefined;
}

/** Any number as a level: below 1 is 1, past the deepest is the deepest. */
export function clampContentsLevel(level: number): ContentsLevel {
  if (!(level > 1)) return 1;
  return level >= MAX_CONTENTS_LEVEL ? MAX_CONTENTS_LEVEL : 2;
}

/** The level of a page's title: a chapter unless set deeper. */
export function titleLevelOf(page: Page): ContentsLevel {
  return page.titleLevel ?? 1;
}

/**
 * Where a heading inside a page sits when it has no level of its own: one
 * below its page's title, or a chapter on a page without one. That is where
 * headings sat before levels, so old notebooks read as they did.
 */
export function sectionDefaultLevel(page: Page): ContentsLevel {
  return page.title !== undefined ? clampContentsLevel(titleLevelOf(page) + 1) : 1;
}

/** A page-less chapter's level in the contents. */
export function chapterLevelOf(chapter: PageChapter): ContentsLevel {
  return chapter.level ?? 1;
}

/** A heading's level in the contents. */
export function sectionLevelOf(page: Page, section: PageSection): ContentsLevel {
  return section.level ?? sectionDefaultLevel(page);
}

/**
 * One line of the contents: a titled page, by its index in the page list,
 * or a section inside a page, which also carries the section.
 */
export interface ContentsEntry {
  index: number;
  title: string;
  section?: PageSection;
  /** A chapter with no page of its own; `index` is the page it stands by. */
  chapter?: PageChapter;
  /** How deep it sits: 1 a chapter, 2 a section of it, 3 a part of that. */
  level: ContentsLevel;
}

/** The contents, in page order: each page's title, then its sections top to bottom. */
export function contentsEntries(doc: InkDocument): ContentsEntry[] {
  return doc.pages.flatMap((page, index) => {
    const chapters = page.chapters ?? [];
    const entry = (chapter: PageChapter): ContentsEntry => ({
      index,
      title: chapter.title,
      chapter,
      level: chapterLevelOf(chapter),
    });
    return [
      ...chapters.filter((chapter) => !chapter.after).map(entry),
      ...pageContentsEntries(page, index),
      ...chapters.filter((chapter) => chapter.after).map(entry),
    ];
  });
}

/** One page's lines of the contents, `index` being its place in the page list. */
export function pageContentsEntries(page: Page, index: number): ContentsEntry[] {
  const out: ContentsEntry[] = [];
  if (page.title !== undefined) out.push({ index, title: page.title, level: titleLevelOf(page) });
  for (const section of page.sections ?? []) {
    out.push({ index, title: section.title, section, level: sectionLevelOf(page, section) });
  }
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
    // Standing after the page: not reached by reading it.
    if (entry.index === page && entry.chapter?.after) continue;
    if (entry.index === page && (entry.section?.y ?? -Infinity) > y) break;
    found = i;
  }
  return found;
}

/**
 * Give a page a title in the contents, rename it, or (with `null`, or a title
 * that normalises to nothing) take it out, its level with it. One undo step.
 */
export class SetPageTitle implements Command {
  readonly label: string;
  private readonly title: string | undefined;
  /** What the page had before `apply`; `null` until it has run. */
  private previous: { title: string | undefined; titleLevel: ContentsLevel | undefined } | null =
    null;

  constructor(
    private readonly page: Page,
    title: string | null,
  ) {
    this.title = normalizePageTitle(title);
    if (this.title === undefined) this.label = t("view.contents.remove");
    else this.label = page.title === undefined ? t("view.contents.add") : t("view.contents.rename");
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    // By identity, like the other page commands: ids can repeat within a file.
    if (!doc.pages.includes(this.page)) return;
    this.previous = { title: this.page.title, titleLevel: this.page.titleLevel };
    setTitle(this.page, this.title);
    // A level belongs to a title: taking the title out takes it too.
    if (this.title === undefined) delete this.page.titleLevel;
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    setTitle(this.page, this.previous.title);
    setTitleLevel(this.page, this.previous.titleLevel);
    this.previous = null;
  }
}

function setTitle(page: Page, title: string | undefined): void {
  if (title === undefined) delete page.title;
  else page.title = title;
}

function setTitleLevel(page: Page, level: ContentsLevel | undefined): void {
  if (level === undefined || level === 1 || page.title === undefined) delete page.titleLevel;
  else page.titleLevel = level;
}

// --- Sections: headings inside a page (FineNotes#20) --------------------------

/** The next free section id in the notebook: `c<N>`. */
export function nextSectionId(doc: InkDocument): string {
  return `c${maxSectionNumber(doc) + 1}`;
}

/** The highest `N` among the notebook's `c<N>` section ids, 0 for none. */
export function maxSectionNumber(doc: InkDocument): number {
  let max = 0;
  for (const page of doc.pages) {
    for (const section of [...(page.sections ?? []), ...(page.chapters ?? [])]) {
      const m = /^c(\d+)$/.exec(section.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

/**
 * Add, move, rename or (with `null`) remove one section of a page, by id.
 * The page's sections stay in order top to bottom. One undo step, which
 * puts back exactly the list the page had. A section that is moved or
 * renamed keeps its level unless `value` gives one.
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
    if (value === null) this.label = t("view.contents.remove");
    else this.label = exists ? t("view.contents.change") : t("view.contents.add");
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    if (!doc.pages.includes(this.page)) return;
    const before = this.page.sections;
    this.previous = { sections: before };
    const old = before?.find((s) => s.id === this.id);
    const rest = (before ?? []).filter((s) => s.id !== this.id);
    const value = this.value;
    const title = value ? normalizePageTitle(value.title) : undefined;
    const keep =
      value !== null && title !== undefined && Number.isFinite(value.x) && Number.isFinite(value.y);
    // A full copy: a field added to sections later must not be dropped here.
    const level = value?.level ?? old?.level;
    const next = keep
      ? sortSections([
          ...rest,
          level === undefined
            ? { ...value, id: this.id, title }
            : { ...value, id: this.id, title, level },
        ])
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
 * the notebook is dropped. A level other than 1, 2 or 3 is dropped too (the
 * heading then sits where it always did). Top to bottom.
 */
export function normalizeSections(raw: unknown, seen: Set<string>): PageSection[] {
  if (!Array.isArray(raw)) return [];
  const out: PageSection[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { id, x, y, title, level } = item as Record<string, unknown>;
    const name = normalizePageTitle(title);
    if (typeof id !== "string" || id === "" || seen.has(id) || name === undefined) continue;
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof y !== "number" || !Number.isFinite(y)) continue;
    seen.add(id);
    const depth = readContentsLevel(level);
    out.push(
      depth === undefined ? { id, x, y, title: name } : { id, x, y, title: name, level: depth },
    );
  }
  return sortSections(out);
}

// --- Chapters with no page of their own (discussion #185) ----------------------

/**
 * Add, rename or (with `null`, or a title that normalises to nothing) remove
 * a page-less chapter standing by `page`, by id. What sits under it stays
 * where it is. One undo step.
 */
export class SetChapter implements Command {
  readonly label: string;
  private previous: { chapters: PageChapter[] | undefined } | null = null;
  private readonly title: string | undefined;

  constructor(
    private readonly page: Page,
    private readonly id: string,
    title: string | null,
  ) {
    this.title = normalizePageTitle(title);
    const exists = page.chapters?.some((chapter) => chapter.id === id) === true;
    if (this.title === undefined) this.label = t("view.contents.remove");
    else this.label = exists ? t("view.contents.rename") : t("view.contents.add");
  }

  apply(doc: InkDocument): void {
    if (!doc.pages.includes(this.page)) return;
    const before = this.page.chapters ?? [];
    this.previous = { chapters: this.page.chapters };
    const title = this.title;
    let next: PageChapter[];
    if (title === undefined) next = before.filter((chapter) => chapter.id !== this.id);
    else if (before.some((chapter) => chapter.id === this.id)) {
      next = before.map((chapter) => (chapter.id === this.id ? { ...chapter, title } : chapter));
    } else {
      // Last of those standing before the page, so it is next to the page.
      next = [
        ...before.filter((chapter) => !chapter.after),
        { id: this.id, title },
        ...before.filter((chapter) => chapter.after),
      ];
    }
    if (next.length > 0) this.page.chapters = next;
    else delete this.page.chapters;
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    if (this.previous.chapters === undefined) delete this.page.chapters;
    else this.page.chapters = this.previous.chapters;
    this.previous = null;
  }
}

/**
 * A page's chapters as stored, or none: each needs an id not seen yet in the
 * notebook and a title that survives `normalizePageTitle`.
 */
export function normalizeChapters(raw: unknown, seen: Set<string>): PageChapter[] {
  if (!Array.isArray(raw)) return [];
  const out: PageChapter[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { id, title: rawTitle, level, after } = item as Record<string, unknown>;
    const title = normalizePageTitle(rawTitle);
    if (typeof id !== "string" || id === "" || seen.has(id) || title === undefined) continue;
    seen.add(id);
    const depth = readContentsLevel(level);
    out.push({
      id,
      title,
      ...(depth === 2 || depth === 3 ? { level: depth } : {}),
      ...(after === true ? { after: true as const } : {}),
    });
  }
  return out;
}

/** The notebook in contents order: each page, with its chapters' ids around it. */
export type ContentsItem = Page | string;

export function contentsItems(doc: InkDocument): ContentsItem[] {
  return doc.pages.flatMap((page) => {
    const chapters = page.chapters ?? [];
    return [
      ...chapters.filter((chapter) => !chapter.after).map((chapter) => chapter.id),
      page,
      ...chapters.filter((chapter) => chapter.after).map((chapter) => chapter.id),
    ];
  });
}

/**
 * Stand each chapter by the page that follows it in `items`, or after the
 * last page when none does. Writes fresh objects, so a snapshot stays good.
 */
export function placeChapters(pages: readonly Page[], items: readonly ContentsItem[]): void {
  const byId = new Map<string, PageChapter>();
  for (const page of pages) {
    for (const chapter of page.chapters ?? []) byId.set(chapter.id, chapter);
    delete page.chapters;
  }
  let waiting: PageChapter[] = [];
  let last: Page | null = null;
  const plain = (chapter: PageChapter): PageChapter => {
    const copy = { ...chapter };
    delete copy.after;
    return copy;
  };
  for (const item of items) {
    if (typeof item === "string") {
      const chapter = byId.get(item);
      if (chapter) waiting.push(plain(chapter));
    } else {
      if (waiting.length > 0) item.chapters = waiting;
      waiting = [];
      last = item;
    }
  }
  if (waiting.length > 0 && last) {
    const after = waiting.map((chapter): PageChapter => ({ ...chapter, after: true }));
    last.chapters = [...(last.chapters ?? []), ...after];
  }
}

/** Every page's chapters as they are, to put back on undo. */
export function snapshotChapters(
  pages: readonly Page[],
): Array<{ page: Page; chapters: PageChapter[] | undefined }> {
  return pages.map((page) => ({ page, chapters: page.chapters }));
}

export function restoreChapters(snapshot: ReturnType<typeof snapshotChapters>): void {
  for (const { page, chapters } of snapshot) {
    if (chapters === undefined) delete page.chapters;
    else page.chapters = chapters;
  }
}

/**
 * Before `removed` leave the notebook: their chapters do not go with them,
 * since a chapter is not its pages; each stands by the next page left.
 * Returns what undo puts back, or `null` when nothing had to move.
 */
export function keepChaptersOf(
  doc: InkDocument,
  removed: readonly Page[],
): ReturnType<typeof snapshotChapters> | null {
  if (!removed.some((page) => (page.chapters?.length ?? 0) > 0)) return null;
  const snapshot = snapshotChapters(doc.pages);
  const gone = new Set(removed);
  const items = contentsItems(doc).filter((item) => typeof item === "string" || !gone.has(item));
  placeChapters(doc.pages, items);
  return snapshot;
}

// --- The tree: what folds under what ----------------------------------------------

/** One entry of the contents, with the entries it holds when it is folded open. */
export interface ContentsNode {
  /** Where the entry is in `contentsEntries`. */
  at: number;
  entry: ContentsEntry;
  children: ContentsNode[];
}

/**
 * The contents as a tree, nested the way Markdown headings nest: an entry
 * holds the entries after it that sit deeper, up to the next one at its own
 * level or above. Nothing is reordered, only grouped, so the contents stay
 * in page order. Without levels set, a page's title holds the headings on its
 * page and everything else stands on its own, as before levels.
 */
export function contentsTree(entries: readonly ContentsEntry[]): ContentsNode[] {
  const roots: ContentsNode[] = [];
  const open: ContentsNode[] = [];
  entries.forEach((entry, at) => {
    const node: ContentsNode = { at, entry, children: [] };
    while (open.length > 0 && open[open.length - 1].entry.level >= entry.level) open.pop();
    (open.length > 0 ? open[open.length - 1].children : roots).push(node);
    open.push(node);
  });
  return roots;
}

/** For each entry, the entries it sits inside, outermost first (as `contentsTree` nests). */
export function contentsAncestors(entries: readonly ContentsEntry[]): number[][] {
  const out: number[][] = [];
  const open: number[] = [];
  entries.forEach((entry, at) => {
    while (open.length > 0 && entries[open[open.length - 1]].level >= entry.level) open.pop();
    out.push([...open]);
    open.push(at);
  });
  return out;
}

// --- Levels: indent and outdent (discussion #185) ------------------------------

/** One entry's new level: a page's title, or a heading or page-less chapter by id. */
export interface LevelChange {
  page: Page;
  section?: string;
  chapter?: string;
  level: ContentsLevel;
}

/**
 * What indenting (`+1`) or outdenting (`-1`) entry `at` changes: it and the
 * entries inside it move together, so a chapter keeps its sections. `null`
 * when it cannot: indenting needs an entry above it, at its level or deeper,
 * to go under, and nothing may pass the deepest level; outdenting stops at 1.
 */
export function levelShift(doc: InkDocument, at: number, delta: 1 | -1): LevelChange[] | null {
  const entries = contentsEntries(doc);
  const target = entries[at];
  if (!target) return null;
  let end = at + 1;
  while (end < entries.length && entries[end].level > target.level) end++;
  const moved = entries.slice(at, end);
  if (delta > 0) {
    const above = entries[at - 1];
    if (!above || above.level < target.level) return null;
    if (moved.some((entry) => entry.level >= MAX_CONTENTS_LEVEL)) return null;
  } else if (target.level <= 1) {
    return null;
  }
  return moved.map((entry) => {
    const page = doc.pages[entry.index];
    const level = clampContentsLevel(entry.level + delta);
    if (entry.chapter) return { page, chapter: entry.chapter.id, level };
    return entry.section ? { page, section: entry.section.id, level } : { page, level };
  });
}

/**
 * Set the levels `levelShift` worked out, as one undo step. A heading's
 * default level follows its page's title, so every heading on a page that
 * changes keeps the level it showed unless it is one of the changes; each
 * level is stored only where it differs from what absent means.
 */
export class SetContentsLevels implements Command {
  private previous: Array<{
    page: Page;
    titleLevel: ContentsLevel | undefined;
    sections: PageSection[] | undefined;
    chapters: PageChapter[] | undefined;
  }> | null = null;

  constructor(
    private readonly changes: readonly LevelChange[],
    readonly label: string,
  ) {}

  apply(doc: InkDocument): void {
    const pages = [...new Set(this.changes.map((change) => change.page))].filter((page) =>
      doc.pages.includes(page),
    );
    this.previous = pages.map((page) => ({
      page,
      titleLevel: page.titleLevel,
      sections: page.sections,
      chapters: page.chapters,
    }));
    // Every heading's level as it reads now, before any title moves.
    const want = new Map<string, ContentsLevel>();
    for (const page of pages) {
      for (const section of page.sections ?? []) {
        want.set(`${page.id}/${section.id}`, sectionLevelOf(page, section));
      }
    }
    for (const change of this.changes) {
      if (!pages.includes(change.page)) continue;
      if (change.chapter !== undefined) setChapterLevel(change.page, change.chapter, change.level);
      else if (change.section === undefined) setTitleLevel(change.page, change.level);
      else want.set(`${change.page.id}/${change.section}`, change.level);
    }
    for (const page of pages) {
      if (!page.sections) continue;
      const fallback = sectionDefaultLevel(page);
      // Fresh objects: undo puts the old ones back untouched.
      page.sections = page.sections.map((section) => {
        const rest: PageSection = { ...section };
        delete rest.level;
        const level = want.get(`${page.id}/${section.id}`) ?? fallback;
        return level === fallback ? rest : { ...rest, level };
      });
    }
  }

  invert(doc: InkDocument): void {
    if (this.previous === null) return;
    for (const { page, titleLevel, sections, chapters } of this.previous) {
      if (!doc.pages.includes(page)) continue;
      if (titleLevel === undefined) delete page.titleLevel;
      else page.titleLevel = titleLevel;
      if (sections === undefined) delete page.sections;
      else page.sections = sections;
      if (chapters === undefined) delete page.chapters;
      else page.chapters = chapters;
    }
    this.previous = null;
  }
}

function setChapterLevel(page: Page, id: string, level: ContentsLevel): void {
  page.chapters = page.chapters?.map((chapter) => {
    if (chapter.id !== id) return chapter;
    const copy = { ...chapter };
    delete copy.level;
    return level === 1 ? copy : { ...copy, level };
  });
}

// --- Whole pages' contents at once: a PDF's outline, and taking it out ---------

/** What a page's contents become: its title, the title's level and its headings. */
export interface PageContents {
  page: Page;
  title?: string;
  titleLevel?: ContentsLevel;
  sections?: PageSection[];
}

/**
 * Replace several pages' contents in one undo step: what a PDF's outline
 * adds when it is imported, and what the notice's Undo takes out again.
 */
export class SetPagesContents implements Command {
  private previous: PageContents[] | null = null;

  constructor(
    private readonly next: readonly PageContents[],
    readonly label: string,
  ) {}

  apply(doc: InkDocument): void {
    const here = this.next.filter(({ page }) => doc.pages.includes(page));
    this.previous = here.map(({ page }) => ({
      page,
      title: page.title,
      titleLevel: page.titleLevel,
      sections: page.sections,
    }));
    for (const contents of here) writeContents(contents);
  }

  invert(doc: InkDocument): void {
    if (this.previous === null) return;
    for (const contents of this.previous) {
      if (doc.pages.includes(contents.page)) writeContents(contents);
    }
    this.previous = null;
  }
}

function writeContents({ page, title, titleLevel, sections }: PageContents): void {
  setTitle(page, title);
  setTitleLevel(page, titleLevel);
  if (sections === undefined || sections.length === 0) delete page.sections;
  else page.sections = sections;
}

/** These pages with nothing in the contents: what taking an imported outline out leaves. */
export function clearedContents(pages: readonly Page[]): PageContents[] {
  return pages
    .filter((page) => page.title !== undefined || (page.sections?.length ?? 0) > 0)
    .map((page) => ({ page }));
}
