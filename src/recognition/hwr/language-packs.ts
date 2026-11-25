/**
 * Grape's language packs as this build downloads them (language-pack.ts):
 * one per language other than English, pinned by size and SHA-256, made by
 * research/handwriting-rig/lang/build_lang_lm.py from Common Voice's CC0
 * text. Each is offered the first time a page in its language is read
 * (view/language-packs.ts), never in advance.
 *
 * PURE: data only.
 */

import type { ModelAsset } from "../../downloads/model-manifest";
import { t } from "../../i18n/translate";
import { INTERFACE_LANGUAGES } from "../../i18n/languages";
import { PACK_FORMAT } from "./language-pack";
import type { PageLanguage } from "./page-language";

const RELEASE = "https://github.com/Joost-8/Grape/releases/download/languages-v1.0";

/**
 * Whether the packs are published at `RELEASE`. False until the release is
 * made (a public step, on Joost's word): a pack is then used only where its
 * file is already in the folder (by sync, or copied there), and nothing is
 * offered for download.
 */
export const LANGUAGE_PACKS_HOSTED = false;

/** Version 1.0 of each pack: its file's size and SHA-256. */
const PACKS: Record<Exclude<PageLanguage, "en">, { bytes: number; sha256: string }> = {
  nl: {
    bytes: 1_129_280,
    sha256: "35764c3c4465d3b53857e786846f6b0d18d1904e5a56663da2d2e858c8ad0671",
  },
  de: {
    bytes: 1_805_084,
    sha256: "ad54d7ad87f8fa968abcd5769550c457f0c189527b80dbfc13a0344c30efbae7",
  },
  fr: {
    bytes: 1_816_540,
    sha256: "d2f94ff3dde2788b098b67136bad83c4b9a4007ad30982587062d657d2d2d42f",
  },
  es: {
    bytes: 1_035_724,
    sha256: "49c57d56f28fc524c671bdf9dd85182a4e5c350d7f1dc51f0f1b359c633e8e75",
  },
  pt: {
    bytes: 1_212_748,
    sha256: "adb9a4c389ee12a8e127dd15b998229411ca63de4fc93263f08a708c849d693b",
  },
  it: {
    bytes: 1_615_892,
    sha256: "3eec19f1f7e0f75ccac4992754eb09814298ad5c316c98bcc1d22f11ed446561",
  },
};

/** The languages a pack exists for. */
export const PACK_LANGUAGES = Object.keys(PACKS) as Exclude<PageLanguage, "en">[];

/** A language's name in itself ("Nederlands"), as the interface menu names it. */
export function languageName(language: PageLanguage): string {
  return INTERFACE_LANGUAGES.find((l) => l.code === language)?.name ?? language;
}

/** The download for `language`'s pack, or null when there is none. */
export function languagePackAsset(language: PageLanguage): ModelAsset | null {
  if (language === "en") return null;
  const pin = PACKS[language];
  if (!pin) return null;
  const name = `grape-lang-${language}-1.0.bin`;
  return {
    id: `grape-lang-${language}`,
    get label() {
      return t("ai.grape.packLabel", { language: languageName(language) });
    },
    get purpose() {
      return t("ai.grape.packPurpose", { language: languageName(language) });
    },
    version: "1.0",
    format: PACK_FORMAT,
    folder: "handwriting/languages",
    files: [{ name, url: `${RELEASE}/${name}`, bytes: pin.bytes, sha256: pin.sha256 }],
    prefix: `grape-lang-${language}-`,
    suffix: ".bin",
  };
}
