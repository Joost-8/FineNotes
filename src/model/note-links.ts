/**
 * Links and tags in a text note's typed text, found as Obsidian finds them:
 * `[[Note]]`, `[[Note|shown text]]`, `[[Note#Heading]]`, and `#tag`. PURE.
 *
 * The page draws them as links while you type (`note-editor.ts`); the
 * Markdown on disk is unchanged, so Obsidian's own links, backlinks and tag
 * pane see them as in any note.
 */

export interface TextMark {
  readonly kind: "link" | "tag";
  /** Character offsets in the line, end exclusive. */
  readonly from: number;
  readonly to: number;
  /** A link's target (without its `|text` or `#heading`), or a tag's name with its `#`. */
  readonly target: string;
}

const LINK = /\[\[([^[\]\n|]+?)(?:\|[^[\]\n]*)?\]\]/g;
/** A tag: `#` after a space or the line's start, then letters, digits, `_`, `-`, `/`; not all digits. */
const TAG = /(^|[\s(])(#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** The links and tags in a line of text, in order; a tag inside a link is the link's. */
export function findMarks(text: string): TextMark[] {
  const out: TextMark[] = [];
  for (const match of text.matchAll(LINK)) {
    const from = match.index ?? 0;
    const target = match[1].split("#")[0].trim() || match[1].trim();
    out.push({ kind: "link", from, to: from + match[0].length, target });
  }
  for (const match of text.matchAll(TAG)) {
    const from = (match.index ?? 0) + match[1].length;
    const to = from + match[2].length;
    if (out.some((m) => m.kind === "link" && from < m.to && to > m.from)) continue;
    out.push({ kind: "tag", from, to, target: match[2] });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** A short key for a line's marks: the page redraws a line only when it changes. */
export function marksKey(marks: readonly TextMark[]): string {
  return marks.map((m) => `${m.kind[0]}${m.from}-${m.to}`).join(",");
}

/**
 * The link being typed before the caret: `[[` and what follows it, up to the
 * caret, with no `]]` yet. Its start offset (at the `[[`) and the query.
 */
export function openLinkAt(text: string, caret: number): { from: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("[[");
  if (at < 0) return null;
  const query = before.slice(at + 2);
  if (/[\]\n|]/.test(query) || query.length > 80) return null;
  return { from: at, query };
}

/**
 * The names that best match a query: those that start with it first, then
 * those with a word that does, then any that contain it; shorter first within
 * each. At most `limit`.
 */
export function rankNames(names: readonly string[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase();
  const scored: Array<{ name: string; rank: number }> = [];
  for (const name of names) {
    const low = name.toLowerCase();
    let rank: number;
    if (q === "") rank = 3;
    else if (low.startsWith(q)) rank = 0;
    else if (low.split(/[\s\-_./]+/).some((word) => word.startsWith(q))) rank = 1;
    else if (low.includes(q)) rank = 2;
    else continue;
    scored.push({ name, rank });
  }
  scored.sort(
    (a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name),
  );
  return scored.slice(0, limit).map((s) => s.name);
}
