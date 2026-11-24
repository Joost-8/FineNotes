/**
 * Messages between the main thread and the writer's worker (worker.ts,
 * client.ts). Every request carries an id its reply repeats, and the tag.
 *
 * PURE: types only.
 */

import type { Reference } from "./rows";
import type { WriterMeta, Written } from "./sampler";

export const WRITER_TAG = "fineNotesWriter";

/** The model's files, as bytes (the worker never fetches anything). */
export interface WriterFiles {
  encode: ArrayBuffer;
  durations: ArrayBuffer;
  velocity: ArrayBuffer;
  /** onnxruntime-web's WebAssembly binary (the OCR's file). */
  wasm: ArrayBuffer;
}

export type WriterRequest =
  | { type: "load"; files: WriterFiles; meta: WriterMeta }
  | {
      type: "write";
      text: string;
      ref: Reference;
      seed: number;
      /** The line's number, for its noise (not `id`: that is the message's). */
      line: number;
      /** Positions in the text written at low guidance (the repair). */
      low: number[];
    };

export type WriterResult = { type: "load"; ms: number } | { type: "write"; written: Written; ms: number };

export type WriterReply = { id: number } & ({ ok: true; result: WriterResult } | { ok: false; error: string });
