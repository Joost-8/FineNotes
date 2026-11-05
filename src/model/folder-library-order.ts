/**
 * How the Folders library lists a folder: notebooks and pages are shown by
 * their title without the ".notebook" or ".page" of their file name, notes
 * sort by creation date, edit date or name, and the grid has as many columns
 * as the width holds. No Obsidian, no DOM.
 */

import type { LibrarySort } from "./folder-sidebar-data";

/** Space between the grid's cards, px. */
export const GRID_GAP = 16;
/** The narrowest a grid card is allowed to get, px. */
export const MIN_CARD_WIDTH = 190;
/** The width assumed before the page has been measured, px. */
export const DEFAULT_LIBRARY_WIDTH = 880;

/** How many grid columns fit in `width` px (at least one). */
export function columnsFor(width: number): number {
  return Math.max(1, Math.floor((width + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP)));
}

/** A file's title: its basename without a ".notebook" or ".page" ending (kept if that is all there is). */
export function noteTitle(basename: string): string {
  return basename.replace(/\.(notebook|page)$/i, "") || basename;
}

/** What the sort needs of a file. */
export interface SortableNote {
  basename: string;
  stat: { ctime: number; mtime: number };
}

/** What the sort needs of a folder. */
export interface SortableFolder {
  name: string;
}

/** Names compared as people read them: "Week 2" before "Week 10", case ignored. */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** The time a note is sorted by: when it was created, or last edited. */
export function sortTime(note: SortableNote, sort: Exclude<LibrarySort, "name">): number {
  return sort === "created" ? note.stat.ctime : note.stat.mtime;
}

/** `notes` in the order the library shows them. The list given is not changed. */
export function sortNotes<T extends SortableNote>(
  notes: readonly T[],
  sort: LibrarySort,
  descending: boolean,
): T[] {
  const direction = descending ? -1 : 1;
  const list = [...notes];
  if (sort === "name") {
    return list.sort(
      (a, b) => direction * compareNames(noteTitle(a.basename), noteTitle(b.basename)),
    );
  }
  return list.sort((a, b) => direction * (sortTime(a, sort) - sortTime(b, sort)));
}

/** `folders` by name. The list given is not changed. */
export function sortFolders<T extends SortableFolder>(folders: readonly T[]): T[] {
  return [...folders].sort((a, b) => compareNames(a.name, b.name));
}

/**
 * The tree's order: folders before files, each by name. Returns a negative
 * number when `a` comes first.
 */
export function compareTreeEntries(
  a: { name: string; isFolder: boolean },
  b: { name: string; isFolder: boolean },
): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
  return compareNames(a.name, b.name);
}

/**
 * The `descending` value of the sort menu's two direction rows, for `sort`:
 * by name they are A to Z (ascending) and Z to A; by date, newest first
 * (descending) and oldest first.
 */
export function directionRows(sort: LibrarySort): { first: boolean; second: boolean } {
  const byName = sort === "name";
  return { first: !byName, second: byName };
}

/** What a new sort sorts by to start with: names ascending, dates newest first. */
export function descendingFor(sort: LibrarySort): boolean {
  return sort !== "name";
}
