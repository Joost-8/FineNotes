/**
 * On-device handwriting recognition, end to end: a page's ink → lines →
 * frames → network → text. Experimental and dev-only: the models are
 * research-only and are read from the user's own vault (bundle.ts).
 *
 * PURE: no DOM, no Obsidian. The worker (worker.ts) runs it off the main
 * thread; `now` is its clock, for the timings.
 */

import { forward } from "./blstm";
import type { HwrBundle } from "./bundle";
import { type BeamOptions, beamDecode, greedyDecode } from "./ctc";
import { networkInput } from "./curves";
import { type InkStroke, LineTooLongError, lineFeatures } from "./features";
import { type Box, type PageInk, lineStrokes, segmentPage } from "./lines";

export interface LineTimings {
  /** Milliseconds for the frames, the network and the decoders. */
  features: number;
  network: number;
  greedy: number;
  beam: number;
}

export interface LineReading {
  /** The letters as written (best path). */
  greedy: string;
  /** With the language model, when the bundle has one; else the greedy text. */
  text: string;
  /** Mean best-class probability over non-blank frames. */
  confidence: number;
  frames: number;
  timings: LineTimings;
}

export interface PageLineReading extends LineReading {
  strokeIds: string[];
  /** The line's words, as stroke ids, so a caller need not find them again. */
  words: string[][];
  box: Box;
}

export interface PageReading {
  lines: PageLineReading[];
  /** Set when the worker kept the lines' log-probabilities, to ask about their words. */
  id?: number;
  /** Milliseconds to find the lines. */
  segment: number;
  wordGap: number;
}

export interface ReadOptions {
  /** Decode with the bundle's language model (default true, when it has one). */
  useLm?: boolean;
  /** Overrides the bundle's decoder settings. */
  beam?: Partial<BeamOptions>;
  /** A clock in milliseconds (`performance.now` in the worker). */
  now?: () => number;
  /**
   * Handed each line's CTC log-probabilities (`frames × classes`), for a
   * second look at its words (lexicon.ts). `line` is its index on the page.
   */
  logp?: (line: number, logp: Float32Array, frames: number) => void;
}

/**
 * Read one line of strokes (any order: they are put in writing order). A
 * line too long to read (`MAX_LINE_FRAMES`) reads as nothing, so the rest of
 * its page is still read.
 */
export function readLine(
  bundle: HwrBundle,
  strokes: readonly InkStroke[],
  options: ReadOptions = {},
): LineReading {
  const now = options.now ?? (() => 0);
  const t0 = now();
  let line: { features: Float32Array; frames: number };
  try {
    const points = lineFeatures(strokes, bundle.meta.features.heightsPerSecond);
    line = networkInput(bundle.meta.input, bundle.net.inputs, points.features, points.frames);
  } catch (error) {
    if (!(error instanceof LineTooLongError)) throw error;
    const timings = { features: now() - t0, network: 0, greedy: 0, beam: 0 };
    return { greedy: "", text: "", confidence: 0, frames: 0, timings };
  }
  const { features, frames } = line;
  const t1 = now();
  const logp = forward(bundle.net, features, frames);
  const t2 = now();
  options.logp?.(0, logp, frames);
  const alphabet = bundle.meta.alphabet;
  const greedy = greedyDecode(logp, frames, alphabet);
  const t3 = now();
  const lm = options.useLm === false ? null : bundle.lm;
  const text = lm
    ? beamDecode(logp, frames, alphabet, lm, { ...bundle.meta.decoder, ...options.beam })
    : greedy.text;
  const t4 = now();
  return {
    greedy: greedy.text,
    text,
    confidence: greedy.confidence,
    frames,
    timings: { features: t1 - t0, network: t2 - t1, greedy: t3 - t2, beam: t4 - t3 },
  };
}

/** Find a page's lines and read each one. */
export function readPage(
  bundle: HwrBundle,
  strokes: readonly PageInk[],
  options: ReadOptions = {},
): PageReading {
  const now = options.now ?? (() => 0);
  const t0 = now();
  const { lines, wordGap } = segmentPage(strokes);
  const segment = now() - t0;
  return {
    segment,
    wordGap,
    lines: lines.map((line, index) => {
      const ink = lineStrokes(line);
      const keep = options.logp;
      return {
        ...readLine(bundle, ink, {
          ...options,
          logp: keep && ((_, logp, frames) => keep(index, logp, frames)),
        }),
        strokeIds: ink.map((s) => s.id),
        words: line.words.map((word) => word.strokes.map((s) => s.id)),
        box: line.box,
      };
    }),
  };
}
