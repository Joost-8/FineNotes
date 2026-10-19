/**
 * Messages between the plugin and the on-device speech recognizer's worker
 * (speech-worker.ts, view/speech-client.ts).
 *
 * PURE: types, and the error a stopped job ends with.
 */

import type { SpeechSegment } from "./speech-chunks";

/** Thrown when a job was stopped. */
export class SpeechCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

/** Tags this module's messages. */
export const SPEECH_TAG = "fineNotesSpeech";

export type SpeechRequest =
  /** Load a model (its bytes are transferred). */
  | { type: "load"; model: ArrayBuffer }
  /**
   * Transcribe a recording: 16 kHz mono samples (transferred). Progress
   * comes as messages; the reply carries the segments on the recording's
   * clock.
   */
  | { type: "transcribe"; samples: Float32Array; language: string };

export interface SpeechProgress {
  /** 0 to 100, over the whole recording. */
  percent: number;
  /** Windows done, of `windows`. */
  done: number;
  windows: number;
}

export type SpeechResult =
  | { type: "load"; multilingual: boolean; loadMs: number }
  | { type: "transcribe"; segments: SpeechSegment[]; language: string; runMs: number };

export type SpeechReply =
  | { id: number; progress: SpeechProgress }
  | { id: number; ok: true; result: SpeechResult }
  | { id: number; ok: false; error: string };
