/**
 * What a press menu's Paste pastes, and where. Pure: the surface reads the
 * clipboards and places the result.
 *
 * Two clipboards meet here. The plugin's own (`model/clipboard.ts`) holds
 * ink, text boxes and pictures copied with the lasso; the system's holds
 * whatever another app, or Obsidian itself, copied last: a picture, or text.
 *
 * - The plugin's clipboard answers first while the app has not been left
 *   since it was filled: nothing newer can be on the system clipboard, and
 *   the system's is not touched at all (on iPad, reading it shows the
 *   system's Paste bubble).
 * - Otherwise the system clipboard is read, and a picture on it wins, then
 *   text (pasted as a text box). Where it holds neither, or cannot be read,
 *   the plugin's clipboard is pasted after all.
 */

/** Whether the plugin's own clipboard is pasted without reading the system's. */
export function inkFirst(canPasteInk: boolean, leftSinceCopy: boolean): boolean {
  return canPasteInk && !leftSinceCopy;
}

/** A clipboard item's type worth pasting: a picture, else text. */
export type ClipboardPick = { kind: "image"; type: string } | { kind: "text"; type: string };

/** Pictures a page can show, in the order they are preferred when an item offers several. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

/**
 * The type to read from a clipboard item offering `types`: a picture, else
 * plain text; `null` when it offers neither (HTML alone, a file list, a type
 * of another app's own). The usual web formats are preferred; any other
 * picture type (a HEIC photo, a TIFF) is taken too, since importing decodes
 * and re-encodes it, and says so itself where this device cannot
 * (discussion #112).
 */
export function pickClipboardType(types: readonly string[]): ClipboardPick | null {
  const lower = types.map((type) => type.toLowerCase());
  for (const type of IMAGE_TYPES) if (lower.includes(type)) return { kind: "image", type };
  const other = lower.find((type) => type.startsWith("image/"));
  if (other) return { kind: "image", type: other };
  if (lower.includes("text/plain")) return { kind: "text", type: "text/plain" };
  return null;
}

/**
 * Whether a clipboard that held items of `typesPerItem`, none of them
 * pasteable, held something this engine would not show the page. iPad
 * WebKit hands over a photo copied in Photos as an item with no types at
 * all (WebKit bug 229377), so the press menu's Paste found "nothing" where
 * the user had just copied a picture (discussion #112).
 */
export function clipboardHidSomething(typesPerItem: readonly (readonly string[])[]): boolean {
  return typesPerItem.some((types) => types.length === 0);
}

/** File name endings of pictures, for a pasted file that came without a type. */
const PICTURE_NAME = /\.(png|jpe?g|gif|webp|svg|heic|heif|avif|bmp|tiff?)$/i;

/**
 * Whether a file a paste carries is a picture: its type says so, or it has
 * no type and its name ends like one (iOS hands some photos over untyped).
 */
export function isPictureFile(type: string, name: string): boolean {
  if (type) return type.toLowerCase().startsWith("image/");
  return PICTURE_NAME.test(name);
}

/**
 * Text as a pasted text box holds it: line breaks made `\n`, tabs kept as
 * spaces the box can wrap, and blank lines and spaces at either end gone.
 * Empty when nothing is left.
 */
export function cleanPastedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Least room a pasted text box keeps to its right, page px, so it does not wrap a word a line. */
export const PASTED_TEXT_ROOM = 240;

/**
 * The page-local spot a pasted text box starts at, for a press at `at`: the
 * press itself, moved left where the page's right edge would leave the box
 * less than {@link PASTED_TEXT_ROOM}, and kept on the page.
 */
export function pastedTextOrigin(
  at: { x: number; y: number },
  page: { width: number; height: number },
): { x: number; y: number } {
  const room = Math.min(PASTED_TEXT_ROOM, page.width);
  return {
    x: Math.max(0, Math.min(at.x, page.width - room)),
    y: Math.max(0, Math.min(at.y, page.height)),
  };
}
