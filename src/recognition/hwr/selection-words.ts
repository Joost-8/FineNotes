/**
 * Lassoed ink as words of its page's reading. "Add to contents" and "Link
 * to…" fill their field with what the selected ink says; read alone, a
 * word loses the line around it ("rationals" came back "Fationals"), so
 * when the selection is whole words of the page's latest reading, their
 * text is used instead, and their kept frames can be checked against the
 * word list (lexicon.ts).
 *
 * PURE: no DOM, no Obsidian.
 */

import { type ReadWord, plainWord } from "./corrections";

/**
 * The read words a selection is made of, in reading order; null when it
 * does not line up with whole words: a word only partly selected, or
 * selected ink the reading put in no word (a line whose words it could not
 * pair). Selected strokes it did not read at all (`read`: every stroke on
 * its lines), such as shapes and highlighter, are ignored.
 */
export function selectionWords(
  words: readonly ReadWord[],
  read: ReadonlySet<string>,
  selected: readonly string[],
): ReadWord[] | null {
  const chosen = new Set(selected);
  const out: ReadWord[] = [];
  const covered = new Set<string>();
  for (const word of words) {
    const inside = word.strokeIds.filter((id) => chosen.has(id)).length;
    if (inside === 0) continue;
    if (inside !== word.strokeIds.length) return null;
    out.push(word);
    for (const id of word.strokeIds) covered.add(id);
  }
  if (out.length === 0) return null;
  for (const id of chosen) if (read.has(id) && !covered.has(id)) return null;
  return out;
}

/**
 * `word` cased like `like`: UPPER when it is upper case (two letters or
 * more), Capitalised when it starts with a capital, else as given.
 */
export function matchCase(like: string, word: string): string {
  const letters = like.replace(/[^\p{L}]/gu, "");
  if (
    letters.length > 1 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  ) {
    return word.toUpperCase();
  }
  const first = letters.charAt(0);
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return word;
}

/** `text` with its first whitespace-separated token equal to `from` replaced by `to`. */
export function replaceToken(text: string, from: string, to: string): string {
  for (const m of text.matchAll(/\S+/g)) {
    if (m[0] === from) return text.slice(0, m.index) + to + text.slice(m.index + from.length);
  }
  return text;
}

/**
 * The words a field's final text corrects: paired with the read words by
 * position (only when it has as many words), a word whose letters changed,
 * other than in case, and stayed close to the reading (at most half the
 * longer word's letters edited). A rename to another word altogether is the
 * writer's choice of title, not a correction of what the ink says.
 */
export function editedWords(
  words: readonly ReadWord[],
  final: string,
): { word: ReadWord; text: string }[] {
  const tokens = final.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== words.length) return [];
  const out: { word: ReadWord; text: string }[] = [];
  words.forEach((word, i) => {
    const was = letters(word.text);
    const now = letters(tokens[i]);
    if (!now || was === now) return;
    if (levenshtein(was, now) > Math.floor(Math.max(was.length, now.length) / 2)) return;
    // Only plain words are labels worth learning (as `flagWords`).
    if (plainWord(tokens[i]) === null) return;
    out.push({ word, text: tokens[i] });
  });
  return out;
}

/** A token's letters, lower case, without the punctuation around them. */
function letters(token: string): string {
  return token
    .normalize("NFC")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
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
