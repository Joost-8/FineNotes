/**
 * Rearranging the contents by dragging an entry (discussion #185). The
 * contents follow the pages, so moving an entry moves what it stands for: a
 * page's title takes that page and the untitled pages running on under it, a
 * chapter takes everything inside it, and all of it is one undo step.
 *
 * - A **gap** `g` is a place between entries: just before entry `g` of
 *   `contentsEntries`, gap `n` after the last.
 * - An entry's **block** is it and the deeper entries after it.
 * - A heading inside a page cannot leave its page, so it only changes level.
 *   For the same reason nothing can be dropped between two entries of one page.
 * - A chapter that holds nothing is only a line, and moves alone.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import {
  type ContentsEntry,
  type ContentsItem,
  type LevelChange,
  MAX_CONTENTS_LEVEL,
  SetContentsLevels,
  clampContentsLevel,
  contentsEntries,
  contentsItems,
  placeChapters,
  restoreChapters,
  snapshotChapters,
} from "./contents";
import type { ContentsLevel, InkDocument, Page } from "./document";

/** Where entry `at`'s block ends: the first entry after it that is not inside it. */
export function contentsBlockEnd(entries: readonly ContentsEntry[], at: number): number {
  const level = entries[at]?.level ?? 0;
  let end = at + 1;
  while (end < entries.length && entries[end].level > level) end++;
  return end;
}

function itemOf(doc: InkDocument, entry: ContentsEntry): ContentsItem {
  return entry.chapter ? entry.chapter.id : doc.pages[entry.index];
}

/**
 * What moves with entry `at`, as a range of `items`, or `null` when it cannot
 * leave its place: a heading, or a title sharing its page with an entry
 * outside its block.
 */
function movedSpan(
  doc: InkDocument,
  entries: readonly ContentsEntry[],
  items: readonly ContentsItem[],
  at: number,
): { from: number; to: number } | null {
  const head = entries[at];
  if (!head || head.section) return null;
  const from = items.indexOf(itemOf(doc, head));
  const end = contentsBlockEnd(entries, at);
  // Holds nothing: the pages after it are not its own.
  if (head.chapter && end === at + 1) return { from, to: from + 1 };
  const to = end < entries.length ? items.indexOf(itemOf(doc, entries[end])) : items.length;
  return to > from ? { from, to } : null;
}

/** The gaps entry `at` can be dropped in; its own place is gap `at`. */
export function contentsDropGaps(doc: InkDocument, at: number): number[] {
  const entries = contentsEntries(doc);
  if (!entries[at]) return [];
  if (!movedSpan(doc, entries, contentsItems(doc), at)) return [at];
  const end = contentsBlockEnd(entries, at);
  const gaps: number[] = [];
  for (let gap = 0; gap <= entries.length; gap++) {
    if (gap > at && gap <= end) continue;
    const next = entries[gap];
    const previous = entries[gap - 1];
    // Inside a page: a page cannot be split to make room.
    const midPage =
      next?.section !== undefined &&
      previous !== undefined &&
      previous.index === next.index &&
      !previous.chapter;
    if (gap === at || !midPage) gaps.push(gap);
  }
  return gaps;
}

/**
 * The levels entry `at` may take in gap `gap`: no deeper than one below the
 * entry above it (and its deepest entry within the limit), and not so
 * shallow that it would take over the entry after it.
 */
export function contentsDropLevels(
  entries: readonly ContentsEntry[],
  at: number,
  gap: number,
): { min: ContentsLevel; max: ContentsLevel } {
  const head = entries[at];
  const end = contentsBlockEnd(entries, at);
  const previous = entries[(gap === end ? at : gap) - 1];
  const next = entries[gap === at ? end : gap];
  const deepest = Math.max(...entries.slice(at, end).map((entry) => entry.level));
  const max = clampContentsLevel(
    Math.min(previous ? previous.level + 1 : 1, head.level + MAX_CONTENTS_LEVEL - deepest),
  );
  const min = clampContentsLevel(Math.min(next ? next.level : 1, max));
  return { min, max };
}

/** What a drop does: the new order (absent when only levels change) and the levels. */
export interface ContentsDrop {
  items?: ContentsItem[];
  levels: LevelChange[];
}

/**
 * What dropping entry `at` in gap `gap` at level `level` changes, or `null`
 * when the gap is not allowed or nothing would change. A level outside what
 * the gap allows is brought inside it.
 */
export function planContentsDrop(
  doc: InkDocument,
  at: number,
  gap: number,
  level: number,
): ContentsDrop | null {
  const entries = contentsEntries(doc);
  const head = entries[at];
  if (!head || !contentsDropGaps(doc, at).includes(gap)) return null;
  const { min, max } = contentsDropLevels(entries, at, gap);
  const delta = Math.max(min, Math.min(max, Math.round(level))) - head.level;
  if (gap === at && delta === 0) return null;

  const items = contentsItems(doc);
  const span = movedSpan(doc, entries, items, at);
  const carried = entries.slice(at, contentsBlockEnd(entries, at)).filter((entry) => {
    if (!span) return true;
    const position = items.indexOf(itemOf(doc, entry));
    return position >= span.from && position < span.to;
  });
  const levels = delta === 0 ? [] : carried.map((entry) => levelChange(doc, entry, delta));
  if (gap === at || !span) return { levels };

  const moved = items.slice(span.from, span.to);
  const landing = gap < entries.length ? itemOf(doc, entries[gap]) : null;
  const rest = [...items.slice(0, span.from), ...items.slice(span.to)];
  const place = landing === null ? rest.length : rest.indexOf(landing);
  return { items: [...rest.slice(0, place), ...moved, ...rest.slice(place)], levels };
}

function levelChange(doc: InkDocument, entry: ContentsEntry, delta: number): LevelChange {
  const page = doc.pages[entry.index];
  const level = clampContentsLevel(entry.level + delta);
  if (entry.chapter) return { page, chapter: entry.chapter.id, level };
  return entry.section ? { page, section: entry.section.id, level } : { page, level };
}

/** Apply a `planContentsDrop`, as one undo step. */
export class MoveContents implements Command {
  readonly keepsReading = true;
  private readonly levels: SetContentsLevels;
  private previous: {
    pages: Page[];
    chapters: ReturnType<typeof snapshotChapters>;
  } | null = null;

  constructor(
    private readonly drop: ContentsDrop,
    readonly label: string,
  ) {
    this.levels = new SetContentsLevels(drop.levels, label);
  }

  apply(doc: InkDocument): void {
    this.previous = { pages: doc.pages.slice(), chapters: snapshotChapters(doc.pages) };
    this.levels.apply(doc);
    const items = this.drop.items;
    if (!items) return;
    doc.pages.splice(0, doc.pages.length, ...items.filter((item) => typeof item !== "string"));
    placeChapters(doc.pages, items);
  }

  invert(doc: InkDocument): void {
    if (!this.previous) return;
    doc.pages.splice(0, doc.pages.length, ...this.previous.pages);
    restoreChapters(this.previous.chapters);
    this.levels.invert(doc);
    this.previous = null;
  }
}
