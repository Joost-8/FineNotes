/**
 * How many transcript words a search finds but lights nothing for, on real
 * notebooks: every notebook under a vault folder is decoded, each page with
 * a transcript is read by Grape (the model in the vault's plugin folder),
 * and every word of the page's transcript is searched as the view does
 * (`InkView.showSearchHits`): `lineHits` over the reading and transcript.
 *
 *   npx tsx tests/bench/search-marks.ts <vault> [folder filter] [--cache <dir>]
 *
 * Read-only: nothing is written to the vault. Readings are cached in
 * `--cache` (default: the OS temp dir), keyed by the page's content hash, so
 * a run before and after a change to the highlight reads each page once.
 *
 * Not part of `npm test`: it needs Joost's vault and Grape's model.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "../../src/model/document";
import { parseInkFile } from "../../src/model/serialize";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import { pageWords } from "../../src/recognition/hwr/page-words";
import { readPage } from "../../src/recognition/hwr/recognizer";
import { pageContentHash, pageKeys } from "../../src/recognition/page-transcripts";
import { readTextSection } from "../../src/recognition/text-layer";
import {
  type ReadLine,
  lineHits,
  transcriptMatchInk,
  withFocusInk,
} from "../../src/search/hit-strokes";
import {
  collectPageText,
  folderNotebookSidecarPath,
  holdsPhrase,
  transcriptSidecarPath,
} from "../../src/search/notebook-search";
import { matchesOfKind } from "../../src/search/search-results";

/** As `view/handwriting.ts`'s `inkForReading` (which imports Obsidian): pen ink, no shapes. */
function inkForReading(strokes: readonly Page["strokes"][number][]) {
  return strokes
    .filter((s) => s.tool === "pen" && !s.shape)
    .map((s) => ({ id: s.id, tool: s.tool, shape: s.shape ?? null, t0: s.t0 ?? null, pts: s.pts }));
}

const args = process.argv.slice(2);
const cacheAt = args.indexOf("--cache");
const cacheDir = cacheAt >= 0 ? args[cacheAt + 1] : join(tmpdir(), "finenotes-search-marks");
const positional = args.filter((_, i) => i !== cacheAt && i !== cacheAt + 1);
const [vault, filter = ""] = positional;
if (!vault) {
  console.error("usage: search-marks.ts <vault> [folder filter] [--cache <dir>]");
  process.exit(2);
}
mkdirSync(cacheDir, { recursive: true });

// The learned model when there is one, as the app reads (main.ts `learnedPath`).
const grapeDir = join(vault, ".obsidian/plugins/finenotes/handwriting/grape-2");
const modelName = existsSync(join(grapeDir, "personal.bin")) ? "personal.bin" : "grape-2.0.bin";
const bundle = parseBundle(readFileSync(join(grapeDir, modelName)));
console.log(`model: ${modelName}`);

function notebooks(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...notebooks(path));
    else if (entry.name.endsWith(".notebook.md")) out.push(path);
  }
  return out;
}

function reading(page: Page, words: string[]): ReadLine[] {
  const key = createHash("sha1")
    .update(`pageWords ${modelName}\n${pageContentHash(page)}\n${words.join(" ")}`)
    .digest("hex");
  const file = join(cacheDir, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as ReadLine[];
  const read = readPage(bundle, inkForReading(page.strokes), { useLm: true, pageWords: words });
  const lines = read.lines.map((line) => ({ text: line.text, words: line.words }));
  writeFileSync(file, JSON.stringify(lines));
  return lines;
}

/**
 * The words of an AI transcript a user might search for: three letters or
 * more with a letter in them, LaTeX commands (`\cdot`) left out.
 */
function wordsOf(text: string): string[] {
  // The AI's own notes ("[placed picture not shown]") are not on the page.
  const plain = text.replace(/\\[a-zA-Z]+/g, " ").replace(/(?<!\[)\[(?!\[)[^\]\n]*\](?!\])/g, " ");
  return [...new Set(plain.match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((w) => /\p{L}/u.test(w));
}

interface Tally {
  pages: number;
  unread: number;
  words: number;
  dark: number;
  matches: number;
  placed: number;
  focused: number;
}
const total: Tally = { pages: 0, unread: 0, words: 0, dark: 0, matches: 0, placed: 0, focused: 0 };
const darkSamples: string[] = [];

for (const path of notebooks(vault).filter((p) => p.includes(filter))) {
  const markdown = readFileSync(path, "utf8");
  const { body, doc } = parseInkFile(markdown);
  if (!doc) continue;
  const rel = path.slice(vault.length + 1);
  const sidecarPath = [transcriptSidecarPath(rel), folderNotebookSidecarPath(rel)]
    .map((p) => (p ? join(vault, p) : null))
    .find((p): p is string => p !== null && existsSync(p));
  const sidecar = sidecarPath ? readFileSync(sidecarPath, "utf8") : null;
  const index = collectPageText(doc.pages, readTextSection(body), sidecar);
  // The AI's transcript alone: the words a user saw in it and searches for.
  // (The note's own text layer may hold this device's older readings.)
  const ai = collectPageText(doc.pages, null, sidecar);
  const keys = pageKeys(doc.pages);
  const title = rel.slice(rel.lastIndexOf("/") + 1).replace(/\.notebook\.md$/, "");
  const tally: Tally = {
    pages: 0,
    unread: 0,
    words: 0,
    dark: 0,
    matches: 0,
    placed: 0,
    focused: 0,
  };
  doc.pages.forEach((page, i) => {
    const pageText = index[i];
    const sources = pageText.sources.filter((s) => s.kind === "handwriting");
    if (sources.length === 0) return;
    tally.pages++;
    // As the view passes them: each transcript on its own.
    const transcript = sources.map((s) => s.text);
    if (inkForReading(page.strokes).length === 0) {
      tally.unread++;
      return;
    }
    const lines = reading(page, pageWords(title, [body, ...(sidecar ? [sidecar] : [])], keys[i]));
    const said = ai[i].sources.map((s) => s.text).join("\n");
    for (const word of wordsOf(said)) {
      const phrase = holdsPhrase(pageText, word);
      const lit = lineHits(word, lines, transcript, phrase);
      tally.words++;
      if (lit.length === 0) {
        tally.dark++;
        if (darkSamples.length < 60) darkSamples.push(`${title} p${i + 1}: ${word}`);
      }
      const count = matchesOfKind(pageText, word, phrase, "handwriting");
      tally.matches += count;
      const each = transcriptMatchInk(word, lines, sources, phrase);
      // A result steers to its own word when that ink is lit (`withFocusInk`, as the surface).
      tally.placed += each.filter((ink) => withFocusInk(lit, ink).focus !== null).length;
      if (lit.length === count) tally.focused += count;
    }
  });
  if (tally.pages === 0) continue;
  for (const k of Object.keys(total) as (keyof Tally)[]) total[k] += tally[k];
  const pct = (n: number, d: number): string => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
  console.log(
    `${title}: ${tally.pages} pages with a transcript (${tally.unread} without pen ink), ` +
      `${tally.words} words, ${tally.dark} light nothing (${pct(tally.dark, tally.words)}); ` +
      `${tally.matches} matches, ${pct(tally.placed, tally.matches)} steer to their own spot now, ` +
      `${pct(tally.focused, tally.matches)} steered before`,
  );
}
const pct = (n: number, d: number): string => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
console.log(
  `\nALL: ${total.pages} pages, ${total.words} words, ${total.dark} dark (${pct(total.dark, total.words)}); ` +
    `${total.matches} matches, steer now ${pct(total.placed, total.matches)}, steered before ${pct(total.focused, total.matches)}`,
);
console.log("\nDark samples:\n" + darkSamples.join("\n"));
