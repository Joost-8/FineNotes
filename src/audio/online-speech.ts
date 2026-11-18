/**
 * Transcribing a recording with an online service (Groq, OpenAI,
 * OpenRouter, Gemini, a server of the user's own) instead of on this device.
 *
 * - **Whole file.** A recording within the service's upload limit goes up
 *   as it is, in the format it was recorded in.
 * - **Windows.** A longer one is decoded to 16 kHz mono, cut at quiet
 *   moments into windows of a few minutes by the same `cutPoints` and
 *   `planWindows` the device uses, and each window goes up as 16-bit WAV
 *   (32 KB a second, so 25 MB holds about 12 minutes). The answers are
 *   stitched by `mergeSegments`, as the device's windows are.
 * - **Times.** A service that answers with segments (Whisper's
 *   `verbose_json`) gives a timed transcript like the device's; one that
 *   answers with text alone gives paragraphs, one per window.
 *
 * PURE: no DOM, no Obsidian, no network. Decoding and sending are passed in.
 */

import {
  SPEECH_RATE,
  type SpeechSegment,
  type SpeechWindow,
  type WindowResult,
  buildTimedTranscript,
  cutPoints,
  isNonSpeech,
  mergeSegments,
  planWindows,
} from "./speech-chunks";

/** Where recordings are transcribed: this device, or an online service. */
export type SpeechService = "device" | "groq" | "openai" | "openrouter" | "google" | "custom";
export type OnlineSpeechService = Exclude<SpeechService, "device">;

export const SPEECH_SERVICES: readonly SpeechService[] = [
  "device",
  "groq",
  "openai",
  "openrouter",
  "google",
  "custom",
];

export function isSpeechService(value: unknown): value is SpeechService {
  return typeof value === "string" && (SPEECH_SERVICES as readonly string[]).includes(value);
}

export function isOnlineSpeechService(value: unknown): value is OnlineSpeechService {
  return isSpeechService(value) && value !== "device";
}

/** A WAV file's header, before its samples. */
export const WAV_HEADER_BYTES = 44;
/** Windows sent to a service are at most this long, whatever its limit. */
export const UPLOAD_WINDOW_MAX_S = 600;
/** Each window stays this far under the limit, for the form around it. */
export const UPLOAD_MARGIN = 0.92;

/**
 * How long a window may run for an upload limit of `maxBytes`: what fits as
 * 16-bit mono WAV, kept under the margin, and never above
 * {@link UPLOAD_WINDOW_MAX_S} (one slow answer then costs a few minutes,
 * not an hour). At least 30 s.
 */
export function uploadWindowSeconds(maxBytes: number, rate = SPEECH_RATE): number {
  const fits = Math.floor((maxBytes * UPLOAD_MARGIN - WAV_HEADER_BYTES) / (rate * 2));
  return Math.max(30, Math.min(UPLOAD_WINDOW_MAX_S, fits));
}

/** Samples in [-1, 1] as a 16-bit PCM mono WAV file. */
export function encodeWav(samples: Float32Array, rate = SPEECH_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a frame
  view.setUint16(34, 16, true); // bits a sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(WAV_HEADER_BYTES + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** What a service answered for one upload: its text, and its segments when it gives them (ms from the upload's start). */
export interface OnlineAnswer {
  text: string;
  segments?: readonly SpeechSegment[];
}

/**
 * A window's answer as segments on the window's own clock. Without
 * segments the whole text is one segment spanning what the window keeps,
 * so `mergeSegments` keeps it and drops the words its padding repeats.
 */
export function windowResult(
  window: SpeechWindow,
  answer: OnlineAnswer,
  rate = SPEECH_RATE,
): WindowResult {
  if (answer.segments && answer.segments.length > 0) {
    return { window, segments: answer.segments };
  }
  const toMs = (samples: number): number => (samples * 1000) / rate;
  const text = answer.text.trim();
  return {
    window,
    segments: text
      ? [{ start: toMs(window.own0 - window.from), end: toMs(window.own1 - window.from), text }]
      : [],
  };
}

/**
 * The transcript from every window's answer: timed paragraphs when any
 * answer had segments, else one paragraph per window.
 */
export function joinAnswers(
  results: readonly { window: SpeechWindow; answer: OnlineAnswer }[],
  rate = SPEECH_RATE,
): string {
  const merged = mergeSegments(
    results.map(({ window, answer }) => windowResult(window, answer, rate)),
    rate,
  );
  const timed = results.some(({ answer }) => (answer.segments?.length ?? 0) > 0);
  if (timed) return buildTimedTranscript(merged);
  return merged.map((s) => s.text).join("\n\n");
}

/** A whole-file answer as the transcript: timed when it came with segments. */
export function answerText(answer: OnlineAnswer): string {
  const segments = (answer.segments ?? [])
    .map((s) => ({ ...s, text: s.text.replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text !== "" && !isNonSpeech(s.text));
  return (segments.length > 0 ? buildTimedTranscript(segments) : "") || answer.text.trim();
}

export interface OnlineTranscription {
  /** The recording as stored. */
  bytes: Uint8Array;
  mimeType: string;
  /** The most the service takes in one upload. */
  maxBytes: number;
  /** The recording as 16 kHz mono samples; only called for a recording over the limit. */
  decode: () => Promise<Float32Array>;
  /** Send one upload and return what the service answered. */
  send: (audio: Uint8Array, mimeType: string) => Promise<OnlineAnswer>;
  /** Called before each upload: its number from 1, and how many there are. */
  onUpload?: (part: number, parts: number, bytes: number) => void;
  /** True to stop before the next upload. */
  stopped?: () => boolean;
}

/** Thrown when `stopped` said to stop. */
export class TranscriptionStopped extends Error {}

/**
 * The transcript of a recording, sent whole when it fits and in windows
 * when it does not. Empty when nothing was said. Errors from `decode` and
 * `send` pass through unchanged.
 */
export async function transcribeOnline(input: OnlineTranscription): Promise<string> {
  if (input.bytes.length <= input.maxBytes) {
    input.onUpload?.(1, 1, input.bytes.length);
    return answerText(await input.send(input.bytes, input.mimeType));
  }
  const samples = await input.decode();
  const rate = SPEECH_RATE;
  const windows = planWindows(
    samples.length,
    cutPoints(samples, rate, uploadWindowSeconds(input.maxBytes, rate)),
    rate,
  );
  const results: { window: SpeechWindow; answer: OnlineAnswer }[] = [];
  for (const window of windows) {
    if (input.stopped?.()) throw new TranscriptionStopped();
    const wav = encodeWav(samples.subarray(window.from, window.to), rate);
    input.onUpload?.(window.index + 1, windows.length, wav.length);
    results.push({ window, answer: await input.send(wav, "audio/wav") });
  }
  return joinAnswers(results, rate);
}
