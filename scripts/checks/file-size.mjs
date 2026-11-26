// The largest files may not grow without a visible decision.
//
//   npm run check:file-size
//
// file-size.json holds a line cap per file. Past its cap a file fails here,
// and the way on is a module of its own or a raised cap in the same pull
// request, where the reviewer sees it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countLines, overCaps } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const CAPS = "scripts/checks/file-size.json";
const caps = JSON.parse(readFileSync(path.join(here, "file-size.json"), "utf8"));

const gone = Object.keys(caps).filter((file) => !existsSync(path.join(root, file)));
const counts = Object.fromEntries(
  Object.keys(caps)
    .filter((file) => !gone.includes(file))
    .map((file) => [file, countLines(readFileSync(path.join(root, file), "utf8"))]),
);
const over = overCaps(caps, counts);

if (gone.length === 0 && over.length === 0) {
  const room = Object.entries(counts).map(([file, lines]) => `${file} ${lines}/${caps[file]}`);
  console.log(`file-size: ok (lines/cap: ${room.join(", ")})`);
  process.exit(0);
}

for (const { file, cap, lines, over: extra } of over) {
  console.error(
    `file-size: ${file} has ${lines} lines, ${extra} over its cap of ${cap}.\n` +
      "  Move the new behaviour into a module of its own (a pure one, with tests, where it\n" +
      `  can be), or raise this file's cap in ${CAPS} in the same pull request, so the\n` +
      "  reviewer sees that the file grew on purpose.\n",
  );
}
if (gone.length > 0) {
  console.error(
    `file-size: ${CAPS} names file(s) that are gone: ${gone.join(", ")}.\n` +
      "  Remove the entry, or point it at the file's new path.\n",
  );
}
process.exit(1);
