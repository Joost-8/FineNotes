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
import { plainWord } from "../hwr/corrections";
import { isLone } from "./own-ink";
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
      if (ok && listedOrNot(words[i], inList)) out[i] = true;
    }
  }
  return out;
}

/**
 * Whether a word passes the word list: only a word the list could hold is
 * looked up. The list keeps words of three letters or more, letters only
 * (`plainWord`), so "on", "at" and "B-214" are never in it; they were each
 * asked about on Joost's iPad (25 November) for that alone.
 */
function listedOrNot(word: string, inList: ((word: string) => boolean) | null): boolean {
  if (!inList) return true;
  const core = wordCore(word);
  return plainWord(core) === null || inList(core);
}

/**
 * How sure Grape is of each word of `text`, 0 to 1: its least sure letter,
 * halved when the word could be in the word list and is not, and 0 where the
 * text (with the language model) and the letters as written disagree. The
 * least sure words are the ones worth a question.
 */
export function wordSureness(
  text: string,
  greedy: string,
  chars: readonly CharReading[],
  inList: ((word: string) => boolean) | null = null,
): number[] {
  const words = wordsOf(text);
  const out = words.map(() => 0);
  const read = greedyWords(greedy, chars);
  if (!read) return out;
  for (const [tag, a0, a1, b0] of opcodes(
    words,
    read.map((r) => r.word),
  )) {
    if (tag !== "equal") continue;
    for (let i = a0; i < a1; i++) {
      const least = Math.min(...read[b0 + (i - a0)].letters.map((c) => c.confidence));
      out[i] = listedOrNot(words[i], inList) ? least : least / 2;
    }
  }
  return out;
}

/** A word Beautify could ask about: where it is, and how sure Grape is of it. */
export interface Question {
  line: number;
  word: number;
  sure: number;
}

/**
 * Below this sureness a word Grape is unsure of gets a card; above it, it is
 * written as read (the read-back still keeps a word that does not read back
 * as itself in the writer's ink). "Tuesday" read at 0.97 needs no question.
 */
export const ASK_BELOW = 0.9;

/**
 * Which unsure words to ask about: on each line the least sure one, if it is
 * under `ASK_BELOW` (Joost, 25 November, after ten cards for two lines:
 * "way fewer and dependent on the amount of lines"). Lines in order.
 */
export function pickQuestions(
  candidates: readonly Question[],
  /** At most this many on a line; a function gives each line its own (`questionBudget` of its words). */
  perLine: number | ((line: number) => number) = 1,
  /** At most this many in all (`questionBudget`): the least sure are kept. */
  limit = Infinity,
): Question[] {
  const onLine = (line: number): number =>
    Math.max(0, typeof perLine === "number" ? perLine : perLine(line));
  const byLine = new Map<number, Question[]>();
  for (const q of candidates) {
    if (q.sure >= ASK_BELOW) continue;
    byLine.set(q.line, [...(byLine.get(q.line) ?? []), q]);
  }
  const picked = [...byLine.keys()]
    .sort((a, b) => a - b)
    .flatMap((line) =>
      (byLine.get(line) ?? [])
        .sort((a, b) => a.sure - b.sure || a.word - b.word)
        .slice(0, onLine(line)),
    );
  if (picked.length <= limit) return picked;
  const kept = new Set(
    [...picked]
      .sort((a, b) => a.sure - b.sure || a.line - b.line || a.word - b.word)
      .slice(0, Math.max(0, limit)),
  );
  return picked.filter((q) => kept.has(q));
}

/** Never more cards than this for one Beautify, however much is selected. */
export const MOST_CARDS = 8;

/**
 * How many cards a line, or one whole Beautify, may show, by its words
 * (Joost, 26 November: "a limit adjusted to the number of words, as to not
 * overwhelm", then "two per 8, but the scale does not have to be linear"):
 * two for 8 words, growing with the square root after that (3 at 16, 4 at
 * 32, 5 at 50), one for up to 4 words, eight at most. The cards go to the
 * least sure words first, where Grape is wrong most: on donated handwriting
 * 37 % of the words under 0.5 were misread, 24 % of those from 0.5 to 0.9,
 * 7 % above (`research/handwriting-rig/gen/neaten_tally.mjs`).
 */
export function questionBudget(words: number): number {
  return Math.min(MOST_CARDS, Math.max(1, Math.round(2 * Math.sqrt(words / 8))));
}

/** A line's words as Beautify sees them before asking: their text, ink, whether sure, and how sure. */
export interface LineChoice {
  read: readonly string[];
  words: readonly (readonly string[])[];
  rewrite: readonly boolean[];
  sure: readonly number[];
}

/**
 * The words Beautify could ask about: not sure enough to write, with a letter or digit
 * (more than one: a lone word keeps the writer's ink, so a card goes to a real word), and ink.
 */
export function unsureCandidates(
  lines: readonly LineChoice[],
  /** `lone`: single letters and digits too ("Beautify this word" on one: the writer pointed at it). */
  options: { lone?: boolean } = {},
): Question[] {
  return lines.flatMap((line, li) =>
    line.read.flatMap((w, word) =>
      !line.rewrite[word] &&
      /[\p{L}\p{N}]/u.test(w) &&
      (options.lone || !isLone(w)) &&
      line.words[word]?.length
        ? [{ line: li, word, sure: line.sure[word] ?? 0 }]
        : [],
    ),
  );
}

/**
 * After the questions: which words of a line are written. A word asked about
 * and not answered stays the writer's ink; an answered one is sure by now;
 * every other word with ink is marked for writing, and `own-ink.ts` then keeps
 * the writer's ink for a lone word or one Grape's sureness of is under
 * `WRITE_UNASKED_FROM`; the read-back keeps one that does not read back as
 * itself (Joost, 25 November: the words not asked about get no card). `asked`
 * holds the first stroke id of each word asked about.
 */
export function writeUnasked(
  line: Pick<LineChoice, "words" | "rewrite">,
  asked: ReadonlySet<string>,
): { rewrite: boolean[]; answered: boolean[] } {
  const rewrite = line.rewrite.map((r, w) => {
    const ink = line.words[w] ?? [];
    return r || (ink.length > 0 && !asked.has(ink[0]));
  });
  const answered = line.rewrite.map((r, w) => r && asked.has(line.words[w]?.[0] ?? ""));
  return { rewrite, answered };
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
 * `listed`. Either way the word takes the answer's text and is `known`: the
 * writer has said what it is (so Beautify writes that, and does not ask
 * again). An answer of several words, or none, is left out.
 */
export function applyAnswers(
  words: readonly string[],
  ink: readonly (readonly string[])[],
  answers: readonly WordAnswer[],
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
      // The answer's text is what the word is, whatever Beautify's own reading of the line
      // says (the card shows the page's reading, which can differ): one word only.
      const text = answer.text.trim();
      if (!text || /\s/.test(text)) continue;
      out[i] = text;
      if (answer.kind !== "misread") listed.add(wordCore(text).toLowerCase());
      // Any answer says what the word is: Beautify writes it and does not ask about it again.
      known.add(i);
      break;
    }
  });
  return { words: out, known, listed };
}

/** A line's words with their strokes and whether each is rewritten. */
export interface LineWords {
  words: string[];
  ink: string[][];
  rewrite: boolean[];
  /** How sure Grape is of each word (`wordSureness`); a joined word takes its parts' least. */
  sure?: number[];
  /** Whether the writer answered about each word (`applyAnswers`' `known`); a joined word is known if its letters are. */
  known?: boolean[];
}

interface Part {
  word: string;
  ink: string[];
  rewrite: boolean;
  sure: number;
  known: boolean;
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
    const part: Part = {
      word,
      ink: line.ink[i] ?? [],
      rewrite: line.rewrite[i] ?? false,
      sure: line.sure?.[i] ?? 0,
      known: line.known?.[i] ?? false,
    };
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
    ...(line.sure ? { sure: parts.map((p) => p.sure) } : {}),
    ...(line.known ? { known: parts.map((p) => p.known) } : {}),
  };
}

/** Two parts as one word; a bare punctuation mark does not lower how sure the word is. */
function join(a: Part, b: Part): Part {
  const bare = (p: Part): boolean => !/[\p{L}\p{N}]/u.test(p.word);
  const sure = bare(a) ? b.sure : bare(b) ? a.sure : Math.min(a.sure, b.sure);
  return {
    word: a.word + b.word,
    ink: [...a.ink, ...b.ink],
    rewrite: a.rewrite && b.rewrite,
    sure,
    known: bare(a) ? b.known : bare(b) ? a.known : a.known && b.known,
  };
}
