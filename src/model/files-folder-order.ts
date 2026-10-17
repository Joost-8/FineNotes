/**
 * Keeping a notebook and its files folder together in Obsidian's file
 * explorer. The explorer always lists a folder's subfolders before its files
 * (read from `getSortedFolderItems` in Obsidian 1.14's `app.js`; no sort order
 * changes that), so "Physics files/" would sit at the top with the other
 * folders, far from "Physics.notebook.md". This reorders one folder's sorted
 * list so each files folder comes straight after its notebook.
 *
 * Pure: the view hands in the explorer's items and how to read them.
 */

import { FILES_FOLDER_SUFFIX, inkFileSuffix } from "./new-notebook";

/** What the reordering needs to know about one explorer item. */
export interface ExplorerEntry {
  name: string;
  folder: boolean;
}

/**
 * `items` (one folder's children, already sorted) with every files folder
 * moved to just after the notebook it belongs to: "Physics files" after
 * "Physics.notebook.md" (or `.page.md`, or the legacy `.ink.md`). Names are
 * compared case-insensitively, as the file systems a vault syncs to compare
 * them. A files folder whose notebook is not there stays where it was; so do
 * all other items, in their order.
 */
export function pairFilesFolders<T>(items: readonly T[], entry: (item: T) => ExplorerEntry): T[] {
  const suffix = FILES_FOLDER_SUFFIX.toLowerCase();
  const notebooks = new Set<string>();
  for (const item of items) {
    const { name, folder } = entry(item);
    const ink = folder ? undefined : inkFileSuffix(name);
    if (ink) notebooks.add(name.slice(0, -ink.length).toLowerCase());
  }
  // The files folders that have their notebook here, by the notebook's base name.
  const paired = new Map<string, T>();
  for (const item of items) {
    const { name, folder } = entry(item);
    const lower = name.toLowerCase();
    if (!folder || !lower.endsWith(suffix)) continue;
    const base = lower.slice(0, -suffix.length);
    if (base && notebooks.has(base) && !paired.has(base)) paired.set(base, item);
  }
  if (paired.size === 0) return [...items];
  const moved = new Set(paired.values());
  const out: T[] = [];
  for (const item of items) {
    if (moved.has(item)) continue;
    out.push(item);
    const { name, folder } = entry(item);
    const ink = folder ? undefined : inkFileSuffix(name);
    if (!ink) continue;
    const base = name.slice(0, -ink.length).toLowerCase();
    const files = paired.get(base);
    if (files) {
      out.push(files);
      // A page and a notebook of one name share it: the first one takes it.
      paired.delete(base);
    }
  }
  return out;
}
