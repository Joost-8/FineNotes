/**
 * Page tabs: GoodNotes' most-asked-for "post-it tabs" (5,076 votes), a
 * coloured tab a page carries so the notebook can be opened at it, as a
 * binder's dividers are. The tab shows the page's title from the contents,
 * or its number; the view draws the tabs along the page's edge.
 *
 * Pure: no DOM.
 */

import type { Command } from "./commands";
import type { InkDocument, Page } from "./document";
import { paletteOf } from "./palette";

const HEX6 = /^#[0-9a-f]{6}$/i;

/** A stored tab colour, or `undefined` when it is not one. */
export function readTabColor(value: unknown): string | undefined {
  return typeof value === "string" && HEX6.test(value) ? value.toLowerCase() : undefined;
}

/**
 * The colour a new tab gets: the notebook's palette after its ink colour,
 * the first not yet used by another tab, else in turn.
 */
export function nextTabColor(doc: Pick<InkDocument, "pages" | "palette">): string {
  const colors = paletteOf(doc).colors.slice(1);
  const used = doc.pages.flatMap((p) => (p.tab ? [p.tab.toLowerCase()] : []));
  return colors.find((c) => !used.includes(c.toLowerCase())) ?? colors[used.length % colors.length];
}

/** A tab's label: the page's contents title, or "Page N". */
export function tabLabel(page: Page, index: number): string {
  return page.title?.trim() || `Page ${index + 1}`;
}

/** The tabbed pages in order, with what the view needs to draw each tab. */
export function pageTabs(
  doc: Pick<InkDocument, "pages">,
): Array<{ index: number; color: string; label: string }> {
  return doc.pages.flatMap((page, index) =>
    page.tab ? [{ index, color: page.tab, label: tabLabel(page, index) }] : [],
  );
}

/** Give a page a tab in `color`, or (with `null`) take it off. One undo step. */
export class SetPageTab implements Command {
  readonly label: string;
  private previous: string | undefined | null = null;

  constructor(
    private readonly page: Page,
    private readonly color: string | null,
  ) {
    this.label = color ? "Add page tab" : "Remove page tab";
  }

  apply(doc: InkDocument): void {
    // By identity, like the other page commands: ids can repeat within a file.
    if (!doc.pages.includes(this.page)) return;
    this.previous = this.page.tab;
    const color = this.color === null ? undefined : readTabColor(this.color);
    if (color) this.page.tab = color;
    else delete this.page.tab;
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    if (this.previous) this.page.tab = this.previous;
    else delete this.page.tab;
    this.previous = null;
  }
}
