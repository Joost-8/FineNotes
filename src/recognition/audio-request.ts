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
 * - **Anthropic** and **OpenRouter** have no audio-file transcription
 *   endpoint, and say so rather than guess.
 *
 * The multipart body is built here, as bytes, because `requestUrl` takes an
 * `ArrayBuffer` and has no FormData — and a hand-built body is only correct
 * if it is correct to the byte, which is what the tests pin.
 *
 * No DOM, no Obsidian, no network.
 */

import {
  type LlmVendor,
  VENDORS,
  defaultModelFor,
  extractLlmText,
  openAiEndpointUrl,
} from "./llm-request";

export type AudioVendor = "openai" | "google" | "custom";

export const AUDIO_VENDORS: readonly AudioVendor[] = ["openai", "google", "custom"];

/**
 * Starting points. `gpt-4o-mini-transcribe` is the cheapest OpenAI model
 * (research/FEATURES.md §3.4: about $0.27 for a 90-minute lecture). Gemini
 * transcribes with the ordinary text model. Self-hosted Whisper servers
 * conventionally accept the name `whisper-1`.
 */
export const DEFAULT_AUDIO_MODELS: Readonly<Record<AudioVendor, string>> = {
  openai: "gpt-4o-mini-transcribe",
  google: defaultModelFor("google"),
  custom: "whisper-1",
};

/** OpenAI's documented upload cap. */
export const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
/** Gemini's documented cap on a whole inline request, prompt included. */
export const GOOGLE_INLINE_MAX_BYTES = 20 * 1024 * 1024;
/** A transcript of an hour of speech is ~10k words; leave room for two. */
export const AUDIO_MAX_OUTPUT_TOKENS = 32768;

export function canTranscribeAudio(vendor: LlmVendor): vendor is AudioVendor {
  return (AUDIO_VENDORS as readonly string[]).includes(vendor);
}

/** A one-line reason why `vendor` cannot transcribe audio (empty when it can). */
export function audioUnsupportedReason(vendor: LlmVendor): string {
  switch (vendor) {
    case "anthropic":
      return "Claude cannot transcribe audio files — needs an OpenAI or Google key";
    case "openrouter":
      return "OpenRouter has no audio transcription — needs an OpenAI or Google key";
    default:
      return "";
  }
}

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
  const vendor = VENDORS[input.vendor];
  if (vendor.requiresKey && !input.apiKey.trim()) throw new Error("missing API key");
  if (input.audio.length === 0) throw new Error("the recording is empty");
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
        `the recording is ${megabytes(input.audio.length)} — Gemini takes at most about ` +
          `${megabytes((GOOGLE_INLINE_MAX_BYTES * 3) / 4)} in one request. Use an OpenAI key ` +
          "(up to 25 MB), or record shorter parts.",
      );
    }
    return {
      url: vendor.url({ model }),
      headers: vendor.headers(input.apiKey),
      contentType: "application/json",
      body: json,
    };
  }

  if (input.vendor === "openai" && input.audio.length > OPENAI_AUDIO_MAX_BYTES) {
    throw new Error(
      `the recording is ${megabytes(input.audio.length)} — OpenAI takes at most 25 MB. ` +
        "Record shorter parts, or at a lower bitrate.",
    );
  }
  const parts: MultipartPart[] = [
    { name: "model", value: model },
    // gpt-4o-*-transcribe answer only `json` or `text`; `json` suits all.
    { name: "response_format", value: "json" },
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

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
