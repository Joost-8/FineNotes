/**
 * The vault PDF picker's list (view/pdf-import-modal.ts): the vault's folders
 * to browse, with the PDFs in them to tap, as Obsidian's file list shows
 * them; typing searches every PDF instead.
 *
 * Only folders that hold a PDF somewhere below them are listed: a folder
 * with none is a dead end here. Pure: it takes the vault's PDF paths.
 */

export interface PickerFolder {
  name: string;
  path: string;
  /** PDFs in it and in every folder below it. */
  count: number;
}

export interface PickerPdf {
  path: string;
  /** The file name without `.pdf`. */
  name: string;
  /** The folder it is in ("" for the vault's root). */
  folder: string;
}

export interface PickerListing {
  /** The folder above (`""` is the root); `null` at the root itself. */
  up: string | null;
  folders: PickerFolder[];
  pdfs: PickerPdf[];
}

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** `path` as the picker shows it. */
export function pickerPdf(path: string): PickerPdf {
  const slash = path.lastIndexOf("/");
  const file = slash < 0 ? path : path.slice(slash + 1);
  return {
    path,
    name: file.replace(/\.pdf$/i, ""),
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
 * What `folder` shows: the folders directly in it that lead to a PDF (with
 * how many each holds), then the PDFs directly in it, both A to Z as the
 * file list sorts them. A folder that no longer leads to any PDF shows as
 * empty; the caller goes back to the root then.
 */
export function browsePdfs(paths: readonly string[], folder: string): PickerListing {
  const prefix = folder === "" ? "" : `${folder}/`;
  const counts = new Map<string, number>();
  const pdfs: PickerPdf[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) pdfs.push(pickerPdf(path));
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
    pdfs: pdfs.sort((a, b) => byName(a.name, b.name)),
  };
}

/** Lower case, accents dropped: "Résumé" is found by "resume". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Every PDF whose path holds each word typed, best first: a name that
 * starts with what was typed, then a name that holds every word, then one
 * found through its folders; A to Z within each.
 */
export function searchPdfs(paths: readonly string[], query: string): PickerPdf[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const whole = fold(query.trim());
  const ranked: Array<{ pdf: PickerPdf; rank: number }> = [];
  for (const path of paths) {
    const folded = fold(path);
    if (!words.every((word) => folded.includes(word))) continue;
    const pdf = pickerPdf(path);
    const name = fold(pdf.name);
    const rank = name.startsWith(whole) ? 0 : words.every((word) => name.includes(word)) ? 1 : 2;
    ranked.push({ pdf, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank || byName(a.pdf.name, b.pdf.name)).map((r) => r.pdf);
}
