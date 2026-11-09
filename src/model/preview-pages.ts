/**
 * Which pages a preview of a long notebook shows: the hover preview of a
 * notebook link (`page-embed.ts`) and the page strip of Home's preview
 * (`library-view.ts`). A short notebook shows every page; a longer one, such
 * as an imported textbook, shows its first page and the pages its contents
 * and bookmarks point to.
 *
 * PURE: no DOM, no Obsidian.
 */

/**
 * What choosing the pages reads of a page: its place in the contents and
 * its bookmark. Levels are 1 a chapter, 2 a section of it, 3 a part of that;
 * a title without one is a chapter, and a heading without one sits one below
 * its page's title, or is a chapter on a page without a title (discussion
 * #185, as `contentsEntries` reads them). A chapter that is only a name
 * starts at the page it stands before; one standing `after` the last page
 * starts nothing.
 */
export interface PreviewPage {
  title?: string;
  titleLevel?: number;
  sections?: readonly { title: string; level?: number }[];
  chapters?: readonly { title: string; level?: number; after?: true }[];
  bookmarked?: true;
}

/** Places a shortened preview keeps for bookmarked pages, however many chapters there are. */
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
 * The pages a preview of `pages` shows, 0-based, in order: every page while
 * there are at most `limit`. Past that, the first page, then the pages the
 * contents and bookmarks point to, chosen in this order: chapters, bookmarked
 * pages, then the deeper entries of the contents, except that chapters always
 * leave `PREVIEW_BOOKMARK_PLACES` for bookmarks. Where one kind has more pages
 * than are left, they are spread evenly through the notebook. With neither
 * contents nor bookmarks, the first `limit` pages.
 */
export function previewPageIndexes(pages: readonly PreviewPage[], limit: number): number[] {
  const count = pages.length;
  const max = Math.max(1, Math.floor(limit));
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const chapters: number[] = [];
  const bookmarked: number[] = [];
  const outlined: number[] = [];
  // The first page is always shown, so it is never one of the picks.
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
  if (picked.length === 0) return Array.from({ length: max }, (_, i) => i);
  return [0, ...picked.sort((a, b) => a - b)];
}

/**
 * What a page reads as in a shortened preview: its highest entry in the
 * contents (the first chapter on it, else its first entry), or `undefined`
 * for a page the contents does not list.
 */
export function previewCaption(page: PreviewPage): string | undefined {
  let best: { title: string; level: number } | undefined;
  for (const entry of previewEntries(page)) if (!best || entry.level < best.level) best = entry;
  return best?.title;
}
