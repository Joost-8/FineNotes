/**
 * A notebook with a folder of its own: `Physics/Physics.notebook.md`, beside
 * `Physics/Images/`, `Recordings/` and the rest (`notebookPaths`). The file
 * explorer shows that folder as the notebook: the notebook file is not listed
 * inside it, a tap on the folder's name opens the notebook, and its arrow
 * still shows the files. Renaming either one renames the other, so they stay
 * a pair.
 *
 * Pure: the view supplies names and paths and does the renaming.
 */

import {
  OWN_FOLDER_AUDIO,
  OWN_FOLDER_CHATS,
  OWN_FOLDER_EXPORTS,
  OWN_FOLDER_IMAGES,
  OWN_FOLDER_TRANSCRIPTS,
  inkFileSuffix,
  stripInkSuffix,
} from "./new-notebook";

/** One entry of a folder: its name and whether it is a folder. */
export interface FolderEntry {
  name: string;
  folder: boolean;
}

/** The last segment of a vault path. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The folder part of a vault path ("" for the root). */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * The name of the notebook a folder called `folderName` is the folder of, or
 * `undefined`: the file among `entries` named after the folder with an ink
 * suffix (`.notebook.md`, then `.page.md`, then the legacy `.ink.md`).
 * Compared case-insensitively, as the file systems a vault syncs to are.
 */
export function folderNotebookName(
  folderName: string,
  entries: readonly FolderEntry[],
): string | undefined {
  const want = folderName.toLowerCase();
  if (!want) return undefined;
  let best: { name: string; rank: number } | undefined;
  for (const { name, folder } of entries) {
    if (folder) continue;
    const suffix = inkFileSuffix(name);
    if (!suffix || name.slice(0, -suffix.length).toLowerCase() !== want) continue;
    const rank = [".notebook.md", ".page.md"].indexOf(suffix);
    const score = rank < 0 ? 2 : rank;
    if (!best || score < best.rank) best = { name, rank: score };
  }
  return best?.name;
}

/** Whether the note at `notePath` is its folder's notebook: `X/X.notebook.md`. */
export function isFolderNotebook(notePath: string): boolean {
  const name = baseName(notePath);
  if (!inkFileSuffix(name)) return false;
  const folder = baseName(parentPath(notePath));
  return folder !== "" && stripInkSuffix(name).toLowerCase() === folder.toLowerCase();
}

/** Obsidian icon names for a notebook and for the folders inside one. */
export const NOTEBOOK_ICON = "notebook";
const OWN_FOLDER_ICONS: Readonly<Record<string, string>> = {
  [OWN_FOLDER_IMAGES.toLowerCase()]: "image",
  [OWN_FOLDER_AUDIO.toLowerCase()]: "mic",
  [OWN_FOLDER_TRANSCRIPTS.toLowerCase()]: "file-text",
  [OWN_FOLDER_CHATS.toLowerCase()]: "message-square",
  [OWN_FOLDER_EXPORTS.toLowerCase()]: "file-output",
};

/** The icon for a folder inside a notebook's folder, or `undefined` for one of the user's own. */
export function ownFolderIcon(name: string): string | undefined {
  const key = name.toLowerCase();
  return Object.prototype.hasOwnProperty.call(OWN_FOLDER_ICONS, key)
    ? OWN_FOLDER_ICONS[key]
    : undefined;
}

/** A rename to make so a notebook and its folder keep one name. */
export interface PairRename {
  from: string;
  to: string;
}

/**
 * What else to rename after `oldPath` became `newPath`, so a folder notebook
 * and its folder keep one name. `entries` are what the renamed thing's folder
 * holds now (for a renamed folder: its own entries).
 *
 * - A folder renamed whose notebook still has the old name: rename the
 *   notebook after it. `Physics/` -> `Mechanics/` gives
 *   `Mechanics/Physics.notebook.md` -> `Mechanics/Mechanics.notebook.md`.
 * - Its notebook renamed in place, from its folder's name to another: rename
 *   the folder after it. `Physics/Physics.notebook.md` ->
 *   `Physics/Mechanics.notebook.md` gives `Physics/` -> `Mechanics/`.
 *
 * Nothing when the name is taken, when only the case changed, for a move to
 * another folder (the pair moves together, or the user split it on purpose),
 * or for the renames this itself causes, which already agree.
 */
export function followPairRename(
  oldPath: string,
  newPath: string,
  isFolder: boolean,
  entries: readonly FolderEntry[],
): PairRename | undefined {
  const oldName = baseName(oldPath);
  const newName = baseName(newPath);
  const taken = (name: string) =>
    entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (isFolder) {
    if (oldName.toLowerCase() === newName.toLowerCase()) return undefined;
    const note = folderNotebookName(oldName, entries);
    if (!note) return undefined;
    const suffix = inkFileSuffix(note) ?? "";
    const renamed = `${newName}${suffix}`;
    if (taken(renamed)) return undefined;
    return { from: `${newPath}/${note}`, to: `${newPath}/${renamed}` };
  }
  // A move, not a rename: the pair is the user's to keep or split.
  if (parentPath(oldPath) !== parentPath(newPath)) return undefined;
  const oldSuffix = inkFileSuffix(oldName);
  const newSuffix = inkFileSuffix(newName);
  if (!oldSuffix || !newSuffix) return undefined;
  const folder = parentPath(newPath);
  const folderName = baseName(folder);
  const oldBase = oldName.slice(0, -oldSuffix.length);
  const newBase = newName.slice(0, -newSuffix.length);
  if (!folderName || oldBase.toLowerCase() !== folderName.toLowerCase()) return undefined;
  if (newBase.toLowerCase() === folderName.toLowerCase() || !newBase) return undefined;
  const target = `${parentPath(folder) ? `${parentPath(folder)}/` : ""}${newBase}`;
  return { from: folder, to: target };
}
