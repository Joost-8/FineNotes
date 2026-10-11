/**
 * What the "Link to…" picker offers for what has been typed (FineNotes#20):
 * a web address when it looks like one, notes whose name or path holds the
 * words, a note's headings after a `#`, and the typed text itself as a link
 * to a note that does not exist yet, as Obsidian lets a wikilink do.
 *
 * PURE: no DOM, no Obsidian. The view hands in the vault's notes.
 */

import { isExternalTarget } from "../model/links";

/** A note in the vault, as the picker needs it. */
export interface LinkableNote {
  /** Vault path, for showing where it is. */
  path: string;
  /** Its name without the extension. */
  basename: string;
  /** What a link to it from this notebook is written as (`fileToLinktext`). */
  linktext: string;
  headings: readonly string[];
}

export type LinkChoice =
  | { kind: "url"; target: string }
  | { kind: "note"; target: string; note: LinkableNote }
  | { kind: "heading"; target: string; note: LinkableNote; heading: string }
  | { kind: "new"; target: string };

/** At most this many notes or headings are listed. */
export const LINK_CHOICE_LIMIT = 50;

/**
 * The choices for `query`, best first. An empty query lists notes in the
 * order given (the view passes the most recently changed first).
 */
export function linkChoices(query: string, notes: readonly LinkableNote[]): LinkChoice[] {
  const typed = query.trim();
  const out: LinkChoice[] = [];
  if (typed !== "" && isExternalTarget(typed)) return [{ kind: "url", target: typed }];
  const hash = typed.indexOf("#");
  if (hash >= 0) {
    const notePart = typed.slice(0, hash).trim().toLowerCase();
    const headingPart = typed
      .slice(hash + 1)
      .trim()
      .toLowerCase();
    for (const note of ranked(notePart, notes)) {
      for (const heading of note.headings) {
        if (!heading.toLowerCase().includes(headingPart)) continue;
        out.push({ kind: "heading", target: `${note.linktext}#${heading}`, note, heading });
        if (out.length >= LINK_CHOICE_LIMIT) break;
      }
      if (out.length >= LINK_CHOICE_LIMIT) break;
    }
  } else {
    for (const note of ranked(typed.toLowerCase(), notes).slice(0, LINK_CHOICE_LIMIT)) {
      out.push({ kind: "note", target: note.linktext, note });
    }
  }
  // The typed text as a link of its own, unless it names a note exactly.
  const exact = out.some((c) => c.target.toLowerCase() === typed.toLowerCase());
  if (typed !== "" && !exact) out.push({ kind: "new", target: typed });
  return out;
}

/**
 * Notes whose name or path holds `words`: a name starting with them first,
 * then a name holding them, then a path holding them; in the given order
 * within each.
 */
function ranked(words: string, notes: readonly LinkableNote[]): LinkableNote[] {
  if (words === "") return [...notes];
  const starts: LinkableNote[] = [];
  const names: LinkableNote[] = [];
  const paths: LinkableNote[] = [];
  for (const note of notes) {
    const name = note.basename.toLowerCase();
    if (name.startsWith(words)) starts.push(note);
    else if (name.includes(words)) names.push(note);
    else if (note.path.toLowerCase().includes(words)) paths.push(note);
  }
  return [...starts, ...names, ...paths];
}
