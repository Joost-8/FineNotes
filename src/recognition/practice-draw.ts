/**
 * Drawn practice sheets (research/handwriting-rig/PRACTICE-DIVERSITY-2026-11-23.md):
 * instead of everyone copying the same three sets, a writer's first sheet
 * starts with a short anchor page every writer copies (so writers can be
 * compared), and every sheet after that is drawn from a pool of about 3,300
 * lines (practice-pool.ts), picked to fill what this writer has not written
 * yet: letter pairs, capitals and signs seen fewer than three times. Thirty
 * drawn lines lift the share of English letter pairs seen three times from
 * 71 % (the old 90 lines) to about 94 %, and the first sheet alone holds
 * every capital A to Z (the old sets never asked for two of them).
 *
 * A line is identified by its kind's letter and its index in the pool
 * ("p12", "s7"), and the anchor's lines by "a1" to "a10": the sheet stores
 * them in its prompt ids, so a line is never changed under a written sheet.
 *
 * PURE: no DOM, no Obsidian.
 */

import { PRACTICE_POOL, PRACTICE_POOL_VERSION } from "./practice-pool";

export { PRACTICE_POOL_VERSION };

/** A pool line's kind, and the letter its id starts with. */
export type PoolKind = keyof typeof PRACTICE_POOL;

const KIND_LETTER: Record<PoolKind, string> = {
  prose: "p",
  notes: "n",
  sums: "s",
  caps: "c",
  signs: "g",
};

/** A line on a drawn sheet. */
export interface DrawnLine {
  /** "a3" for an anchor line, else the kind's letter and the pool index. */
  id: string;
  text: string;
}

/**
 * The anchor: ten lines every writer copies once, at the top of their first
 * drawn sheet. Five are set 1's (so lines donated before stay comparable);
 * the other five put every capital A to Z on the page at least once, and 1s
 * beside 7s, in ordinary sentences. No rare signs: they are drawn later, a
 * few per sheet.
 */
export const ANCHOR_LINES: readonly string[] = [
  "The quick brown fox jumps over the lazy dog.",
  "Meeting on Tuesday at 10:30 in room B-214.",
  "x = (a + b) / 2, so y = 3x - 4.",
  "Total: $45.80 (incl. 21% tax).",
  '"Never give up," she said.',
  "Jack, Lena and Olivia met in Quebec.",
  "Zoe flew from Helsinki to Vienna in May.",
  "Dr. Kim works for the UN and WHO in Geneva.",
  "Is the EXAM on Friday? Yes, 9:17 in hall C.",
  "Pay Ravi and Sofia 17 euros, 71 cents.",
];

/** How many lines of each kind a sheet of `count` drawn lines takes. */
export function sheetQuota(count: number): Record<PoolKind, number> {
  // Prose 40 %, capitals 20 %, notes 20 %, sums 15 %, signs 5 %.
  const shares: [PoolKind, number][] = [
    ["prose", 0.4],
    ["caps", 0.2],
    ["notes", 0.2],
    ["sums", 0.15],
    ["signs", 0.05],
  ];
  const out = { prose: 0, notes: 0, sums: 0, caps: 0, signs: 0 } as Record<PoolKind, number>;
  let given = 0;
  for (const [kind, share] of shares) {
    out[kind] = Math.floor(count * share);
    given += out[kind];
  }
  // What rounding left goes to prose, the kind with the most letter pairs.
  out.prose += count - given;
  return out;
}

/** Seen this many times, a letter pair or a character counts as covered. */
export const TARGET = 3;

/** The features a line teaches: its characters, and its letter pairs (lower case). */
export function lineFeatures(text: string): string[] {
  const out: string[] = [];
  const chars = Array.from(text);
  for (const ch of chars) if (ch !== " ") out.push(`c:${ch}`);
  for (let i = 0; i + 1 < chars.length; i++) {
    const a = chars[i].toLowerCase();
    const b = chars[i + 1].toLowerCase();
    if (/[a-z]/.test(a) && /[a-z]/.test(b)) out.push(`b:${a}${b}`);
  }
  return out;
}

/** How often each feature occurs in `texts`. */
export function countFeatures(texts: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const f of lineFeatures(text)) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return counts;
}

/**
 * How much each letter pair matters: the square root of how often it occurs
 * in the pool's prose, so common pairs come first and rare ones still count.
 * Characters weigh 1 each. Computed once.
 */
let pairWeights: Map<string, number> | null = null;
function weights(): Map<string, number> {
  if (pairWeights) return pairWeights;
  const counts = countFeatures(PRACTICE_POOL.prose);
  let total = 0;
  for (const [f, n] of counts) if (f.startsWith("b:")) total += n;
  const out = new Map<string, number>();
  for (const [f, n] of counts) if (f.startsWith("b:")) out.set(f, Math.sqrt((n / total) * 1000));
  pairWeights = out;
  return out;
}

/** What copying `text` adds for a writer who has `have`: the features still under {@link TARGET}. */
export function lineGain(text: string, have: ReadonlyMap<string, number>): number {
  const w = weights();
  const extra = new Map<string, number>();
  let gain = 0;
  for (const f of lineFeatures(text)) {
    const seen = (have.get(f) ?? 0) + (extra.get(f) ?? 0);
    extra.set(f, (extra.get(f) ?? 0) + 1);
    if (seen >= TARGET) continue;
    gain += f.startsWith("c:") ? 1 : (w.get(f) ?? 0.2);
  }
  return gain / Math.sqrt(Math.max(1, Array.from(text).length));
}

/** A seeded generator (mulberry32): the same seed draws the same sheet. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pool line with id `id` ("p12"), or null. */
export function poolLine(id: string): DrawnLine | null {
  const anchor = /^a(\d+)$/.exec(id);
  if (anchor) {
    const text = ANCHOR_LINES[Number(anchor[1]) - 1];
    return text === undefined ? null : { id, text };
  }
  for (const kind of Object.keys(KIND_LETTER) as PoolKind[]) {
    const match = new RegExp(`^${KIND_LETTER[kind]}(\\d+)$`).exec(id);
    if (!match) continue;
    const text = PRACTICE_POOL[kind][Number(match[1])] as string | undefined;
    return text === undefined ? null : { id, text };
  }
  return null;
}

/**
 * The lines of a new sheet. `asked`: the texts every earlier sheet of this
 * writer asked for (written or not), so nothing repeats and the draw fills
 * what they lack. With `anchor`, the sheet opens with the anchor's ten
 * lines and then `count` drawn ones. Greedy per kind, best gain first; the
 * seed only breaks ties, so two writers with the same history still get
 * different sheets. At least one sum has a 1 beside a 7 (the digits read
 * as each other most).
 */
export function drawSheet(
  asked: readonly string[],
  count: number,
  seed: number,
  anchor: boolean,
): DrawnLine[] {
  const out: DrawnLine[] = anchor ? ANCHOR_LINES.map((text, i) => ({ id: `a${i + 1}`, text })) : [];
  const have = countFeatures([...asked, ...out.map((l) => l.text)]);
  const used = new Set([...asked, ...out.map((l) => l.text)]);
  const random = rng(seed);
  const quota = sheetQuota(count);
  const picked: DrawnLine[] = [];
  const shapes = new Set<string>();
  for (const kind of Object.keys(KIND_LETTER) as PoolKind[]) {
    const lines = PRACTICE_POOL[kind] as readonly string[];
    const tie = lines.map(() => random());
    for (let n = 0; n < quota[kind]; n++) {
      let best = -1;
      let bestGain = -1;
      const wantSeven = kind === "sums" && n === 0;
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (used.has(text)) continue;
        if (kind !== "prose" && shapes.has(lineShape(text))) continue;
        if (wantSeven && !(text.includes("1") && text.includes("7"))) continue;
        const gain = lineGain(text, have) + tie[i] * 1e-6;
        if (gain > bestGain) {
          bestGain = gain;
          best = i;
        }
      }
      if (best < 0) continue;
      const text = lines[best];
      used.add(text);
      if (kind !== "prose") shapes.add(lineShape(text));
      for (const f of lineFeatures(text)) have.set(f, (have.get(f) ?? 0) + 1);
      picked.push({ id: `${KIND_LETTER[kind]}${best}`, text });
    }
  }
  // Mixed, so a page is not all sums: the order is the seed's.
  const order = picked.map(() => random());
  const mixed = picked.map((line, i) => ({ line, at: order[i] })).sort((a, b) => a.at - b.at);
  return [...out, ...mixed.map((m) => m.line)];
}

/**
 * What a made line looks like with its names and numbers taken out, first
 * two words only ("N flew", "#todo: redo", "0 +"): two lines of one shape
 * come from one template, and a sheet takes one of each.
 */
export function lineShape(text: string): string {
  return text
    .replace(/\d+/g, "0")
    .replace(/\b[A-Z][a-z]+\b/g, "N")
    .replace(/\b[A-Z]{2,}\b/g, "A")
    .split(" ")
    .slice(0, 2)
    .join(" ");
}

/** Share of letter-pair weight `texts` hold at least {@link TARGET} times: the coverage measure. */
export function pairCoverage(texts: Iterable<string>): number {
  const have = countFeatures(texts);
  let covered = 0;
  let total = 0;
  for (const [f, w] of weights()) {
    total += w * w;
    if ((have.get(f) ?? 0) >= TARGET) covered += w * w;
  }
  return total > 0 ? covered / total : 0;
}
