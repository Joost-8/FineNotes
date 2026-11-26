/**
 * Best of a few tries, then the repair of words a reader rejects
 * (research/handwriting-rig/gen/repair.py, `Neatener.neaten` and
 * `rejected`), kept in 2026-11-24's test: on 72 unseen writers it read a
 * little better at a small cost in likeness.
 *
 * A line is written `tries` times; the reader keeps the try it reads closest
 * to the text. Then, twice at most: for each word the reader does not read
 * back, first only its wrong letters (round 1), then whole rejected words
 * (round 2) are written again at low guidance, from the same try's noise. A
 * rewrite is kept only if the line reads better and no word read right
 * before is rejected after.
 *
 * PURE: no DOM, no Obsidian. Writing and reading are handed in.
 */

import type { Reference } from "./rows";
import type { Written } from "./sampler";

/** One [tag, a0, a1, b0, b1] of difflib's `get_opcodes`. */
export type Opcode = ["equal" | "replace" | "delete" | "insert", number, number, number, number];

/**
 * difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes(): the same
 * longest-match recursion, so the same edits (ties broken alike).
 */
export function opcodes<T>(a: readonly T[], b: readonly T[]): Opcode[] {
  const b2j = new Map<T, number[]>();
  b.forEach((v, j) => {
    const list = b2j.get(v);
    if (list) list.push(j);
    else b2j.set(v, [j]);
  });
  const longest = (
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): [number, number, number] => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = next;
    }
    // No junk, so difflib's extension loops only grow over equal elements, which the search above already took.
    return [besti, bestj, bestsize];
  };
  const blocks: [number, number, number][] = [];
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop() as [number, number, number, number];
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      blocks.push([i, j, k]);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const merged: [number, number, number][] = [];
  for (const blk of blocks) {
    const last = merged[merged.length - 1];
    if (last && last[0] + last[2] === blk[0] && last[1] + last[2] === blk[1]) last[2] += blk[2];
    else merged.push([...blk]);
  }
  merged.push([a.length, b.length, 0]);
  const out: Opcode[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj, size] of merged) {
    const tag = i < ai && j < bj ? "replace" : i < ai ? "delete" : j < bj ? "insert" : null;
    if (tag) out.push([tag, i, ai, j, bj]);
    i = ai + size;
    j = bj + size;
    if (size) out.push(["equal", ai, i, bj, j]);
  }
  return out;
}

/** Where each word of `text` (split on single spaces) starts. */
function wordStarts(text: string): { words: string[]; starts: number[] } {
  const words = text.split(" ");
  const starts: number[] = [];
  let pos = 0;
  for (const w of words) {
    starts.push(pos);
    pos += w.length + 1;
  }
  return { words, starts };
}

const ALNUM = /[\p{L}\p{N}]/u;

/**
 * For each word of `text` the reading does not hold: the positions in
 * `text` of its letters to rewrite, those the character diff against the
 * words read in its place marks as replaced or missing (all its letters when
 * none are found, or nothing was read there).
 */
export function rejected(text: string, read: string): Map<number, Set<number>> {
  const { words, starts } = wordStarts(text);
  const got = read.split(/\s+/).filter(Boolean);
  const out = new Map<number, Set<number>>();
  for (const [tag, a0, a1, b0, b1] of opcodes(words, got)) {
    if (tag === "equal") continue;
    const there = got.slice(b0, b1).join(" ");
    for (let wi = a0; wi < a1; wi++) {
      const w = words[wi];
      if (!w) continue;
      let bad = new Set<number>();
      if (there) {
        for (const [t2, i0, i1] of opcodes([...w], [...there])) {
          if (t2 === "replace" || t2 === "delete") for (let i = i0; i < i1; i++) bad.add(i);
        }
      }
      if (bad.size === 0 || !there) bad = new Set(Array.from(w, (_, i) => i));
      const letters = new Set([...bad].filter((i) => ALNUM.test(w[i])).map((i) => starts[wi] + i));
      out.set(wi, letters.size ? letters : new Set(Array.from(w, (_, i) => starts[wi] + i)));
    }
  }
  return out;
}

/**
 * The least sure a letter of a written word may be read back with for the
 * word to be kept. "at" written like "nt" was still read as "at" (Joost's
 * iPad, 25 November): only how unsure the reader was of its "a" told.
 */
export const READ_BACK_SURE = 0.7;

/**
 * Which words stay rewritten once the written line has been read back: a
 * word the reader does not find as written keeps the writer's own ink, and
 * so does one found with a letter read less surely than `READ_BACK_SURE`
 * (`sure`: per character of `read`, when the reader gives it).
 */
export function readBackRewrite(
  text: string,
  read: string,
  rewrite: readonly boolean[],
  sure?: readonly number[],
): boolean[] {
  const misread = rejected(text, read);
  if (sure) for (const w of shakyWords(text, read, sure)) misread.set(w, new Set());
  return rewrite.map((r, w) => r && !misread.has(w));
}

/** The words of `text` read back as written, but with a letter read less surely than `READ_BACK_SURE`. */
function shakyWords(text: string, read: string, sure: readonly number[]): number[] {
  const { words } = wordStarts(text);
  const got = [...read.matchAll(/\S+/g)].map((m) => ({ word: m[0], at: m.index ?? 0 }));
  const out: number[] = [];
  for (const [tag, a0, a1, b0] of opcodes(
    words,
    got.map((g) => g.word),
  )) {
    if (tag !== "equal") continue;
    for (let wi = a0; wi < a1; wi++) {
      const { word, at } = got[b0 + (wi - a0)];
      const shaky = Array.from(word).some(
        (ch, i) => ALNUM.test(ch) && (sure[at + i] ?? 1) < READ_BACK_SURE,
      );
      if (shaky) out.push(wi);
    }
  }
  return out;
}

/** The positions in `text` of word `wi`'s letters. */
export function wordSpan(text: string, wi: number): Set<number> {
  const { words, starts } = wordStarts(text);
  const w = words[wi] ?? "";
  return new Set(Array.from(w, (_, i) => starts[wi] + i));
}

/** Characters wrong (edit distance) per character of the text. */
export function errorRate(text: string, read: string): number {
  if (text.length === 0) return read.length ? 1 : 0;
  let prev = Array.from({ length: read.length + 1 }, (_, j) => j);
  for (let i = 1; i <= text.length; i++) {
    const cur = [i];
    for (let j = 1; j <= read.length; j++) {
      cur.push(
        Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (text[i - 1] === read[j - 1] ? 0 : 1)),
      );
    }
    prev = cur;
  }
  return prev[read.length] / text.length;
}

/** Writes one try of a line (`ref`: what the model is shown, as its kind made it) (`low`: letters at low guidance), from a try's seed and the line's number. */
export type WriteTry<R = Reference> = (
  text: string,
  ref: R,
  seed: number,
  id: number,
  low: ReadonlySet<number>,
) => Promise<Written>;
/** Reads a written line back. */
export type ReadBack = (line: Written) => Promise<string>;

export interface NeatenedLine {
  written: Written;
  /** What the reader read in it. */
  read: string;
  /** The try it came from. */
  seed: number;
  /** Rewrites tried and kept. */
  repairs: { tried: number; kept: number };
}

/**
 * The best of `tries` tries of one line, then its repair. `seed` is the
 * line's own seed (tries are `seed * tries + s`, as in the research);
 * `stop` is asked between tries and ends the work early (null). Between
 * tries the reader reads equally well, `uneven` (lower is better; Beautify
 * gives `evenness.roughness`) keeps the more even one; without it, or on a
 * tie there too, the earlier try stays.
 */
export async function neatenLine<R = Reference>(
  text: string,
  ref: R,
  id: number,
  write: WriteTry<R>,
  read: ReadBack,
  options: {
    seed: number;
    tries: number;
    repair: boolean;
    stop?: () => boolean;
    uneven?: (written: Written) => number;
  },
): Promise<NeatenedLine | null> {
  let best: NeatenedLine | null = null;
  let bestUneven = 0;
  for (let s = 0; s < options.tries; s++) {
    if (options.stop?.()) return null;
    const seed = options.seed * options.tries + s;
    const written = await write(text, ref, seed, id, new Set());
    const got = await read(written);
    const wrong = errorRate(text, got);
    const uneven = options.uneven?.(written) ?? 0;
    const was = best ? errorRate(text, best.read) : Infinity;
    if (wrong < was || (wrong === was && uneven < bestUneven)) {
      best = { written, read: got, seed, repairs: { tried: 0, kept: 0 } };
      bestUneven = uneven;
    }
  }
  if (!best || !options.repair) return best;
  for (const round of [1, 2]) {
    const bad = rejected(text, best.read);
    if (bad.size === 0) break;
    if (options.stop?.()) return null;
    const low = new Set<number>();
    for (const [wi, letters] of bad)
      for (const i of round === 1 ? letters : wordSpan(text, wi)) low.add(i);
    const written = await write(text, ref, best.seed, id, low);
    const got = await read(written);
    const now = rejected(text, got);
    const kept =
      [...now.keys()].every((wi) => bad.has(wi)) &&
      errorRate(text, got) < errorRate(text, best.read);
    best.repairs.tried++;
    if (kept)
      best = {
        written,
        read: got,
        seed: best.seed,
        repairs: { tried: best.repairs.tried, kept: best.repairs.kept + 1 },
      };
  }
  return best;
}
