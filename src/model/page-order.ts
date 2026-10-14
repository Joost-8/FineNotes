/**
 * Several pages at once, as the page overview's selection acts on them:
 * move them together, delete them, or duplicate them. Each is one undo step.
 *
 * Pages are named by **identity**, never by id or index: ids only have to be
 * unique per file, and an index means a different page once anything moves
 * (CLAUDE.md, "Resolve an inverse by identity"). Every inverse puts back
 * exactly the objects its forward pass touched.
 *
 * A drop is addressed as a **gap**: gap `g` lies just before page `g` of the
 * page list as it is before the move (`0` before the first page, `length`
 * after the last). It is what a drop indicator between two thumbnails means.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { type InkDocument, type Page, insertPage } from "./document";
import { duplicatePageAfter } from "./page-commands";

/**
 * Where a single page at `from` lands for `MovePage` when dropped in gap
 * `gap`, or `null` when the drop leaves it where it is.
 */
export function moveIndexForGap(from: number, gap: number, total: number): number | null {
  if (from < 0 || from >= total || gap < 0 || gap > total) return null;
  if (gap === from || gap === from + 1) return null;
  return gap > from ? gap - 1 : gap;
}

/**
 * The page order after gathering `moving` (indexes, any order) into one
 * block, in their page order, at gap `gap`. Out-of-range indexes are ignored.
 */
export function orderAfterBlockMove(
  total: number,
  moving: readonly number[],
  gap: number,
): number[] {
  const picked = new Set(moving.filter((i) => Number.isInteger(i) && i >= 0 && i < total));
  const block = [...picked].sort((a, b) => a - b);
  const rest: number[] = [];
  let at = 0;
  const clamped = Math.max(0, Math.min(total, Math.trunc(gap)));
  for (let i = 0; i < total; i++) {
    if (i === clamped) at = rest.length;
    if (!picked.has(i)) rest.push(i);
  }
  if (clamped >= total) at = rest.length;
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** Whether gathering `moving` at gap `gap` would change nothing. */
export function isNoOpBlockMove(total: number, moving: readonly number[], gap: number): boolean {
  return orderAfterBlockMove(total, moving, gap).every((index, i) => index === i);
}

/** The positions of `pages` in the document, in page order; pages not in it are left out. */
function positionsOf(doc: InkDocument, pages: readonly Page[]): Array<{ page: Page; at: number }> {
  const seen = new Set<Page>();
  const out: Array<{ page: Page; at: number }> = [];
  for (const page of pages) {
    if (seen.has(page)) continue;
    seen.add(page);
    const at = doc.pages.indexOf(page);
    if (at >= 0) out.push({ page, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Take `placed` back out of the document and put each page back where it
 * was: removing them all first, then inserting in ascending order, rebuilds
 * the order they were taken from exactly.
 */
function restore(doc: InkDocument, placed: ReadonlyArray<{ page: Page; at: number }>): void {
  for (const { page } of placed) {
    const now = doc.pages.indexOf(page);
    if (now >= 0) doc.pages.splice(now, 1);
  }
  for (const { page, at } of placed) insertPage(doc, at, page);
}

/**
 * Move several pages together to gap `gap`, gathered into one block in their
 * page order. Undo puts each back where it was. A move that changes nothing
 * is a no-op both ways.
 */
export class MovePages implements Command {
  readonly label: string;
  readonly keepsReading = true;
  private placed: Array<{ page: Page; at: number }> | null = null;

  constructor(
    private readonly pages: readonly Page[],
    private readonly gap: number,
  ) {
    this.label = pages.length === 1 ? "Move page" : "Move pages";
  }

  apply(doc: InkDocument): void {
    this.placed = null;
    const placed = positionsOf(doc, this.pages);
    const total = doc.pages.length;
    const indexes = placed.map((p) => p.at);
    if (placed.length === 0 || isNoOpBlockMove(total, indexes, this.gap)) return;
    const order = orderAfterBlockMove(total, indexes, this.gap);
    const before = doc.pages.slice();
    doc.pages.splice(0, total, ...order.map((i) => before[i]));
    this.placed = placed;
  }

  invert(doc: InkDocument): void {
    if (!this.placed) return;
    restore(doc, this.placed);
    this.placed = null;
  }
}

/**
 * Delete several pages. A notebook keeps at least one page, so deleting
 * every page is refused (a no-op both ways). Undo puts each back where it was.
 */
export class RemovePages implements Command {
  readonly label: string;
  readonly keepsReading = true;
  private removed: Array<{ page: Page; at: number }> | null = null;

  constructor(private readonly pages: readonly Page[]) {
    this.label = pages.length === 1 ? "Delete page" : "Delete pages";
  }

  apply(doc: InkDocument): void {
    this.removed = null;
    const placed = positionsOf(doc, this.pages);
    if (placed.length === 0 || placed.length >= doc.pages.length) return;
    for (let i = placed.length - 1; i >= 0; i--) doc.pages.splice(placed[i].at, 1);
    this.removed = placed;
  }

  invert(doc: InkDocument): void {
    if (!this.removed) return;
    for (const { page, at } of this.removed) insertPage(doc, at, page);
    this.removed = null;
  }
}

/**
 * Duplicate several pages, each copy straight after its original, as the
 * page menu's "Duplicate page" does for one. The copies are made on the
 * first apply (each with fresh ids, above those of the copies before it) and
 * kept, so a redo puts back the very same pages.
 */
export class DuplicatePages implements Command {
  readonly label: string;
  readonly keepsReading = true;
  private copies: Array<{ source: Page; copy: Page }> | null = null;
  private applied = false;

  constructor(private readonly pages: readonly Page[]) {
    this.label = pages.length === 1 ? "Duplicate page" : "Duplicate pages";
  }

  /** The copies the last apply inserted, in page order. */
  get added(): readonly Page[] {
    return this.applied ? (this.copies ?? []).map((c) => c.copy) : [];
  }

  apply(doc: InkDocument): void {
    this.applied = false;
    if (!this.copies) {
      const copies: Array<{ source: Page; copy: Page }> = [];
      for (const { page } of positionsOf(doc, this.pages)) {
        // Inserted at once, so the next copy's ids count past this one's.
        const made = duplicatePageAfter(doc, doc.pages.indexOf(page));
        if (!made) continue;
        insertPage(doc, made.index, made.page);
        copies.push({ source: page, copy: made.page });
      }
      this.copies = copies;
      this.applied = copies.length > 0;
      return;
    }
    for (const { source, copy } of this.copies) {
      const at = doc.pages.indexOf(source);
      if (at >= 0 && !doc.pages.includes(copy)) insertPage(doc, at + 1, copy);
    }
    this.applied = true;
  }

  invert(doc: InkDocument): void {
    if (!this.applied || !this.copies) return;
    for (const { copy } of this.copies) {
      const at = doc.pages.indexOf(copy);
      if (at >= 0) doc.pages.splice(at, 1);
    }
    this.applied = false;
  }
}
