/**
 * Home's folder rail, the pure part: which folders it lists, how deep, and
 * how many items each holds; and when two taps on a cover are a double tap.
 *
 * The rail lists every folder that holds an item (as `browse` counts them,
 * so the numbers agree with the folder tiles), at the root and down the path
 * to the folder open now, plus that folder's own subfolders. A folder off
 * that path stays folded: the rail is where you are and the ways out of it,
 * not the whole vault at once.
 */

import { type LibraryEntry, browse } from "./library";

export interface RailFolder {
  path: string;
  name: string;
  /** Items in it and in its subfolders. */
  count: number;
  /** 0 for a folder at the vault's root. */
  depth: number;
  /** It is the folder open now. */
  current: boolean;
  /** It holds subfolders, shown or not. */
  hasChildren: boolean;
}

/**
 * The rail's rows, in order: each folder is followed by its subfolders when
 * it lies on the path to `open` (or is `open` itself). `extra` adds folders
 * that hold no item but should still be listed (made in the library).
 */
export function railFolders(
  entries: readonly LibraryEntry[],
  open: string,
  extra: readonly string[] = [],
): RailFolder[] {
  const rows: RailFolder[] = [];
  const onPath = (path: string): boolean => open === path || open.startsWith(`${path}/`);
  const walk = (folder: string, depth: number): void => {
    const listing = browse(entries, folder);
    const prefix = folder === "" ? "" : `${folder}/`;
    const names = new Map(listing.folders.map((f) => [f.path, f.count]));
    for (const path of extra) {
      if (!path.startsWith(prefix) || path === folder) continue;
      const child = path.slice(prefix.length).split("/")[0] ?? "";
      if (child !== "" && !names.has(`${prefix}${child}`)) names.set(`${prefix}${child}`, 0);
    }
    const sorted = [...names].sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
    for (const [path, count] of sorted) {
      const inside =
        browse(entries, path).folders.length > 0 || extra.some((e) => e.startsWith(`${path}/`));
      rows.push({
        path,
        name: path.slice(prefix.length),
        count,
        depth,
        current: path === open,
        hasChildren: inside,
      });
      if (onPath(path)) walk(path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** The longest gap between the two taps of a double tap, ms (iOS uses about 350). */
export const DOUBLE_TAP_MS = 350;

export interface Tap {
  key: string;
  at: number;
}

/** Whether a tap on `key` at `at` completes a double tap begun by `last`. */
export function isDoubleTap(last: Tap | null, key: string, at: number): boolean {
  return last !== null && last.key === key && at - last.at >= 0 && at - last.at <= DOUBLE_TAP_MS;
}
