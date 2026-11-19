/**
 * Notes follow the slide (PDF tabs, P4). Pure: no DOM, no Obsidian.
 *
 * A notes page written on while a PDF kept beside the notes was being read
 * remembers that slide (`Page.follows`). Going from that page to the PDF's
 * tab opens the slide; going back to the notes shows them as they were left.
 * And on a PDF's tab, the slides either side of the one read are kept ready
 * ahead.
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
 * The slides kept ready around slide `index` of `count`: the next first,
 * then the one before, then the one after the next (it shows at the pane's
 * foot once the next is gone to). A reader mostly goes on.
 */
export function slidesAround(index: number, count: number): number[] {
  return [index + 1, index - 1, index + 2].filter((i) => i >= 0 && i < count);
}
