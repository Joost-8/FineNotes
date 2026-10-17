/**
 * A notebook's page furniture: a header and page numbers set once for the
 * whole notebook and printed on every page (covers aside), where the welcome
 * notebook placed a footer by hand on each page
 * (research/reports/GoodNotes aesthetics and design freedom.md, bottleneck 7).
 * Drawn with the paper, under the ink, on the page and in its thumbnails and
 * exports alike.
 *
 * Pure: no DOM. {@link furnitureText} resolves a page's two lines.
 */

import type { Command } from "./commands";
import { type InkDocument, isCoverRuling } from "./document";

/** Where page numbers go; absent is none. */
export type PageNumbers = "center" | "right";

export interface NotebookFurniture {
  /** Text at the top of every page; `{title}`, `{page}` and `{pages}` are filled in. */
  header?: string;
  numbers?: PageNumbers;
}

/** The longest header kept. */
export const MAX_HEADER_LENGTH = 80;

/** A stored furniture block, or `undefined` when it says nothing. */
export function readFurniture(raw: unknown): NotebookFurniture | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: NotebookFurniture = {};
  if (typeof r.header === "string" && r.header.trim()) {
    out.header = r.header.trim().slice(0, MAX_HEADER_LENGTH);
  }
  if (r.numbers === "center" || r.numbers === "right") out.numbers = r.numbers;
  return out.header || out.numbers ? out : undefined;
}

/** The lines printed on a page: the header, and the footer (its number). */
export interface PageTexts {
  header?: string;
  footer?: string;
  /** Where the footer sits. */
  align?: PageNumbers;
}

/**
 * Page `index`'s header and footer in `doc`, counting pages from the first
 * that is not a cover, so a covered notebook's first page of writing is 1.
 */
export function furnitureText(
  doc: Pick<InkDocument, "furniture" | "pages">,
  index: number,
  title = "",
): PageTexts {
  const furniture = readFurniture(doc.furniture);
  const page = doc.pages[index];
  if (!furniture || !page || isCoverRuling(page.backdrop.kind)) return {};
  const covers = doc.pages.filter((p, i) => i < index && isCoverRuling(p.backdrop.kind)).length;
  const total = doc.pages.filter((p) => !isCoverRuling(p.backdrop.kind)).length;
  const number = index - covers + 1;
  const out: PageTexts = {};
  if (furniture.header) {
    out.header = furniture.header
      .replace(/\{title\}/g, title)
      .replace(/\{page\}/g, String(number))
      .replace(/\{pages\}/g, String(total))
      .trim();
    if (!out.header) delete out.header;
  }
  if (furniture.numbers) {
    out.footer = String(number);
    out.align = furniture.numbers;
  }
  return out;
}

/** Set (or with `undefined`, clear) the notebook's furniture, as one undo step. */
export class SetFurniture implements Command {
  readonly label = "Change header and page numbers";
  private previous: NotebookFurniture | undefined;

  constructor(private readonly furniture: NotebookFurniture | undefined) {}

  apply(doc: InkDocument): void {
    this.previous = doc.furniture ? { ...doc.furniture } : undefined;
    const next = readFurniture(this.furniture);
    if (next) doc.furniture = next;
    else delete doc.furniture;
  }

  invert(doc: InkDocument): void {
    if (this.previous) doc.furniture = this.previous;
    else delete doc.furniture;
  }
}
