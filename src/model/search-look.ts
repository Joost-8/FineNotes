/**
 * How a notebook shows its search results (discussion #112): in a sidebar
 * beside the page, or in a window floating over it. A choice each notebook
 * makes for itself, with one button on the results; stored in the document
 * as `meta.searchLook`, only when it is the window, so it follows the
 * notebook to every device and older builds simply ignore it.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { InkDocument } from "./document";

export type SearchLook = "sidebar" | "window";

/** The look a notebook's results show in; the sidebar unless it chose the window. */
export function searchLookOf(doc: Pick<InkDocument, "searchLook"> | null): SearchLook {
  return doc?.searchLook === "window" ? "window" : "sidebar";
}

/** The other look: what the switch button turns the results into. */
export function otherLook(look: SearchLook): SearchLook {
  return look === "window" ? "sidebar" : "window";
}

/**
 * Keep `look` in the document. The sidebar deletes the key, so a notebook
 * that never chose saves byte for byte as before. Whether anything changed.
 */
export function writeSearchLook(doc: InkDocument, look: SearchLook): boolean {
  if (searchLookOf(doc) === look) return false;
  if (look === "window") doc.searchLook = "window";
  else delete doc.searchLook;
  return true;
}
