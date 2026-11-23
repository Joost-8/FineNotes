#!/usr/bin/env node
/**
 * Writes src/translate/catalog.ts: the translation engine and language
 * models FineNotes downloads, pinned by URL, size and SHA-256, taken from
 * the Remote Settings collections Firefox's own translations read
 * (Mozilla's Bergamot project; engine MPL-2.0, models MPL-2.0).
 *
 *   node scripts/translate-catalog.mjs
 *
 * - The engine is Bergamot 3.x: it reads models 1.x and 2.x (Firefox's
 *   TranslationsParent.sys.mjs). Bergamot 4.x and models 3.x are zstd
 *   compressed and are not used.
 * - Per language pair, the newest released (no "a" pre-release) model of
 *   major version 1 or 2; each other file is the newest of its kind at or
 *   below that version.
 * - Language detection is fastText's lid.176 model with Mozilla's fastText
 *   WebAssembly build, from the same service.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = "https://firefox.settings.services.mozilla.com/v1/buckets/main/collections";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/translate/catalog.ts");

async function records(collection) {
  const answer = await fetch(`${SERVER}/${collection}/records`);
  if (!answer.ok) throw new Error(`${collection}: HTTP ${answer.status}`);
  return (await answer.json()).data;
}

const info = await (await fetch("https://firefox.settings.services.mozilla.com/v1/")).json();
const base = info.capabilities.attachments.base_url;

/** "2.1" → [2, 1]; null for a pre-release. */
function version(text) {
  if (!/^\d+(\.\d+)*$/.test(text)) return null;
  return text.split(".").map(Number);
}
function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
function file(record, name) {
  return {
    name,
    url: base + record.attachment.location,
    bytes: record.attachment.size,
    sha256: record.attachment.hash,
  };
}
function newest(list) {
  return [...list].sort((a, b) => compare(version(b.version), version(a.version)))[0];
}

const wasm = await records("translations-wasm");
const bergamot = newest(
  wasm.filter((r) => r.name === "bergamot-translator" && version(r.version)?.[0] === 3),
);
const fasttext = newest(
  wasm.filter((r) => r.name === "fasttext-wasm" && version(r.version) !== null),
);
const lid = newest(
  (await records("translations-identification-models")).filter(
    (r) => r.name === "lid.176.ftz" && version(r.version) !== null,
  ),
);
if (!bergamot || !fasttext || !lid) throw new Error("engine files not found");

/**
 * What Firefox on the desktop, release channel, gets: records with no
 * filter, or one for "not Android" (some pairs have an Android build of
 * their own, and pre-release ones for Nightly and Beta).
 */
function forDesktopRelease(filter) {
  const f = (filter ?? "").trim();
  return f === "" || f.startsWith("env.appinfo.OS != 'Android'");
}

const models = (await records("translations-models")).filter((r) => {
  const v = version(r.version);
  return v !== null && (v[0] === 1 || v[0] === 2) && forDesktopRelease(r.filter_expression);
});
const byPair = new Map();
for (const r of models) {
  const key = `${r.fromLang}|${r.toLang}`;
  if (!byPair.has(key)) byPair.set(key, []);
  byPair.get(key).push(r);
}

const pairs = [];
for (const [key, list] of [...byPair].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const [from, to] = key.split("|");
  const model = newest(list.filter((r) => r.fileType === "model"));
  if (!model) continue;
  const at = version(model.version);
  const pick = (type) =>
    newest(list.filter((r) => r.fileType === type && compare(version(r.version), at) <= 0));
  const vocab = pick("vocab");
  const src = pick("srcvocab");
  const trg = pick("trgvocab");
  const lex = pick("lex");
  const files = [file(model, "model.bin")];
  if (vocab) files.push(file(vocab, "vocab.spm"));
  else if (src && trg) files.push(file(src, "srcvocab.spm"), file(trg, "trgvocab.spm"));
  else continue;
  if (lex) files.push(file(lex, "lex.bin"));
  pairs.push({
    from,
    to,
    version: model.version,
    precision: model.name.endsWith("intgemm8.bin") ? "int8shiftAll" : "int8shiftAlphaAll",
    files,
  });
}

/**
 * FineNotes downloads its copies, from a release of FineNotes-templates
 * (Mozilla's own server refuses Chrome-like user agents, so Obsidian on the
 * desktop cannot download from it). Each file is renamed there to be
 * unique in the release: `nl-en-2.0.model.bin`, `bergamot-3.0.wasm`.
 */
const RELEASE = "https://github.com/Joost-8/FineNotes-templates/releases/download/translate-1/";

const json = (value) => JSON.stringify(value);
const NL = String.fromCharCode(10);
/** Every file: its name in the release, where Mozilla serves it, size, hash. */
const sources = [];
const mirrored = (f, asset) => {
  sources.push({ asset, from: f.url, bytes: f.bytes, sha256: f.sha256 });
  return asset;
};
const engine = [
  [bergamot, "bergamot.wasm", `bergamot-${bergamot.version}.wasm`],
  [fasttext, "fasttext.wasm", `fasttext-${fasttext.version}.wasm`],
  [lid, "lid.176.ftz", "lid.176.ftz"],
].map(([record, name, asset]) => {
  const f = file(record, name);
  return { ...f, url: RELEASE + mirrored(f, asset) };
});
const lines = pairs.map((p) => {
  const files = p.files.map((f) => [
    f.name,
    mirrored(f, `${p.from}-${p.to}-${p.version}.${f.name}`),
    f.bytes,
    f.sha256,
  ]);
  return `    ${json([p.from, p.to, p.version, p.precision === "int8shiftAll" ? 1 : 0, files])},`;
});
const out = `/**
 * GENERATED by scripts/translate-catalog.mjs from Mozilla's Remote Settings
 * (the collections Firefox's translations read). Do not edit by hand: run
 * the script again to move to newer models, then mirror the new files with
 * scripts/translate-mirror.mjs.
 *
 * The engine (Bergamot ${bergamot.version}, MPL-2.0), language detection
 * (fastText ${fasttext.version} with lid.176, MIT / CC BY-SA 3.0) and ${pairs.length}
 * one-way language models (MPL-2.0), each file pinned by size and SHA-256,
 * downloaded from FineNotes' own copies in the \`translate-1\` release of
 * Joost-8/FineNotes-templates. A pair is [from, to, version, intgemm8 (1)
 * or alphas (0), files]; a file is [name, file in MODELS_URL, bytes, sha256].
 *
 * PURE: data only.
 */

import type { CompactPair } from "./catalog-types";
import type { ModelFile } from "../downloads/model-manifest";

export const MODELS_URL = ${json(RELEASE)};

export const ENGINE_VERSION = ${json(bergamot.version)};

export const ENGINE_FILES: readonly ModelFile[] = ${JSON.stringify(engine, null, 2)};

// prettier-ignore
export const PAIRS: readonly CompactPair[] = [
${lines.join(NL)}
];
`;
writeFileSync(OUT, out);
const SOURCES = resolve(dirname(OUT), "../../scripts/translate-sources.json");
writeFileSync(SOURCES, JSON.stringify(sources, null, 1) + NL);
// In the repository's own style, so a run with no new models changes nothing.
execFileSync("npx", ["prettier", "--write", OUT, SOURCES], { stdio: "ignore", shell: true });
const total = sources.reduce((sum, s) => sum + s.bytes, 0);
console.log(
  `${pairs.length} pairs, engine ${bergamot.version}, ${sources.length} files, ` +
    `${(total / 1e9).toFixed(2)} GB → ${OUT}`,
);
