/**
 * Page-scoped stroke commands.
 *
 * The page-level commands (`AddPage`, `RemovePage`, `SetBackdrop`, the image
 * commands) live in `src/model/commands.ts`. Every stroke command is addressed
 * to a page: a stroke drawn on page 3 must land in page 3's `strokes` array and
 * nowhere else, so each command here names its page by id.
 *
 * These were written under `src/view/` by the frontend agent to stay out of the
 * model's territory, and moved here at integration (2026-09-20) unchanged —
 * they touch no DOM and no Obsidian API. Pure, like the rest of `src/model/`.
 */

import type { Command } from "./commands";
import {
  type Backdrop,
  type InkDocument,
  type Page,
  type Stroke,
  type TextBoxElement,
  POINT_STRIDE,
  pageById,
} from "./document";
import { paperTemplateFor } from "./templates";

/** Append a freshly-drawn stroke to a specific page. */
export class AddStrokeToPage implements Command {
  readonly label = "Add stroke";
  constructor(
    readonly pageId: string,
    private readonly stroke: Stroke,
  ) {}

  apply(doc: InkDocument): void {
    pageById(doc, this.pageId)?.strokes.push(this.stroke);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const index = page.strokes.findIndex((s) => s.id === this.stroke.id);
    if (index >= 0) page.strokes.splice(index, 1);
  }
}

/** Place a typed text box on one page. */
export class AddTextBoxToPage implements Command {
  readonly label = "Add text box";

  constructor(
    readonly pageId: string,
    private readonly textBox: TextBoxElement,
  ) {}

  apply(doc: InkDocument): void {
    pageById(doc, this.pageId)?.textBoxes.push(this.textBox);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const index = page.textBoxes.findIndex((textBox) => textBox.id === this.textBox.id);
    if (index >= 0) page.textBoxes.splice(index, 1);
  }
}

/** Remove one text box from one page, restoring it at the same index on undo. */
export class RemoveTextBoxFromPage implements Command {
  readonly label = "Remove text box";
  private removed: { index: number; textBox: TextBoxElement } | null = null;

  constructor(
    readonly pageId: string,
    private readonly textBoxId: string,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    // Prefer the exact object removed before (redo), since ids can repeat.
    let index = this.removed ? page.textBoxes.indexOf(this.removed.textBox) : -1;
    if (index < 0) index = page.textBoxes.findIndex((t) => t.id === this.textBoxId);
    if (index < 0) {
      this.removed = null;
      return;
    }
    this.removed = { index, textBox: page.textBoxes[index] };
    page.textBoxes.splice(index, 1);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page || !this.removed) return;
    page.textBoxes.splice(this.removed.index, 0, this.removed.textBox);
  }
}

/**
 * Where a text box sits and how big it is, in page space. `h` absent = auto
 * height; `fit` = the width follows the text (a resize leaves it out).
 */
export interface TextBoxFrame {
  x: number;
  y: number;
  w: number;
  h?: number;
  fit?: true;
}

/** Move and/or resize one text box on one page. */
export class SetTextBoxFrame implements Command {
  readonly label = "Resize text box";
  private previous: TextBoxFrame | null = null;
  /** The box acted on, so undo restores exactly that object (ids can repeat). */
  private target: TextBoxElement | null = null;
  /** The box's key order before apply: re-adding `h` or `fit` would append it. */
  private keyOrder: string[] = [];

  constructor(
    readonly pageId: string,
    private readonly textBoxId: string,
    private readonly frame: TextBoxFrame,
  ) {}

  apply(doc: InkDocument): void {
    const box = this.target ?? this.find(doc);
    if (!box) return;
    this.target = box;
    this.previous = frameOf(box);
    this.keyOrder = Object.keys(box);
    setFrame(box, this.frame);
  }

  invert(doc: InkDocument): void {
    const box = this.target ?? this.find(doc);
    if (!box || !this.previous) return;
    setFrame(box, this.previous);
    restoreKeyOrder(box, this.keyOrder);
  }

  private find(doc: InkDocument): TextBoxElement | null {
    return pageById(doc, this.pageId)?.textBoxes.find((t) => t.id === this.textBoxId) ?? null;
  }
}

function frameOf(box: TextBoxElement): TextBoxFrame {
  return {
    x: box.x,
    y: box.y,
    w: box.w,
    ...(box.h !== undefined ? { h: box.h } : {}),
    ...(box.fit ? { fit: true as const } : {}),
  };
}

function restoreKeyOrder(box: TextBoxElement, order: readonly string[]): void {
  const record = box as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.every((key, i) => key === order[i])) return;
  const rank = (key: string): number => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  const entries = Object.entries(record).sort((a, b) => rank(a[0]) - rank(b[0]));
  for (const key of keys) delete record[key];
  for (const [key, value] of entries) record[key] = value;
}

function setFrame(box: TextBoxElement, frame: TextBoxFrame): void {
  box.x = frame.x;
  box.y = frame.y;
  box.w = frame.w;
  if (frame.h === undefined) delete box.h;
  else box.h = frame.h;
  if (frame.fit) box.fit = true;
  else delete box.fit;
}

/** Remove strokes by id from one page, restoring their positions on undo. */
export class RemoveStrokesFromPage implements Command {
  readonly label: string;
  private removed: Array<{ index: number; stroke: Stroke }> = [];

  constructor(
    readonly pageId: string,
    private readonly ids: ReadonlySet<string>,
    label = "Erase",
  ) {
    this.label = label;
  }

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.removed = [];
    // Walk high->low so splicing doesn't shift not-yet-visited indices.
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const stroke = page.strokes[i];
      if (this.ids.has(stroke.id)) {
        this.removed.push({ index: i, stroke });
        page.strokes.splice(i, 1);
      }
    }
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    // `removed` is in descending index order; restore ascending so each
    // insertion lands at its original index.
    for (let k = this.removed.length - 1; k >= 0; k--) {
      const { index, stroke } = this.removed[k];
      page.strokes.splice(index, 0, stroke);
    }
  }
}

/** Translate a set of a page's strokes by (dx, dy), in page space. */
export class MoveStrokesOnPage implements Command {
  readonly label = "Move";
  constructor(
    readonly pageId: string,
    private readonly ids: ReadonlySet<string>,
    private readonly dx: number,
    private readonly dy: number,
  ) {}

  apply(doc: InkDocument): void {
    this.shift(doc, this.dx, this.dy);
  }

  invert(doc: InkDocument): void {
    this.shift(doc, -this.dx, -this.dy);
  }

  private shift(doc: InkDocument, dx: number, dy: number): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    for (const stroke of page.strokes) {
      if (!this.ids.has(stroke.id)) continue;
      // Guard the y write: a ragged `pts` (length not a multiple of the
      // stride) otherwise wrote one slot past the end, appending NaN and
      // *growing* the array. A NaN here poisons strokeBounds and everything
      // measured from it, and makes recognizeShape give up.
      for (let i = 0; i < stroke.pts.length; i += POINT_STRIDE) {
        stroke.pts[i] += dx;
        if (i + 1 < stroke.pts.length) stroke.pts[i + 1] += dy;
      }
    }
  }
}

/**
 * Build the page an "add page" control should insert after `afterIndex`.
 *
 * Contract v2 §1: a new page inherits the geometry and backdrop of the page it
 * follows — except that a cover is not paper, so a page after the cover
 * repeats the notebook's paper instead ({@link paperTemplateFor}). The
 * command itself is the model's `AddPage`; only the "what page, and where"
 * decision is the view's, so that is all that lives here.
 */
export function pageToInsertAfter(
  doc: InkDocument,
  afterIndex: number,
): { index: number; page: Page } | null {
  const at = doc.pages[afterIndex] ? afterIndex : doc.pages.length - 1;
  const template = doc.pages[at];
  if (!template) return null;
  return {
    index: afterIndex + 1,
    page: {
      id: nextPageId(doc),
      kind: "ink",
      geometry: { ...template.geometry },
      backdrop: inheritBackdrop(paperTemplateFor(doc.pages, at)),
      strokes: [],
      images: [],
      textBoxes: [],
    },
  };
}

/**
 * A new page inherits the previous page's backdrop — except a PDF backdrop,
 * which points at a specific source page and cannot be meaningfully repeated.
 * A blank sheet is the honest default there.
 */
function inheritBackdrop(backdrop: Backdrop): Backdrop {
  if (backdrop.kind === "pdf") return { kind: "blank" };
  return { ...backdrop };
}

/** Next free `p<N>` page id for a document. */
export function nextPageId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    const m = /^p(\d+)$/.exec(page.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `p${max + 1}`;
}

/**
 * Several commands as one undo step. An eraser drag that crosses a page gap
 * touches two pages but is one gesture, and must undo as one gesture.
 */
export class CompositeCommand implements Command {
  constructor(
    readonly label: string,
    private readonly parts: readonly Command[],
  ) {}

  /** The page every part that names one agrees on; none when they differ or none names one. */
  get pageId(): string | undefined {
    let id: string | undefined;
    for (const part of this.parts) {
      const own = part.pageId;
      if (own === undefined) continue;
      if (id !== undefined && own !== id) return undefined;
      id = own;
    }
    return id;
  }

  apply(doc: InkDocument): void {
    for (const part of this.parts) part.apply(doc);
  }

  invert(doc: InkDocument): void {
    // Reverse order, so each inverse sees the state its forward pass produced.
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].invert(doc);
  }
}

/** Remove every stroke on one page (one undoable step). */
export class ClearPage implements Command {
  readonly label = "Clear page";
  private removed: Stroke[] = [];

  constructor(readonly pageId: string) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.removed = page.strokes;
    page.strokes = [];
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (page) page.strokes = this.removed;
  }
}

/*
 * Page-sidebar operations (the thumbnail "…" menu). Like `pageToInsertAfter`,
 * `duplicatePageAfter` only decides *what* page goes *where*; the insertion
 * itself is the model's `AddPage`, so undo comes for free.
 */

/**
 * A deep copy of page `index`, to insert straight after it.
 *
 * Stroke and text-box ids are unique across the whole document, not just per
 * page — the surface indexes strokes by id alone — so every copied element
 * gets a fresh id above the document's current maximum. The backdrop is
 * copied as is, a PDF page included: duplicating an annotated PDF page to
 * annotate it again is exactly what a duplicate is for.
 */
export function duplicatePageAfter(
  doc: InkDocument,
  index: number,
): { index: number; page: Page } | null {
  const source = doc.pages[index];
  if (!source) return null;
  let strokeSeq = maxNumericId(doc, (page) => page.strokes, "s");
  let textSeq = maxNumericId(doc, (page) => page.textBoxes, "t");
  let imageSeq = maxNumericId(doc, (page) => page.images, "i");
  const copy = structuredClone(source);
  copy.id = nextPageId(doc);
  // A bookmark marks that page, not its content: the copy starts without one.
  delete copy.bookmarked;
  for (const stroke of copy.strokes) stroke.id = `s${++strokeSeq}`;
  for (const textBox of copy.textBoxes) textBox.id = `t${++textSeq}`;
  for (const image of copy.images) image.id = `i${++imageSeq}`;
  return { index: index + 1, page: copy };
}

/** Highest `<prefix><N>` id among one kind of page element, across all pages. */
function maxNumericId(
  doc: InkDocument,
  items: (page: Page) => readonly { id: string }[],
  prefix: string,
): number {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const page of doc.pages) {
    for (const item of items(page)) {
      const match = pattern.exec(item.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}

/**
 * Move a page from `from` to `to` (both indexes into the page list as it is
 * before the move). Out-of-range or equal indexes make it a no-op, and then
 * `invert()` is one too.
 */
export class MovePage implements Command {
  readonly label = "Move page";
  private moved: Page | null = null;

  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {}

  apply(doc: InkDocument): void {
    this.moved = null;
    const last = doc.pages.length - 1;
    if (this.from === this.to || this.from < 0 || this.to < 0) return;
    if (this.from > last || this.to > last) return;
    const [page] = doc.pages.splice(this.from, 1);
    doc.pages.splice(this.to, 0, page);
    this.moved = page;
  }

  invert(doc: InkDocument): void {
    if (!this.moved) return;
    // By identity, for the same reason as `AddPage.invert`: ids can repeat.
    const at = doc.pages.indexOf(this.moved);
    if (at < 0) return;
    doc.pages.splice(at, 1);
    doc.pages.splice(this.from, 0, this.moved);
    this.moved = null;
  }
}

/**
 * Change a page's template: its paper, and optionally its size. One undo step.
 *
 * Ink is never moved or scaled. Strokes live in page space, so shrinking a
 * page leaves any ink beyond the new edge in the document, clipped from view
 * but intact, and changing back reveals it again.
 */
export class SetPageTemplate implements Command {
  readonly label = "Change template";
  private previous: { backdrop: Backdrop; geometry: Page["geometry"] } | null = null;

  constructor(
    private readonly page: Page,
    private readonly backdrop: Backdrop,
    private readonly geometry?: Page["geometry"],
  ) {}

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    // By identity, like the other page commands: ids can repeat within a file.
    if (!doc.pages.includes(this.page)) return;
    this.previous = { backdrop: this.page.backdrop, geometry: this.page.geometry };
    this.page.backdrop = { ...this.backdrop };
    if (this.geometry) this.page.geometry = { ...this.geometry };
  }

  invert(doc: InkDocument): void {
    if (!this.previous || !doc.pages.includes(this.page)) return;
    this.page.backdrop = this.previous.backdrop;
    this.page.geometry = this.previous.geometry;
    this.previous = null;
  }
}

/** Bookmark a page, or take its bookmark off. One undo step; a no-op if it already is. */
export class SetPageBookmark implements Command {
  readonly label: string;
  private previous: boolean | null = null;

  constructor(
    private readonly page: Page,
    private readonly on: boolean,
  ) {
    this.label = on ? "Bookmark page" : "Remove bookmark";
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    // By identity, like the other page commands: ids can repeat within a file.
    if (!doc.pages.includes(this.page)) return;
    this.previous = this.page.bookmarked === true;
    setBookmark(this.page, this.on);
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    setBookmark(this.page, this.previous);
    this.previous = null;
  }
}

function setBookmark(page: Page, on: boolean): void {
  if (on) page.bookmarked = true;
  else delete page.bookmarked;
}

/** Indexes of the bookmarked pages, in page order: the sidebar's "Bookmarks only". */
export function bookmarkedPageIndexes(doc: InkDocument): number[] {
  const out: number[] = [];
  doc.pages.forEach((page, index) => {
    if (page.bookmarked === true) out.push(index);
  });
  return out;
}

/** Where the "Add Page" popover inserts, relative to the page it was opened on. */
export type InsertPosition = "before" | "after" | "last";

/** The index a new page lands at for `position`, relative to page `ref`. */
export function insertIndexFor(position: InsertPosition, ref: number, total: number): number {
  const at = Math.max(0, Math.min(total - 1, ref));
  if (position === "before") return at;
  if (position === "after") return at + 1;
  return total;
}

/**
 * A fresh, empty page with a chosen template, to insert at `index`. The
 * insertion itself is `AddPage`, as for every other new page.
 */
export function pageFromTemplate(
  doc: InkDocument,
  index: number,
  backdrop: Backdrop,
  geometry: Page["geometry"],
): { index: number; page: Page } {
  return {
    index: Math.max(0, Math.min(doc.pages.length, index)),
    page: {
      id: nextPageId(doc),
      kind: "ink",
      geometry: { ...geometry },
      backdrop: { ...backdrop },
      strokes: [],
      images: [],
      textBoxes: [],
    },
  };
}
