/**
 * Handwritten `[[links]]` (FineNotes#20): words read on the device that
 * open with `[[` and, on the same line, close with `]]` are a link the
 * writer meant. They are only ever offered: the view underlines them dashed,
 * and a tap opens Link to… with the name filled in, to confirm. The
 * recogniser reads brackets less surely than letters, so a miss is a link
 * not offered, and a false find costs one dismissed suggestion.
 *
 * PURE: no DOM, no Obsidian.
 */

/** One word as read, and the strokes it was written with. */
export interface ReadWord {
  /** The text as read; the bracket test uses either reading. */
  text: string;
  /** The letters as written, without the language model (it rarely keeps brackets). */
  greedy?: string;
  strokeIds: string[];
}

/** A link written by hand: where it leads and the strokes that wrote it, brackets included. */
export interface HandwrittenLink {
  target: string;
  strokeIds: string[];
}

/** Punctuation a sentence puts after a link: `[[Note]],`. */
const AFTER = /[.,;:!?)]+$/;

const opens = (s: string): boolean => s.trim().startsWith("[[");
const closes = (s: string): boolean => s.trim().replace(AFTER, "").endsWith("]]");

/**
 * The links in a line's words, in order. A link runs from a word that opens
 * with `[[` to the first word, from there on, that closes with `]]`; its
 * target is the words between, brackets off, before any `|` (an alias). A
 * link with nothing inside, or one that never closes on its line, is none.
 */
export function findHandwrittenLinks(words: readonly ReadWord[]): HandwrittenLink[] {
  const out: HandwrittenLink[] = [];
  const either = (w: ReadWord, test: (s: string) => boolean): boolean =>
    test(w.text) || (w.greedy !== undefined && test(w.greedy));
  // The reading to take the target from: one that shows the brackets.
  const shown = (w: ReadWord, test: (s: string) => boolean): string =>
    test(w.text) || w.greedy === undefined ? w.text : w.greedy;
  for (let i = 0; i < words.length; i++) {
    if (!either(words[i], opens)) continue;
    let end = -1;
    for (let j = i; j < words.length; j++) {
      if (either(words[j], closes)) {
        end = j;
        break;
      }
    }
    if (end < 0) break;
    const parts = words.slice(i, end + 1).map((w, k, all) => {
      let text = w.text;
      if (k === 0) text = shown(w, opens);
      if (k === all.length - 1) text = shown(k === 0 ? { ...w, text } : w, closes);
      return text;
    });
    const inner = parts
      .join(" ")
      .trim()
      .replace(AFTER, "")
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]
      .replace(/\s+/g, " ")
      .trim();
    if (inner !== "" && !inner.includes("[") && !inner.includes("]")) {
      out.push({ target: inner, strokeIds: words.slice(i, end + 1).flatMap((w) => w.strokeIds) });
    }
    i = end;
  }
  return out;
}
