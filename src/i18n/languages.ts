/**
 * The languages FineNotes' interface comes in: Obsidian's own list (read
 * from its `app.js`, 1.14), so a vault in any of Obsidian's languages gets
 * FineNotes in the same one. British English is left out: it is English.
 * Each is named in itself, as Obsidian's Language menu names them, so the
 * list can be read whatever language the interface is in now. PURE.
 */

/** "auto": the language Obsidian is in. */
export const FOLLOW_OBSIDIAN = "auto";

export const INTERFACE_LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "am", name: "አማርኛ" },
  { code: "ar", name: "العربية" },
  { code: "be", name: "Беларуская" },
  { code: "bn", name: "বাংলা" },
  { code: "ca", name: "Català" },
  { code: "cs", name: "Čeština" },
  { code: "da", name: "Dansk" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "fa", name: "فارسی" },
  { code: "fi", name: "Suomi" },
  { code: "fr", name: "Français" },
  { code: "ga", name: "Gaeilge" },
  { code: "he", name: "עברית" },
  { code: "hu", name: "Magyar" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "ka", name: "ქართული" },
  { code: "kh", name: "ខ្មែរ" },
  { code: "ko", name: "한국어" },
  { code: "lv", name: "Latviešu" },
  { code: "ms", name: "Bahasa Melayu" },
  { code: "ne", name: "नेपाली" },
  { code: "nl", name: "Nederlands" },
  { code: "no", name: "Norsk" },
  { code: "pl", name: "Polski" },
  { code: "pt", name: "Português" },
  { code: "pt-BR", name: "Português do Brasil" },
  { code: "ro", name: "Română" },
  { code: "ru", name: "Русский" },
  { code: "sk", name: "Slovenčina" },
  { code: "sq", name: "Shqip" },
  { code: "sr", name: "Српски" },
  { code: "sv", name: "Svenska" },
  { code: "th", name: "ไทย" },
  { code: "tr", name: "Türkçe" },
  { code: "uk", name: "Українська" },
  { code: "uz", name: "Oʻzbekcha" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "zh", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
];

/** Every code but English: the ones with a table of their own. */
export const TRANSLATED_LANGUAGES: readonly string[] = INTERFACE_LANGUAGES.map(
  (l) => l.code,
).filter((c) => c !== "en");

/** The other spellings Obsidian or a platform may report for a code we list. */
const ALIASES: Record<string, string> = {
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  nb: "no",
  nn: "no",
  cz: "cs",
  km: "kh",
  iw: "he",
  in: "id",
  "en-gb": "en",
};

/** A code from the list for `raw`, matched without case, or null. */
function known(raw: string): string | null {
  const lower = raw.toLowerCase();
  const alias = Object.prototype.hasOwnProperty.call(ALIASES, lower) ? ALIASES[lower] : undefined;
  if (alias) return alias;
  return INTERFACE_LANGUAGES.find((l) => l.code.toLowerCase() === lower)?.code ?? null;
}

/**
 * The language to show: the one chosen, or with "auto" (and anything this
 * build does not know) the one Obsidian is in. A regional code we do not
 * list falls back to its language (`pt-PT` → `pt`, `de-AT` → `de`), and
 * anything else to English.
 */
export function resolveLanguage(chosen: string | undefined, obsidian: string | undefined): string {
  if (chosen && chosen !== FOLLOW_OBSIDIAN) {
    const own = known(chosen);
    if (own) return own;
  }
  const raw = (obsidian ?? "").trim();
  if (!raw) return "en";
  return known(raw) ?? known(raw.split(/[-_]/)[0] ?? "") ?? "en";
}

/** The stored choice, kept only if it is "auto" or a code from the list. */
export function interfaceLanguageOf(raw: unknown): string {
  if (typeof raw !== "string" || raw === FOLLOW_OBSIDIAN) return FOLLOW_OBSIDIAN;
  return INTERFACE_LANGUAGES.some((l) => l.code === raw) ? raw : FOLLOW_OBSIDIAN;
}
