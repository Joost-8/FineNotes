/**
 * A PDF's own outline (its bookmarks, the table of contents a reader shows
 * beside it) as the notebook's contents (discussion #185). `view/pdf-outline`
 * reads the outline with pdf.js; this decides where each entry goes.
 *
 * - An entry is matched to the notebook page that shows its PDF page, by the
 *   page's backdrop, not by position: a PDF added halfway through a notebook,
 *   or a page deleted since, still lines up. An entry whose page is not in
 *   the notebook is left out.
 * - An entry that starts at the top of its page becomes the page's title,
 *   unless the page has one; any other becomes a heading inside the page,
 *   where the PDF points.
 * - Its depth in the outline is its level, the deepest kept being 3.
 *
 * On a PDF's tab (`model/beside-pdfs`) the same outline is shown, read only,
 * as that tab's contents ({@link tabOutlineEntries}); it never goes into the
 * notebook's.
 *
 * PURE: no DOM, no Obsidian.
 */

import { mintedId } from "./dot-ids";
import {
  type ContentsEntry,
  type PageContents,
  clampContentsLevel,
  contentsEntries,
  maxSectionNumber,
  normalizePageTitle,
  sectionDefaultLevel,
  sortSections,
} from "./contents";
import {
  type ContentsLevel,
  type InkDocument,
  type Page,
  type PageSection,
  pdfFrameOf,
} from "./document";

/** One entry of a PDF's outline, flattened in reading order. */
export interface OutlineItem {
  title: string;
  /** 1 for a top-level entry, 2 for one inside it, and so on. */
  depth: number;
  /** 0-based page of the PDF it points to. */
  page: number;
  /** Where on that page, as fractions of its width and height from the top left; absent: its top. */
  x?: number;
  y?: number;
}

/** An entry this close to the top of its page starts the page: it is the page's title. */
export const OUTLINE_TOP = 0.15;

/** Where a heading goes when the PDF gives no left edge: a little in from the page's. */
const DEFAULT_LEFT = 0.06;

/** Most entries taken from one outline: a few long books list every index term. */
export const MAX_OUTLINE_ITEMS = 2000;

/**
 * The contents `items` give the notebook pages showing the PDF at `path`
 * (only those in `pages`, when given), each page's new contents whole, ready
 * for `SetPagesContents`. Entries go after what a page already has; empty
 * when nothing lands.
 */
export function outlineContents(
  doc: InkDocument,
  path: string,
  items: readonly OutlineItem[],
  pages?: readonly Page[],
): PageContents[] {
  const byPdfPage = new Map<number, Page>();
  for (const page of pages ?? doc.pages) {
    const backdrop = page.backdrop;
    if (backdrop.kind !== "pdf" || backdrop.path !== path || byPdfPage.has(backdrop.page)) continue;
    byPdfPage.set(backdrop.page, page);
  }
  const out = new Map<
    Page,
    { title?: string; titleLevel: ContentsLevel; sections: PageSection[] }
  >();
  const levels = new Map<PageSection, ContentsLevel>();
  let next = maxSectionNumber(doc);
  for (const item of items.slice(0, MAX_OUTLINE_ITEMS)) {
    const page = byPdfPage.get(item.page);
    const title = normalizePageTitle(item.title);
    if (!page || title === undefined) continue;
    let contents = out.get(page);
    if (!contents) {
      contents = {
        title: page.title,
        titleLevel: page.titleLevel ?? 1,
        sections: [...(page.sections ?? [])],
      };
      out.set(page, contents);
    }
    const level = clampContentsLevel(Math.round(item.depth));
    const y = fraction(item.y) ?? 0;
    if (contents.title === undefined && y <= OUTLINE_TOP) {
      contents.title = title;
      contents.titleLevel = level;
      continue;
    }
    const frame = pdfFrameOf(page.backdrop, page.geometry);
    const section: PageSection = {
      id: mintedId(doc) ?? `c${++next}`,
      x: Math.round(frame.x + (fraction(item.x) ?? DEFAULT_LEFT) * frame.width),
      y: Math.round(frame.y + y * frame.height),
      title,
    };
    levels.set(section, level);
    contents.sections.push(section);
  }
  return [...out].map(([page, contents]) => {
    // A heading's level is stored only where it differs from where it would sit.
    const shaped: Page = { ...page, title: contents.title, titleLevel: contents.titleLevel };
    const fallback = sectionDefaultLevel(shaped);
    const sections = sortSections(
      contents.sections.map((section) => {
        const level = levels.get(section);
        return level === undefined || level === fallback ? section : { ...section, level };
      }),
    );
    return {
      page,
      title: contents.title,
      titleLevel: contents.titleLevel,
      sections,
    };
  });
}

/** How many entries `contents` adds to the notebook's contents, against what it had. */
export function addedEntries(contents: readonly PageContents[]): number {
  let added = 0;
  for (const { page, title, sections } of contents) {
    if (title !== undefined && page.title === undefined) added++;
    added += (sections?.length ?? 0) - (page.sections?.length ?? 0);
  }
  return added;
}

function fraction(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/**
 * The contents a PDF's tab shows: the PDF's own outline laid on the tab's
 * pages (`doc`, from `besideDocument`; slide i is the tab's page i), in the
 * notes' shape (titles, headings inside, levels), so the sidebar draws it as
 * it draws the notes'. Nothing of it is stored: the tab's pages are copied,
 * and whatever contents they carry are left out. Empty when the PDF has no
 * outline, or none of it lands on a slide.
 */
export function tabOutlineEntries(
  doc: InkDocument,
  path: string,
  items: readonly OutlineItem[],
): ContentsEntry[] {
  if (items.length === 0) return [];
  const bare: InkDocument = {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      title: undefined,
      titleLevel: undefined,
      sections: undefined,
      chapters: undefined,
    })),
  };
  const placed = outlineContents(bare, path, items);
  if (placed.length === 0) return [];
  const byPage = new Map(placed.map((contents) => [contents.page, contents]));
  const pages = bare.pages.map((page) => {
    const contents = byPage.get(page);
    if (!contents) return page;
    return {
      ...page,
      title: contents.title,
      titleLevel: contents.title === undefined ? undefined : contents.titleLevel,
      sections: contents.sections && contents.sections.length > 0 ? contents.sections : undefined,
    };
  });
  return contentsEntries({ ...bare, pages });
}
