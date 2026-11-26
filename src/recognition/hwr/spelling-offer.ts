/**
 * When the word card may offer "Should be …" for a word as read: only when
 * the word is very likely a misspelling. Joost's iPad test (2026-11-25)
 * found it offered for words written and read right ("on" → "an",
 * "Tuesday" → "Thursday", "room" → "soon", "B-214", "O(log n)"); on his
 * real pages the first rule ("a close list word that is not the reading")
 * offered it for 240 of 432 words.
 *
 * Offered only for a plain word (letters, 3 or more: corrections.ts
 * `plainWord`) that is not all capitals (an acronym, a code), that its list
 * lacks (and, in English, whose stem the list has with -s, -es, -ed or -ing
 * is not), and whose suggestion is at most two letters' edit away.
 *
 * PURE: no DOM, no Obsidian.
 */

import { plainWord } from "./corrections";

/** Most letter edits between a word as read and the word offered for it. */
export const MAX_SPELLING_EDITS = 2;

const SUFFIXES = ["s", "es", "ed", "d", "ing", "'s", "’s"];

/** Whether `word` (lower case) is an English list word with a common ending: "accepts", "searched". */
function inflected(word: string, listed: (w: string) => boolean): boolean {
  return SUFFIXES.some((end) => word.endsWith(end) && listed(word.slice(0, -end.length)));
}

function edits(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(
        Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Whether the card offers `suggested` as what `read` should be. `listed`:
 * whether a word (lower case) is in the page's list; `english`: the page is
 * English (endings are then checked too).
 */
export function offersSpelling(
  read: string,
  suggested: string | null | undefined,
  listed: (word: string) => boolean,
  english: boolean,
): boolean {
  if (!suggested || suggested === read) return false;
  // Letters, with only ordinary punctuation around them: "Qxz->", "f(x)=" are notation.
  const bare = read.replace(/^[("'“‘]+|[.,;:!?)"'”’]+$/gu, "");
  if (!/^\p{L}+(?:['’-]\p{L}+)*$/u.test(bare)) return false;
  const word = plainWord(read);
  if (!word) return false;
  const letters = read.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return false;
  if (listed(word) || (english && inflected(word, listed))) return false;
  const target = plainWord(suggested);
  if (!target) return false;
  return edits(word, target) <= MAX_SPELLING_EDITS;
}
