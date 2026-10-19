/**
 * The lexicon re-decode (lexicon.ts) against brute force: every CTC
 * alignment enumerated, every edit distance computed in full. The word list,
 * classes and frame counts of the first block are those of
 * research/handwriting-rig/lexicon/redecode.py --selftest.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import type { CharLm } from "../../src/recognition/hwr/char-lm";
import {
  Lexicon,
  bestWords,
  SUGGEST_MARGIN,
  ctcScore,
  forceAlign,
  lmWord,
  replaceCore,
  suggest,
  wordCore,
  wordWindow,
} from "../../src/recognition/hwr/lexicon";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Random log-probabilities, peaked like a network's (`frames × C`). */
function randomLogp(frames: number, C: number, random: () => number): Float32Array {
  const out = new Float32Array(frames * C);
  for (let t = 0; t < frames; t++) {
    let sum = 0;
    const row: number[] = [];
    for (let k = 0; k < C; k++) {
      const v = random() ** 4 + 1e-6;
      row.push(v);
      sum += v;
    }
    row.forEach((v, k) => (out[t * C + k] = Math.log(v / sum)));
  }
  return out;
}

/** Every CTC alignment of `labels` over frames [start, end], as path log-probabilities. */
function alignments(
  logp: Float32Array,
  C: number,
  start: number,
  end: number,
  labels: readonly number[],
): { score: number; path: number[] }[] {
  const out: { score: number; path: number[] }[] = [];
  const walk = (t: number, j: number, last: number, score: number, path: number[]): void => {
    if (labels.length - j > end - t + 1) return;
    if (t > end) {
      if (j === labels.length) out.push({ score, path: [...path] });
      return;
    }
    const o = t * C;
    const step = (k: number, nj: number) => {
      path.push(k);
      walk(t + 1, nj, k, score + logp[o + k], path);
      path.pop();
    };
    step(0, j);
    if (last !== 0) step(last, j);
    if (j < labels.length && labels[j] !== last) step(labels[j], j + 1);
  };
  walk(start, 0, 0, 0, []);
  return out;
}

function logSumExp(xs: number[]): number {
  if (xs.length === 0) return -Infinity;
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0));
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(
        Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

describe("ctcScore and forceAlign, against every alignment (redecode.py --selftest's cases)", () => {
  const chars = [..."abcdehilnorstS"];
  const C = chars.length + 1;
  const ids = (w: string) => [...w].map((c) => chars.indexOf(c) + 1);
  const words = ["the", "then", "there", "thin", "this", "these", "tee", "tree", "a", "at"];
  const random = rng(0);
  for (const T of [3, 7, 11]) {
    it(`sums and maximises over all alignments, ${T} frames`, () => {
      const logp = randomLogp(T, C, random);
      for (const w of words) {
        const all = alignments(logp, C, 0, T - 1, ids(w));
        const score = ctcScore(logp, C, 0, T - 1, ids(w));
        if (all.length === 0) {
          expect(score).toBe(-Infinity);
          expect(forceAlign(logp, T, C, ids(w))).toBeNull();
          continue;
        }
        expect(score).toBeCloseTo(logSumExp(all.map((a) => a.score)), 9);
        const pos = forceAlign(logp, T, C, ids(w));
        expect(pos).not.toBeNull();
        const path = Array.from(pos as Int32Array, (p) => (p < 0 ? 0 : ids(w)[p]));
        const viterbi = path.reduce((s, k, t) => s + logp[t * C + k], 0);
        expect(viterbi).toBeCloseTo(Math.max(...all.map((a) => a.score)), 9);
        // The positions are a real alignment: each label in order, none skipped.
        const emitted = Array.from(pos as Int32Array).filter((p, t, a) => p >= 0 && p !== a[t - 1]);
        expect(emitted).toEqual(ids(w).map((_, i) => i));
      }
    });
  }

  it("scores a window of the frames, and the longer selftest frame counts agree with a shorter brute force", () => {
    const T = 41;
    const logp = randomLogp(T, C, random);
    for (const w of ["at", "the", "tee"]) {
      const all = alignments(logp, C, 30, 40, ids(w));
      expect(ctcScore(logp, C, 30, 40, ids(w))).toBeCloseTo(logSumExp(all.map((a) => a.score)), 9);
    }
    // A word that cannot fit its window scores nothing.
    expect(ctcScore(logp, C, 0, 1, ids("these"))).toBe(-Infinity);
  });
});

describe("Lexicon.near", () => {
  it("finds every word within half the longer word, nearest first, never the word itself", () => {
    const list = ["integers", "integer", "interest", "intakes", "in", "tea", "teeth", "the"];
    const lexicon = new Lexicon(list);
    const near = lexicon.near("Integets");
    const all = [...new Set([...list, "a", "i", "to", "at", "it", "is"])];
    const expected = all.filter((w) => {
      const d = levenshtein("integets", w);
      return d > 0 && d <= Math.floor(Math.max(8, w.length) / 2);
    });
    expect(new Set(near)).toEqual(new Set(expected));
    expect(near[0]).toBe("integers");
    expect(new Lexicon(["the"]).near("the")).not.toContain("the");
    // The short words the list leaves out are candidates for short readings.
    expect(new Lexicon([]).near("tho")).toContain("to");
  });
});

describe("bestWords, against scoring every word", () => {
  const chars = [..."abcdehilnorstS"];
  const C = chars.length + 1;
  const ids = (w: string) => [...w].map((c) => chars.indexOf(c) + 1);
  const random = rng(3);
  const pick = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(random() * chars.length)]).join("");
  const list = [
    ...new Set([
      "the", "then", "there", "thin", "this", "these", "tee", "tree", "a", "at",
      "noted", "notes", "stone", "Stone", "lit", "tt", "teeth", "aa",
      ...Array.from({ length: 300 }, () => pick(1 + Math.floor(random() * 7))),
    ]),
  ]; // prettier-ignore
  const entries = list.map((word) => ({ word, ids: ids(word) }));

  /** Brute force: every word's exact score, best first. */
  const brute = (logp: Float32Array, s: number, e: number, extra: (w: string) => number) =>
    entries
      .map(({ word, ids: wi }) => {
        const ctc = ctcScore(logp, C, s, e, wi);
        return { word, ctc, score: ctc + extra(word) };
      })
      .filter((x) => x.ctc > -Infinity)
      .sort((a, b) => b.score - a.score);

  for (const T of [3, 7, 20, 41]) {
    it(`finds the best words by CTC, ${T} frames`, () => {
      const logp = randomLogp(T, C, random);
      for (const k of [1, 3, 20]) {
        const got = bestWords(logp, C, 0, T - 1, entries, k);
        const want = brute(logp, 0, T - 1, () => 0).slice(0, k);
        expect(got.map((g) => g.score)).toHaveLength(want.length);
        got.forEach((g, i) => {
          expect(g.score).toBeCloseTo(want[i].score, 9);
          expect(g.ctc).toBeCloseTo(ctcScore(logp, C, 0, T - 1, ids(g.word)), 9);
        });
      }
    });
  }

  it("adds a prefix-monotone word score exactly, as an LM does", () => {
    // A stand-in LM: log P falls with every letter, as a real LM's does.
    const lm = {
      prob: (history: string, ch: string) =>
        0.05 + (0.9 * ((history.length * 7 + ch.charCodeAt(0)) % 11)) / 11,
      context: (history: string) => [history.length, ...[...history].map((c) => c.charCodeAt(0))],
      probIn: (context: readonly number[], code: number) =>
        0.05 + (0.9 * ((context[0] * 7 + code) % 11)) / 11,
      codeOf: (ch: string) => ch.charCodeAt(0),
    } as unknown as CharLm;
    const wordLm = { lm, alpha: 0.3, before: "the ", after: " " };
    const T = 20;
    const logp = randomLogp(T, C, random);
    const got = bestWords(logp, C, 2, T - 3, entries, 3, wordLm);
    const extra = (w: string) => 0.3 * lmWord(lm, "the ", w, " ");
    const want = brute(logp, 2, T - 3, extra).slice(0, 3);
    got.forEach((g, i) => expect(g.score).toBeCloseTo(want[i].score, 9));
  });

  it("still finds them when the window is too long to bound in a float64", () => {
    // 500 frames whose best class is ~0.2: 800 nats of scale over the window.
    const T = 500;
    const flat = new Float32Array(T * C);
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < C; k++) flat[t * C + k] = Math.log(k === t % C ? 0.2 : 0.8 / (C - 1));
    }
    const got = bestWords(flat, C, 0, T - 1, entries, 3);
    const want = brute(flat, 0, T - 1, () => 0).slice(0, 3);
    got.forEach((g, i) => expect(g.score).toBeCloseTo(want[i].score, 6));
  });

  it("finds the same near words as checking each one", () => {
    const words = [
      ...new Set(
        Array.from({ length: 2000 }, () => pick(1 + Math.floor(random() * 9)).toLowerCase()),
      ),
    ];
    const lexicon = new Lexicon(words);
    const all = [
      ...new Set([
        ...words,
        "a",
        "i",
        "am",
        "an",
        "as",
        "at",
        "be",
        "by",
        "do",
        "go",
        "he",
        "hi",
        "if",
        "in",
        "is",
        "it",
        "me",
        "my",
        "no",
        "of",
        "oh",
        "ok",
        "on",
        "or",
        "so",
        "to",
        "up",
        "us",
        "we",
      ]),
    ];
    for (let i = 0; i < 40; i++) {
      const w = pick(2 + Math.floor(random() * 8)).toLowerCase();
      const want = all.filter((c) => {
        const d = levenshtein(w, c);
        return c !== w && d <= Math.floor(Math.max(w.length, c.length) / 2);
      });
      expect(new Set(lexicon.near(w))).toEqual(new Set(want));
    }
  });
});

describe("words in a line", () => {
  it("finds tokens, their letters, and the frames around them", () => {
    expect(wordCore({ text: " (two)  words", start: 1, end: 6 })).toEqual({ cs: 2, ce: 5 });
    expect(replaceCore("(integets),", "integers")).toBe("(integers),");
    // Frames: a a _ b _ c c → characters 0, 1, 2.
    const pos = Int32Array.from([0, 0, -1, 1, -1, 2, 2]);
    expect(wordWindow(pos, 1, 2, 3)).toEqual([2, 4]);
    expect(wordWindow(pos, 0, 1, 3)).toEqual([0, 2]);
    expect(wordWindow(pos, 2, 3, 3)).toEqual([4, 6]);
  });
});

/** Frames that spell `text`: each character twice, then a blank; `mix` blends in a rival. */
function spell(
  text: string,
  alphabet: readonly string[],
  mix: Record<number, { ch: string; p: number }> = {},
): { logp: Float32Array; frames: number } {
  const C = alphabet.length + 1;
  const rows: number[][] = [];
  const row = (k: number, rival?: { k: number; p: number }) => {
    const r = new Array<number>(C).fill(0.02 / C);
    r[k] += 0.98 - (rival?.p ?? 0);
    if (rival) r[rival.k] += rival.p;
    rows.push(r);
  };
  [...text].forEach((ch, i) => {
    const k = alphabet.indexOf(ch) + 1;
    const m = mix[i];
    const rival = m && { k: alphabet.indexOf(m.ch) + 1, p: m.p };
    row(k, rival);
    row(k, rival);
    row(0);
  });
  const logp = new Float32Array(rows.length * C);
  rows.forEach((r, t) => r.forEach((v, k) => (logp[t * C + k] = Math.log(v))));
  return { logp, frames: rows.length };
}

describe("suggest, with the built-in model's alphabet and language model", () => {
  const FILE = "models/grape-1.0.bin";
  const bundle = existsSync(FILE) ? parseBundle(readFileSync(FILE)) : null;

  it.skipIf(!bundle)("offers the list word for a misread, with a small margin", () => {
    const { alphabet, decoder } = (bundle as NonNullable<typeof bundle>).meta;
    const lm = (bundle as NonNullable<typeof bundle>).lm;
    const text = "the integets are";
    // The seventh letter of "integets" (the "t") looks nearly as much like an "r".
    const line = spell(text, alphabet, { 10: { ch: "r", p: 0.4 } });
    const lexicon = new Lexicon(["the", "are", "integers", "integer", "intakes", "interest"]);
    const found = suggest(line, alphabet, lm, decoder.alpha, { text, start: 4, end: 12 }, lexicon);
    expect(found).not.toBeNull();
    expect(found?.words[0]).toBe("integers");
    expect(found?.words.length).toBeLessThanOrEqual(3);
    expect(found?.margin).toBeLessThan(SUGGEST_MARGIN);
  });

  it.skipIf(!bundle)("keeps a word the ink clearly shows above the margin", () => {
    const { alphabet, decoder } = (bundle as NonNullable<typeof bundle>).meta;
    const lm = (bundle as NonNullable<typeof bundle>).lm;
    const text = "Radix sort";
    const line = spell(text, alphabet);
    const lexicon = new Lexicon(["radio", "radii", "radish", "sort"]);
    const found = suggest(line, alphabet, lm, decoder.alpha, { text, start: 0, end: 5 }, lexicon);
    expect(found?.margin).toBeGreaterThan(SUGGEST_MARGIN);
    // Capitalised as the reading is.
    expect(found?.words[0]).toMatch(/^Radi/);
  });

  it.skipIf(!bundle)(
    "adds the LM on both sides: the margin is the CTC margin plus the LM's",
    () => {
      const { alphabet } = (bundle as NonNullable<typeof bundle>).meta;
      const lm = (bundle as NonNullable<typeof bundle>).lm;
      if (!lm) return;
      const text = "the integets are";
      const line = spell(text, alphabet, { 10: { ch: "r", p: 0.4 } });
      const lexicon = new Lexicon(["integers"]);
      const word = { text, start: 4, end: 12 };
      const plain = suggest(line, alphabet, null, 0.3, word, lexicon);
      const withLm = suggest(line, alphabet, lm, 0.3, word, lexicon);
      const lmGap =
        (0.3 * (lmWord(lm, "the ", "integets", " ") - lmWord(lm, "the ", "integers", " "))) / 8;
      expect((withLm?.margin ?? 0) - (plain?.margin ?? 0)).toBeCloseTo(lmGap, 6);
    },
  );

  it.skipIf(!bundle)(
    "gives nothing for a reading it cannot align or a word with no near list word",
    () => {
      const { alphabet } = (bundle as NonNullable<typeof bundle>).meta;
      const line = spell("abc", alphabet);
      const lexicon = new Lexicon(["xyzzyq"]);
      // The reading says more than the frames can carry.
      const long = "abcdefghijklmnopqrstuvwxyz";
      expect(
        suggest(line, alphabet, null, 0.3, { text: long, start: 0, end: 26 }, lexicon),
      ).toBeNull();
      expect(
        suggest(
          line,
          alphabet,
          null,
          0.3,
          { text: "abc", start: 0, end: 3 },
          new Lexicon(["zzzzzzzz"]),
        ),
      ).toBeNull();
      expect(
        suggest(line, alphabet, null, 0.3, { text: "abc", start: 0, end: 0 }, lexicon),
      ).toBeNull();
    },
  );
});
