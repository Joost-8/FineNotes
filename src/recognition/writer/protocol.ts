/**
 * Messages between the main thread and the writer's worker (worker.ts,
 * client.ts). Every request carries an id its reply repeats, and the tag.
 *
 * PURE: types only.
 */

import type { WriterManifest } from "./manifest";
import type { Written } from "./sampler";

export const WRITER_TAG = "fineNotesWriter";

/** The model's files, as bytes (the worker never fetches anything). */
export interface WriterFiles {
  /** Each graph's file, by its role in the manifest. */
  graphs: Record<string, ArrayBuffer>;
  /** onnxruntime-web's WebAssembly binary (the OCR's file). */
  wasm: ArrayBuffer;
}

export type WriterRequest =
  | { type: "load"; files: WriterFiles; manifest: WriterManifest }
  | {
      type: "write";
      text: string;
      /** What the model is shown, as its kind made it (`kinds.ts`). */
      ref: unknown;
      seed: number;
      /** The line's number, for its noise (not `id`: that is the message's). */
      line: number;
      /** Positions in the text written at low guidance (the repair). */
      low: number[];
      /** Guidance for the rest of the line (the neatness dial); the model's own when absent. */
      guidance?: number;
    };

export type WriterResult =
  { type: "load"; ms: number } | { type: "write"; written: Written; ms: number };

export type WriterReply = { id: number } & (
  { ok: true; result: WriterResult } | { ok: false; error: string }
);
