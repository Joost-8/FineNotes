/**
 * Messages between the plugin and the recogniser's worker (worker.ts,
 * client.ts). Every request carries an id its reply repeats.
 *
 * PURE: types only.
 */

import type { InkStroke } from "./features";
import type { PageInk } from "./lines";
import type { LineReading, PageReading } from "./recognizer";

/** Tags this module's messages. */
export const HWR_TAG = "fineNotesHwr";

export type HwrRequest =
  /** Parse a recogniser file (the bytes are transferred). */
  | { type: "load"; bytes: ArrayBuffer }
  /** Find a page's lines and read them. */
  | { type: "page"; strokes: PageInk[]; useLm: boolean }
  /** Read lines given as strokes (benchmarks, tests). */
  | { type: "lines"; lines: InkStroke[][]; useLm: boolean };

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
  | { type: "lines"; readings: LineReading[] };

export type HwrReply = { id: number } & (
  { ok: true; result: HwrResult } | { ok: false; error: string }
);
