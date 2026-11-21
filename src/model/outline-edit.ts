/**
 * Ask AI and a notebook's outline (its contents, `model/contents.ts`, with
 * the levels of discussion #185): the outline as the AI reads it
 * ({@link outlineText}), and the AI's entries as the pages' new contents
 * ({@link placeOutline}), ready for `SetPagesContents`, one undo step.
 *
 * An entry names a page, a title and a level. One at the top of a page
 * (`y` absent or within `OUTLINE_TOP` of it) is the page's title, when the
 * page has none yet; any other is a heading inside the page, `y` of the way
 * down, as the add_section tool places one. The same rule a PDF's own
 * outline follows when it comes in (`model/pdf-outline.ts`).
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
import type { ContentsLevel, InkDocument, Page, PageSection } from "./document";
import { OUTLINE_TOP } from "./pdf-outline";

/** Most entries one call may set: more than any lecture's outline. */
export const MAX_OUTLINE_ENTRIES = 200;

/** Where a heading's left edge goes, as a fraction of the page: as add_section puts it. */
const HEADING_LEFT = 0.08;

/** One entry the AI gives. */
export interface OutlineEntry {
  /** 1-based page. */
  page: number;
  title: string;
  /** 1 a chapter, 2 a section of it, 3 a part of that; absent is 1. */
  level?: number;
  /** How far down the page it starts, 0 (top) to 1; absent is the top. */
  y?: number;
}

/**
 * The pages' new contents for `entries`, in one `SetPagesContents`. With
 * `replace`, the outline becomes exactly these entries: every other title,
 * heading and page-less chapter goes. Without it, they are added to what
 * the pages have. Entries outside the notebook, or with no title left once
 * normalised, are passed over.
 */
export function placeOutline(
  doc: InkDocument,
  entries: readonly OutlineEntry[],
  replace: boolean,
): PageContents[] {
  const out = new Map<
    Page,
    { title?: string; titleLevel: ContentsLevel; sections: PageSection[] }
  >();
  const levels = new Map<PageSection, ContentsLevel>();
  let next = maxSectionNumber(doc);
  const start = (page: Page) =>
    replace
      ? { title: undefined, titleLevel: 1 as ContentsLevel, sections: [] }
      : {
          title: page.title,
          titleLevel: page.titleLevel ?? 1,
          sections: [...(page.sections ?? [])],
        };
  if (replace) {
    for (const page of doc.pages) {
      const has =
        page.title !== undefined ||
        (page.sections?.length ?? 0) > 0 ||
        (page.chapters?.length ?? 0) > 0;
      if (has) out.set(page, start(page));
    }
  }
  for (const item of entries.slice(0, MAX_OUTLINE_ENTRIES)) {
    const page = doc.pages[item.page - 1];
    const title = normalizePageTitle(item.title);
    if (!page || title === undefined) continue;
    let contents = out.get(page);
    if (!contents) {
      contents = start(page);
      out.set(page, contents);
    }
    const level = clampContentsLevel(Math.round(item.level ?? 1));
    const y = fraction(item.y) ?? 0;
    if (contents.title === undefined && y <= OUTLINE_TOP) {
      contents.title = title;
      contents.titleLevel = level;
      continue;
    }
    const section: PageSection = {
      id: mintedId(doc) ?? `c${++next}`,
      x: Math.round(HEADING_LEFT * page.geometry.width),
      y: Math.round(y * page.geometry.height),
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
        const level = levels.get(section) ?? section.level;
        const bare: PageSection = { ...section };
        delete bare.level;
        return level === undefined || level === fallback ? bare : { ...bare, level };
      }),
    );
    return {
      page,
      title: contents.title,
      titleLevel: contents.titleLevel,
      sections,
      ...(replace ? { chapters: [] } : {}),
    };
  });
}

function fraction(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/** One entry as the AI reads it: "- p.3, level 2, heading at 40%: “Mitosis”". */
function entryLine(doc: InkDocument, entry: ContentsEntry): string {
  const page = doc.pages[entry.index];
  const where = entry.chapter
    ? "chapter with no page of its own, before this page"
    : entry.section
      ? `heading ${Math.round((entry.section.y / Math.max(1, page?.geometry.height ?? 1)) * 100)}% down`
      : "page title";
  return `- page ${entry.index + 1}, level ${entry.level}, ${where}: “${entry.title}”`;
}

/** A PDF behind some of the notebook's pages, and its own outline laid on them. */
export interface PdfOutlineOf {
  name: string;
  /** 1-based notebook pages showing it. */
  pages: number[];
  /** Its own outline (bookmarks), as entries on the notebook's pages; empty when it has none. */
  entries: ContentsEntry[];
}

/**
 * The outline as the AI reads it with read_outline: every entry in order,
 * with its page, level and kind; then each PDF behind the pages, and its own
 * outline where it has one, which set_outline can copy.
 */
export function outlineText(doc: InkDocument, pdfs: readonly PdfOutlineOf[] = []): string {
  const entries = contentsEntries(doc);
  const lines: string[] = [];
  const total = doc.pages.length;
  if (entries.length === 0) {
    lines.push(`The notebook (${total} page${total === 1 ? "" : "s"}) has no outline yet.`);
  } else {
    lines.push(
      `The notebook's outline (${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${total} page${total === 1 ? "" : "s"}):`,
    );
    for (const entry of entries) lines.push(entryLine(doc, entry));
  }
  for (const pdf of pdfs) {
    const one = pdf.pages.length === 1;
    lines.push(
      "",
      `${one ? "Page" : "Pages"} ${pageRange(pdf.pages)} show${one ? "s" : ""} the PDF “${pdf.name}”.`,
    );
    if (pdf.entries.length === 0) {
      lines.push("It has no outline of its own: read its pages to make one.");
      continue;
    }
    lines.push(`Its own outline, on the notebook's pages (${pdf.entries.length} entries):`);
    for (const entry of pdf.entries.slice(0, MAX_OUTLINE_ENTRIES)) {
      lines.push(entryLine(doc, entry).replace(/^- /, "  - "));
    }
  }
  return lines.join("\n");
}

/** "3", "3–9", "1–4, 7". */
export function pageRange(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return runs.join(", ");
}
