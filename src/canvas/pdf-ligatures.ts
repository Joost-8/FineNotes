/**
 * Ligatures a PDF wrote as private-use characters, read back as letters.
 *
 * Some typesetting tools (Type3 fonts in school books, for one) give each
 * ligature glyph a code from Unicode's private-use area (U+E000 to U+F8FF)
 * in the font's ToUnicode map, numbered per font. pdf.js then reads
 * "heeft" as "hee" + U+E000 + "t", which iPadOS draws as an old emoji, and
 * which nothing can search, copy or translate.
 *
 * Each code is taken, per font on the page, as the f-ligature (fi, fl, ff,
 * ft, fb, ...; with a space after, when the glyph ended a word) that makes
 * its words most like words: words found elsewhere on the page, word
 * pieces of the translation models' vocabularies (ligature-lexicon.ts),
 * and the rule that one short vowel before a vowel doubles the f
 * ("effect", "koffie"). A run of private-use text (a whole font of them)
 * is left as it is: no single letter decides it.
 *
 * PURE: no DOM, no pdf.js.
 */

import { LIGATURE_LEXICON } from "./ligature-lexicon";

/** What a ligature code may stand for, the likelier first (the order breaks ties). */
export const LIGATURE_CANDIDATES: readonly string[] = [
  "f",
  "fi",
  "ff",
  "fl",
  "ffi",
  "ffl",
  "ft",
  "fb",
  "fh",
  "fk",
  "fj",
  "f ",
  "ft ",
  "ff ",
];

const PUA_FIRST = 0xe000;
const PUA_LAST = 0xf8ff;

/** Whether `ch` (one UTF-16 unit) is in the private-use area. */
export function isPrivateUse(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= PUA_FIRST && code <= PUA_LAST;
}

function countPrivateUse(text: string): number {
  let n = 0;
  for (const ch of text) if (isPrivateUse(ch)) n++;
  return n;
}

const LETTER = /\p{L}/u;
const isLetter = (ch: string): boolean => ch !== "" && LETTER.test(ch) && !isPrivateUse(ch);
/** Whether `ch` is a vowel, accented or not. */
const isVowel = (ch: string): boolean =>
  ch !== "" && "aeiouy".includes(ch.normalize("NFD").charAt(0));

/** Word pieces by which a filled-in word is judged; built once. */
let lexicon: ReadonlySet<string> | null = null;
export function ligatureLexicon(): ReadonlySet<string> {
  lexicon ??= new Set(LIGATURE_LEXICON.split(" "));
  return lexicon;
}

/** A text's words, lower case, letters only. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/\p{L}+/gu) ?? [];
}

/**
 * Whether an item is private-use text through and through: three or more
 * codes, and more of them than letters. Its codes are a whole alphabet, not
 * ligatures.
 */
export function isPrivateUseRun(text: string): boolean {
  const codes = countPrivateUse(text);
  if (codes < 3) return false;
  let letters = 0;
  for (const ch of text) if (isLetter(ch)) letters++;
  return codes > letters;
}

/** The longest lexicon piece in "^" + `word` holding all of [lo, hi), in letters. */
function cover(word: string, lo: number, hi: number, pieces: ReadonlySet<string>): number {
  const w = `^${word}`;
  const a0 = lo + 1;
  const b0 = hi + 1;
  let best = 0;
  for (let a = 0; a <= a0; a++) {
    for (let b = Math.max(b0, a + best + 1); b <= Math.min(w.length, a + 16); b++) {
      if (pieces.has(w.slice(a, b))) best = b - a;
    }
  }
  return best;
}

/** One place a code stands: the letters right before and after it. */
interface Occurrence {
  before: string;
  after: string;
  /** The letter before the one before (for the doubling rule). */
  beforeTwo: string;
}

/** The letters touching position `at` of `text` going left, other codes read as "f". */
function lettersBefore(text: string, at: number): string {
  let out = "";
  for (let i = at - 1; i >= 0; i--) {
    const ch = isPrivateUse(text[i]) ? "f" : text[i];
    if (!LETTER.test(ch)) break;
    out = ch + out;
  }
  return out.toLowerCase();
}

function lettersAfter(text: string, at: number): string {
  let out = "";
  for (let i = at + 1; i < text.length; i++) {
    const ch = isPrivateUse(text[i]) ? "f" : text[i];
    if (!LETTER.test(ch)) break;
    out += ch;
  }
  return out.toLowerCase();
}

/** The token (no spaces) around position `at`, every code in it filled with `fill`. */
function tokenAround(text: string, at: number, code: string, fill: string): string {
  let a = at;
  let b = at + 1;
  while (a > 0 && !/\s/.test(text[a - 1])) a--;
  while (b < text.length && !/\s/.test(text[b])) b++;
  return fillCode(text.slice(a, b), code, fill);
}

function fillCode(text: string, code: string, fill: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== code) {
      out += isPrivateUse(ch) ? "f" : ch;
      continue;
    }
    // A glyph that ended a word needs no space where one already follows.
    const next = text[i + 1] ?? "";
    out += fill.endsWith(" ") && !isLetter(next) ? fill.trimEnd() : fill;
  }
  return out;
}

function score(
  fill: string,
  rank: number,
  code: string,
  places: readonly Occurrence[],
  texts: readonly string[],
  vocab: ReadonlyMap<string, number>,
  common: ReadonlySet<string>,
  pieces: ReadonlySet<string>,
): number {
  const spaced = fill.endsWith(" ");
  const letters = fill.trimEnd();
  let total = (-0.3 * rank) / LIGATURE_CANDIDATES.length - (spaced ? 0.5 : 0);
  places.forEach((place, i) => {
    // Words the filled token makes, all seen on the page: the best evidence.
    const words = wordsOf(fillCode(texts[i], code, fill));
    if (words.length > 0 && words.every((w) => w.length >= 2 && (vocab.get(w) ?? 0) > 0)) {
      total += Math.min(...words.map((w) => Math.log(1 + (vocab.get(w) ?? 0)))) - (spaced ? 1 : 0);
    }
    const { before, after } = place;
    if (spaced) {
      const left = before + letters;
      total += 0.25 * cover(left, before.length, left.length, pieces);
      if (after.length >= 2 && (common.has(after) || (vocab.get(after) ?? 0) >= 20)) total += 1.2;
    } else {
      const word = before + letters + after;
      total += 0.25 * cover(word, before.length, before.length + letters.length, pieces);
    }
    // One short vowel before, a vowel after: the f is doubled ("e_ect").
    const vowel = before.slice(-1);
    const next = after.slice(0, 1);
    if (isVowel(vowel) && !isVowel(place.beforeTwo) && isVowel(next)) {
      total += fill === "ff" ? 0.8 : fill === "f" ? -0.8 : 0;
    }
  });
  return total;
}

/**
 * A page's item texts with their ligature codes read as letters. `fonts[i]`
 * names the font of `texts[i]` (codes are numbered per font); `common` holds
 * short words common enough to start after a ligature that ended a word.
 * Texts with no code come back unchanged, as do private-use runs.
 */
export function repairLigatures(
  texts: readonly string[],
  fonts: readonly (string | undefined)[],
  common: ReadonlySet<string>,
  pieces: ReadonlySet<string> = ligatureLexicon(),
): string[] {
  const touched = texts.map((text) => countPrivateUse(text) > 0 && !isPrivateUseRun(text));
  if (!touched.some(Boolean)) return [...texts];
  const vocab = new Map<string, number>();
  texts.forEach((text) => {
    if (countPrivateUse(text) > 0) return;
    for (const w of wordsOf(text)) vocab.set(w, (vocab.get(w) ?? 0) + 1);
  });
  // Every place each (font, code) stands, and the token around it.
  const groups = new Map<string, { code: string; places: Occurrence[]; tokens: string[] }>();
  texts.forEach((text, i) => {
    if (!touched[i]) return;
    for (let at = 0; at < text.length; at++) {
      const ch = text[at];
      if (!isPrivateUse(ch)) continue;
      const key = `${fonts[i] ?? ""}|${ch}`;
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { code: ch, places: [], tokens: [] }));
      const before = lettersBefore(text, at);
      group.places.push({
        before,
        after: lettersAfter(text, at),
        beforeTwo: before.slice(-2, -1),
      });
      group.tokens.push(tokenAround(text, at, ch, ch));
    }
  });
  const chosen = new Map<string, string>();
  for (const [key, group] of groups) {
    let best = LIGATURE_CANDIDATES[0];
    let bestScore = -Infinity;
    LIGATURE_CANDIDATES.forEach((fill, rank) => {
      const s = score(fill, rank, group.code, group.places, group.tokens, vocab, common, pieces);
      if (s > bestScore) {
        bestScore = s;
        best = fill;
      }
    });
    chosen.set(key, best);
  }
  return texts.map((text, i) => {
    if (!touched[i]) return text;
    const font = fonts[i] ?? "";
    let out = "";
    for (let at = 0; at < text.length; at++) {
      const ch = text[at];
      const fill = isPrivateUse(ch) ? chosen.get(`${font}|${ch}`) : undefined;
      if (fill === undefined) {
        out += ch;
        continue;
      }
      out += fill.endsWith(" ") && !isLetter(text[at + 1] ?? "") ? fill.trimEnd() : fill;
    }
    return out;
  });
}
