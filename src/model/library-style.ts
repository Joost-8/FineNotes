/**
 * How a folder looks in the library: a colour and an icon the user chose,
 * kept by vault path in the plugin's settings. Also what a rename or a move
 * does to every path the library remembers (stars, folder looks).
 */

export interface FolderStyle {
  color?: string;
  icon?: string;
}

export type FolderStyles = Record<string, FolderStyle>;

/** The folder colours on offer; the first is what an unstyled folder wears. */
export const FOLDER_COLORS: ReadonlyArray<{ id: string; name: string; color: string }> = [
  { id: "sky", name: "Sky", color: "#3fb6d8" },
  { id: "blue", name: "Blue", color: "#4a7df0" },
  { id: "violet", name: "Violet", color: "#8b6cf0" },
  { id: "pink", name: "Pink", color: "#e8629a" },
  { id: "red", name: "Red", color: "#e5534b" },
  { id: "orange", name: "Orange", color: "#f08a3c" },
  { id: "yellow", name: "Yellow", color: "#e8b630" },
  { id: "green", name: "Green", color: "#46b86a" },
  { id: "gray", name: "Gray", color: "#8a929c" },
];

/** The icons on offer (Lucide names); the first is what an unstyled folder wears. */
export const FOLDER_ICONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "graduation-cap", name: "Study" },
  { id: "book-open", name: "Reading" },
  { id: "briefcase", name: "Work" },
  { id: "flask-conical", name: "Science" },
  { id: "calculator", name: "Maths" },
  { id: "code", name: "Code" },
  { id: "palette", name: "Art" },
  { id: "music", name: "Music" },
  { id: "heart", name: "Personal" },
  { id: "house", name: "Home" },
  { id: "plane", name: "Travel" },
  { id: "folder", name: "Plain" },
];

export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS[0].color;
export const DEFAULT_FOLDER_ICON = FOLDER_ICONS[0].id;

/** The saved looks, cleaned: known colours and icons only, nothing empty. */
export function folderStylesOf(raw: unknown): FolderStyles {
  const out: FolderStyles = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [path, value] of Object.entries(raw)) {
    if (path === "" || typeof value !== "object" || value === null) continue;
    const { color, icon } = value as FolderStyle;
    const style: FolderStyle = {};
    if (FOLDER_COLORS.some((c) => c.color === color)) style.color = color;
    if (FOLDER_ICONS.some((i) => i.id === icon)) style.icon = icon;
    if (style.color !== undefined || style.icon !== undefined) out[path] = style;
  }
  return out;
}

/** `styles` with `path` given `change`; a look with nothing left in it is dropped. */
export function withFolderStyle(
  styles: FolderStyles,
  path: string,
  change: FolderStyle,
): FolderStyles {
  const next = { ...styles, [path]: { ...styles[path], ...change } };
  return folderStylesOf(next);
}

/** `path` after `from` became `to`: itself, or what lies below it, moved with it. */
export function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return path;
}

/** Every path in `paths` followed through a rename or a move. */
export function movePaths(paths: readonly string[], from: string, to: string): string[] {
  return paths.map((p) => movedPath(p, from, to));
}

/** The looks followed through a rename or a move. */
export function moveStyles(styles: FolderStyles, from: string, to: string): FolderStyles {
  const out: FolderStyles = {};
  for (const [path, style] of Object.entries(styles)) out[movedPath(path, from, to)] = style;
  return out;
}

/** What a file name cannot hold: both slashes (code 92 is the backslash), and the rest. */
const BAD_NAME_CHARS = `${String.fromCharCode(92)}/:*?"<>|`;

/** A name for a file or folder: the typed text without slashes or edge blanks; "" if nothing is left. */
export function cleanName(raw: string): string {
  let out = "";
  for (const ch of raw) {
    out += ch.charCodeAt(0) < 32 || BAD_NAME_CHARS.includes(ch) ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** `base` + `ext`, or `base 2`, `base 3` … the first that `taken` does not claim. */
export function freeName(base: string, ext: string, taken: (path: string) => boolean): string {
  let name = `${base}${ext}`;
  for (let n = 2; taken(name); n++) name = `${base} ${n}${ext}`;
  return name;
}
