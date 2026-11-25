/**
 * Which language a page is written in, from Grape's reading of it without
 * the language model: by its short function words ("the", "de", "und", …),
 * which Grape reads well even where it misreads the long words.
 *
 * Why it matters: Grape's character model and word list are English.
 * Measured on unseen writers (research/handwriting-rig, RESEARCH-LOG
 * 2026-11-25), the English model makes every other language worse (Dutch
 * 5.8 → 9.1 % CER with the word list's reread, word errors 25 → 40 %), and
 * the English word list would underline three quarters or more of their
 * correct words. So a page found to be in another language is read without
 * them, unless a language pack for it is installed (language-pack.ts).
 *
 * Grape writes ASCII only, so the words are listed without accents.
 *
 * PURE: no DOM, no Obsidian.
 */

/** The languages told apart. English is what Grape's own model and list are for. */
export const PAGE_LANGUAGES = ["en", "nl", "de", "fr", "es", "pt", "it"] as const;
export type PageLanguage = (typeof PAGE_LANGUAGES)[number];

const WORDS: Record<PageLanguage, string> = {
  en: "the and of to is in that it for with on are be this as by at or from not we you have an was if can when each every before after which there their will would should",
  nl: "de het een en van voor met op niet dat zijn wordt ook maar naar bij aan om er je ik wat hoe deze die dit tot uit nog kan moet elke geen worden heeft wel dan",
  de: "der die das und ist nicht mit ein eine den dem des zu von auf fur sich auch es im wir sie bei nach wird oder wenn jede jeder vor aus sind werden kann noch",
  fr: "le la les des et est un une du dans pour que qui pas sur au avec ce se il nous vous sont par plus chaque avant ou mais leur cette entre",
  es: "el la los las y es un una del en que por con para se no lo al como mas pero su cada antes esta este son entre sobre",
  pt: "o a os as e da do das dos em um uma que para com nao se por mais na no cada antes esta sao ao pelo pela entre sobre",
  it: "il lo la gli le e di del della che per con non un una sono nel alla al ogni prima questo questa piu si tra",
};

/** Each word, with the languages it belongs to: a word of several counts a share in each. */
const INDEX: Map<string, PageLanguage[]> = (() => {
  const out = new Map<string, PageLanguage[]>();
  for (const lang of PAGE_LANGUAGES) {
    for (const w of WORDS[lang].split(" ")) out.set(w, [...(out.get(w) ?? []), lang]);
  }
  return out;
})();

/** Fewest function-word hits before a page is called anything but English. */
export const MIN_EVIDENCE = 3;
/** How far another language must lead English (its score ÷ English's) to win. */
export const LEAD = 2;

export interface LanguageGuess {
  language: PageLanguage;
  /** Function-word hits per language (shared words split between them). */
  scores: Record<PageLanguage, number>;
}

/**
 * The language of `text` (a page's greedy reading). English unless another
 * language has at least `MIN_EVIDENCE` hits and leads English by `LEAD`
 * times: reading English without its model costs little (2.0 → 2.7 % CER
 * on the test lines), reading Dutch with it costs more (5.8 → 9.1 %).
 */
export function pageLanguage(text: string): LanguageGuess {
  const scores = Object.fromEntries(PAGE_LANGUAGES.map((l) => [l, 0])) as Record<
    PageLanguage,
    number
  >;
  for (const token of text.toLowerCase().split(/[^a-z']+/)) {
    const langs = INDEX.get(token);
    if (!langs) continue;
    for (const lang of langs) scores[lang] += 1 / langs.length;
  }
  let best: PageLanguage = "en";
  for (const lang of PAGE_LANGUAGES) if (scores[lang] > scores[best]) best = lang;
  const lead = best !== "en" && scores[best] >= MIN_EVIDENCE && scores[best] >= LEAD * scores.en;
  return { language: lead ? best : "en", scores };
}
