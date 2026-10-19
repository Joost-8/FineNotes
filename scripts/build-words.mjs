// Build the public word list for "Underline words it may have misread"
// (words.txt, downloaded on first use; src/recognition/hwr/model-manifest.ts
// pins its size and SHA-256). It holds only words seen at least MIN_COUNT
// times in the handwriting rig's LM text (research/handwriting-rig,
// `text_pool.py`'s shippable sources), never anything from a vault.
// Same word rule as `plainWord` in src/recognition/hwr/corrections.ts.
// The output is deterministic: the same text gives the same bytes.
//
// Usage: node scripts/build-words.mjs <pool-lm.txt> <out words.txt>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [pool, outFile] = process.argv.slice(2);
if (!pool || !outFile) {
  console.error("usage: node scripts/build-words.mjs <pool-lm.txt> <out words.txt>");
  process.exit(1);
}
const MIN_COUNT = 3;

function plainWord(text) {
  const word = text
    .normalize("NFC")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .toLowerCase();
  if (word.length < 3 || word.length > 40) return null;
  return /^\p{L}+(?:['’-]\p{L}+)*$/u.test(word) ? word : null;
}

const counts = new Map();
for (const token of readFileSync(pool, "utf8").split(/\s+/)) {
  const word = plainWord(token);
  if (word) counts.set(word, (counts.get(word) ?? 0) + 1);
}
const words = [...counts]
  .filter(([, n]) => n >= MIN_COUNT)
  .map(([w]) => w)
  .sort();

const body =
  "# FineNotes word list: words not to underline as possibly misread.\n" +
  `# Words seen ${MIN_COUNT}+ times in the Grape rig's LM text. One word a line.\n` +
  words.join("\n") +
  "\n";
writeFileSync(outFile, body);
const bytes = Buffer.from(body, "utf8");
const sha = createHash("sha256").update(bytes).digest("hex");
console.log(`words ${words.length}, bytes ${bytes.length}, sha256 ${sha}`);
