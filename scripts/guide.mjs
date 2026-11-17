// npm run guide: turns the wiki in guide/ into src/model/finenotes-guide-data.ts
// (what Ask AI searches) and writes guide/tips.md from the feature index.
//
//   npm run guide            write both
//   npm run guide -- --check exit 1 when either is out of date
//
// The parsing and formatting are the pure module src/model/guide-markdown.ts;
// this script only bundles it with esbuild, reads and writes the files, and
// runs Prettier, so what it writes is what `npm run format:check` expects.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as prettier from "prettier";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const bundle = await build({
  stdin: {
    contents: [
      'export * from "./src/model/guide-markdown";',
      'export { tipRows } from "./src/recognition/finenotes-help";',
      'export { english } from "./src/i18n/translate";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
  // finenotes-help reaches the guide data it is about to rewrite; any copy will do.
  external: ["obsidian"],
});
const lib = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const options = (await prettier.resolveConfig(join(root, "package.json"))) ?? {};
const pretty = (text, parser) => prettier.format(text, { ...options, parser });

const entries = [];
const ids = new Map();
for (const page of lib.GUIDE_PAGES) {
  const file = join(root, "guide", page.file);
  for (const entry of lib.parseGuidePage(readFileSync(file, "utf8"), `guide/${page.file}`)) {
    if (ids.has(entry.id)) {
      throw new Error(`Id "${entry.id}" is in ${ids.get(entry.id)} and guide/${page.file}.`);
    }
    ids.set(entry.id, `guide/${page.file}`);
    entries.push(entry);
  }
}

const outputs = [
  [
    join(root, "src", "model", "finenotes-guide-data.ts"),
    await pretty(lib.formatGuideData(entries), "typescript"),
  ],
  [
    join(root, "guide", "tips.md"),
    await pretty(lib.formatTipsPage(lib.tipRows(lib.english), entries), "markdown"),
  ],
];

let stale = 0;
for (const [file, text] of outputs) {
  let old = "";
  try {
    old = readFileSync(file, "utf8");
  } catch {
    // A file not written yet is out of date.
  }
  if (old === text) continue;
  stale++;
  if (check) console.log(`Out of date: ${file}`);
  else writeFileSync(file, text);
}
console.log(
  check
    ? stale === 0
      ? `The guide is up to date (${entries.length} entries).`
      : "Run npm run guide."
    : `${entries.length} entries; ${stale} file(s) written.`,
);
if (check && stale > 0) process.exit(1);
