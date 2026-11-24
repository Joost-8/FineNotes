/**
 * The writer's sampler: one line of text written in a writer's hand by the
 * dual flow-matching model "A long" (research/handwriting-rig/gen/repair.py,
 * `Neatener.write`), with the model's three graphs behind {@link Graphs} so
 * this part runs anywhere (ONNX Runtime in the worker, fakes in the tests).
 *
 * Per line: the reference is encoded twice (the writer's lines, and none);
 * each character's number of rows comes from the durations graph given the
 * writer's summary; starting noise is drawn per character, so a character
 * given more or fewer rows leaves the rest of the line's noise alone; then
 * `steps` Euler steps, each velocity mixed between "none" and "the writer"
 * by the guidance (per character: the repair lowers it on letters a reader
 * rejected, and takes their row counts from a summary part-way to none).
 *
 * The reader's pull of the research recipe is left out: it needs the
 * reader's gradient, which the graphs do not have.
 *
 * PURE: no DOM, no Obsidian.
 */

import { ROW, type Reference, type Rows, runsOf } from "./rows";

/** The model's own numbers (`writer.json`, written by gen/neaten_v1.py meta). */
export interface WriterMeta {
  /** The model's characters; index 0 is the blank, and a character's id is its index. */
  chars: string[];
  /** Mean and spread of each row value: the velocity works on normalised rows. */
  mean: number[];
  std: number[];
  /** Most rows a character may get (the durations graph's classes). */
  maxDur: number;
  /** Reference rows shown per line. */
  refCurves: number;
  steps: number;
  /** Starting noise. */
  sigma: number;
  guidance: number;
  /** Guidance on repaired letters, and how much of the writer's summary sets their row counts. */
  lowGuidance: number;
  lowMix: number;
  /** Longest pen-up move a reference line may show, in units. */
  hold: number;
  /** Reference lines per written line. */
  refLines: number;
}

/** What the encoder made of a reference: opaque to the sampler, but for the summary. */
export interface Encoded {
  /** The writer's summary vector (or the null one). */
  g: Float32Array;
}

/** The model's three graphs (gen/export_onnx.py). */
export interface Graphs<E extends Encoded = Encoded> {
  /** The reference encoded, or the null reference when `drop`. */
  encode(ref: Reference, drop: boolean): Promise<E>;
  /** Per character, logits over 1..maxDur rows (`L × maxDur`), given a summary. */
  durations(ids: Int32Array, g: Float32Array): Promise<Float32Array>;
  /** The velocity of normalised rows `x` (`T × ROW`) at time `tau`. */
  velocity(x: Float32Array, tau: number, cid: Int32Array, k: Int32Array, d: Int32Array, enc: E): Promise<Float32Array>;
}

/** A written line: its raw rows and the character of the text each row was written for. */
export interface Written extends Rows {
  char: Int32Array;
}

/** The model's id of each character of `text`; null when it has no id for one. */
export function textIds(text: string, meta: WriterMeta): Int32Array | null {
  const ids = new Int32Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const id = meta.chars.indexOf(text[i]);
    if (id <= 0) return null;
    ids[i] = id;
  }
  return ids;
}

/** A small seeded generator of standard normal numbers (sfc32 and Box-Muller). */
export function normals(seed: number): () => number {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u <= 1e-12) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

/** The noise seed of a line (the research's: a try's seed and the line's number). */
export function lineSeed(seed: number, id: number): number {
  return (seed * 100003 + id * 101 + 7) >>> 0;
}

function argmaxRows(logits: Float32Array, i: number, classes: number): number {
  let best = 0;
  for (let c = 1; c < classes; c++) if (logits[i * classes + c] > logits[i * classes + best]) best = c;
  return best + 1;
}

export interface WriteOptions {
  /** The try's seed. */
  seed: number;
  /** The line's number, for its noise. */
  id: number;
  /** Characters (positions in the text) to write at low guidance with mixed row counts. */
  low?: ReadonlySet<number>;
  /** Noise to start from instead of drawing it (`T × ROW`, before `sigma`), for parity checks. */
  noise?: (counts: Int32Array) => Float32Array;
}

/** Write `text` from the reference. Throws when the model has no id for a character. */
export async function writeLine<E extends Encoded>(
  graphs: Graphs<E>,
  meta: WriterMeta,
  text: string,
  ref: Reference,
  options: WriteOptions,
): Promise<Written> {
  const ids = textIds(text, meta);
  if (!ids || ids.length === 0) throw new Error("the writer has no letter for this text");
  const low = options.low ?? new Set<number>();
  const his = await graphs.encode(ref, false);
  const none = await graphs.encode(ref, true);
  const L = ids.length;
  const D = meta.maxDur;
  const dHis = await graphs.durations(ids, his.g);
  let dMix: Float32Array | null = null;
  if (low.size > 0) {
    const g = new Float32Array(his.g.length);
    for (let i = 0; i < g.length; i++) g[i] = meta.lowMix * his.g[i] + (1 - meta.lowMix) * none.g[i];
    dMix = await graphs.durations(ids, g);
  }
  const counts = new Int32Array(L);
  for (let i = 0; i < L; i++) counts[i] = argmaxRows(low.has(i) && dMix ? dMix : dHis, i, D);
  const T = counts.reduce((s, v) => s + v, 0);
  const char = new Int32Array(T);
  for (let i = 0, t = 0; i < L; i++) for (let j = 0; j < counts[i]; j++) char[t++] = i;
  const { k, d } = runsOf(char);
  const cid = new Int32Array(T);
  for (let t = 0; t < T; t++) cid[t] = ids[char[t]];

  let x: Float32Array;
  if (options.noise) {
    x = options.noise(counts);
  } else {
    // Each character's noise from its own block of maxDur rows, so the rest of
    // the line keeps its noise when one character gets more or fewer rows.
    const draw = normals(lineSeed(options.seed, options.id));
    x = new Float32Array(T * ROW);
    let t = 0;
    for (let i = 0; i < L; i++) {
      const block = new Float32Array(D * ROW);
      for (let v = 0; v < block.length; v++) block[v] = draw();
      x.set(block.subarray(0, counts[i] * ROW), t * ROW);
      t += counts[i];
    }
  }
  for (let v = 0; v < x.length; v++) x[v] *= meta.sigma;
  const gw = new Float32Array(T);
  for (let t = 0; t < T; t++) gw[t] = low.has(char[t]) ? meta.lowGuidance : meta.guidance;

  for (let step = 0; step < meta.steps; step++) {
    const tau = step / meta.steps;
    const v1 = await graphs.velocity(x, tau, cid, k, d, his);
    const v0 = await graphs.velocity(x, tau, cid, k, d, none);
    const next = new Float32Array(x.length);
    for (let t = 0; t < T; t++) {
      for (let c = 0; c < ROW; c++) {
        const o = t * ROW + c;
        next[o] = x[o] + (v0[o] + gw[t] * (v1[o] - v0[o])) / meta.steps;
      }
    }
    x = next;
  }
  for (let t = 0; t < T; t++) {
    for (let c = 0; c < ROW; c++) x[t * ROW + c] = x[t * ROW + c] * meta.std[c] + meta.mean[c];
    x[t * ROW + ROW - 1] = x[t * ROW + ROW - 1] > 0.5 ? 1 : 0;
  }
  return { x, n: T, char };
}
