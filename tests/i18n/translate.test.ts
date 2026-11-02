import { afterEach, describe, expect, it } from "vitest";
import {
  currentLanguage,
  placeholdersOf,
  t,
  tn,
  useLanguage,
  type TextKey,
  type PluralKey,
} from "../../src/i18n/translate";
import {
  FOLLOW_OBSIDIAN,
  INTERFACE_LANGUAGES,
  TRANSLATED_LANGUAGES,
  interfaceLanguageOf,
  resolveLanguage,
} from "../../src/i18n/languages";
import { cachePath, readCache, tableOf, tableUrl, writeCache } from "../../src/i18n/table-file";

afterEach(() => useLanguage("en"));

// A key that is no text, to see what a lookup does without one.
const UNKNOWN = "nowhere.atAll" as TextKey;

describe("t", () => {
  it("gives English by default", () => {
    expect(currentLanguage()).toBe("en");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("gives the language's own text, and English for what it lacks", () => {
    useLanguage("de", { "common.cancel": "Abbrechen" });
    expect(currentLanguage()).toBe("de");
    expect(t("common.cancel")).toBe("Abbrechen");
    expect(t("common.delete")).toBe("Delete");
  });

  it("treats an empty translation as missing", () => {
    useLanguage("de", { "common.cancel": "" });
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("shows the key for a text nobody has", () => {
    expect(t(UNKNOWN)).toBe("nowhere.atAll");
  });

  it("fills placeholders, and leaves one without a value as written", () => {
    expect(t("language.follow", { language: "Deutsch" })).toBe("Follow Obsidian (Deutsch)");
    expect(t("language.follow")).toBe("Follow Obsidian ({language})");
    useLanguage("de", { "language.follow": "Wie Obsidian ({language}) {other}" });
    expect(t("language.follow", { language: "Deutsch" })).toBe("Wie Obsidian (Deutsch) {other}");
  });

  it("is not fooled by inherited names in the table or in the values", () => {
    useLanguage("de", {});
    expect(t("toString" as TextKey)).toBe("toString");
    expect(t("language.follow", Object.create({ language: "x" }) as Record<string, string>)).toBe(
      "Follow Obsidian ({language})",
    );
  });

  it("English as a code ignores any table handed in", () => {
    useLanguage("en", { "common.cancel": "Nope" });
    expect(t("common.cancel")).toBe("Cancel");
  });
});

describe("tn", () => {
  // Plural forms are tested through a table, so the test holds whatever
  // English plural keys the areas have.
  const KEY = "test.pages" as PluralKey;

  it("picks the language's plural form, and .other where a form is missing", () => {
    useLanguage("pl", {
      "test.pages.one": "{count} strona",
      "test.pages.few": "{count} strony",
      "test.pages.many": "{count} stron",
    });
    expect(tn(KEY, 1)).toBe("1 strona");
    expect(tn(KEY, 3)).toBe("3 strony");
    expect(tn(KEY, 5)).toBe("5 stron");
    useLanguage("pl", { "test.pages.other": "{count} stron(y)" });
    expect(tn(KEY, 3)).toBe("3 stron(y)");
  });

  it("falls back to the key when no form exists anywhere", () => {
    expect(tn(KEY, 2)).toBe("test.pages");
  });

  it("survives a code Intl does not know", () => {
    useLanguage("kh", { "test.pages.other": "{count} ទំព័រ" });
    expect(tn(KEY, 4)).toBe("4 ទំព័រ");
  });

  it("fills extra values next to the count", () => {
    useLanguage("de", { "test.pages.other": "{count} Seiten in {name}" });
    expect(tn(KEY, 2, { name: "Mathe" })).toBe("2 Seiten in Mathe");
  });
});

describe("placeholdersOf", () => {
  it("lists each name once, sorted", () => {
    expect(placeholdersOf("{b} and {a} and {b}")).toEqual(["a", "b"]);
    expect(placeholdersOf("none")).toEqual([]);
  });
});

describe("resolveLanguage", () => {
  it("follows Obsidian when asked to", () => {
    expect(resolveLanguage(FOLLOW_OBSIDIAN, "de")).toBe("de");
    expect(resolveLanguage(undefined, "ja")).toBe("ja");
  });

  it("takes the choice over Obsidian's", () => {
    expect(resolveLanguage("fr", "de")).toBe("fr");
  });

  it("matches without case, through aliases, and by the base language", () => {
    expect(resolveLanguage("auto", "PT-br")).toBe("pt-BR");
    expect(resolveLanguage("auto", "zh-cn")).toBe("zh");
    expect(resolveLanguage("auto", "nb")).toBe("no");
    expect(resolveLanguage("auto", "de-AT")).toBe("de");
    expect(resolveLanguage("auto", "pt_PT")).toBe("pt");
    expect(resolveLanguage("auto", "en-GB")).toBe("en");
  });

  it("falls back to English for anything else", () => {
    expect(resolveLanguage("auto", "xx")).toBe("en");
    expect(resolveLanguage("auto", "")).toBe("en");
    expect(resolveLanguage("auto", undefined)).toBe("en");
    expect(resolveLanguage("auto", "constructor")).toBe("en");
  });

  it("follows Obsidian when the stored choice is unknown", () => {
    expect(resolveLanguage("klingon", "it")).toBe("it");
  });
});

describe("the language list", () => {
  it("has English first and no code twice", () => {
    const codes = INTERFACE_LANGUAGES.map((l) => l.code);
    expect(codes[0]).toBe("en");
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThanOrEqual(40);
    expect(TRANSLATED_LANGUAGES).not.toContain("en");
    expect(TRANSLATED_LANGUAGES.length).toBe(codes.length - 1);
  });

  it("keeps only known stored choices", () => {
    expect(interfaceLanguageOf("de")).toBe("de");
    expect(interfaceLanguageOf("auto")).toBe("auto");
    expect(interfaceLanguageOf("xx")).toBe("auto");
    expect(interfaceLanguageOf(3)).toBe("auto");
    expect(interfaceLanguageOf(undefined)).toBe("auto");
  });
});

describe("table files", () => {
  it("publishes at the version's tag", () => {
    expect(tableUrl("2.8.0", "pt-BR")).toBe(
      "https://raw.githubusercontent.com/Joost-8/FineNotes/2.8.0/src/i18n/locales/pt-BR.json",
    );
    expect(cachePath(".obsidian/plugins/finenotes", "de")).toBe(
      ".obsidian/plugins/finenotes/languages/de.json",
    );
  });

  it("keeps only non-empty strings", () => {
    expect(tableOf({ a: "x", b: 3, c: "", d: null })).toEqual({ a: "x" });
    expect(tableOf([])).toBeNull();
    expect(tableOf("x")).toBeNull();
    expect(tableOf(null)).toBeNull();
  });

  it("round-trips the cache, and refuses a damaged one", () => {
    const json = writeCache("2.8.0", { "common.cancel": "Abbrechen" });
    expect(readCache(json)).toEqual({ version: "2.8.0", texts: { "common.cancel": "Abbrechen" } });
    expect(readCache("{")).toBeNull();
    expect(readCache("null")).toBeNull();
    expect(readCache(JSON.stringify({ version: 1, texts: {} }))).toBeNull();
    expect(readCache(JSON.stringify({ version: "1", texts: [] }))).toBeNull();
  });
});
