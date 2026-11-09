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
import {
  type BeamOptions,
  type WordBias,
  beamDecode,
  greedyDecode,
  mathLogp,
  wordTrie,
} from "./ctc";
import { type CharReading, charReadings } from "./char-readings";
import { networkFrames } from "./curves";
import { type InkStroke, LineTooLongError, lineFeatures } from "./features";
import { REREAD_MARGIN, type RereadList, rereadOutOfList } from "./lexicon";
import { type Box, type PageInk, lineStrokes, segmentPage } from "./lines";

/** Nats per letter a page word earns while decoding (EXP-PCONFIRM: lam 1). */
export const PAGE_WORD_WEIGHT = 1;

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
  /**
   * Each character of `greedy`, with its strokes (indices into the strokes
   * read), its confidence and its runner-ups; only when asked (`chars`).
   */
  chars?: CharReading[];
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

/** How much the text language model counts on a maths line. */
const MATH_LM_SCALE = 0.5;
/** The words a maths line is written with, favoured as a page's own words are. */
const MATH_BIAS: WordBias = {
  root: wordTrie(["ln", "log", "mod", "sin", "cos", "tan"]),
  weight: 1,
};

export interface ReadOptions {
  /** Decode with the bundle's language model (default true, when it has one). */
  useLm?: boolean;
  /**
   * The line is known to be maths (a calculation note's "="): digits, signs
   * and x y f are rewarded, the text language model counts half, and ln log
   * mod sin cos tan are favoured. Ordinary reading never sets it.
   */
  math?: boolean;
  /** Overrides the bundle's decoder settings. */
  beam?: Partial<BeamOptions>;
  /** A clock in milliseconds (`performance.now` in the worker). */
  now?: () => number;
  /**
   * Handed each line's CTC log-probabilities (`frames × classes`), for a
   * second look at its words (lexicon.ts). `line` is its index on the page.
   */
  logp?: (line: number, logp: Float32Array, frames: number) => void;
  /** Also give each character with its strokes and runner-ups (`LineReading.chars`). */
  chars?: boolean;
  /**
   * The four reading fixes of EXP-PCONFIRM (set P whole pages 33.7 → 29.2 %
   * CER), each on unless turned off here:
   *
   * - `rowOrder`: a page's lines in row order (`segmentPage`'s `rows`);
   * - `lateStrokes`: late strokes read where they belong (`lateStrokeOrder`);
   * - `pageWordBias`: favour `pageWords` while decoding (`WordBias`), when given;
   * - `reread`: words not in `rereadList` read again against it
   *   (`rereadOutOfList`), when given. The list is the word list
   *   (words.txt), never the page words alone, which made one set worse.
   */
  rowOrder?: boolean;
  lateStrokes?: boolean;
  pageWordBias?: boolean;
  reread?: boolean;
  /** The notebook's own words (page-words.ts), never the page's own reading. */
  pageWords?: readonly string[] | null;
  /** Nats per letter for `pageWords` (default `PAGE_WORD_WEIGHT`). */
  pageWordWeight?: number;
  rereadList?: RereadList | null;
  /** Default `REREAD_MARGIN`. */
  rereadMargin?: number;
  /** The page words' trie, built once by `readPage` for all its lines. */
  bias?: WordBias | null;
}

/** The word bias `options` asks for, or null. */
function biasOf(options: ReadOptions): WordBias | null {
  if (options.bias !== undefined) return options.bias;
  if (options.pageWordBias === false || !options.pageWords || options.pageWords.length === 0) {
    return null;
  }
  return {
    root: wordTrie(options.pageWords),
    weight: options.pageWordWeight ?? PAGE_WORD_WEIGHT,
  };
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
  let line: { features: Float32Array; frames: number; frameStroke: Int32Array | null };
  let order: number[] = [];
  try {
    const points = lineFeatures(strokes, bundle.meta.features.heightsPerSecond, {
      lateStrokes: options.lateStrokes !== false,
    });
    line = networkFrames(
      bundle.meta.input,
      bundle.net.inputs,
      points.features,
      points.frames,
      points.frameStroke,
    );
    if (options.chars) order = points.strokes.map((s) => strokes.indexOf(s));
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
  const decoder = { ...bundle.meta.decoder, ...options.beam };
  const math = options.math === true;
  let text = greedy.text;
  if (lm) {
    text = math
      ? beamDecode(
          mathLogp(logp, frames, alphabet),
          frames,
          alphabet,
          lm,
          { ...decoder, alpha: decoder.alpha * MATH_LM_SCALE },
          MATH_BIAS,
        )
      : beamDecode(logp, frames, alphabet, lm, decoder, biasOf(options));
  }
  if (lm && !math && options.reread !== false && options.rereadList) {
    const margin = options.rereadMargin ?? REREAD_MARGIN;
    const line = { logp, frames };
    text = rereadOutOfList(line, alphabet, lm, decoder.alpha, text, options.rereadList, margin);
  }
  const t4 = now();
  return {
    greedy: greedy.text,
    text,
    confidence: greedy.confidence,
    frames,
    timings: { features: t1 - t0, network: t2 - t1, greedy: t3 - t2, beam: t4 - t3 },
    ...(options.chars && line.frameStroke
      ? {
          chars: charReadings(
            logp,
            frames,
            alphabet,
            greedy.text,
            greedy.spans,
            line.frameStroke,
            order,
          ),
        }
      : {}),
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
  const { lines, wordGap } = segmentPage(strokes, { rows: options.rowOrder !== false });
  const segment = now() - t0;
  const bias = biasOf(options);
  return {
    segment,
    wordGap,
    lines: lines.map((line, index) => {
      const ink = lineStrokes(line);
      const keep = options.logp;
      return {
        ...readLine(bundle, ink, {
          ...options,
          bias,
          logp: keep && ((_, logp, frames) => keep(index, logp, frames)),
        }),
        strokeIds: ink.map((s) => s.id),
        words: line.words.map((word) => word.strokes.map((s) => s.id)),
        box: line.box,
      };
    }),
  };
}
