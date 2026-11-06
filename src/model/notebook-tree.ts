/**
 * The notebooks of a vault as a tree of folders, for the Notebooks view in
 * Obsidian's sidebar: only folders that hold a notebook, at any depth, and a
 * notebook in a folder of its own (`X/X.notebook.md` beside its `Images/`,
 * `Recordings/`…) shown as the notebook, in the folder above.
 */

import { baseName, isFolderNotebook, parentPath } from "./folder-notebook";
import { stripInkSuffix } from "./new-notebook";

export interface TreeNotebook {
  path: string;
  title: string;
}

export interface TreeFolder {
  /** "" for the vault's root. */
  path: string;
  name: string;
  folders: TreeFolder[];
  notebooks: TreeNotebook[];
  /** Notebooks in it and below it. */
  count: number;
}

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The tree of the notebooks at `paths` (vault paths of ink files). */
export function notebookTree(paths: readonly string[]): TreeFolder {
  // How many notebooks each folder holds, at any depth.
  const held = new Map<string, number>();
  for (const path of paths) {
    for (let at = parentPath(path); at !== ""; at = parentPath(at))
      held.set(at, (held.get(at) ?? 0) + 1);
  }
  const root: TreeFolder = { path: "", name: "", folders: [], notebooks: [], count: 0 };
  const folders = new Map<string, TreeFolder>([["", root]]);
  const folderAt = (path: string): TreeFolder => {
    const known = folders.get(path);
    if (known) return known;
    const made: TreeFolder = {
      path,
      name: baseName(path),
      folders: [],
      notebooks: [],
      count: 0,
    };
    folders.set(path, made);
    folderAt(parentPath(path)).folders.push(made);
    return made;
  };
  for (const path of paths) {
    const own = parentPath(path);
    // A notebook alone in a folder named after it is that folder.
    const shownIn = isFolderNotebook(path) && held.get(own) === 1 ? parentPath(own) : own;
    folderAt(shownIn).notebooks.push({ path, title: stripInkSuffix(baseName(path)) });
    for (let at: string | null = shownIn; at !== null; at = at === "" ? null : parentPath(at)) {
      const folder = folders.get(at);
      if (folder) folder.count++;
    }
  }
  const order = (folder: TreeFolder): void => {
    folder.folders.sort((a, b) => byName(a.name, b.name));
    folder.notebooks.sort((a, b) => byName(a.title, b.title));
    folder.folders.forEach(order);
  };
  order(root);
  return root;
}
