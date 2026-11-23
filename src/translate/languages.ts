/**
 * Which languages FineNotes can translate between on the device, what has
 * to be downloaded for a translation, and how a detected language and the
 * target are chosen.
 *
 * - Mozilla's models go to and from English, so a translation between two
 *   other languages runs through English: two models, both downloaded.
 * - Every model is a `ModelAsset` of its own (`translate-nl-en`, kept in
 *   `translation/nl-en/`), and so is the engine, which every translation
 *   needs (`translation/engine/`). What one translation needs is
 *   `neededAssets`.
 *
 * PURE: no DOM, no Obsidian, no network.
 */

import type { ModelAsset, ModelFile } from "../downloads/model-manifest";
import { ENGINE_FILES, ENGINE_VERSION, MODELS_URL, PAIRS } from "./catalog";
import type { CompactPair, TranslationPair } from "./catalog-types";

/** The pivot every model goes through. */
export const PIVOT = "en";

/** The engine's asset id. */
export const ENGINE_ID = "translate-engine";

function expand(pair: CompactPair): TranslationPair {
  const [from, to, version, intgemm8, files] = pair;
  return {
    from,
    to,
    version,
    precision: intgemm8 ? "int8shiftAll" : "int8shiftAlphaAll",
    files: files.map(([name, path, bytes, sha256]) => ({
      name,
      url: MODELS_URL + path,
      bytes,
      sha256,
    })),
  };
}

let expanded: readonly TranslationPair[] | null = null;

/** Every one-way model in the catalogue. */
export function translationPairs(): readonly TranslationPair[] {
  expanded ??= PAIRS.map(expand);
  return expanded;
}

/** The model from `from` to `to`, or null. */
export function pairOf(
  from: string,
  to: string,
  pairs: readonly TranslationPair[] = translationPairs(),
): TranslationPair | null {
  return pairs.find((p) => p.from === from && p.to === to) ?? null;
}

/** Languages text can be translated from: English, and every language with a model into English. */
export function sourceLanguages(pairs: readonly TranslationPair[] = translationPairs()): string[] {
  const out = new Set([PIVOT]);
  for (const p of pairs) if (p.to === PIVOT) out.add(p.from);
  return [...out];
}

/** Languages text can be translated into: English, and every language with a model from English. */
export function targetLanguages(pairs: readonly TranslationPair[] = translationPairs()): string[] {
  const out = new Set([PIVOT]);
  for (const p of pairs) if (p.from === PIVOT) out.add(p.to);
  return [...out];
}

/**
 * The models a translation from `from` to `to` runs through, in order: one
 * when either side is English (or a direct model exists), two through
 * English otherwise. [] for the same language; null when it cannot be done.
 */
export function routeOf(
  from: string,
  to: string,
  pairs: readonly TranslationPair[] = translationPairs(),
): TranslationPair[] | null {
  if (from === to) return [];
  const direct = pairOf(from, to, pairs);
  if (direct) return [direct];
  if (from === PIVOT || to === PIVOT) return null;
  const first = pairOf(from, PIVOT, pairs);
  const second = pairOf(PIVOT, to, pairs);
  return first && second ? [first, second] : null;
}

/** A model's asset id ("translate-nl-en"). */
export function pairId(pair: Pick<TranslationPair, "from" | "to">): string {
  return `translate-${pair.from}-${pair.to}`;
}

/** The engine as a downloadable model. `label` and `purpose` come from the caller (translated). */
export function engineAsset(label: string, purpose: string): ModelAsset {
  return {
    id: ENGINE_ID,
    label,
    purpose,
    version: ENGINE_VERSION,
    format: 1,
    folder: "translation/engine",
    files: ENGINE_FILES,
    // Mozilla's server sends whole files; asking in larger pieces costs nothing.
    chunkBytes: 8 * 1024 * 1024,
  };
}

/** A language model as a downloadable model. */
export function pairAsset(pair: TranslationPair, label: string, purpose: string): ModelAsset {
  return {
    id: pairId(pair),
    label,
    purpose,
    version: pair.version,
    format: 1,
    folder: `translation/${pair.from}-${pair.to}`,
    files: pair.files,
    chunkBytes: 8 * 1024 * 1024,
  };
}

/** The pair a `translation/<from>-<to>` folder name holds, or null. */
export function pairOfFolder(
  name: string,
  pairs: readonly TranslationPair[] = translationPairs(),
): TranslationPair | null {
  return pairs.find((p) => `${p.from}-${p.to}` === name) ?? null;
}

/** The bytes a list of files takes. */
export function filesBytes(files: readonly ModelFile[]): number {
  return files.reduce((sum, f) => sum + f.bytes, 0);
}

/**
 * A language fastText named ("__label__nl") as the catalogue names it, or
 * null when it has no models. Chinese is taken as Simplified; Norwegian
 * as Bokmål.
 */
export function catalogLanguage(label: string, known: readonly string[]): string | null {
  const code = label.replace(/^__label__/, "");
  const mapped = code === "zh" ? "zh-Hans" : code === "no" ? "nb" : code;
  return known.includes(mapped) ? mapped : null;
}

/** A guess at a text's language: its code and how sure (0 to 1). */
export interface LanguageGuess {
  lang: string;
  p: number;
}

/**
 * The language text is in, from fastText's top guesses (`[label, p]`, best
 * first). Kana means Japanese and Hangul Korean whatever fastText says (it
 * reads short Japanese as Chinese). Its first guess the catalogue can
 * translate from, when it is sure (`UNSURE` or more). fastText is rarely
 * sure of a short text ("Morgen leren we samen." read as Esperanto at
 * 0.16), so then, in order: `rough` (common words, `roughGuess`), the
 * language last used (`fallback`) for short text, and its first guess.
 */
export const UNSURE = 0.5;

export function pickSource(
  text: string,
  guesses: readonly (readonly [string, number])[],
  known: readonly string[],
  fallback: string | null,
  rough: string | null = null,
): LanguageGuess | null {
  if (/[぀-ヿ]/.test(text) && known.includes("ja")) return { lang: "ja", p: 1 };
  if (/[가-힯]/.test(text) && known.includes("ko")) return { lang: "ko", p: 1 };
  let best: LanguageGuess | null = null;
  for (const [label, p] of guesses) {
    const lang = catalogLanguage(label, known);
    if (lang) {
      best = { lang, p };
      break;
    }
  }
  if (best && best.p >= UNSURE) return best;
  const p = best?.p ?? 0;
  if (rough && known.includes(rough)) return { lang: rough, p };
  const last = fallback && known.includes(fallback) ? fallback : null;
  if (last && (letters(text) < 20 || !best)) return { lang: last, p };
  return best;
}

/**
 * The selection's language, given its page's (`context`, detected from the
 * text around it). fastText misreads short text (36 of 75 single words of a
 * Dutch course book were read as English, German, French...), and a word
 * taken for the language it is translated into is not translated at all; a
 * page's text it reads right (155 of 155). The page wins unless the
 * selection's own guess is sure (`SURE`) and long enough to trust
 * (`SURE_LETTERS`): an English quote on a Dutch page.
 */
export const SURE = 0.9;
export const SURE_LETTERS = 30;

export function withContext(
  text: string,
  own: LanguageGuess | null,
  context: LanguageGuess | null,
): LanguageGuess | null {
  if (!context) return own;
  if (!own) return context;
  if (own.lang === context.lang) return own.p >= context.p ? own : context;
  return own.p >= SURE && letters(text) >= SURE_LETTERS ? own : context;
}

/**
 * Common short words of the languages most notes are in: a first guess at
 * a text's language before the detector is downloaded (it needs the
 * engine's download, and the download depends on the language).
 */
const COMMON_WORDS: Readonly<Record<string, readonly string[]>> = {
  en: [
    "the",
    "and",
    "of",
    "to",
    "is",
    "in",
    "that",
    "it",
    "for",
    "with",
    "are",
    "this",
    // Not "we": Dutch has it too, and a tie goes to English.
    "you",
    "i",
    "not",
    "be",
    "was",
    "have",
    "on",
    "can",
    "will",
  ],
  nl: [
    "de",
    "het",
    "een",
    "en",
    "van",
    "is",
    "dat",
    "niet",
    "zijn",
    "op",
    "met",
    "voor",
    "je",
    "we",
    "ik",
    "maar",
    "ook",
    "er",
    "te",
    "wat",
    "nog",
    "bij",
    "als",
    "kan",
    "wordt",
  ],
  de: [
    "der",
    "die",
    "das",
    "und",
    "ist",
    "nicht",
    "ein",
    "eine",
    "zu",
    "mit",
    "den",
    "auf",
    "ich",
    "wir",
    "auch",
    "aber",
    "sich",
    "es",
    "im",
    "von",
    "wird",
    "kann",
  ],
  fr: [
    "le",
    "la",
    "les",
    "et",
    "est",
    "un",
    "une",
    "des",
    "du",
    "que",
    "pour",
    "dans",
    "pas",
    "je",
    "nous",
    "vous",
    "ne",
    "il",
    "elle",
    "avec",
    "sur",
    "au",
    "qui",
  ],
  es: [
    "el",
    "la",
    "los",
    "las",
    "y",
    "es",
    "un",
    "una",
    "que",
    "por",
    "para",
    "con",
    "del",
    "yo",
    "no",
    "lo",
    "se",
    "su",
    "pero",
    "como",
    "muy",
    "está",
  ],
  it: ["il", "lo", "la", "gli", "e", "è", "un", "una", "che", "per", "con", "non", "del"],
  pt: ["o", "os", "as", "e", "é", "um", "uma", "que", "não", "para", "com", "do", "da"],
  pl: ["i", "w", "nie", "na", "jest", "się", "że", "to", "z", "do", "jak", "co"],
  sv: ["och", "att", "det", "är", "som", "en", "på", "för", "med", "inte", "av", "jag"],
  da: ["og", "at", "det", "er", "som", "en", "på", "for", "med", "ikke", "af", "jeg"],
  nb: ["og", "at", "det", "er", "som", "en", "på", "for", "med", "ikke", "av", "jeg"],
  fi: ["ja", "on", "ei", "se", "että", "oli", "kun", "mutta", "tai", "niin", "ovat"],
  cs: ["a", "je", "v", "se", "na", "že", "to", "s", "z", "jsou", "není", "jak"],
  tr: ["ve", "bir", "bu", "da", "de", "için", "ile", "değil", "çok", "ne", "olarak"],
};

/** Every language's common short words, as one set (pdf-ligatures.ts reads it). */
let commonSet: ReadonlySet<string> | null = null;
export function commonWords(): ReadonlySet<string> {
  commonSet ??= new Set(Object.values(COMMON_WORDS).flat());
  return commonSet;
}

/**
 * A first guess at a text's language without the detector: by script
 * (Cyrillic → Russian, kana → Japanese, Hangul → Korean, Han → Chinese,
 * Arabic, Greek, Hebrew, Thai), else by its most common short words. Null
 * when nothing matches.
 */
export function roughGuess(text: string, known: readonly string[]): string | null {
  const scripts: [RegExp, string][] = [
    [/[぀-ヿ]/, "ja"],
    [/[가-힯]/, "ko"],
    [/[一-鿿]/, "zh-Hans"],
    [/[Ѐ-ӿ]/, "ru"],
    [/[؀-ۿ]/, "ar"],
    [/[Ͱ-Ͽ]/, "el"],
    [/[֐-׿]/, "he"],
    [/[฀-๿]/, "th"],
  ];
  for (const [pattern, lang] of scripts)
    if (pattern.test(text)) return known.includes(lang) ? lang : null;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, common] of Object.entries(COMMON_WORDS)) {
    if (!known.includes(lang)) continue;
    const set = new Set(common);
    const score = words.filter((w) => set.has(w)).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

function letters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/**
 * The language to translate into: the one last chosen when there is one;
 * else the interface's ("nl" from "nl", "zh-Hans" from "zh"); else English.
 * Never the text's own language when another is possible: then English,
 * or (for English text) the interface's.
 */
export function pickTarget(
  source: string | null,
  last: string | undefined,
  interfaceLang: string,
  targets: readonly string[],
): string {
  const ui = interfaceLang === "zh" ? "zh-Hans" : interfaceLang === "no" ? "nb" : interfaceLang;
  const wanted = [last, ui, PIVOT].filter(
    (code): code is string => !!code && targets.includes(code),
  );
  return wanted.find((code) => code !== source) ?? wanted[0] ?? PIVOT;
}

/**
 * Text cut where the engine must not join it: at line breaks. `pieces`
 * holds the lines with text in them (trimmed), `joins` what stood between
 * each and the next (the line breaks, kept as they were), `lead` and
 * `tail` what came before the first and after the last.
 */
export interface TextPieces {
  lead: string;
  pieces: string[];
  joins: string[];
  tail: string;
}

export function textPieces(text: string): TextPieces {
  const parts = text.split(/(\s*\n\s*)/);
  const pieces: string[] = [];
  const joins: string[] = [];
  let lead = "";
  let pending = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      pending += part;
      continue;
    }
    const trimmed = part.trim();
    if (!trimmed) {
      pending += part;
      continue;
    }
    const before = part.slice(0, part.length - part.trimStart().length);
    if (pieces.length === 0) lead = pending + before;
    else joins.push(pending + before);
    pending = part.slice(part.trimEnd().length);
    pieces.push(trimmed);
  }
  return { lead, pieces, joins, tail: pending };
}

/** The translated pieces put back between the original line breaks. */
export function joinPieces(cut: TextPieces, translated: readonly string[]): string {
  let out = cut.lead;
  translated.forEach((piece, i) => {
    if (i > 0) out += cut.joins[i - 1] ?? "\n";
    out += piece;
  });
  return out + cut.tail;
}

/**
 * PDF text copied from a page breaks lines where the page did; a sentence
 * runs on across them. Lines are joined into one when the first does not
 * end a sentence (a hyphen at the end of a word is dropped). Blank lines
 * and lines ending in . ! ? : stay breaks.
 */
export function joinRunOnLines(text: string): string {
  return text.replace(/([^\n])\n(?=[^\n])/g, (whole, last: string, offset: number) => {
    if (/[.!?:;]/.test(last)) return whole;
    const before = text.slice(Math.max(0, offset - 1), offset + 1);
    if (last === "-" && /\p{L}-/u.test(before)) return "";
    return `${last} `;
  });
}

/**
 * `text` without private-use characters (U+E000 to U+F8FF): a PDF font's
 * own codes for its glyphs, which mean nothing to a translator and which
 * iPadOS draws as emoji.
 */
export function withoutPrivateUse(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0xe000 || code > 0xf8ff) out += ch;
  }
  return out;
}
