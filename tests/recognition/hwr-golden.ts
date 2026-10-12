/**
 * Shared by the on-device recogniser's golden tests: the fixture shapes
 * written by research/handwriting-rig/export_port_fixtures.py, and the checks
 * that the TypeScript port computes what the Python reference computed.
 */

import { expect } from "vitest";
import { forward } from "../../src/recognition/hwr/blstm";
import type { HwrBundle } from "../../src/recognition/hwr/bundle";
import { beamDecode, greedyDecode } from "../../src/recognition/hwr/ctc";
import { MIN_LINE_HEIGHT, lineFeatures } from "../../src/recognition/hwr/features";
import { segmentPage } from "../../src/recognition/hwr/lines";
import { readPage } from "../../src/recognition/hwr/recognizer";

export interface GoldenStroke {
  id: string;
  tool: string;
  shape: string | null;
  t0: number | null;
  pts: number[];
}

export interface GoldenLine {
  name: string;
  label?: string;
  strokes: GoldenStroke[];
  order: string[];
  frames: number;
  features: string;
  frameStroke: number[];
  norm: { full: number; base: number; core: number; scale: number };
  logp: string;
  greedy: { text: string; spans: [number, number][]; confidence: number };
  minTop2Gap: number;
  beam: {
    lm: boolean;
    alpha: number;
    beta: number;
    beam: number;
    topk: number;
    prune: number;
    text: string;
  }[];
}

export interface GoldenPage {
  name: string;
  strokes: GoldenStroke[];
  wordGap: number;
  lines: {
    xHeight: number;
    box: [number, number, number, number];
    words: string[][];
    greedy?: string;
    text?: string;
  }[];
}

/** Little-endian float32 values from base64. */
export function float32(b64: string): Float32Array {
  const bytes = Buffer.from(b64, "base64");
  const out = new Float32Array(bytes.length / 4);
  new Uint8Array(out.buffer).set(bytes);
  return out;
}

export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

/** What one line measured: how far the TypeScript is from the reference. */
export interface LineCheck {
  featureDiff: number;
  /** The forward pass as it runs (WebAssembly SIMD where available). */
  logpDiff: number;
  /** The plain JavaScript forward pass. */
  logpDiffJs: number;
}

/**
 * Frames, network, greedy and beam for one line against the reference.
 * `logpTolerance` bounds the network's difference from numpy's float32;
 * `checkJs` also runs the plain JavaScript forward pass (slow on long lines).
 */
export function checkLine(
  bundle: HwrBundle,
  line: GoldenLine,
  logpTolerance = 1e-4,
  checkJs = true,
): LineCheck {
  const alphabet = bundle.meta.alphabet;
  const C = alphabet.length + 1;
  // Frames: same writing order, same resampling, float32-identical values
  // up to a rounding step or two (numpy fits the baseline by SVD).
  const got = lineFeatures(line.strokes, bundle.meta.features.heightsPerSecond);
  expect(got.strokes.map((s) => (s as GoldenStroke).id)).toEqual(line.order);
  expect(got.frames).toBe(line.frames);
  expect(Array.from(got.frameStroke)).toEqual(line.frameStroke);
  const want = float32(line.features);
  const featureDiff = maxAbsDiff(got.features, want);
  expect(featureDiff).toBeLessThan(1e-6);
  if (line.norm.full < MIN_LINE_HEIGHT) {
    // The one place the port parts from the reference on purpose: a line
    // flatter than 1 px is taken as 1 px tall (FineNotes#22).
    expect(got.norm.full).toBe(MIN_LINE_HEIGHT);
  } else {
    expect(got.norm.full).toBe(line.norm.full);
    expect(got.norm.core).toBeCloseTo(line.norm.core, 9);
    expect(Math.abs(got.norm.scale / line.norm.scale - 1)).toBeLessThan(1e-12);
  }
  expect(got.norm.base).toBeCloseTo(line.norm.base, 6);

  // The network, on the reference's own frames: both kernels.
  const ref = float32(line.logp);
  const logp = forward(bundle.net, want, line.frames);
  const logpDiff = maxAbsDiff(logp, ref);
  expect(logpDiff).toBeLessThan(logpTolerance);
  const logpDiffJs = checkJs
    ? maxAbsDiff(forward(bundle.net, want, line.frames, { simd: false }), ref)
    : NaN;
  if (checkJs) expect(logpDiffJs).toBeLessThan(logpTolerance);
  expect(ref.length).toBe(line.frames * C);

  // Decoders on the reference's log-probabilities: the same text exactly.
  const greedy = greedyDecode(ref, line.frames, alphabet);
  expect(greedy.text).toBe(line.greedy.text);
  expect(greedy.spans).toEqual(line.greedy.spans);
  expect(greedy.confidence).toBeCloseTo(line.greedy.confidence, 5);
  for (const b of line.beam) {
    const options = { alpha: b.alpha, beta: b.beta, beam: b.beam, topk: b.topk, prune: b.prune };
    expect(beamDecode(ref, line.frames, alphabet, b.lm ? bundle.lm : null, options)).toBe(b.text);
  }
  // And end to end on our own: the greedy reading cannot move while the
  // network stays this close and no frame's best two classes are closer.
  if (line.minTop2Gap > 2 * logpDiff) {
    expect(greedyDecode(logp, line.frames, alphabet).text).toBe(line.greedy.text);
  }
  return { featureDiff, logpDiff, logpDiffJs };
}

/** Lines and words of a page, and (when recorded) each line's reading. */
export function checkPage(bundle: HwrBundle | null, page: GoldenPage): void {
  const { lines, wordGap } = segmentPage(page.strokes);
  expect(wordGap).toBeCloseTo(page.wordGap, 12);
  expect(lines.map((l) => l.words.map((w) => w.strokes.map((s) => s.id)))).toEqual(
    page.lines.map((l) => l.words),
  );
  expect(lines.map((l) => l.xHeight)).toEqual(page.lines.map((l) => l.xHeight));
  expect(lines.map((l) => l.box)).toEqual(page.lines.map((l) => l.box));
  if (!bundle || page.lines.some((l) => l.text === undefined)) return;
  const read = readPage(bundle, page.strokes);
  expect(read.lines.map((l) => l.greedy)).toEqual(page.lines.map((l) => l.greedy));
  expect(read.lines.map((l) => l.text)).toEqual(page.lines.map((l) => l.text));
}
