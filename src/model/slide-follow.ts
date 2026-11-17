/**
 * Notes follow the slide (PDF tabs, P4). Pure: no DOM, no Obsidian.
 *
 * A notes page written on while a PDF kept beside the notes was being read
 * remembers that slide (`Page.follows`). Going from that page to the PDF's
 * tab opens the slide; going back from a slide to the notes finds the page
 * written beside it, when there is exactly one. And on a PDF's tab, the
 * slides either side of the one read are kept ready ahead.
 */

import type { BesideView, Page, SlideRef } from "./document";

/**
 * What a notes page written on should now follow: the slide last shown in
 * this notebook's PDF tabs. `null` when there is nothing to record: no slide
 * has been shown, or the page already follows that very slide.
 */
export function followOnWrite(
  lastShown: SlideRef | null,
  page: Pick<Page, "follows">,
): SlideRef | null {
  if (!lastShown) return null;
  const now = page.follows;
  if (now && now.tab === lastShown.tab && now.page === lastShown.page) return null;
  return { tab: lastShown.tab, page: lastShown.page };
}

/**
 * The slide (0-based PDF page) to open when going from the notes page
 * `notesPage` to tab `tab`, or `null` to show the tab as it was left
 * (`tabView`). The page's slide is opened when it follows this tab, unless
 * the tab was left on that slide anyway (it stays where it was on it), or
 * the PDF has no such page (`slideCount`).
 */
export function slideToOpen(
  notesPage: Pick<Page, "follows"> | null | undefined,
  tab: string,
  tabView: Pick<BesideView, "page"> | null | undefined,
  slideCount: number,
): number | null {
  const follows = notesPage?.follows;
  if (!follows || follows.tab !== tab) return null;
  if (follows.page >= slideCount) return null;
  if (tabView && tabView.page === follows.page) return null;
  return follows.page;
}

/**
 * The notes page (index) to go back to from slide `shown`, or `null` to keep
 * the notes where they were left: kept when the page shown (`current`)
 * already follows that slide, or when no page, or several, do.
 */
export function notesToOpen(
  shown: SlideRef | null,
  pages: ReadonlyArray<Pick<Page, "follows">>,
  current: number,
): number | null {
  if (!shown) return null;
  const follows = (page: Pick<Page, "follows"> | undefined): boolean =>
    page?.follows?.tab === shown.tab && page.follows.page === shown.page;
  if (follows(pages[current])) return null;
  let found: number | null = null;
  for (let i = 0; i < pages.length; i++) {
    if (!follows(pages[i])) continue;
    if (found !== null) return null;
    found = i;
  }
  return found;
}

/**
 * The slides kept ready around slide `index` of `count`: the next first,
 * then the one before, then the one after the next (it shows at the pane's
 * foot once the next is gone to). A reader mostly goes on.
 */
export function slidesAround(index: number, count: number): number[] {
  return [index + 1, index - 1, index + 2].filter((i) => i >= 0 && i < count);
}
