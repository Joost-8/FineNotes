/**
 * Vault paths as the Folders sidebar and its library handle them: the root
 * is "" (Obsidian says "/" too), a folder path never ends in a slash, and
 * what the sidebar remembers about a folder (its colour, whether it is open,
 * whether it is pinned) follows the folder when it is renamed, moved or
 * deleted. No Obsidian, no DOM.
 */

/** Whether `path` names the vault's root: "", or "/" as Obsidian spells it. */
export function isRootPath(path: string | null | undefined): boolean {
  return !path || path === "/";
}

/** A folder path in the form the sidebar keeps: "" for the root. */
export function folderKey(path: string | null | undefined): string {
  return isRootPath(path) ? "" : (path ?? "");
}

/** The folder a path is in: "" for a path at the root. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** The last part of a path. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The path of a child called `name` inside the folder `parent` ("" is the root). */
export function childPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** Whether `path` is the folder `folder` or inside it. */
export function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** A name starting with a dot is hidden: never listed. */
export function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

/** Imported notebooks keep their PDFs in a folder called Attachments. */
export function isAttachmentFolderName(name: string): boolean {
  return name.toLowerCase() === "attachments";
}

/** Whether a name contains a character a folder name cannot. */
export function hasPathSeparator(name: string): boolean {
  return name.includes("/") || name.includes("\\");
}

/**
 * Re-key `map` for a rename (`to` is the new path) or a delete (`to` is
 * null): every key that is `from` or inside it moves to the same place under
 * `to`, or goes. Returns whether anything changed.
 */
export function remapKeys<T>(map: Record<string, T>, from: string, to: string | null): boolean {
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key !== from && !key.startsWith(`${from}/`)) continue;
    const value = map[key];
    delete map[key];
    changed = true;
    if (to !== null) map[to + key.slice(from.length)] = value;
  }
  return changed;
}

/**
 * Where `path` is after `from` was renamed to `to`; after `from` was deleted
 * (`to` is null) the folder `from` was in.
 */
export function remapPath(path: string, from: string, to: string | null): string {
  if (path !== from && !path.startsWith(`${from}/`)) return path;
  if (to !== null) return to + path.slice(from.length);
  return parentPath(from);
}

/**
 * `list` after a rename or a delete of `from`: renamed entries follow, entries
 * in a deleted folder go. The list itself is untouched.
 */
export function remapPathList(list: readonly string[], from: string, to: string | null): string[] {
  const out: string[] = [];
  for (const entry of list) {
    if (entry !== from && !entry.startsWith(`${from}/`)) out.push(entry);
    else if (to !== null) out.push(to + entry.slice(from.length));
  }
  return out;
}

/** Whether two lists hold the same entries in the same order. */
export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/**
 * Whether the item at `source` may be moved into the folder `target` ("" is
 * the root): not the root itself, not where it already is, not into itself
 * or into something inside itself.
 */
export function isValidMove(source: string, target: string): boolean {
  const folder = folderKey(target);
  return !(
    isRootPath(source) ||
    parentPath(source) === folder ||
    folder === source ||
    folder.startsWith(`${source}/`)
  );
}

/**
 * Mark every ancestor folder of `path` open in `expanded`. Returns whether
 * anything was newly opened.
 */
export function openAncestors(expanded: Record<string, boolean>, path: string): boolean {
  let changed = false;
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join("/");
    if (expanded[ancestor] !== true) {
      expanded[ancestor] = true;
      changed = true;
    }
  }
  return changed;
}

/**
 * The first free path for a new file in `folder`: `base` + `extension`, then
 * "base 1", "base 2", … : `taken` says whether a path is in use.
 */
export function freePath(
  folder: string,
  base: string,
  extension: string,
  taken: (path: string) => boolean,
): string {
  const prefix = isRootPath(folder) ? "" : `${folder}/`;
  let path = `${prefix}${base}${extension}`;
  for (let n = 1; taken(path); n++) path = `${prefix}${base} ${n}${extension}`;
  return path;
}
