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

/** An answer the writer gave about a word (corrections.json): what it is, and its strokes. */
export interface WordAnswer {
  kind: "misread" | "mistake" | "ignore";
  text: string;
  ids: readonly string[];
}

/**
 * The line's words with the writer's answers applied. A word whose strokes
 * are mostly an answered word's takes that answer: "misread" gives its text
 * (Grape read it wrong; the writer said what it is); "mistake" and "ignore"
 * mean the word is as written though not in the word list, so it counts as
 * `listed`. Either way it is `known`: the writer has said what it is (so
 * Beautify writes it, and does not ask again). A word whose strokes are mostly one of
 * `confirmed` (ink the writer just answered about, when Beautify asked) is
 * `known` whatever the answer: they have said what it is.
 */
export function applyAnswers(
  words: readonly string[],
  ink: readonly (readonly string[])[],
  answers: readonly WordAnswer[],
  confirmed: readonly (readonly string[])[] = [],
): { words: string[]; known: Set<number>; listed: Set<string> } {
  const out = [...words];
  const known = new Set<number>();
  const listed = new Set<string>();
  const mostly = (ids: readonly string[], of: readonly string[]): boolean => {
    const theirs = new Set(of);
    const shared = ids.filter((id) => theirs.has(id)).length;
    return shared * 2 > Math.max(ids.length, theirs.size);
  };
  ink.forEach((ids, i) => {
    if (ids.length === 0) return;
    for (const answer of answers) {
      if (!mostly(ids, answer.ids)) continue;
      if (answer.kind === "misread") {
        if (/\s/.test(answer.text.trim()) || !answer.text.trim()) continue;
        out[i] = answer.text.trim();
      } else listed.add(wordCore(out[i]).toLowerCase());
      // Any answer says what the word is: Beautify writes it and does not ask about it again.
      known.add(i);
      break;
    }
    if (confirmed.some((of) => mostly(ids, of))) known.add(i);
  });
  return { words: out, known, listed };
}

/**
 * The words of a line Beautify would leave as written because Grape is not
 * sure of them, as their ink: the ones it can ask the writer about (a word
 * with a letter or digit, not rewritten).
 */
export function unsureWords(line: {
  words: readonly string[];
  ink: readonly (readonly string[])[];
  rewrite: readonly boolean[];
}): string[][] {
  return line.words.flatMap((w, i) =>
    !line.rewrite[i] && /[\p{L}\p{N}]/u.test(w) && line.ink[i]?.length ? [[...line.ink[i]]] : [],
  );
}

/** A line's words with their strokes and whether each is rewritten. */
export interface LineWords {
  words: string[];
  ink: string[][];
  rewrite: boolean[];
}

interface Part {
  word: string;
  ink: string[];
  rewrite: boolean;
}

/**
 * A word with no letter or digit (a comma Grape read apart, "May , June")
 * joined to the word before it (leading ones join the word after), so the
 * model writes "May," and the page keeps it beside its word instead of a
 * word gap away. The joined word is rewritten only if every part was.
 */
export function joinPunctuation(line: LineWords): LineWords {
  const parts: Part[] = [];
  let lead: Part | null = null;
  line.words.forEach((word, i) => {
    const part: Part = { word, ink: line.ink[i] ?? [], rewrite: line.rewrite[i] ?? false };
    const bare = !/[\p{L}\p{N}]/u.test(word);
    const last = parts[parts.length - 1];
    if (bare && last) {
      parts[parts.length - 1] = join(last, part);
    } else if (bare) {
      lead = lead ? join(lead, part) : part;
    } else {
      parts.push(lead ? join(lead, part) : part);
      lead = null;
    }
  });
  if (lead) parts.push(lead);
  return {
    words: parts.map((p) => p.word),
    ink: parts.map((p) => p.ink),
    rewrite: parts.map((p) => p.rewrite),
  };
}

function join(a: Part, b: Part): Part {
  return { word: a.word + b.word, ink: [...a.ink, ...b.ink], rewrite: a.rewrite && b.rewrite };
}
