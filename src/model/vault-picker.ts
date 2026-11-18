/**
 * The vault file pickers' list (view/vault-file-picker.ts: Import PDF and
 * Insert image › From vault): the vault's folders to browse, with the files
 * in them to tap, as Obsidian's file list shows them; typing searches every
 * file instead.
 *
 * Only folders that hold a file of the kind somewhere below them are
 * listed: a folder with none is a dead end here. Pure: it takes the paths
 * of the files the picker offers.
 */

export interface PickerFolder {
  name: string;
  path: string;
  /** Files in it and in every folder below it. */
  count: number;
}

export interface PickerFile {
  path: string;
  /** The file name without its extension. */
  name: string;
  /** The extension, lower case, without the dot ("" for none). */
  ext: string;
  /** The folder it is in ("" for the vault's root). */
  folder: string;
}

export interface PickerListing {
  /** The folder above (`""` is the root); `null` at the root itself. */
  up: string | null;
  folders: PickerFolder[];
  files: PickerFile[];
}

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** `path` as the picker shows it. */
export function pickerFile(path: string): PickerFile {
  const slash = path.lastIndexOf("/");
  const file = slash < 0 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const named = dot > 0;
  return {
    path,
    name: named ? file.slice(0, dot) : file,
    ext: named ? file.slice(dot + 1).toLowerCase() : "",
    folder: slash < 0 ? "" : path.slice(0, slash),
  };
}

/** The folder above `folder`; `null` for the root. */
export function parentFolder(folder: string): string | null {
  if (folder === "") return null;
  const slash = folder.lastIndexOf("/");
  return slash < 0 ? "" : folder.slice(0, slash);
}

/**
 * What `folder` shows: the folders directly in it that lead to a file (with
 * how many each holds), then the files directly in it, both A to Z as the
 * file list sorts them. A folder that no longer leads to any file shows as
 * empty; the caller goes back to the root then.
 */
export function browseFiles(paths: readonly string[], folder: string): PickerListing {
  const prefix = folder === "" ? "" : `${folder}/`;
  const counts = new Map<string, number>();
  const files: PickerFile[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) files.push(pickerFile(path));
    else {
      const name = rest.slice(0, slash);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return {
    up: parentFolder(folder),
    folders: [...counts]
      .map(([name, count]) => ({ name, path: `${prefix}${name}`, count }))
      .sort((a, b) => byName(a.name, b.name)),
    files: files.sort((a, b) => byName(a.name, b.name) || byName(a.ext, b.ext)),
  };
}

/** Lower case, accents dropped: "Résumé" is found by "resume". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Every file whose path holds each word typed, best first: a name that
 * starts with what was typed, then a name that holds every word, then one
 * found through its folders; A to Z within each.
 */
export function searchFiles(paths: readonly string[], query: string): PickerFile[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const whole = fold(query.trim());
  const ranked: Array<{ file: PickerFile; rank: number }> = [];
  for (const path of paths) {
    const folded = fold(path);
    if (!words.every((word) => folded.includes(word))) continue;
    const file = pickerFile(path);
    const name = fold(file.name);
    const rank = name.startsWith(whole) ? 0 : words.every((word) => name.includes(word)) ? 1 : 2;
    ranked.push({ file, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || byName(a.file.name, b.file.name))
    .map((r) => r.file);
}
