/**
 * Messages between the plugin and the translation worker
 * (translate-worker.ts, view/translator.ts).
 *
 * PURE: types only.
 */

import type { GemmPrecision } from "./catalog-types";

/** Tags this module's messages. */
export const TRANSLATE_TAG = "fineNotesTranslate";

/** A model's files, by kind, as the worker needs them (bytes are transferred). */
export interface ModelBytes {
  /** The pair ("nl-en"): the worker keeps loaded models by it. */
  key: string;
  from: string;
  to: string;
  precision: GemmPrecision;
  model: ArrayBuffer;
  /** One shared vocabulary, or a source and a target one. */
  vocab?: ArrayBuffer;
  srcvocab?: ArrayBuffer;
  trgvocab?: ArrayBuffer;
  lex?: ArrayBuffer;
}

export type TranslateRequest =
  /** The engines' code (transferred), once per worker. */
  | { type: "init"; bergamot: ArrayBuffer; fasttext: ArrayBuffer; lid: ArrayBuffer }
  /** fastText's top guesses for the text's language. */
  | { type: "detect"; text: string }
  /** Load models the worker does not hold yet (by key). */
  | { type: "load"; models: ModelBytes[] }
  /**
   * Translate each text through the models named, in order (one, or two
   * through English). They must have been loaded.
   */
  | { type: "translate"; keys: string[]; texts: string[] };

export type TranslateResult =
  | { type: "init" }
  | { type: "detect"; guesses: [string, number][] }
  | { type: "load"; loaded: string[] }
  | { type: "translate"; texts: string[]; ms: number };

export type TranslateReply =
  { id: number; ok: true; result: TranslateResult } | { id: number; ok: false; error: string };
