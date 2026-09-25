/**
 * Network side of the AI features: one call per user action, over Obsidian's
 * `requestUrl` (the webview blocks cross-origin `fetch` to these APIs, on the
 * iPad included), with every vendor's failure turned into one sentence that
 * names the vendor and quotes its own error message.
 *
 * Nothing here asks for consent or reads settings — callers do both (see
 * `GoodObsidianPlugin.confirmAiSend`). Request and response shapes are the
 * pure modules': `ai-chat.ts`, `ai-image.ts`, `audio-request.ts`.
 */

import type { RequestUrlResponse } from "obsidian";
import { postBytes, postJson } from "./http";
import { errorMessage } from "../util/errors";
import {
  type LlmVendor,
  MAX_OUTPUT_TOKENS,
  VENDORS,
  buildRecognitionPrompt,
  cleanTranscription,
  defaultModelFor,
  describeLlmTarget,
  extractLlmErrorMessage,
  extractLlmText,
  isTruncatedLlmResponse,
} from "./llm-request";
import { type ChatTurn, buildChatRequest, extractRefusal } from "./ai-chat";
import {
  DEFAULT_IMAGE_MODELS,
  type ImageAspect,
  type ImageVendor,
  base64ToBytes,
  buildImageRequest,
  describeMissingImage,
  extractGeneratedImage,
} from "./ai-image";
import {
  AUDIO_MAX_OUTPUT_TOKENS,
  DEFAULT_AUDIO_MODELS,
  audioUnsupportedReason,
  buildAudioRequest,
  canTranscribeAudio,
  extractAudioTranscript,
  makeBoundary,
} from "./audio-request";

/** Everything needed to reach one vendor. Keys are resolved by the caller. */
export interface AiVendorConfig {
  vendor: LlmVendor;
  /** Empty means "the default for this vendor and task". */
  model: string;
  /** Optional for the `custom` vendor. Never another vendor's key. */
  apiKey: string;
  /** OpenAI-compatible base URL; only read for `custom`. */
  baseUrl: string;
}

/** A vendor's label, or "your configured endpoint (host)". */
export function targetLabel(config: Pick<AiVendorConfig, "vendor" | "baseUrl">): string {
  return describeLlmTarget(config.vendor, config.baseUrl);
}

/** Refuse early, in the words the settings use, when a request cannot be sent. */
export function assertConfigured(config: AiVendorConfig): void {
  const vendor = VENDORS[config.vendor];
  if (vendor.userEndpoint && !config.baseUrl.trim()) {
    throw new Error("no endpoint URL set — add one in FineNotes settings.");
  }
  if (vendor.requiresKey && !config.apiKey.trim()) {
    throw new Error(`no API key set for ${targetLabel(config)} — add one in FineNotes settings.`);
  }
}

/**
 * Send one request and hand back the parsed JSON of a 2xx response, or throw
 * an `Error` whose message is ready for a Notice.
 */
export async function sendVendorRequest(
  config: Pick<AiVendorConfig, "vendor" | "baseUrl">,
  send: () => Promise<RequestUrlResponse>,
): Promise<unknown> {
  const vendor = VENDORS[config.vendor];
  const label = targetLabel(config);
  let response: RequestUrlResponse;
  try {
    response = await send();
  } catch (err) {
    // `ConnectionError` is what the helpers in http.ts throw for a request
    // that never reached the server; anything else is reported the same way.
    const message = errorMessage(err, "");
    const detail = message ? ` (${message})` : "";
    throw new Error(
      vendor.userEndpoint
        ? `could not reach ${label} — is the server running and reachable ` +
            `from this device?${detail}`
        : `could not reach ${label} — check your network connection.${detail}`,
    );
  }

  const { status } = response;
  if (status < 200 || status >= 300) throw failedStatus(label, vendor.userEndpoint, response);

  try {
    return response.json as unknown;
  } catch {
    throw new Error(`${label} returned an unreadable response.`);
  }
}

/**
 * The error for a reply with a failing status, quoting the vendor's own
 * message where the body has one: Google's 404 names the model it lacks,
 * which the status alone never would.
 */
function failedStatus(label: string, userEndpoint: boolean, response: RequestUrlResponse): Error {
  const { status } = response;
  if (status === 401 || status === 403) {
    // From a named vendor this is the key. From a self-hosted server it is
    // more often the server's own access rules: Ollama answers only requests
    // addressed to localhost unless told otherwise, so through a tunnel or a
    // proxy it sends back an empty 403.
    return new Error(
      userEndpoint
        ? `${label} denied the request (HTTP ${status}). A self-hosted server does that when it ` +
            "wants an API key (add one in settings), or when it only answers requests from its " +
            "own machine, which a tunnel or proxy is not: Ollama needs OLLAMA_HOST=0.0.0.0 or " +
            "network exposure switched on. SELF_HOSTING.md walks through both."
        : `${label} did not accept the API key — check it in FineNotes settings.`,
    );
  }
  let body: unknown;
  try {
    body = response.json;
  } catch {
    body = undefined; // not JSON: the status is all there is to go on
  }
  const detail = extractLlmErrorMessage(body);
  return new Error(`${label} request failed (HTTP ${status})${detail ? `: ${detail}` : "."}`);
}

/** A sent chat: the reply, its text as it goes into the note, and whether it was cut off. */
interface ChatReply {
  json: unknown;
  text: string;
  cutOff: boolean;
}

/** Send one conversation to the configured text vendor and read what comes back. */
async function sendChat(
  config: AiVendorConfig,
  system: string,
  turns: readonly ChatTurn[],
): Promise<ChatReply> {
  assertConfigured(config);
  const request = buildChatRequest({
    vendor: config.vendor,
    model: config.model.trim() || defaultModelFor(config.vendor),
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl,
    system,
    turns,
  });
  const json = await sendVendorRequest(config, () =>
    postJson(request.url, request.headers, request.body),
  );
  return {
    json,
    text: cleanTranscription(extractLlmText(config.vendor, json)),
    cutOff: isTruncatedLlmResponse(config.vendor, json),
  };
}

// --- Transcribe page ----------------------------------------------------------------

/**
 * The Markdown text of one page image, for the note's text layer: a one-
 * question chat whose question is the transcription prompt with the image.
 * `wholePage` means the image shows the page as the reader sees it (paper,
 * typed text), not only its ink on white.
 *
 * A reply cut off at the output cap is refused outright, text and all: half
 * a page written into the note would read as the whole of it.
 */
export async function transcribePageImage(
  config: AiVendorConfig,
  pngBase64: string,
  wholePage: boolean,
): Promise<string> {
  const question: ChatTurn = {
    role: "user",
    text: buildRecognitionPrompt(wholePage),
    images: [{ base64: pngBase64, mimeType: "image/png" }],
  };
  const reply = await sendChat(config, "", [question]);
  const label = targetLabel(config);
  if (reply.cutOff) {
    throw new Error(
      `${label} hit FineNotes's ${MAX_OUTPUT_TOKENS}-token output limit before finishing, ` +
        "so its partial transcription was thrown away. Transcribe a page with less on it, or " +
        "choose a model that does not spend its output on reasoning.",
    );
  }
  if (!reply.text) throw new Error(`${label} returned no transcription.`);
  return reply.text;
}

// --- Ask ------------------------------------------------------------------------

/** One answer in a conversation about notebook pages. */
export async function askAi(
  config: AiVendorConfig,
  system: string,
  turns: readonly ChatTurn[],
): Promise<string> {
  const { json, text, cutOff } = await sendChat(config, system, turns);
  const label = targetLabel(config);
  const refusal = extractRefusal(config.vendor, json);
  if (refusal) throw new Error(`${label}: ${refusal}.`);
  if (cutOff) {
    // A partial answer is still worth reading, but not without saying so.
    if (text) return `${text}\n\n*(The answer was cut off at ${MAX_OUTPUT_TOKENS} tokens.)*`;
    throw new Error(
      `${label} used up FineNotes's ${MAX_OUTPUT_TOKENS}-token output limit before ` +
        "answering. Ask about fewer pages, or pick a model that does not spend its output " +
        "budget on reasoning.",
    );
  }
  if (!text) throw new Error(`${label} returned no answer.`);
  return text;
}

// --- Generate image ---------------------------------------------------------------

export interface ImageConfig {
  vendor: ImageVendor;
  model: string;
  apiKey: string;
}

export interface GeneratedPicture {
  bytes: Uint8Array;
  mimeType: string;
}

/** One picture from `prompt`, as bytes ready for `vault.createBinary`. */
export async function generateImage(
  config: ImageConfig,
  prompt: string,
  aspect: ImageAspect,
): Promise<GeneratedPicture> {
  const target = { vendor: config.vendor, baseUrl: "" };
  const label = targetLabel(target);
  if (!config.apiKey.trim()) {
    throw new Error(`no API key set for ${label} — add one in FineNotes settings.`);
  }
  const request = buildImageRequest({
    vendor: config.vendor,
    model: config.model.trim() || DEFAULT_IMAGE_MODELS[config.vendor],
    apiKey: config.apiKey.trim(),
    prompt,
    aspect,
  });
  const json = await sendVendorRequest(target, () =>
    postJson(request.url, request.headers, request.body),
  );
  const image = extractGeneratedImage(config.vendor, json);
  if (!image) {
    const why = describeMissingImage(config.vendor, json);
    throw new Error(`${label} returned no image${why ? `: ${why}` : "."}`);
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(image.base64);
  } catch {
    throw new Error(`${label} returned an image FineNotes could not decode.`);
  }
  return { bytes, mimeType: image.mimeType };
}

// --- Transcribe audio -------------------------------------------------------------

export interface AudioTranscriptionConfig extends AiVendorConfig {
  /** ISO-639-1 hint ("en", "nl"); optional. */
  language?: string;
}

/**
 * Transcribe one audio recording with the user's own key.
 *
 * - `config.vendor` must be `openai`, `google` or `custom`; Anthropic and
 *   OpenRouter throw a one-line "not supported" error naming what would work.
 * - `config.model` empty means the vendor's default (`DEFAULT_AUDIO_MODELS`:
 *   `gpt-4o-mini-transcribe`, Gemini's text model, `whisper-1`).
 * - `bytes` is the whole recording; `mimeType` is what `MediaRecorder`
 *   reported (`audio/mp4` on the iPad). OpenAI takes up to 25 MB, Gemini
 *   about 14 MB inline; larger throws before anything is sent.
 * - `onProgress` gets short status lines ("Uploading 12.3 MB to …",
 *   "Waiting for the transcript…"). `requestUrl` reports no byte progress.
 *
 * Resolves to the transcript text (never empty); throws an `Error` whose
 * message is ready for a Notice. It asks no consent and reads no settings —
 * go through `GoodObsidianPlugin.transcribeAudioFile` for both.
 */
export async function transcribeAudio(
  config: AudioTranscriptionConfig,
  bytes: ArrayBuffer,
  mimeType: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const label = targetLabel(config);
  if (!canTranscribeAudio(config.vendor)) {
    throw new Error(`${audioUnsupportedReason(config.vendor)}.`);
  }
  assertConfigured(config);
  const boundaryBytes = new Uint8Array(16);
  crypto.getRandomValues(boundaryBytes);
  const vendor = config.vendor;
  const request = buildAudioRequest({
    vendor,
    model: config.model.trim() || DEFAULT_AUDIO_MODELS[vendor],
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl,
    audio: new Uint8Array(bytes),
    mimeType,
    boundary: makeBoundary(boundaryBytes),
    language: config.language,
  });
  onProgress?.(`Uploading ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB to ${label}…`);
  const pending = sendVendorRequest(config, () =>
    postBytes(request.url, request.headers, request.contentType, request.body),
  );
  onProgress?.("Waiting for the transcript…");
  const json = await pending;
  if (vendor === "google" && isTruncatedLlmResponse("google", json)) {
    throw new Error(
      `${label} hit the ${AUDIO_MAX_OUTPUT_TOKENS}-token output limit before the end of the ` +
        "recording. Transcribe shorter parts.",
    );
  }
  const text = extractAudioTranscript(vendor, json);
  if (!text) throw new Error(`${label} returned no transcript.`);
  return text;
}
