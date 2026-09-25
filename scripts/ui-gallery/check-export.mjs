// Check out/export/ is fit to upload as text, and track what the Claude
// Design project holds.
//
//   node scripts/ui-gallery/check-export.mjs             check, write out/manifest.json
//   node scripts/ui-gallery/check-export.mjs --changed   also list files that differ from
//                                                        the last push (out/manifest-pushed.json)
//   node scripts/ui-gallery/check-export.mjs --verify remote.json
//                                                        compare hashes read in the project
//                                                        (sync.js); on a full match, record
//                                                        this export as pushed
//
// Checks: every file under 30 KB and every line under 2,000 characters (files go
// up as text in one tool call, and are read back line by line), and every page's
// paint data parses. Hashes ignore line endings and trailing newlines, as sync.js.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const dir = path.join(out, "export");
const MAX_LINE = 2000;
const MAX_FILE = 30_000;
const problems = [];
const manifest = {};
let total = 0;
for (const name of readdirSync(dir).sort()) {
  const text = readFileSync(path.join(dir, name), "utf8");
  total += text.length;
  const norm = text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  manifest[name] = createHash("sha256").update(norm, "utf8").digest("hex");
  if (text.length > MAX_FILE) problems.push(`${name}: ${text.length} chars (max ${MAX_FILE})`);
  text.split("\n").forEach((line, i) => {
    if (line.length > MAX_LINE) problems.push(`${name}:${i + 1}: line of ${line.length} chars`);
  });
  if (name.endsWith(".html")) {
    for (const m of text.matchAll(/data-gallery-paint='([^']*)'/g)) {
      try {
        JSON.parse(
          m[1]
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">"),
        );
      } catch (e) {
        problems.push(`${name}: paint data does not parse (${e.message})`);
      }
    }
  }
}
console.log(`${Object.keys(manifest).length} files, ${(total / 1024).toFixed(0)} KB`);
console.log(problems.length ? problems.join("\n") : "no problems");
writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1));

const pushedPath = path.join(out, "manifest-pushed.json");
const pushed = existsSync(pushedPath) ? JSON.parse(readFileSync(pushedPath, "utf8")) : {};
if (process.argv.includes("--changed")) {
  // polish.css is the designer's once it is up: never listed for upload.
  const changed = Object.keys(manifest).filter(
    (k) => pushed[k] !== manifest[k] && k !== "polish.css",
  );
  const gone = Object.keys(pushed).filter((k) => !(k in manifest));
  console.log(`changed since the last push (${changed.length}): ${changed.join(" ") || "none"}`);
  if (gone.length) console.log(`no longer exported: ${gone.join(" ")}`);
}
const verifyAt = process.argv.indexOf("--verify");
if (verifyAt > 0) {
  const remote = JSON.parse(readFileSync(process.argv[verifyAt + 1], "utf8"));
  const bad = Object.keys(manifest).filter(
    (k) => k !== "polish.css" && remote[k] !== manifest[k].slice(0, 16),
  );
  if (bad.length) {
    console.log(`differ in the project (${bad.length}): ${bad.join(" ")}`);
  } else {
    copyFileSync(path.join(out, "manifest.json"), pushedPath);
    console.log("the project matches this export; recorded as pushed");
  }
}
process.exit(problems.length ? 1 : 0);
