/**
 * Pure request/response shapes for transcribing an audio recording with the
 * user's own key — the seam the audio feature calls through
 * `transcribeAudio()` in `ai-client.ts`.
 *
 * - **OpenAI** and a **custom OpenAI-compatible endpoint** (Speaches,
 *   LocalAI, faster-whisper-server …): `POST …/audio/transcriptions`, a
 *   `multipart/form-data` body with `file` and `model`, answering `{ text }`.
 *   Up to 25 MB; mp3, mp4, mpeg, mpga, m4a, wav and webm.
 *   https://developers.openai.com/api/docs/guides/speech-to-text (2026-09-22)
 * - **Google**: `generateContent` with the audio inline beside a
 *   transcription prompt. The whole request may be 20 MB; `audio/m4a` is a
 *   listed type and `audio/mp4` is not, so MP4 audio is relabelled.
 *   https://ai.google.dev/gemini-api/docs/audio (2026-09-22)
 * - **Groq**: the same OpenAI form at
 *   `api.groq.com/openai/v1/audio/transcriptions`, Whisper large v3 (turbo).
 *   25 MB on the free tier; flac, mp3, mp4, m4a, ogg, wav, webm.
 *   https://console.groq.com/docs/speech-to-text (2026-11-12)
 * - **OpenRouter**: the OpenAI form at `openrouter.ai/api/v1/audio/transcriptions`
 *   (added 2026), models such as `openai/whisper-large-v3`; multipart
 *   uploads up to 25 MB; `json` or `verbose_json` only.
 *   https://openrouter.ai/docs/guides/overview/multimodal/stt (2026-11-12)
 * - **Anthropic** has no audio-file transcription endpoint, and says so
 *   rather than guess.
 *
 * Whisper models answer `verbose_json` with timed segments, which give a
 * transcript with times like the device's; `gpt-4o-*-transcribe` and a
 * server of the user's own are asked for plain `json`.
 *
 * The multipart body is built here, as bytes, because `requestUrl` takes an
 * `ArrayBuffer` and has no FormData — and a hand-built body is only correct
 * if it is correct to the byte, which is what the tests pin.
 *
 * No DOM, no Obsidian, no network.
 */

import { t } from "../i18n/translate";
import {
  type LlmVendor,
  VENDORS,
  defaultModelFor,
  extractLlmText,
  openAiEndpointUrl,
} from "./llm-request";

export type AudioVendor = "openai" | "google" | "custom" | "openrouter" | "groq";

/** Every service a recording can be sent to; Groq transcribes and nothing else here. */
export const AUDIO_VENDORS: readonly AudioVendor[] = [
  "groq",
  "openai",
  "openrouter",
  "google",
  "custom",
];

/** Where a key is kept: one slot per chat vendor, and Groq's. */
export type KeySlot = LlmVendor | "groq";

/**
 * Starting points. `gpt-4o-mini-transcribe` is the cheapest OpenAI model
 * (research/FEATURES.md §3.4: about $0.27 for a 90-minute lecture). Gemini
 * transcribes with the ordinary text model. Groq's turbo Whisper costs
 * $0.04 an hour. Self-hosted Whisper servers conventionally accept the
 * name `whisper-1`.
 */
export const DEFAULT_AUDIO_MODELS: Readonly<Record<AudioVendor, string>> = {
  openai: "gpt-4o-mini-transcribe",
  google: defaultModelFor("google"),
  custom: "whisper-1",
  openrouter: "openai/whisper-large-v3",
  groq: "whisper-large-v3-turbo",
};

/** OpenAI's documented upload cap, which Groq (free tier) and OpenRouter share. */
export const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

/** Groq's transcription endpoint. */
export const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
/** OpenRouter's transcription endpoint. */
export const OPENROUTER_TRANSCRIPTIONS_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

/** What the rest of the code needs to know about a transcription service. */
export interface AudioServiceInfo {
  label: string;
  requiresKey: boolean;
  /** A server of the user's own: its own key slot and its own consent. */
  userEndpoint: boolean;
  headers: (apiKey: string) => Record<string, string>;
}

/** The service behind `vendor`: the chat vendor's own description, or Groq's. */
export function audioService(vendor: AudioVendor): AudioServiceInfo {
  if (vendor === "groq") {
    return {
      label: "Groq",
      requiresKey: true,
      userEndpoint: false,
      headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
    };
  }
  return VENDORS[vendor];
}

/**
 * The most one upload to `vendor` may hold. A server of the user's own
 * publishes none; 25 MB is the OpenAI-compatible servers' common default.
 * Gemini's 20 MB is for the whole JSON request, the audio as base64.
 */
export function audioMaxBytes(vendor: AudioVendor): number {
  if (vendor === "google") {
    return Math.min(14 * 1024 * 1024, Math.floor((GOOGLE_INLINE_MAX_BYTES * 3) / 4));
  }
  return OPENAI_AUDIO_MAX_BYTES;
}

/**
 * Whether `vendor` is asked for timed segments (`verbose_json`): Whisper
 * models at Groq, OpenRouter and OpenAI. `gpt-4o-*-transcribe` refuses it,
 * and a server of the user's own may not know it.
 */
export function wantsSegments(vendor: AudioVendor, model: string): boolean {
  const id = model.trim().toLowerCase();
  if (vendor === "groq") return true;
  if (vendor === "openrouter" || vendor === "openai") return id.includes("whisper");
  return false;
}
/** Gemini's documented cap on a whole inline request, prompt included. */
export const GOOGLE_INLINE_MAX_BYTES = 20 * 1024 * 1024;
/** A transcript of an hour of speech is ~10k words; leave room for two. */
export const AUDIO_MAX_OUTPUT_TOKENS = 32768;

// --- multipart/form-data ------------------------------------------------------

export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; data: Uint8Array };

/**
 * Escape a name or filename for a `Content-Disposition` quoted string the way
 * browsers do for FormData (WHATWG HTML): `"` → `%22`, CR → `%0D`, LF → `%0A`.
 */
export function escapeDispositionValue(value: string): string {
  return value.replace(/"/g, "%22").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** A boundary that cannot occur in the body by accident: 32 hex digits from `random`. */
export function makeBoundary(randomBytes: Uint8Array): string {
  const hex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `----FineNotes${hex}`;
}

/**
 * Encode `parts` as a multipart/form-data body (RFC 7578), CRLF line endings:
 *
 *     --B CRLF Content-Disposition: form-data; name="n" CRLF CRLF value CRLF
 *     --B CRLF Content-Disposition: form-data; name="file"; filename="f" CRLF
 *     Content-Type: t CRLF CRLF <bytes> CRLF
 *     --B-- CRLF
 */
export function encodeMultipart(parts: readonly MultipartPart[], boundary: string): Uint8Array {
  if (!/^[0-9A-Za-z'()+_,\-./:=?]{1,70}$/.test(boundary)) {
    throw new Error(`invalid multipart boundary "${boundary}"`);
  }
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeDispositionValue(part.name)}"`;
    if ("data" in part) {
      head += `; filename="${escapeDispositionValue(part.filename)}"\r\n`;
      head += `Content-Type: ${part.contentType}\r\n\r\n`;
      chunks.push(encoder.encode(head), part.data, encoder.encode("\r\n"));
    } else {
      chunks.push(encoder.encode(`${head}\r\n\r\n${part.value}\r\n`));
    }
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

// --- requests -------------------------------------------------------------------

/** The file name a recording is uploaded under; servers sniff the extension. */
export function audioFilename(mimeType: string): string {
  const type = mimeType.toLowerCase().split(";")[0].trim();
  const ext: Record<string, string> = {
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
  };
  return `recording.${ext[type] ?? "m4a"}`;
}

/** Gemini lists `audio/m4a` but not `audio/mp4`, which is what iPadOS records. */
export function geminiAudioMimeType(mimeType: string): string {
  const type = mimeType.toLowerCase().split(";")[0].trim();
  if (type === "audio/mp4" || type === "audio/x-m4a") return "audio/m4a";
  if (type === "audio/mp3") return "audio/mpeg";
  return type || "audio/m4a";
}

/** The instruction Gemini transcribes against. */
export function buildAudioTranscriptionPrompt(language?: string): string {
  const lines = [
    "Transcribe this audio recording verbatim.",
    "- Output ONLY the transcript: no preamble, no summary, no code fences.",
    "- Start a new paragraph where the speaker pauses or changes topic.",
    "- Write [inaudible] for anything you cannot make out.",
  ];
  if (language) lines.push(`- The speech is most likely in this language: ${language}.`);
  return lines.join("\n");
}

export interface AudioRequestInput {
  vendor: AudioVendor;
  model: string;
  apiKey: string;
  /** OpenAI-compatible base URL; required when vendor is `custom`. */
  baseUrl?: string;
  audio: Uint8Array;
  mimeType: string;
  /** Multipart boundary (random in production, fixed in tests). */
  boundary: string;
  /** ISO-639-1 hint, e.g. "en" or "nl". Optional. */
  language?: string;
  /** Ask for timed segments (`verbose_json`); see {@link wantsSegments}. */
  segments?: boolean;
}

export interface AudioHttpRequest {
  url: string;
  headers: Record<string, string>;
  /** The `Content-Type` header value, passed to `requestUrl` as `contentType`. */
  contentType: string;
  body: Uint8Array;
}

/** Base64 of raw bytes, chunked so a 20 MB recording does not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Build the transcription request. Throws with a user-facing reason when it cannot be sent. */
export function buildAudioRequest(input: AudioRequestInput): AudioHttpRequest {
  const vendor = audioService(input.vendor);
  if (vendor.requiresKey && !input.apiKey.trim()) throw new Error(t("ai.client.missingKey"));
  if (input.audio.length === 0) throw new Error(t("ai.audio.empty"));
  const model = input.model.trim() || DEFAULT_AUDIO_MODELS[input.vendor];

  if (input.vendor === "google") {
    const data = bytesToBase64(input.audio);
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: geminiAudioMimeType(input.mimeType), data } },
            { text: buildAudioTranscriptionPrompt(input.language) },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: AUDIO_MAX_OUTPUT_TOKENS },
    };
    const json = new TextEncoder().encode(JSON.stringify(body));
    if (json.length > GOOGLE_INLINE_MAX_BYTES) {
      throw new Error(
        t("ai.audio.tooBigGemini", {
          size: megabytes(input.audio.length),
          max: megabytes((GOOGLE_INLINE_MAX_BYTES * 3) / 4),
        }),
      );
    }
    return {
      url: VENDORS.google.url({ model }),
      headers: vendor.headers(input.apiKey),
      contentType: "application/json",
      body: json,
    };
  }

  if (input.vendor !== "custom" && input.audio.length > OPENAI_AUDIO_MAX_BYTES) {
    throw new Error(t("ai.audio.tooBigOpenai", { size: megabytes(input.audio.length) }));
  }
  const parts: MultipartPart[] = [
    { name: "model", value: model },
    // gpt-4o-*-transcribe answer only `json` or `text`; Whisper also gives
    // `verbose_json`, with the segments' times.
    { name: "response_format", value: input.segments ? "verbose_json" : "json" },
  ];
  if (input.language) parts.push({ name: "language", value: input.language });
  parts.push({
    name: "file",
    filename: audioFilename(input.mimeType),
    contentType: input.mimeType.split(";")[0].trim() || "application/octet-stream",
    data: input.audio,
  });
  const url =
    input.vendor === "custom"
      ? openAiEndpointUrl(input.baseUrl ?? "", "/audio/transcriptions")
      : input.vendor === "groq"
        ? GROQ_TRANSCRIPTIONS_URL
        : input.vendor === "openrouter"
          ? OPENROUTER_TRANSCRIPTIONS_URL
          : "https://api.openai.com/v1/audio/transcriptions";
  return {
    url,
    headers: vendor.headers(input.apiKey),
    contentType: `multipart/form-data; boundary=${input.boundary}`,
    body: encodeMultipart(parts, input.boundary),
  };
}

/** The transcript text in a vendor response, or "". */
export function extractAudioTranscript(vendor: AudioVendor, json: unknown): string {
  if (vendor === "google") return extractLlmText("google", json).trim();
  if (typeof json !== "object" || json === null) return "";
  const text = (json as Record<string, unknown>).text;
  return typeof text === "string" ? text.trim() : "";
}

/** A timed piece of a transcript, in ms from the start of the audio sent. */
export interface AudioSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * The segments of a `verbose_json` answer (`segments: [{ start, end, text }]`,
 * times in seconds) in ms; empty when there are none or they do not read.
 */
export function extractAudioSegments(json: unknown): AudioSegment[] {
  if (typeof json !== "object" || json === null) return [];
  const list = (json as Record<string, unknown>).segments;
  if (!Array.isArray(list)) return [];
  const out: AudioSegment[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { start, end, text } = item as Record<string, unknown>;
    if (typeof text !== "string") continue;
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) continue;
    const stop = typeof end === "number" && Number.isFinite(end) && end >= start ? end : start;
    out.push({ start: Math.round(start * 1000), end: Math.round(stop * 1000), text });
  }
  return out;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
