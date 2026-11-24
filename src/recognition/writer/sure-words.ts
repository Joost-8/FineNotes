/**
 * Which words of a line Neaten may rewrite: only those Grape is sure of.
 * Writing a misreading neatly makes it worse than the writer's own ink (the
 * 2026-11-24 demo: Neaten from Grape's reading read no better than the ink
 * it replaced), so a word is rewritten only when
 *
 * - the line's text (with the word list and language model) and the best
 *   path (letters as written) agree on it, letter for letter;
 * - every letter of it was read with at least `minConfidence`, and no other
 *   letter came within `maxRival` for the same ink (`charReadings`);
 * - it is in the word list (`inList`, its letters without the punctuation
 *   around them; a word with no letters, such as a number, passes);
 * - the writer can write every letter of it.
 *
 * A word the writer corrected (`known`) is sure whatever Grape thought. The
 * bars are measured on real copy sheets (research/handwriting-rig/gen/
 * neaten_sure_check.mts).
 *
 * PURE: no DOM, no Obsidian.
 */

import type { CharReading } from "../hwr/char-readings";
import { opcodes } from "./repair";

export interface SureBars {
  /** Lowest probability a letter of a sure word may have been read with. */
  minConfidence: number;
  /**
   * Highest probability another letter may have had for the same ink. 1
   * turns it off: a letter's runner-ups are looked for on its neighbours'
   * frames too, so nearly every word has one (measured: 7 % of words passed
   * at 0.3).
   */
  maxRival: number;
}

/**
 * Measured on the author's two copy sheets (49 lines, 333 words; 2026-11-24),
 * read as the app reads with the word list: with the general Grape, 21 % of
 * words pass and 1.4 % of those are misread (0.95: 25 % and 3.6 %; no
 * confidence bar: 44 % and 12 %); with the Grape that learned his hand, 64 %
 * and 1.9 % (it learned from those sheets, so that flatters it).
 */
export const SURE_BARS: SureBars = { minConfidence: 0.98, maxRival: 1 };

/** A word's letters and digits without the punctuation around it ("May," is "May"). */
export function wordCore(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** The words of a text, as the reader's word ink splits them (runs of non-space). */
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** The words of the greedy text with their letters' readings; null when they do not line up. */
function greedyWords(
  greedy: string,
  chars: readonly CharReading[],
): { word: string; letters: CharReading[] }[] | null {
  if (chars.length !== Array.from(greedy).length) return null;
  const out: { word: string; letters: CharReading[] }[] = [];
  let cur: CharReading[] = [];
  const flush = (): void => {
    if (cur.length) out.push({ word: cur.map((c) => c.char).join(""), letters: cur });
    cur = [];
  };
  for (const c of chars) {
    if (/\s/.test(c.char)) flush();
    else cur.push(c);
  }
  flush();
  return out;
}

/**
 * Per word of `text` (as {@link wordsOf} splits it): whether Neaten may
 * rewrite it. `writable` says whether the writer has a letter; `known`
 * marks words whose text the writer confirmed (by index); `inList` checks
 * a word's core against the word list (null: no list, no check).
 */
export function sureWords(
  text: string,
  greedy: string,
  chars: readonly CharReading[],
  writable: (ch: string) => boolean,
  bars: SureBars = SURE_BARS,
  known: ReadonlySet<number> = new Set(),
  inList: ((word: string) => boolean) | null = null,
): boolean[] {
  const words = wordsOf(text);
  const out = words.map((w, i) => known.has(i) && Array.from(w).every(writable));
  const read = greedyWords(greedy, chars);
  if (!read) return out;
  for (const [tag, a0, a1, b0] of opcodes(
    words,
    read.map((r) => r.word),
  )) {
    if (tag !== "equal") continue;
    for (let i = a0; i < a1; i++) {
      const { letters } = read[b0 + (i - a0)];
      const ok = letters.every(
        (c) =>
          writable(c.char) &&
          c.confidence >= bars.minConfidence &&
          (c.alternatives[0]?.p ?? 0) <= bars.maxRival,
      );
      const core = wordCore(words[i]);
      const listed = !inList || !/\p{L}/u.test(core) || inList(core);
      if (ok && listed) out[i] = true;
    }
  }
  return out;
}
