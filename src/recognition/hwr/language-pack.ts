/**
 * A language pack: Grape's character language model and word list for one
 * language other than English, so a page written in it is read with its
 * own letters' statistics and checked against its own words (Grape's model
 * file carries only English ones). Measured on unseen writers (RESEARCH-LOG
 * 2026-11-25), Dutch reads at 3.2 % CER with its pack against 9.1 % with
 * the English model and 5.8 % with none.
 *
 * Built by research/handwriting-rig/lang/build_lang_lm.py from Mozilla
 * Common Voice's CC0 sentences, accents dropped (Grape writes ASCII).
 *
 * File: "FNLP", u32 format version, u32 header length, the JSON header
 * (`LanguagePackMeta`), then sections, each a 4-byte tag, a u32 size and
 * the payload padded to 4 bytes: "LM01" (the character model, exactly as
 * in a model file: bundle.ts, char-lm.ts) and "WORD" (UTF-8, one word a
 * line, as words.txt).
 *
 * PURE: no DOM, no Obsidian.
 */

import { CharLm, type CharLmMeta } from "./char-lm";
import { PAGE_LANGUAGES, type PageLanguage } from "./page-language";

const MAGIC = 0x504c4e46; // "FNLP", little-endian

/** The pack format this build reads. */
export const PACK_FORMAT = 1;

export interface LanguagePackMeta {
  format: "finenotes-language";
  /** Which language (page-language.ts); never "en". */
  language: PageLanguage;
  name: string;
  licence: string;
  exported: string;
  lm: CharLmMeta & { minCount?: number };
  /** How many words the list has. */
  words: number;
  /**
   * Whether the list may underline words it lacks: only where it measured
   * about as few false alarms on correct words as the English list (French,
   * Spanish, Italian; Dutch, German and Portuguese lists lack too much study
   * vocabulary, RESEARCH-LOG 2026-11-25). Their words are still suggested
   * when the writer asks to correct one.
   */
  underline?: boolean;
}

export interface LanguagePack {
  meta: LanguagePackMeta;
  lm: CharLm;
  /** The word list, lower case. */
  words: string[];
}

export class LanguagePackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanguagePackError";
  }
}

/** The format version in a pack's header; null when the bytes are not a pack. */
export function packFormatOf(bytes: ArrayBuffer | Uint8Array): number | null {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (src.byteLength < 8) return null;
  const view = new DataView(src.buffer, src.byteOffset, 8);
  return view.getUint32(0, true) === MAGIC ? view.getUint32(4, true) : null;
}

interface Sections {
  meta: LanguagePackMeta;
  buffer: ArrayBuffer;
  lm: { start: number; size: number } | null;
  words: string[];
}

function readSections(bytes: ArrayBuffer | Uint8Array): Sections {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // One aligned copy, which the model's typed arrays then view.
  const buffer = new ArrayBuffer(src.byteLength);
  new Uint8Array(buffer).set(src);
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== MAGIC) {
    throw new LanguagePackError("not a FineNotes language pack (no FNLP header)");
  }
  const version = view.getUint32(4, true);
  if (version !== PACK_FORMAT) {
    throw new LanguagePackError(
      `language pack version ${version}; this build reads ${PACK_FORMAT}`,
    );
  }
  const metaLength = view.getUint32(8, true);
  if (12 + metaLength > buffer.byteLength) {
    throw new LanguagePackError("the pack ends inside its header");
  }
  const meta = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 12, metaLength)),
  ) as LanguagePackMeta;
  if (
    meta.format !== "finenotes-language" ||
    !isLanguage(meta.language) ||
    meta.language === "en"
  ) {
    throw new LanguagePackError("the pack's header names no language this build reads");
  }
  let lm: Sections["lm"] = null;
  let words: string[] = [];
  let o = 12 + metaLength;
  while (o + 8 <= buffer.byteLength) {
    const tag = String.fromCharCode(...new Uint8Array(buffer, o, 4));
    const size = view.getUint32(o + 4, true);
    const start = o + 8;
    if (start + size > buffer.byteLength) {
      throw new LanguagePackError(`section ${tag} runs past the end of the pack`);
    }
    if (tag === "LM01") lm = { start, size };
    else if (tag === "WORD") {
      words = new TextDecoder()
        .decode(new Uint8Array(buffer, start, size))
        .split("\n")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
    }
    o = start + size + ((4 - (size % 4)) % 4);
  }
  return { meta, buffer, lm, words };
}

function isLanguage(value: unknown): value is PageLanguage {
  return (PAGE_LANGUAGES as readonly unknown[]).includes(value);
}

/** Read a pack: its header, character model and word list. */
export function parseLanguagePack(bytes: ArrayBuffer | Uint8Array): LanguagePack {
  const { meta, buffer, lm, words } = readSections(bytes);
  if (!lm) throw new LanguagePackError("the pack has no language model");
  return { meta, lm: CharLm.fromSection(meta.lm, buffer, lm.start, lm.size), words };
}

/** A pack's language and word list only, without building its model (for the main thread). */
export function packWords(bytes: ArrayBuffer | Uint8Array): {
  language: PageLanguage;
  words: string[];
  underline: boolean;
} {
  const { meta, words } = readSections(bytes);
  return { language: meta.language, words, underline: meta.underline === true };
}

/** A pack's bytes (the build script writes the same in Python; this is for tests and tools). */
export function writeLanguagePack(
  meta: LanguagePackMeta,
  lmPayload: Uint8Array,
  words: readonly string[],
): Uint8Array {
  const pad = (b: Uint8Array, fill: number): Uint8Array => {
    const out = new Uint8Array(b.length + ((4 - (b.length % 4)) % 4)).fill(fill);
    out.set(b);
    return out;
  };
  const head = pad(new TextEncoder().encode(JSON.stringify(meta)), 0x20);
  const sections: [string, Uint8Array][] = [
    ["LM01", lmPayload],
    ["WORD", new TextEncoder().encode(words.join("\n") + "\n")],
  ];
  const size = 12 + head.length + sections.reduce((n, [, p]) => n + 8 + pad(p, 0).length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, PACK_FORMAT, true);
  view.setUint32(8, head.length, true);
  out.set(head, 12);
  let o = 12 + head.length;
  for (const [tag, payload] of sections) {
    for (let i = 0; i < 4; i++) out[o + i] = tag.charCodeAt(i);
    view.setUint32(o + 4, payload.length, true);
    out.set(pad(payload, 0), o + 8);
    o += 8 + pad(payload, 0).length;
  }
  return out;
}
