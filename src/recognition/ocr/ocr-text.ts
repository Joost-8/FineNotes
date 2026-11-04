/**
 * What OCR text is made of before it is used: the reading as stored (raw,
 * never changed in the cache) turned into the text the page shows.
 *
 * - **Unicode.** The recogniser reads a circled step number ("①") as one
 *   character glued to the word after it, and a scan's ligatures and
 *   fullwidth letters as they are drawn. Ligatures and fullwidth forms are
 *   normalised (NFKC); an enclosed number or letter becomes a token of its
 *   own ("①Before" is "1" and "Before"), and the word's box is cut where the
 *   recogniser put the symbol, so each part has its own box. Search folds
 *   native text the same way (`search/notebook-search.ts` `fold`: NFKD, no
 *   accents, lower case), so both sides meet; nothing about native text is
 *   changed here.
 * - **Document vocabulary.** A letter the recogniser takes for two ("rn" for
 *   "m": "Extemal") makes a word that is in no dictionary. A word that is
 *   not in the PDF's own text or the bundled English list, and is a single
 *   cheap edit from exactly one word that the PDF's own text does contain,
 *   is corrected to it, in the case style it was read in. The raw word is
 *   kept in memory beside it.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { TextLayout } from "../../canvas/pdf-text";
import type { OcrTuning, OcrWord } from "./ocr-words";

/** An OCR word as the page uses it; `raw` is what was read, when it was corrected or normalised. */
export type ReadWord = OcrWord & { raw?: string };

/** Enclosed alphanumerics: circled and parenthesised numbers and letters, dingbat circled numbers. */
const ENCLOSED = /[\u2460-\u24ff\u2776-\u2793\u3248-\u325f\u32b1-\u32bf]/u;
/** What is normalised in place: ligatures, fullwidth ASCII and the ideographic space. */
const COMPAT = /[\ufb00-\ufb06\uff01-\uff5e\u3000]/u;

/** Whether a word has a character that {@link normaliseWord} changes. */
export function needsNormalising(text: string): boolean {
  return ENCLOSED.test(text) || COMPAT.test(text);
}

/** The width an enclosed symbol takes against an ordinary letter, when the recogniser did not say where it sits. */
const SYMBOL_WEIGHT = 1.6;

/**
 * A word with its ligatures and fullwidth forms normalised and its enclosed
 * numbers and letters split off as words of their own. The box is cut at the
 * symbol's start and end as the recogniser placed them (`cuts`), or, for a
 * word stored without them, in proportion to the characters, a symbol
 * counting {@link SYMBOL_WEIGHT} letters. Other words come back unchanged.
 */
export function normaliseWord(word: OcrWord): ReadWord[] {
  if (!needsNormalising(word.text)) return [word];
  const chars = Array.from(word.text);
  const n = chars.length;
  // x of the start of character i (bounds[n] is the word's right edge).
  const bounds: number[] = new Array<number>(n + 1);
  bounds[0] = word.box[0];
  bounds[n] = word.box[2];
  if (word.cuts && word.cuts.length === n - 1) {
    for (let i = 1; i < n; i++) bounds[i] = word.cuts[i - 1];
  } else {
    const weights = chars.map((c) => (ENCLOSED.test(c) ? SYMBOL_WEIGHT : 1));
    const total = weights.reduce((s, w) => s + w, 0);
    let at = 0;
    for (let i = 1; i < n; i++) {
      at += weights[i - 1];
      bounds[i] = word.box[0] + ((word.box[2] - word.box[0]) * at) / total;
    }
  }
  for (let i = 1; i <= n; i++)
    bounds[i] = Math.min(word.box[2], Math.max(bounds[i], bounds[i - 1]));

  const out: ReadWord[] = [];
  let run = "";
  let runFrom = 0;
  const flush = (to: number): void => {
    const text = run.trim();
    if (text !== "") out.push(piece(word, text, runFrom, to, bounds));
    run = "";
  };
  chars.forEach((c, i) => {
    if (ENCLOSED.test(c)) {
      flush(i);
      out.push(piece(word, c.normalize("NFKC"), i, i + 1, bounds));
      runFrom = i + 1;
      return;
    }
    const mapped = COMPAT.test(c) ? c.normalize("NFKC") : c;
    if (mapped.trim() === "") {
      flush(i);
      runFrom = i + 1;
      return;
    }
    if (run === "") runFrom = i;
    run += mapped;
  });
  flush(n);
  return out.length > 0 ? out : [word];
}

function piece(word: OcrWord, text: string, from: number, to: number, bounds: number[]): ReadWord {
  return {
    text,
    box: [bounds[from], word.box[1], bounds[to], word.box[3]],
    conf: word.conf,
    min: word.min,
    raw: word.text,
  };
}

/** The lines with every word normalised; a word that splits makes several. */
export function normaliseLines(lines: readonly OcrWord[][]): ReadWord[][] {
  return lines.map((line) => line.flatMap((w) => normaliseWord(w)));
}

// --- The document's vocabulary ----------------------------------------------

/** Letters of a candidate word at least (shorter words are never offered). */
const MIN_CANDIDATE = 4;

/** The words of a laid-out page's own text, lower case, letters only, of four letters or more. */
export function wordsOfLayout(layout: TextLayout): string[] {
  const out: string[] = [];
  for (const line of layout.lines) {
    let text = "";
    for (let i = line.start; i < line.end; i++) text += layout.chars[i].ch;
    for (const part of text.split(/[^\p{L}]+/u)) {
      if (Array.from(part).length >= MIN_CANDIDATE) out.push(part.toLowerCase());
    }
  }
  return out;
}

/** What the correction knows: the PDF's own words and the English list. */
export interface Dictionary {
  /** Words of the PDF's own text (lower case). */
  vocabulary: ReadonlySet<string>;
  /** Words that are known to be words, whatever the PDF says. */
  lexicon: ReadonlySet<string>;
}

type Pair = readonly [string, string];
/** The classic confusions of two letters for one: what is read, what it was. Both directions are tried. */
const PAIRS: readonly Pair[] = [
  ["rn", "m"],
  ["cl", "d"],
  ["vv", "w"],
  ["li", "h"],
];

/** Whether reading `read` for the letter `was` is a classic single-letter confusion (I, l, 1; O, 0). */
function confused(read: string, was: string): boolean {
  if ("Il1|".includes(read) && "li1".includes(was)) return true;
  return "O0".includes(read) && "o0".includes(was);
}

/**
 * The distance between what was read and a word: edits at a cost of 1, but
 * classic confusions (rn/m, cl/d, vv/w, li/h in either direction, I/l/1,
 * O/0) at `tuning.correctConfusion` and a doubled or missing double letter
 * at `tuning.correctDoubled`. Case is ignored except for I, l and O.
 */
export function weightedDistance(read: string, word: string, tuning: OcrTuning): number {
  const a = Array.from(read);
  const b = Array.from(word);
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(Infinity),
  );
  d[0][0] = 0;
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      const here = d[i][j];
      if (!Number.isFinite(here)) continue;
      if (i < m && j < n) {
        const same = a[i].toLowerCase() === b[j];
        const cost = same ? 0 : confused(a[i], b[j]) ? tuning.correctConfusion : 1;
        d[i + 1][j + 1] = Math.min(d[i + 1][j + 1], here + cost);
      }
      if (i < m) {
        // A letter read that is not there; cheap when it doubles the one before.
        const doubled = i > 0 && a[i].toLowerCase() === a[i - 1].toLowerCase();
        d[i + 1][j] = Math.min(d[i + 1][j], here + (doubled ? tuning.correctDoubled : 1));
      }
      if (j < n) {
        // A letter missing from what was read; cheap when the word doubles a letter.
        const doubled = j > 0 && b[j] === b[j - 1];
        d[i][j + 1] = Math.min(d[i][j + 1], here + (doubled ? tuning.correctDoubled : 1));
      }
      for (const [x, y] of PAIRS) {
        for (const [from, to] of [
          [x, y],
          [y, x],
        ] as const) {
          if (
            a
              .slice(i, i + from.length)
              .join("")
              .toLowerCase() === from &&
            b.slice(j, j + to.length).join("") === to
          ) {
            const k = [i + from.length, j + to.length] as const;
            d[k[0]][k[1]] = Math.min(d[k[0]][k[1]], here + tuning.correctConfusion);
          }
        }
      }
    }
  }
  return d[m][n];
}

/** `word` in the case style of `like`: all capitals, a capital first letter, or lower case. */
function inStyleOf(word: string, like: string): string | null {
  // A capital I inside a word is most likely a misread l: not a capital to keep.
  const plain = Array.from(like)
    .map((c, k, all) => (c === "I" && k > 0 && /\p{L}/u.test(all[k - 1]) ? "l" : c))
    .join("");
  if (plain === plain.toLowerCase()) return word;
  if (plain === plain.toUpperCase()) return word.toUpperCase();
  const [first, ...rest] = Array.from(plain);
  if (first === first.toUpperCase() && rest.join("") === rest.join("").toLowerCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return null;
}

/**
 * The one word of the PDF's own text that `read` is a cheap misreading of,
 * or null. Only for a word of letters (punctuation around it is left alone),
 * `tuning.correctMinLetters` letters or more, that is in neither the PDF's text
 * nor the English list; the nearest word must be unique, within
 * `tuning.correctMaxEdit` (`correctMaxEditLong` from `correctLongFrom`
 * letters), and not just `read` with an ending added, taken off or changed.
 */
export function correction(read: string, dictionary: Dictionary, tuning: OcrTuning): string | null {
  if (!/^\p{L}+$/u.test(read)) return null;
  const letters = Array.from(read).length;
  if (letters < tuning.correctMinLetters) return null;
  const lower = read.toLowerCase();
  if (dictionary.vocabulary.has(lower) || dictionary.lexicon.has(lower)) return null;
  const limit =
    letters >= tuning.correctLongFrom ? tuning.correctMaxEditLong : tuning.correctMaxEdit;
  let best = Infinity;
  const found: string[] = [];
  for (const word of dictionary.vocabulary) {
    if (Math.abs(word.length - lower.length) > Math.ceil(limit)) continue;
    // "slings" for "sling": a different word, not a misreading.
    if (word.startsWith(lower) || lower.startsWith(word)) continue;
    // "cystoscope" for "cystoscopy": two words that differ only in the last letter are two words.
    if (word.length === lower.length && word.slice(0, -1) === lower.slice(0, -1)) continue;
    const d = weightedDistance(read, word, tuning);
    if (d > limit || d > best) continue;
    if (d < best) found.length = 0;
    best = d;
    found.push(word);
  }
  if (found.length !== 1) return null;
  return inStyleOf(found[0], read);
}

/**
 * The lines with each word that {@link correction} finds a misreading of
 * corrected; the raw word stays in `raw`. The word's punctuation is kept.
 */
export function correctLines(
  lines: readonly ReadWord[][],
  dictionary: Dictionary,
  tuning: OcrTuning,
): ReadWord[][] {
  return lines.map((line) =>
    line.map((w) => {
      const core = /^([^\p{L}]*)(\p{L}+)([^\p{L}]*)$/u.exec(w.text);
      if (!core) return w;
      const fixed = correction(core[2], dictionary, tuning);
      return fixed === null
        ? w
        : { ...w, text: `${core[1]}${fixed}${core[3]}`, raw: w.raw ?? w.text };
    }),
  );
}
