/**
 * What a lasso screenshot includes (FineNotes#211): the selection with the
 * page behind it, the selection on its own, or the page behind it on its
 * own, without the ink (strokes and highlights) drawn there, so only the
 * paper, PDF, pictures and text show.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Page } from "../model/document";

/** The three pictures the Screenshot dialog offers, in its order. */
export type ScreenshotPart = "all" | "selection" | "page";

export const SCREENSHOT_PARTS: readonly ScreenshotPart[] = ["all", "selection", "page"];

/** Each choice's Lucide icon: everything stacked, the selection, the page alone. */
export const SCREENSHOT_PART_ICONS: Readonly<Record<ScreenshotPart, string>> = {
  all: "layers",
  selection: "lasso",
  page: "file",
};

/**
 * `page` without its ink: every stroke (pens, highlighters, shapes, cover
 * tape) is left out; paper, PDF, pictures and text boxes stay. A shallow
 * copy, so the document is untouched. Arrows joining shapes go with them.
 */
export function pageWithoutInk(page: Page): Page {
  const out: Page = { ...page, strokes: [] };
  // An arrow joining two shapes is drawn ink too, and its shapes are gone.
  delete out.connectors;
  return out;
}
