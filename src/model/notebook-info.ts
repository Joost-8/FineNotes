/**
 * The facts the gear's Notebook info shows: how many pages, how big the file
 * is, where it lives, and the name a rename may give it. Pure: the view reads
 * the file's stat and does the renaming.
 */

import { inkFileSuffix, sanitizeFileName, stripInkSuffix } from "./new-notebook";
import { baseName, isFolderNotebook, parentPath } from "./folder-notebook";

/** A byte count as people read it: "812 B", "14 KB", "3.4 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}

/** The name a notebook shows as: its file name without the ink suffix. */
export function notebookName(notePath: string): string {
  return stripInkSuffix(baseName(notePath));
}

/** What a rename does: the path to rename (the note, or its own folder) and to what. */
export interface RenamePlan {
  from: string;
  to: string;
}

/**
 * Renaming the notebook at `notePath` to `name`, or `undefined` when there
 * is nothing to do (no usable name, or the same one). A notebook with a
 * folder of its own renames the folder; the notebook follows it
 * (`followPairRename`), so the two keep one name.
 */
export function renamePlan(notePath: string, name: string): RenamePlan | undefined {
  const clean = sanitizeFileName(name);
  const suffix = inkFileSuffix(baseName(notePath));
  if (!clean || !suffix || clean === notebookName(notePath)) return undefined;
  if (isFolderNotebook(notePath)) {
    const folder = parentPath(notePath);
    const above = parentPath(folder);
    return { from: folder, to: above ? `${above}/${clean}` : clean };
  }
  const dir = parentPath(notePath);
  return { from: notePath, to: `${dir ? `${dir}/` : ""}${clean}${suffix}` };
}
