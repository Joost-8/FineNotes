/**
 * The messages between the main thread and the OCR worker. The worker is
 * started from a Blob URL (client.ts); its messages carry {@link OCR_TAG}.
 *
 * PURE: types only.
 */

import type { OcrPage } from "./ocr-words";

export const OCR_TAG = "fineNotesOcr";

/** The model's files, as bytes (the worker never fetches anything). */
export interface OcrFiles {
  det: ArrayBuffer;
  rec: ArrayBuffer;
  /** The dictionary's text. */
  dict: string;
  /** onnxruntime-web's WebAssembly binary. */
  wasm: ArrayBuffer;
}

export type OcrRequest =
  | {
      type: "load";
      files: OcrFiles;
      /** The recogniser's confidence thresholds (which lines are read again); default: the Fast model's. */
      confidence?: { wordMean: number; lineMean: number; wordMin: number };
    }
  | {
      type: "read";
      /** The page image; transferred and closed by the worker. */
      bitmap: ImageBitmap;
      /** Pixels per point. */
      scale: number;
      pageWidth: number;
      pageHeight: number;
      /** Where the image's corner lies on the page, points (a region of it); absent: the page's corner. */
      origin?: { x: number; y: number };
    };

export interface OcrReadResult {
  type: "read";
  page: OcrPage;
  /** Milliseconds per step, for the log. */
  steps: Record<string, number>;
}

export type OcrResult = { type: "load"; ms: number } | OcrReadResult;

export type OcrReply =
  { id: number; ok: true; result: OcrResult } | { id: number; ok: false; error: string };
