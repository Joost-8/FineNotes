// node scripts/guide-site/build.mjs [outDir]
//
// Builds the guide's search page for GitHub Pages: one HTML file with the
// guide and the app's own search inlined (src/model/guide-site.ts), so it
// works offline and loads nothing from anywhere else. Default outDir: site/.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = process.argv[2] ?? join(root, "site");

const bundle = await build({
  entryPoints: [join(here, "page.ts")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  logLevel: "silent",
  target: "es2020",
});
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const template = readFileSync(join(here, "template.html"), "utf8");
const html = template.replace("/*SCRIPT*/", () => script);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), html);
console.log(`Guide page: ${join(out, "index.html")} (${Math.round(html.length / 1024)} KB)`);
