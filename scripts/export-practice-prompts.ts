// Export every practice line FineNotes can print, for the handwriting rig's
// donation check (research/handwriting-rig/donations.py, practice-prompts.json):
// a shared practice item is accepted only when its text is a line of its
// sheet. Drawn sheets are checked against the anchor and every pool version.
//
// Usage: npx tsx scripts/export-practice-prompts.ts <out.json>
import { writeFileSync } from "node:fs";
import { DRAWN_SET, PRACTICE_SETS, SYMBOL_LINES, SYMBOL_SET } from "../src/recognition/practice";
import { ANCHOR_LINES, PRACTICE_POOL_VERSION } from "../src/recognition/practice-draw";
import { PRACTICE_POOL } from "../src/recognition/practice-pool";

const out = process.argv[2];
if (!out) {
  console.error("usage: npx tsx scripts/export-practice-prompts.ts <out.json>");
  process.exit(1);
}
const drawn = [...ANCHOR_LINES, ...Object.values(PRACTICE_POOL).flat()];
writeFileSync(
  out,
  `${JSON.stringify(
    {
      sets: PRACTICE_SETS,
      symbolSet: SYMBOL_SET,
      symbols: SYMBOL_LINES,
      drawnSet: DRAWN_SET,
      poolVersion: PRACTICE_POOL_VERSION,
      drawn,
    },
    null,
    1,
  )}\n`,
);
console.log(`${out}: ${PRACTICE_SETS.flat().length} set lines, ${drawn.length} drawn lines`);
