/**
 * Messages between the plugin and the recogniser's worker (worker.ts,
 * client.ts). Every request carries an id its reply repeats.
 *
 * PURE: types only.
 */

import type { InkStroke } from "./features";
import type { LexiconSuggestion } from "./lexicon";
import type { PageInk } from "./lines";
import type { LineReading, PageReading } from "./recognizer";
import type { LabelledLine } from "./tune";

/** Tags this module's messages. */
export const HWR_TAG = "fineNotesHwr";

export type HwrRequest =
  /** Parse a recogniser file (the bytes are transferred). */
  | { type: "load"; bytes: ArrayBuffer }
  /**
   * Find a page's lines and read them. `keep`: hold on to the lines'
   * log-probabilities (the last few pages only), for `suggest`.
   */
  | { type: "page"; strokes: PageInk[]; useLm: boolean; keep?: boolean }
  /** The word list to suggest from (`handwriting/words.txt`). */
  | { type: "lexicon"; words: string[] }
  /** List words for words of a kept page (`PageReading.id`). */
  | { type: "suggest"; reading: number; items: SuggestItem[] }
  /** Read lines given as strokes (benchmarks, tests). */
  | { type: "lines"; lines: InkStroke[][]; useLm: boolean }
  /**
   * Learn a writer's handwriting from labelled lines, starting from the model
   * in `bytes` (the general one): the tuned model file, and how both read
   * the held-out lines. Progress comes as messages along the way.
   */
  | { type: "tune"; bytes: ArrayBuffer; lines: LabelledLine[]; steps: number; name: string };

/** A word of a kept page's line: the token's `[start, end)` in the line's text. */
export interface SuggestItem {
  line: number;
  text: string;
  start: number;
  end: number;
}

/** What `suggest` found for an item; `ms` is the time it took. */
export type SuggestResult = (LexiconSuggestion & { ms: number }) | null;

/** A tuning run's progress, sent after each step. */
export interface HwrProgress {
  step: number;
  steps: number;
  loss: number;
}

/** What a tuning run made. */
export interface HwrTuned {
  /** The tuned model file. */
  bytes: ArrayBuffer;
  /** Characters wrong on the held-out lines, before and after. */
  before: { errors: number; chars: number };
  after: { errors: number; chars: number };
  better: boolean;
  trained: number;
  heldOut: number;
}

/** What a loaded file is, for the dialog. */
export interface HwrModelInfo {
  name: string;
  licence: string;
  layers: number;
  hidden: number;
  characters: number;
  /** LM contexts, or 0 without an LM. */
  lmContexts: number;
  /** Milliseconds to parse the file and lay the network out for the kernels. */
  parseMs: number;
  /** The network runs with WebAssembly SIMD (else plain JavaScript, ~10x slower). */
  simd: boolean;
}

export type HwrResult =
  | { type: "load"; info: HwrModelInfo }
  | { type: "page"; reading: PageReading }
  | { type: "lines"; readings: LineReading[] }
  | { type: "lexicon"; size: number }
  /** One per item; all null when the page is no longer kept or there is no list. */
  | { type: "suggest"; results: SuggestResult[] }
  | { type: "tune"; tuned: HwrTuned | null };

export type HwrReply = { id: number } & (
  { ok: true; result: HwrResult } | { ok: false; error: string } | { progress: HwrProgress }
);
