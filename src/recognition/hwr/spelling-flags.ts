/**
 * Telling the word card's two questions apart: "Grape may have read this
 * wrong" and "you may have spelt this wrong". Joost, 2026-11-27, on
 * "recive" read as "revive": the card could not say which it was asking.
 *
 * A spelling question, as a spell checker asks it: Grape is sure of the
 * letters (the ink fits the reading clearly better than any list word) and
 * they are not a word, with a list word a letter or two away. Underlined
 * red and wavy; the rest of the underlined words stay doubtful readings.
 *
 * Grape also reads a word outside the list again against the list
 * (`rereadOutOfList`) and keeps the list word when the ink fits it nearly
 * as well, which hides a misspelling ("recive" became "revive"). Those
 * words are NOT underlined: on Joost's Network and Software Specifications
 * notes (6,004 words) the second look changed 563, nearly all Grape's own
 * misreads put right ("coble" ? cable), and underlining them added 598 red
 * marks. The letters before it are kept (`LineReading.asWritten`) for the
 * card: Correct on such a word asks the spelling question about them.
 *
 * Which kind a word is decides its mark and its card, never a label: what
 * the ink says is still only ever the writer's answer (corrections.ts).
 *
 * PURE: no DOM, no Obsidian.
 */

import { offersSpelling } from "./spelling-offer";

/** How many spelling fixes a card shows. */
export const SPELLING_FIXES = 3;

/** What the spelling check needs to know about a word. */
export interface SpellingWord {
  /** The word as Grape shows it. */
  text: string;
  /** The word as the ink shows it, when Grape's second look changed it. */
  wrote?: string;
}

/** List words the ink fits, best first, and how much better the reading fits (nats a letter). */
export interface SpellingSuggestion {
  words: readonly string[];
  margin: number;
}

/**
 * The words a misspelt word may have been meant as, best first, at most
 * {@link SPELLING_FIXES}; empty when it is not a spelling question.
 *
 * - Changed by the second look: what was written is the misspelling, and
 *   the reading is the first fix, then the list words its ink fits.
 * - Read as written: only when the ink fits the reading clearly better than
 *   any list word (`margin` at least `suggestMargin`): else Grape may have
 *   misread it, which is the other question.
 */
export function spellingFixes(
  word: SpellingWord,
  suggestion: SpellingSuggestion | null | undefined,
  listed: (word: string) => boolean,
  english: boolean,
  suggestMargin: number,
): string[] {
  const written = word.wrote ?? word.text;
  const candidates: string[] = [];
  if (word.wrote !== undefined) candidates.push(word.text);
  else if (!suggestion || suggestion.margin < suggestMargin) return [];
  for (const w of suggestion?.words ?? []) candidates.push(w);
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= SPELLING_FIXES) break;
    const fix = withPunctuation(written, c);
    if (out.includes(fix) || !offersSpelling(written, fix, listed, english)) continue;
    out.push(fix);
  }
  return out;
}

/** `word` with the punctuation around `token` ("recive," → "receive,"). */
function withPunctuation(token: string, word: string): string {
  const core = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  const m = /^([^\p{L}]*)[\s\S]*?([^\p{L}]*)$/u.exec(token);
  if (!core || !m) return word;
  return `${m[1]}${core}${m[2]}`;
}
