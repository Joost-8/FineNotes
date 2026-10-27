/**
 * The vault folders FineNotes keeps its own files in, and the move from the
 * folders it used before 2.6.
 *
 * All in one folder at the vault's root, `FineNotes assets`:
 * - `Templates` (with the My templates papers) and `Stickers`, each a folder
 *   the settings can point elsewhere;
 * - `Handwriting sheets`: the practice sheets FineNotes makes, and the
 *   corrected words (`corrections.json`), which used to live in the
 *   plugin's own folder, where reinstalling the plugin deleted them.
 *
 * A vault still set to an old default moves to the new one: the setting, the
 * folder and every remembered path inside it. Only the defaults move; a
 * folder the user chose stays where it is.
 *
 * PURE: no DOM, no Obsidian.
 */

export const ASSETS_FOLDER = "FineNotes assets";
export const DEFAULT_TEMPLATE_FOLDER = `${ASSETS_FOLDER}/Templates`;
export const DEFAULT_STICKER_FOLDER = `${ASSETS_FOLDER}/Stickers`;
export const HANDWRITING_FOLDER = `${ASSETS_FOLDER}/Handwriting sheets`;

/** The defaults before 2.6, each at the vault's root. */
export const LEGACY_TEMPLATE_FOLDER = "FineNotes templates";
export const LEGACY_STICKER_FOLDER = "FineNotes stickers";

/** The corrected words' file, in the handwriting folder. */
export function correctionsFile(): string {
  return `${HANDWRITING_FOLDER}/corrections.json`;
}

/** Where corrections were kept before 2.6: the plugin's own folder. */
export function legacyCorrectionsFile(pluginDir: string): string {
  return `${trimSlashes(pluginDir)}/handwriting/corrections.json`;
}

/** A folder as set, or `fallback` for a blank or unreadable one; no slashes at the ends. */
export function folderOf(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? trimSlashes(value.trim()) : "";
  return text || fallback;
}

/** The templates folder as set, or the default. */
export function templateFolderOf(value: unknown): string {
  return folderOf(value, DEFAULT_TEMPLATE_FOLDER);
}

/** `path` moved from folder `from` to folder `to`, or null when it is not inside `from`. */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
}

/** A folder to move, from an old default to its new one. */
export interface FolderMove {
  key: "templateFolder" | "stickerFolder";
  from: string;
  to: string;
}

/**
 * The folders set to a default, old or new (blank reads as the default),
 * each with where its old folder goes. Asked on every start, so an old
 * folder that sync brings back later (a device on an older FineNotes) is
 * moved too. A folder the user typed in stays.
 */
export function folderMoves(settings: {
  templateFolder?: unknown;
  stickerFolder?: unknown;
}): FolderMove[] {
  const moves: FolderMove[] = [];
  const defaults = (value: unknown, legacy: string, current: string): boolean => {
    const text = typeof value === "string" ? trimSlashes(value.trim()) : "";
    return text === "" || text === legacy || text === current;
  };
  if (defaults(settings.templateFolder, LEGACY_TEMPLATE_FOLDER, DEFAULT_TEMPLATE_FOLDER)) {
    moves.push({
      key: "templateFolder",
      from: LEGACY_TEMPLATE_FOLDER,
      to: DEFAULT_TEMPLATE_FOLDER,
    });
  }
  if (defaults(settings.stickerFolder, LEGACY_STICKER_FOLDER, DEFAULT_STICKER_FOLDER)) {
    moves.push({ key: "stickerFolder", from: LEGACY_STICKER_FOLDER, to: DEFAULT_STICKER_FOLDER });
  }
  return moves;
}

function trimSlashes(text: string): string {
  return text.replace(/^\/+|\/+$/g, "");
}
