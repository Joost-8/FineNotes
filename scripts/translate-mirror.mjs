#!/usr/bin/env node
/**
 * Mirrors the translation files (scripts/translate-sources.json, written by
 * translate-catalog.mjs) to the `translate-1` release of
 * Joost-8/FineNotes-templates, where the plugin downloads them.
 *
 *   node scripts/translate-mirror.mjs <work folder> [--notes-only]
 *
 * - Creates the release when it is missing, with notes listing every file,
 *   its size and SHA-256, and the licences.
 * - One file at a time: download from Mozilla, check size and SHA-256,
 *   upload, delete. A file already in the release with the right size is
 *   skipped, so a run that stopped can simply be started again.
 * - Pushes nothing to git and makes no tag in the FineNotes repository.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Joost-8/FineNotes-templates";
const TAG = "translate-1";
const HERE = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(HERE, "translate-sources.json"), "utf8"));
const work = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: translate-mirror.mjs <work folder>");
mkdirSync(work, { recursive: true });

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20 });

function notes() {
  const total = sources.reduce((sum, s) => sum + s.bytes, 0);
  const rows = sources.map(
    (s) => `| ${s.asset} | ${s.bytes.toLocaleString("en")} B | ${s.sha256} |`,
  );
  return [
    'Translation files for FineNotes\' "Translate" (selected text, translated on the device).',
    "The plugin downloads the engine and the language models it needs on first use and checks each by size and SHA-256.",
    "",
    "Unchanged copies of the files Firefox's own translations use, from Mozilla's Remote Settings:",
    "- the Bergamot translation engine (WebAssembly) and the language models: Mozilla, MPL-2.0 (https://www.mozilla.org/MPL/2.0/; source: https://github.com/mozilla/translations);",
    "- fastText's WebAssembly build: Facebook, MIT; the lid.176 language identification model: Facebook, CC BY-SA 3.0 (https://fasttext.cc/docs/en/language-identification.html).",
    "",
    "A model is named `<from>-<to>-<version>.<file>`; translations between two languages other than English go through English.",
    "",
    `${sources.length} files, ${(total / 1e9).toFixed(2)} GB.`,
    "",
    "| File | Size | SHA-256 |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function releaseAssets() {
  try {
    const out = gh("api", "--paginate", `repos/${REPO}/releases/tags/${TAG}`, "--jq", ".id");
    const id = out.trim().split("\n")[0];
    const listed = gh(
      "api",
      "--paginate",
      `repos/${REPO}/releases/${id}/assets?per_page=100`,
      "--jq",
      ".[] | [.name, .size] | @tsv",
    );
    const map = new Map();
    for (const line of listed.trim().split("\n")) {
      if (!line) continue;
      const [name, size] = line.split("\t");
      map.set(name, Number(size));
    }
    return map;
  } catch {
    return null;
  }
}

const notesFile = join(work, "NOTES.md");
writeFileSync(notesFile, notes());
let have = releaseAssets();
if (!have) {
  gh(
    "release",
    "create",
    TAG,
    "-R",
    REPO,
    "--title",
    "Translation models 1",
    "--notes-file",
    notesFile,
    "--latest=false",
  );
  have = new Map();
  console.log(`created release ${TAG}`);
} else {
  gh("release", "edit", TAG, "-R", REPO, "--notes-file", notesFile);
}
if (process.argv.includes("--notes-only")) process.exit(0);

let done = 0;
let skipped = 0;
for (const s of sources) {
  if (have.get(s.asset) === s.bytes) {
    skipped++;
    continue;
  }
  const path = join(work, s.asset);
  let bytes = null;
  for (let attempt = 1; attempt <= 3 && !bytes; attempt++) {
    const answer = await fetch(s.from);
    const body = answer.ok ? Buffer.from(await answer.arrayBuffer()) : null;
    const sha = body ? createHash("sha256").update(body).digest("hex") : "";
    if (body && body.length === s.bytes && sha === s.sha256) bytes = body;
    else console.warn(`${s.asset}: attempt ${attempt} failed (HTTP ${answer.status})`);
  }
  if (!bytes) throw new Error(`${s.asset}: could not download a verified copy`);
  writeFileSync(path, bytes);
  if (have.has(s.asset)) gh("release", "delete-asset", TAG, s.asset, "-R", REPO, "-y");
  gh("release", "upload", TAG, path, "-R", REPO);
  rmSync(path);
  done++;
  console.log(`${done + skipped}/${sources.length} ${s.asset}`);
}
console.log(`uploaded ${done}, already there ${skipped}`);
