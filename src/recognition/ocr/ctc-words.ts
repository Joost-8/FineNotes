/**
 * Reading the recogniser's output: CTC greedy decoding that keeps, for each
 * character, the time steps it was emitted at and how sure the network was
 * (the highest probability at those steps), and the words with their
 * horizontal extents in the crop, found from where their characters sit
 * rather than by sharing the line out evenly.
 *
 * The network's output is a probability per class per time step (already
 * softmaxed); class 0 is the blank. One time step is {@link REC_STRIDE} px of
 * the crop.
 *
 * PURE: no DOM, no Obsidian, no onnxruntime.
 */

import { REC_STRIDE } from "./rec";

/** A character the network emitted, and the time steps `t0..t1` (inclusive) it held its peak. */
export interface CtcChar {
  ch: string;
  conf: number;
  t0: number;
  t1: number;
}

/** A word of a crop: its text, its extent `x0..x1` in the crop's pixels, and its confidences. */
export interface CropWord {
  text: string;
  x0: number;
  x1: number;
  conf: number;
  min: number;
  /** The middles of its first and last characters in the crop, px. */
  first?: number;
  last?: number;
  /** Where each character after the first begins, px of the crop: halfway between its middle and the one before's. */
  cuts?: number[];
}

export interface CropLine {
  words: CropWord[];
  /** The line's character-to-character distance (median), px. */
  pitch?: number;
  /** Mean confidence of all the characters of its words; 0 without words. */
  conf: number;
}

/**
 * Greedy CTC over `steps` time steps of `probs` (`steps x classes`, row by
 * row): the best class per step, repeats merged, blanks dropped.
 */
export function ctcDecode(
  probs: ArrayLike<number>,
  steps: number,
  classes: number,
  alphabet: readonly string[],
): CtcChar[] {
  const out: CtcChar[] = [];
  let prev = 0;
  for (let t = 0; t < steps; t++) {
    const o = t * classes;
    let best = 0;
    let top = probs[o];
    for (let k = 1; k < classes; k++) {
      if (probs[o + k] > top) {
        top = probs[o + k];
        best = k;
      }
    }
    if (best !== 0) {
      const last = out[out.length - 1];
      if (best === prev && last) {
        last.t1 = t;
        if (top > last.conf) last.conf = top;
      } else if (alphabet[best]) {
        out.push({ ch: alphabet[best], conf: top, t0: t, t1: t });
      }
    }
    prev = best;
  }
  return out;
}

/**
 * CTC emits a character a little before its glyph's middle: measured on
 * rendered pages against the true word boxes, the right edge came out
 * 0.6 pt (a tenth of a character pitch) short, the left edge true.
 */
export const RIGHT_BIAS = 0.1;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Split characters into words at the space characters and place each word:
 * a character sits at the middle of its time steps, and a word runs from half
 * the line's median character-to-character distance before its first
 * character's middle to the same after its last, clamped to the crop and
 * kept clear of its neighbours.
 */
export function wordsOf(chars: readonly CtcChar[], cropWidth: number): CropLine {
  const groups: CtcChar[][] = [];
  let current: CtcChar[] = [];
  for (const c of chars) {
    if (c.ch.trim() === "") {
      if (current.length > 0) groups.push(current);
      current = [];
    } else current.push(c);
  }
  if (current.length > 0) groups.push(current);
  if (groups.length === 0) return { words: [], conf: 0 };

  const middle = (c: CtcChar): number => ((c.t0 + c.t1 + 1) / 2) * REC_STRIDE;
  const pitches: number[] = [];
  for (const g of groups)
    for (let i = 1; i < g.length; i++) pitches.push(middle(g[i]) - middle(g[i - 1]));
  // A line of one-letter words: about the height of a letter.
  const pitch = median(pitches) || REC_STRIDE * 3;

  const words: CropWord[] = groups.map((g) => {
    const first = middle(g[0]);
    const last = middle(g[g.length - 1]);
    // A character's peak is near its middle: the word reaches half the line's
    // usual character-to-character distance beyond the first and the last.
    const before = pitch / 2;
    const after = pitch / 2 + RIGHT_BIAS * pitch;
    const confs = g.map((c) => c.conf);
    return {
      text: g.map((c) => c.ch).join(""),
      x0: Math.max(0, first - before),
      x1: Math.min(cropWidth, last + after),
      first,
      last,
      cuts: g.slice(1).map((c, i) => (middle(c) + middle(g[i])) / 2),
      conf: confs.reduce((s, v) => s + v, 0) / confs.length,
      min: Math.min(...confs),
    };
  });
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1];
    const b = words[i];
    if (b.x0 < a.x1) a.x1 = b.x0 = (a.x1 + b.x0) / 2;
  }
  const all = groups.flat();
  return { words, pitch, conf: all.reduce((s, c) => s + c.conf, 0) / all.length };
}
