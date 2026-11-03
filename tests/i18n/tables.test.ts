import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AREAS, EN } from "../../src/i18n/en";
import { TRANSLATED_LANGUAGES } from "../../src/i18n/languages";
import { placeholdersOf } from "../../src/i18n/translate";

const LOCALES = join(__dirname, "../../src/i18n/locales");
const PLURAL_FORMS = new Set(["zero", "one", "two", "few", "many", "other"]);
const english: Record<string, string> = EN;

/** For a plural form's key, the key of its `.other`; null for any other key. */
function pluralOther(key: string): string | null {
  const dot = key.lastIndexOf(".");
  if (!PLURAL_FORMS.has(key.slice(dot + 1))) return null;
  const other = `${key.slice(0, dot)}.other`;
  return Object.prototype.hasOwnProperty.call(english, other) ? other : null;
}

/**
 * The plural forms of `code` that more than one whole number selects (French
 * "many" is a million and up): all but English's one, Arabic's zero, one and
 * two, and forms it never uses.
 */
function manyNumberForms(code: string): Set<string> {
  const rules = new Intl.PluralRules(code);
  const seen = new Map<string, number>();
  const numbers = [...Array(1001).keys(), 1e6, 2e6, 1e7];
  for (const n of numbers) {
    const form = rules.select(n);
    seen.set(form, (seen.get(form) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([form]) => form));
}

describe("manyNumberForms", () => {
  it("leaves out forms that stand for one number", () => {
    expect(manyNumberForms("en")).toEqual(new Set(["other"]));
    expect(manyNumberForms("ru")).toEqual(new Set(["one", "few", "many"]));
    expect(manyNumberForms("fr")).toEqual(new Set(["one", "many", "other"]));
    expect(manyNumberForms("ar")).toEqual(new Set(["few", "many", "other"]));
    expect(manyNumberForms("ms")).toEqual(new Set(["other"]));
  });
});

describe("the English tables", () => {
  it("keep each key in the area it is named after, and no key twice", () => {
    let total = 0;
    for (const [area, table] of Object.entries(AREAS)) {
      for (const key of Object.keys(table)) {
        const owner = area === "common" ? /^(common|language)\./ : new RegExp(`^${area}\\.`);
        expect(key, `${key} in en/${area}.ts`).toMatch(owner);
      }
      total += Object.keys(table).length;
    }
    expect(Object.keys(EN).length).toBe(total);
  });

  it("have no empty text and no padding", () => {
    for (const [key, text] of Object.entries(english)) {
      expect(text, key).not.toBe("");
      expect(text.trim(), key).toBe(text);
    }
  });

  it("give every plural key its .other", () => {
    for (const key of Object.keys(english)) {
      const form = key.slice(key.lastIndexOf(".") + 1);
      if (form === "one") expect(pluralOther(key), key).not.toBeNull();
    }
  });
});

const files = (() => {
  try {
    return readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
})();

describe.each(files)("locales/%s", (file) => {
  const code = file.replace(/\.json$/, "");
  const table = JSON.parse(readFileSync(join(LOCALES, file), "utf8")) as Record<string, unknown>;

  it("is a language FineNotes offers", () => {
    expect(TRANSLATED_LANGUAGES).toContain(code);
  });

  it("has only English's keys, as non-empty strings", () => {
    for (const [key, text] of Object.entries(table)) {
      const known = Object.prototype.hasOwnProperty.call(english, key) || pluralOther(key) !== null;
      expect(known, `${code}: ${key} is not an English key`).toBe(true);
      expect(typeof text, key).toBe("string");
      expect((text as string).trim(), key).not.toBe("");
    }
  });

  it("keeps every placeholder of the English text, and adds none", () => {
    for (const [key, text] of Object.entries(table)) {
      const source = english[key] ?? english[pluralOther(key) ?? ""] ?? "";
      const want = placeholdersOf(source).filter((p) => p !== "count");
      const got = placeholdersOf(text as string).filter((p) => p !== "count");
      expect(got, `${code}: ${key}`).toEqual(want);
    }
  });

  it("writes {count} in every plural form that stands for more than one number", () => {
    // Russian's "one" is also 21 and 101: only a form that is a single
    // number (English's 1, Arabic's 0 and 2) may spell it out.
    const many = manyNumberForms(code);
    for (const [key, text] of Object.entries(table)) {
      const form = key.slice(key.lastIndexOf(".") + 1);
      const other = pluralOther(key);
      if (!other || !many.has(form)) continue;
      if (!placeholdersOf(english[other] ?? "").includes("count")) continue;
      expect(placeholdersOf(text as string), `${code}: ${key}`).toContain("count");
    }
  });

  it("covers nearly all of English", () => {
    const covered = Object.keys(english).filter(
      (key) => typeof table[key] === "string" || pluralOther(key) !== null,
    ).length;
    expect(covered / Object.keys(english).length, code).toBeGreaterThan(0.95);
  });
});
