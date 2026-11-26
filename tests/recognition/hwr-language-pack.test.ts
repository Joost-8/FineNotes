import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import {
  type LanguagePackMeta,
  LanguagePackError,
  PACK_FORMAT,
  packFormatOf,
  packWords,
  parseLanguagePack,
  writeLanguagePack,
} from "../../src/recognition/hwr/language-pack";
import {
  LANGUAGE_PACKS_HOSTED,
  PACK_LANGUAGES,
  languageName,
  languagePackAsset,
} from "../../src/recognition/hwr/language-packs";
import { Lexicon } from "../../src/recognition/hwr/lexicon";
import { type LanguageModel, pageDecodeOptions } from "../../src/recognition/hwr/recognizer";

/** Grape 2.0's own LM section and header, as a stand-in for a language's (same format). */
function grapeLm(): { payload: Uint8Array; meta: LanguagePackMeta["lm"] } {
  const bytes = readFileSync("models/grape-2.0.bin");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLength = view.getUint32(8, true);
  const meta = JSON.parse(bytes.subarray(12, 12 + metaLength).toString("utf8")) as {
    lm: LanguagePackMeta["lm"];
  };
  let o = 12 + metaLength;
  while (o + 8 <= bytes.byteLength) {
    const tag = bytes.subarray(o, o + 4).toString("latin1");
    const size = view.getUint32(o + 4, true);
    if (tag === "LM01")
      return { payload: new Uint8Array(bytes.subarray(o + 8, o + 8 + size)), meta: meta.lm };
    o += 8 + size + ((4 - (size % 4)) % 4);
  }
  throw new Error("no LM01 in grape-2.0.bin");
}

function packMeta(over: Partial<LanguagePackMeta> = {}): LanguagePackMeta {
  const { meta } = grapeLm();
  return {
    format: "finenotes-language",
    language: "nl",
    name: "test pack",
    licence: "CC0",
    exported: "2026-11-25",
    lm: meta,
    words: 3,
    underline: false,
    ...over,
  };
}

describe("a language pack's file", () => {
  it("reads back its model, exactly as the model file's, and its words", () => {
    const { payload } = grapeLm();
    const bytes = writeLanguagePack(packMeta(), payload, ["Tentamen", "college", "en"]);
    expect(packFormatOf(bytes)).toBe(PACK_FORMAT);
    const pack = parseLanguagePack(bytes);
    expect(pack.meta.language).toBe("nl");
    expect(pack.words).toEqual(["tentamen", "college", "en"]);
    const grape = parseBundle(readFileSync("models/grape-2.0.bin"));
    for (const [history, ch] of [
      ["the ", "q"],
      ["hoofdstu", "k"],
      ["", "x"],
    ] as const) {
      expect(pack.lm.prob(history, ch)).toBe(grape.lm?.prob(history, ch));
    }
  });

  it("gives its words and whether they underline without building the model", () => {
    const { payload } = grapeLm();
    const read = packWords(writeLanguagePack(packMeta({ underline: true }), payload, ["a1", "b2"]));
    expect(read).toEqual({ language: "nl", words: ["a1", "b2"], underline: true });
    expect(
      packWords(writeLanguagePack(packMeta({ underline: undefined }), payload, [])).underline,
    ).toBe(false);
  });

  it("refuses what is not a pack it can read", () => {
    const { payload } = grapeLm();
    expect(packFormatOf(new Uint8Array(4))).toBeNull();
    expect(() => parseLanguagePack(readFileSync("models/grape-2.0.bin"))).toThrow(
      LanguagePackError,
    );
    const english = writeLanguagePack(packMeta({ language: "en" }), payload, []);
    expect(() => parseLanguagePack(english)).toThrow(/no language/);
    const later = writeLanguagePack(packMeta(), payload, []);
    new DataView(later.buffer).setUint32(4, PACK_FORMAT + 1, true);
    expect(() => parseLanguagePack(later)).toThrow(/version/);
    expect(() =>
      parseLanguagePack(writeLanguagePack(packMeta(), payload, []).subarray(0, 40)),
    ).toThrow(LanguagePackError);
  });
});

describe("a pack's word list in the reader", () => {
  it("does not get the English one- and two-letter words an English list gets", () => {
    expect(new Lexicon(["tentamen"]).size).toBeGreaterThan(1);
    expect(new Lexicon(["tentamen"], false).size).toBe(1);
  });
});

describe("the packs this build downloads", () => {
  it("has one pinned file per language Grape reads besides English, none for English", () => {
    expect(PACK_LANGUAGES.sort()).toEqual(["de", "es", "fr", "it", "nl", "pt"]);
    expect(languagePackAsset("en")).toBeNull();
    for (const language of PACK_LANGUAGES) {
      const asset = languagePackAsset(language);
      expect(asset?.id).toBe(`grape-lang-${language}`);
      expect(asset?.files).toHaveLength(1);
      const file = asset?.files[0];
      expect(file?.name.startsWith(asset?.prefix ?? "?")).toBe(true);
      expect(file?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file?.bytes).toBeGreaterThan(500_000);
      expect(file?.url).toContain(file?.name ?? "?");
    }
  });

  it("names a language in itself, and is not offered until published", () => {
    expect(languageName("nl")).toBe("Nederlands");
    expect(languageName("de")).toBe("Deutsch");
    expect(LANGUAGE_PACKS_HOSTED).toBe(false);
  });
});

describe("how a page in a language is decoded (pageDecodeOptions)", () => {
  const grape = parseBundle(readFileSync("models/grape-2.0.bin"));
  const lexicon = new Lexicon(["tentamen"]);
  const nl: LanguageModel = {
    lm: grape.lm as NonNullable<typeof grape.lm>,
    rereadList: { lexicon, words: new Set(["tentamen"]) },
  };
  const english = { lexicon: new Lexicon(["exam"]), words: new Set(["exam"]) };
  const models = new Map([["nl", nl] as const]);

  it("reads English as asked", () => {
    const options = { rereadList: english, languageModels: models };
    expect(pageDecodeOptions("en", options)).toBe(options);
  });

  it("reads a language with a pack with its model and its own list", () => {
    const decode = pageDecodeOptions("nl", { rereadList: english, languageModels: models });
    expect(decode.lm).toBe(nl.lm);
    expect(decode.rereadList).toBe(nl.rereadList);
    expect(decode.useLm).not.toBe(false);
    expect(
      pageDecodeOptions("nl", { reread: false, languageModels: models }).rereadList,
    ).toBeNull();
  });

  it("reads a language without a pack without any model", () => {
    expect(pageDecodeOptions("de", { rereadList: english, languageModels: models }).useLm).toBe(
      false,
    );
    expect(pageDecodeOptions("nl", { useLm: false, languageModels: models }).useLm).toBe(false);
  });
});
