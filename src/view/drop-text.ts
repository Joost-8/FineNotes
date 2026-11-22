/**
 * Text dropped on a page (discussion #288): paragraphs dragged from another
 * app, such as Zotero beside Obsidian in Split View, become a text box where
 * they land. Pure: the view reads the drop and the surface places the box.
 *
 * A drop is text only when nothing else claims it: a PDF or picture, a drag
 * from Obsidian's own file list and a link to a vault file keep their own
 * handling (`ink-view.ts`'s `handleFileDrop`), which runs first. Another
 * file is not text either; but a native app may offer its text as a file
 * too, so while `Files` is among the types, only prose counts (unproven on
 * the iPad: the debug HUD's drop line shows the types).
 */
import { cleanPastedText } from "./paste-choice";

/** What a drop carries, as the view reads it from its `DataTransfer`. */
export interface DroppedData {
  /** `DataTransfer.types`. */
  types: readonly string[];
  /** `getData("text/plain")`, empty when there is none. */
  plain: string;
  /** `getData("text/html")`, empty when there is none. */
  html: string;
  /** The drop is Obsidian's own drag (a file, a link) or its text links to a vault file. */
  vaultFile: boolean;
}

/**
 * The text a drop makes a text box of, cleaned as a paste is
 * (`cleanPastedText`): its plain text, else its HTML reduced to text. Empty
 * when the drop is a vault file, a file whose text is only its name or
 * address, or carries no text.
 */
export function droppedText(drop: DroppedData): string {
  if (drop.vaultFile) return "";
  const plain = cleanPastedText(drop.plain);
  const text = plain.trim() ? plain : cleanPastedText(htmlToText(drop.html));
  if (!text.trim()) return "";
  if (drop.types.includes("Files") && !isProse(text)) return "";
  return text;
}

/**
 * Whether text reads as words rather than a file's name or address: more
 * than one word, and not a single line ending in a file extension or
 * starting with a scheme.
 */
export function isProse(text: string): boolean {
  const t = text.trim();
  if (!/\s/.test(t)) return false;
  if (t.includes("\n")) return true;
  return !/\.[a-z0-9]{1,5}$/i.test(t) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t);
}

/** Types a page takes a drop of: files, text, and links. */
const TAKEN_TYPES = ["Files", "text/plain", "text/html", "text/uri-list"];

/** Whether a drag offering `types` may drop on a page. */
export function takesDrag(types: readonly string[]): boolean {
  return types.some((type) => TAKEN_TYPES.includes(type));
}

/**
 * The `dropEffect` a page sets while a drag from outside Obsidian is over
 * it: `copy`, where the drag allows a copy; else `null`, leaving it be.
 * Obsidian's mobile drag manager sets `move` on every drag over the
 * window whose effect is still `none`, and the browser refuses a drop
 * whose effect the drag does not allow, so a drag offering only a copy
 * (text from another app) never dropped (discussion #288, found in the
 * real-Obsidian rig with `mobile on`).
 */
export function outsideDropEffect(effectAllowed: string): "copy" | null {
  const allowed = effectAllowed.toLowerCase();
  return allowed === "uninitialized" || allowed === "all" || allowed.startsWith("copy")
    ? "copy"
    : null;
}

/** Elements whose content is never text the reader sees. */
const HIDDEN = /<(script|style|head|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Elements that end a line where they close. A list item starts its own line instead. */
const BLOCK_END =
  /<\/(p|div|h[1-6]|dt|dd|tr|blockquote|pre|section|article|header|footer|figure|figcaption|table|ul|ol|dl|caption)\s*>/gi;
/** Elements that also start a line where they open: with their end, a blank line around them. */
const BLOCK_START = /<(p|h[1-6]|blockquote|pre|table|ul|ol|dl)\b[^>]*>/gi;

/**
 * HTML as the text a reader sees in it: tags gone, whitespace collapsed as
 * a browser collapses it, a line break for each `<br>` and block, a list
 * item as `- `, table cells apart, and character references decoded.
 * Not a full HTML parser: enough for what apps put on a drag.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(HIDDEN, "")
    // Whitespace in the source is not text: a run of it is one space.
    .replace(/\s+/g, " ")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)\s*>/gi, "\t")
    .replace(BLOCK_END, "\n")
    .replace(BLOCK_START, "\n")
    .replace(/<[^>]*>/g, "");
  text = decodeEntities(text);
  return text
    .split("\n")
    .map((line) => line.replace(/^ +| +$/g, "").replace(/\t+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Named character references apps commonly write; others are left as written. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  shy: "",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const hex = name[1] === "x" || name[1] === "X";
      const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      // A reference to no character (0, a surrogate, past U+10FFFF) stays as written.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return code === 0xa0 ? " " : String.fromCodePoint(code);
    }
    const lower = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED, lower) ? NAMED[lower] : whole;
  });
}
