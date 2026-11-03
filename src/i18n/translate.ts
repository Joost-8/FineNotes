/**
 * The interface's words: `t("area.key")` gives the text in the language in
 * use, and English wherever that language's table has no entry. PURE: the
 * table is handed in by `useLanguage`, which the plugin calls before it
 * draws anything.
 *
 * - `{name}` in a text is filled from `vars`; a name with no value stays as
 *   written, so a missing value shows instead of vanishing.
 * - `tn("area.key", n)` picks the plural form the language's rules give `n`
 *   (`Intl.PluralRules`: `area.key.one`, `.few`, `.many`, `.other`, …),
 *   falling back to `.other`, and fills `{count}` with `n`.
 *
 * Never call `t` where a module is first evaluated (a top-level constant):
 * modules load before the plugin knows the language, so the text would stay
 * English for good. Call it where the text is shown.
 */

import { EN } from "./en";

export type TextKey = Extract<keyof typeof EN, string>;
/** A key with plural forms: `key.other` exists in English. */
export type PluralKey = TextKey extends infer K
  ? K extends `${infer B}.other`
    ? B
    : never
  : never;

export type TextVars = Readonly<Record<string, string | number>>;

/** A language's table: key to text. Keys it lacks are shown in English. */
export type TextTable = Readonly<Record<string, string>>;

const ENGLISH: TextTable = EN;

let language = "en";
let table: TextTable = ENGLISH;
let rules: Intl.PluralRules | null = null;

/** Show `code`'s texts from now on; `entries` is its table (English for "en"). */
export function useLanguage(code: string, entries?: TextTable): void {
  language = code;
  table = code === "en" || !entries ? ENGLISH : entries;
  rules = null;
}

/** The language in use. */
export function currentLanguage(): string {
  return language;
}

/** The text for `key`, filled from `vars`. */
export function t(key: TextKey, vars?: TextVars): string {
  return fill(lookup(key) ?? key, vars);
}

/** The English text for `key`, whatever the language: for what is sent to the AI. */
export function english(key: TextKey, vars?: TextVars): string {
  return fill(ENGLISH[key] ?? key, vars);
}

/** The plural form of `key` for `count`, with `{count}` filled. */
export function tn(key: PluralKey, count: number, vars?: TextVars): string {
  const base: string = key;
  const filled = { count, ...vars };
  if (table !== ENGLISH) {
    const text = own(`${base}.${pluralRules().select(count)}`) ?? own(`${base}.other`);
    if (text !== undefined) return fill(text, filled);
  }
  const english = new Intl.PluralRules("en").select(count);
  return fill(ENGLISH[`${base}.${english}`] ?? ENGLISH[`${base}.other`] ?? base, filled);
}

function lookup(key: string): string | undefined {
  return own(key) ?? (has(ENGLISH, key) ? ENGLISH[key] : undefined);
}

/** The table's own text for `key`. */
function own(key: string): string | undefined {
  const text = has(table, key) ? table[key] : undefined;
  return typeof text === "string" && text !== "" ? text : undefined;
}

function has(source: TextTable, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function pluralRules(): Intl.PluralRules {
  if (!rules) {
    try {
      rules = new Intl.PluralRules(language);
    } catch {
      rules = new Intl.PluralRules("en");
    }
  }
  return rules;
}

function fill(text: string, vars: TextVars | undefined): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** The `{name}` placeholders in a text, sorted and once each. */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ""))].sort();
}
