// Copy Obsidian's own stylesheet and icon table out of the locally installed
// app, into .cache/ (gitignored: both are Obsidian's, not ours to publish).
//
//   node scripts/ui-gallery/extract-obsidian.mjs [path/to/obsidian.asar]
//
// The asar reader is read-only and needs nothing but node:fs.
import { existsSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, ".cache");

const candidates = [
  process.argv[2],
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, "Programs/Obsidian/resources/obsidian.asar"),
  "/Applications/Obsidian.app/Contents/Resources/obsidian.asar",
  path.join(homedir(), "Applications/Obsidian.app/Contents/Resources/obsidian.asar"),
  "/opt/Obsidian/resources/obsidian.asar",
  "/usr/lib/obsidian/obsidian.asar",
].filter(Boolean);
const archive = candidates.find((p) => existsSync(p));
if (!archive) {
  console.error(
    "Obsidian not found. Pass the path to obsidian.asar. Tried:\n  " + candidates.join("\n  "),
  );
  process.exit(1);
}

const fd = openSync(archive, "r");
const head = Buffer.alloc(16);
readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(4);
const jsonLen = head.readUInt32LE(12);
const json = Buffer.alloc(jsonLen);
readSync(fd, json, 0, jsonLen, 16);
const header = JSON.parse(json.toString("utf8"));
const base = 8 + headerSize;

function read(name) {
  const entry = header.files?.[name];
  if (!entry) throw new Error(`${name} not in ${archive}`);
  const buf = Buffer.alloc(entry.size);
  readSync(fd, buf, 0, entry.size, base + Number(entry.offset));
  return buf.toString("utf8");
}

// The Lucide table is one object literal in app.js: const Um={"a-arrow-down":[…
function iconTable(src) {
  const start = src.search(/=\{"a-arrow-down":\[/);
  if (start < 0) throw new Error("icon table not found in app.js");
  let i = src.indexOf("{", start);
  const open = i;
  let depth = 0;
  let inStr = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  // Keys are bare identifiers or strings, values arrays of numbers/strings:
  // evaluate the literal alone, never the rest of app.js.
  return new Function(`return ${src.slice(open, i + 1)}`)();
}

mkdirSync(cache, { recursive: true });
const css = read("app.css");
writeFileSync(path.join(cache, "obsidian-app.css"), css);
const icons = iconTable(read("app.js"));
writeFileSync(path.join(cache, "lucide.json"), JSON.stringify(icons));
console.log(`from ${archive}`);
console.log(`  .cache/obsidian-app.css  ${(css.length / 1024).toFixed(0)} KB`);
console.log(`  .cache/lucide.json       ${Object.keys(icons).length} icons`);
