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
import { english, t } from "../i18n/translate";
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
import { type ChatImage, type ChatTurn, buildChatRequest, extractRefusal } from "./ai-chat";
import { ASK_MAX_TOOL_ROUNDS, type AskToolCall, parseToolCall, toolStatus } from "./ask-tools";
import { TOOL_DIALECTS, type ToolResult } from "./ask-tool-dialects";
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
  /** Skip providers that say they compress the model; only read for `openrouter`. */
  skipCompressed?: boolean;
}

/** A vendor's label, or "your configured endpoint (host)". */
export function targetLabel(config: Pick<AiVendorConfig, "vendor" | "baseUrl">): string {
  return describeLlmTarget(config.vendor, config.baseUrl);
}

/** Refuse early, in the words the settings use, when a request cannot be sent. */
export function assertConfigured(config: AiVendorConfig): void {
  const vendor = VENDORS[config.vendor];
  if (vendor.userEndpoint && !config.baseUrl.trim()) {
    throw new Error(t("ai.client.noEndpoint"));
  }
  if (vendor.requiresKey && !config.apiKey.trim()) {
    throw new Error(t("ai.client.noKey", { label: targetLabel(config) }));
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
      t(vendor.userEndpoint ? "ai.client.unreachableOwn" : "ai.client.unreachable", {
        label,
        detail,
      }),
    );
  }

  const { status } = response;
  if (status < 200 || status >= 300) throw failedStatus(label, vendor.userEndpoint, response);

  try {
    return response.json as unknown;
  } catch {
    throw new Error(t("ai.client.unreadable", { label }));
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
        ? t("ai.client.deniedOwn", { label, status })
        : t("ai.client.deniedKey", { label }),
    );
  }
  let body: unknown;
  try {
    body = response.json;
  } catch {
    body = undefined; // not JSON: the status is all there is to go on
  }
  const detail = extractLlmErrorMessage(body);
  return new Error(
    detail
      ? t("ai.client.requestFailedDetail", { label, status, detail })
      : t("ai.client.requestFailed", { label, status }),
  );
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
  cache = false,
): Promise<ChatReply> {
  assertConfigured(config);
  const request = buildChatRequest({
    vendor: config.vendor,
    model: config.model.trim() || defaultModelFor(config.vendor),
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl,
    skipCompressed: config.skipCompressed,
    system,
    turns,
    cache,
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
    throw new Error(t("ai.client.transcriptionCutOff", { label, max: MAX_OUTPUT_TOKENS }));
  }
  if (!reply.text) throw new Error(t("ai.client.noTranscription", { label }));
  return reply.text;
}

// --- Ask ------------------------------------------------------------------------

/** One answer in a conversation about notebook pages. */
export async function askAi(
  config: AiVendorConfig,
  system: string,
  turns: readonly ChatTurn[],
): Promise<AskAnswer> {
  // Every follow-up resends the pages, so the conversation is worth caching.
  const { json, text, cutOff } = await sendChat(config, system, turns, true);
  const label = targetLabel(config);
  const refusal = extractRefusal(config.vendor, json);
  if (refusal) throw new Error(t("ai.client.refusal", { label, reason: refusal }));
  if (cutOff) {
    // A partial answer is still worth reading, but not without saying so.
    if (text) return { ...cutOffAnswer(text), actions: [], notes: [] };
    throw new Error(t("ai.client.outputLimit", { label, max: MAX_OUTPUT_TOKENS }));
  }
  if (!text) throw new Error(t("ai.client.noAnswer", { label }));
  return { text, actions: [], notes: [] };
}

/**
 * A cut-off answer, saying so: in English for the model, which reads it
 * again with the next question, and in the interface's language as shown.
 */
function cutOffAnswer(text: string): { text: string; shown: string } {
  const vars = { max: MAX_OUTPUT_TOKENS };
  return {
    text: `${text}\n\n${english("ai.client.answerCutOff", vars)}`,
    shown: `${text}\n\n${t("ai.client.answerCutOff", vars)}`,
  };
}

// --- Ask, with the notebook's tools ----------------------------------------------

/** What running one tool call gave back, for the model and for the chat. */
export interface AskToolOutcome {
  /** For the model: what happened, or what was found. */
  text: string;
  /** For the model: page images, for `read_pages`. */
  images?: ChatImage[];
  /** The call could not be done; `text` says why. */
  isError?: boolean;
  /** For the chat, once done: "Added a text box on page 3". */
  done?: string;
}

/** An answer, and what Claude did in the notebook on the way to it. */
export interface AskAnswer {
  /** For the model: the answer, with any note of ours in English. */
  text: string;
  /** For the chat, where it differs from `text`: our note in the interface's language. */
  shown?: string;
  /** For the chat: each action's `done`, in the interface's language. */
  actions: string[];
  /** For the model: what each action did, as its result said it (English). */
  notes: string[];
}

/**
 * One answer with the notebook tools (`ask-tools.ts`), from any vendor in
 * its own format (`ask-tool-dialects.ts`): the
 * question goes with the tools; while Claude asks for tool calls, each is
 * run (`run`) and the results go back, until it answers in words, or after
 * `ASK_MAX_TOOL_ROUNDS` rounds, when it is asked to answer with what it has.
 *
 * Append-only, as the API requires once a reply holds thinking: every round
 * sends the same `system`, the same tools and the same history, with each
 * reply passed back exactly as it came (its thinking and tool calls
 * included) and the results after it.
 */
export async function askAiWithTools(
  config: AiVendorConfig,
  system: string,
  turns: readonly ChatTurn[],
  options: {
    totalPages: () => number;
    run: (call: AskToolCall) => Promise<AskToolOutcome>;
    onStatus: (status: string) => void;
  },
): Promise<AskAnswer> {
  assertConfigured(config);
  const base = buildChatRequest({
    vendor: config.vendor,
    model: config.model.trim() || defaultModelFor(config.vendor),
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl,
    skipCompressed: config.skipCompressed,
    system,
    turns,
    cache: true,
  });
  const baseBody = base.body as Record<string, unknown>;
  const dialect = TOOL_DIALECTS[VENDORS[config.vendor].dialect];
  const label = targetLabel(config);
  const more: unknown[] = [];
  const actions: string[] = [];
  const notes: string[] = [];
  for (let round = 0; ; round++) {
    // Out of rounds: answer now, with what has been found.
    const body = dialect.body(baseBody, more, round >= ASK_MAX_TOOL_ROUNDS);
    const json = await sendVendorRequest(config, () => postJson(base.url, base.headers, body));
    const refusal = extractRefusal(config.vendor, json);
    if (refusal) throw new Error(t("ai.client.refusal", { label, reason: refusal }));
    const uses = dialect.calls(json);
    if (uses.length === 0) {
      const text = cleanTranscription(extractLlmText(config.vendor, json));
      if (isTruncatedLlmResponse(config.vendor, json)) {
        if (text) return { ...cutOffAnswer(text), actions, notes };
        throw new Error(t("ai.client.outputLimit", { label, max: MAX_OUTPUT_TOKENS }));
      }
      if (!text && actions.length === 0) throw new Error(t("ai.client.noAnswer", { label }));
      return { text, actions, notes };
    }
    more.push(...dialect.reply(json));
    const results: ToolResult[] = [];
    for (const use of uses) {
      const call = parseToolCall(use.name, use.input, options.totalPages());
      let outcome: AskToolOutcome;
      if ("error" in call) {
        outcome = { text: call.error, isError: true };
      } else {
        options.onStatus(toolStatus(call));
        try {
          outcome = await options.run(call);
        } catch (error) {
          outcome = { text: `It failed: ${errorMessage(error)}`, isError: true };
        }
      }
      if (outcome.done) {
        actions.push(outcome.done);
        notes.push(outcome.text);
      }
      results.push({ use, text: outcome.text, images: outcome.images, isError: outcome.isError });
    }
    more.push(...dialect.results(results));
  }
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
    throw new Error(t("ai.client.noKey", { label }));
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
    throw new Error(
      why ? t("ai.client.noImageWhy", { label, why }) : t("ai.client.noImage", { label }),
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(image.base64);
  } catch {
    throw new Error(t("ai.client.undecodable", { label }));
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
  onProgress?.(
    t("ai.client.uploading", { size: (bytes.byteLength / (1024 * 1024)).toFixed(1), label }),
  );
  const pending = sendVendorRequest(config, () =>
    postBytes(request.url, request.headers, request.contentType, request.body),
  );
  onProgress?.(t("ai.client.waiting"));
  const json = await pending;
  if (vendor === "google" && isTruncatedLlmResponse("google", json)) {
    throw new Error(t("ai.client.audioLimit", { label, max: AUDIO_MAX_OUTPUT_TOKENS }));
  }
  const text = extractAudioTranscript(vendor, json);
  if (!text) throw new Error(t("ai.client.noTranscript", { label }));
  return text;
}
