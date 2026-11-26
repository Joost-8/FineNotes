/**
 * A notebook opened at a page asked for by its id (a "Handwrite here" block's
 * "Open in notebook"): the page may not be there yet while the notebook's page
 * files are still being read, so the view waits a few times, then gives up.
 *
 * Pure: no DOM, no Obsidian.
 */

/** How many times the view looks again before giving up on a page id (50 ms apart). */
export const PAGE_ID_ATTEMPTS = 20;

export type PageIdStep =
  /** No page asked for by id. */
  | { kind: "none" }
  /** Not among the pages yet: look again. */
  | { kind: "wait" }
  /** Found: its index. */
  | { kind: "found"; index: number }
  /** Still not there after the last look: drop it, and go nowhere by it. */
  | { kind: "missing" };

/** What to do on look number `attempt` (from 0) for the page with id `pageId`. */
export function pageIdStep(
  pages: readonly { id: string }[],
  pageId: string | null,
  attempt: number,
): PageIdStep {
  if (pageId === null) return { kind: "none" };
  const index = pages.findIndex((page) => page.id === pageId);
  if (index >= 0) return { kind: "found", index };
  return attempt < PAGE_ID_ATTEMPTS ? { kind: "wait" } : { kind: "missing" };
}
