/**
 * The AI services FineNotes talks to, and what every request to them has
 * in common: where it goes and with which headers, how the destination is
 * named in a message, how the text is read out of a reply and whether the
 * reply was cut short, and the prompt a page transcription is sent with.
 *
 * Bodies are built elsewhere — `ai-chat.ts` (text and page images, which
 * transcription uses too), `ai-image.ts` and `audio-request.ts` — and sent by
 * `ai-client.ts`. No DOM, no Obsidian, no network.
 */

/** The id `settings.recognitionProviderId` stores for cloud AI. */
export const LLM_PROVIDER_ID = "llm-byok";

/** Vendor ids, as `settings.llmVendor` and the key slots store them. */
export type LlmVendor = "anthropic" | "openai" | "google" | "openrouter" | "custom";

/**
 * A request and reply format. OpenRouter and self-hosted servers speak
 * OpenAI's Chat Completions, so bodies and reply readers go by dialect, not
 * by vendor.
 */
export type LlmDialect = "anthropic" | "openai" | "google";

/** What a vendor's URL may depend on. */
export interface VendorUrlInput {
  model: string;
  /** The user's base URL; only a user-supplied endpoint reads it. */
  baseUrl?: string;
}

/**
 * One vendor. The rest of the plugin asks these fields, never the vendor's
 * id, what to do — so another vendor is one more entry in {@link VENDORS}.
 */
export interface VendorDescriptor {
  /** How the settings and every message name it. */
  label: string;
  /** The model used while the settings' model field is empty. */
  defaultModel: string;
  dialect: LlmDialect;
  url: (input: VendorUrlInput) => string;
  /** The key's header and any other header the vendor wants (content type aside). */
  headers: (apiKey: string) => Record<string, string>;
  /** False only where a request may go without a key: a server of the user's own. */
  requiresKey: boolean;
  /**
   * The user supplies the endpoint. Such a destination is trusted less than a
   * named vendor, so it has a key slot and a consent of its own: no cloud key
   * and no cloud consent ever reach it.
   */
  userEndpoint: boolean;
  /** The settings offer OpenRouter's browser Connect instead of a pasted key. */
  oauthConnect: boolean;
}

/** OpenAI's scheme, which OpenRouter and compatible servers share. */
function bearer(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

/** A named cloud vendor: a key is required, and the endpoint is the vendor's. */
const CLOUD = { requiresKey: true, userEndpoint: false, oauthConnect: false };

export const VENDORS: Record<LlmVendor, VendorDescriptor> = {
  anthropic: {
    ...CLOUD,
    label: "Anthropic (Claude)",
    defaultModel: "claude-opus-4-8",
    dialect: "anthropic",
    url: () => "https://api.anthropic.com/v1/messages",
    headers: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
  },
  openai: {
    ...CLOUD,
    label: "OpenAI (GPT)",
    defaultModel: "gpt-4o-mini",
    dialect: "openai",
    url: () => "https://api.openai.com/v1/chat/completions",
    headers: bearer,
  },
  google: {
    ...CLOUD,
    label: "Google (Gemini)",
    // Not gemini-2.5-flash: it is retired on 2026-10-16, and free-tier keys
    // lost it earlier, which showed up as a bare 404.
    defaultModel: "gemini-3.5-flash",
    dialect: "google",
    url: ({ model }) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    // The key goes in this header, never in the URL as `?key=`: URLs end up
    // in logs.
    headers: (apiKey) => ({ "x-goog-api-key": apiKey }),
  },
  openrouter: {
    ...CLOUD,
    oauthConnect: true,
    label: "OpenRouter (any model)",
    defaultModel: "google/gemini-3.5-flash",
    dialect: "openai",
    url: () => "https://openrouter.ai/api/v1/chat/completions",
    // OpenRouter's app attribution. Only requests to OpenRouter carry it.
    headers: (apiKey) => ({
      ...bearer(apiKey),
      "http-referer": "https://github.com/Joost-8/FineNotes",
      "x-title": "FineNotes",
    }),
  },
  custom: {
    requiresKey: false,
    userEndpoint: true,
    oauthConnect: false,
    label: "Custom endpoint (OpenAI-compatible)",
    defaultModel: "qwen2.5vl:7b",
    dialect: "openai",
    url: ({ baseUrl }) => chatCompletionsUrl(baseUrl ?? ""),
    // A server on the user's own machine rarely wants a key, and gets no
    // authorization header unless one is set.
    headers: (apiKey) => (apiKey.trim() ? bearer(apiKey) : {}),
  },
};

function perVendor<T>(pick: (vendor: VendorDescriptor) => T): Record<LlmVendor, T> {
  const out = {} as Record<LlmVendor, T>;
  for (const id of Object.keys(VENDORS) as LlmVendor[]) out[id] = pick(VENDORS[id]);
  return out;
}

/** The labels by vendor id, in the table's order (the settings dropdown). */
export const VENDOR_LABELS: Record<LlmVendor, string> = perVendor((vendor) => vendor.label);

/** The default models by vendor id; the settings let the user choose another. */
export const DEFAULT_MODELS: Record<LlmVendor, string> = perVendor((vendor) => vendor.defaultModel);

/**
 * The most a reply may spend, per page or per answer. It is a cap, not a
 * reservation: what goes unused costs nothing. A reasoning model spends part
 * of it thinking before it writes a word, which is why it is this high.
 */
export const MAX_OUTPUT_TOKENS = 8192;

export function defaultModelFor(vendor: LlmVendor): string {
  return VENDORS[vendor].defaultModel;
}

/** Who a request goes to, and as whom — everything about it but the body. */
export interface VendorTarget {
  vendor: LlmVendor;
  model: string;
  /** May be empty only where the vendor does not require a key. */
  apiKey: string;
  /** The user's base URL, read for a user-supplied endpoint only. */
  baseUrl?: string;
}

/** A request ready for `postJson`. */
export interface LlmHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * The URL and headers of a JSON request to `target`. Throws, before anything
 * else, when the vendor needs a key and has none; and for a custom endpoint
 * whose URL cannot be used.
 */
export function jsonEndpoint(target: VendorTarget): Omit<LlmHttpRequest, "body"> {
  const vendor = VENDORS[target.vendor];
  if (vendor.requiresKey && target.apiKey.trim() === "") throw new Error("missing API key");
  return {
    url: vendor.url(target),
    headers: { ...vendor.headers(target.apiKey), "content-type": "application/json" },
  };
}

// --- Transcription prompt ------------------------------------------------------

const TRANSCRIPTION_RULES = [
  "Transcribe every piece of handwriting in this image as clean Markdown.",
  "Follow these rules:",
  "- Reply with the transcription only: no introduction, no comments, no code fences around it.",
  "- Keep the lines as they are written. Use Markdown headings or lists only where the writing plainly calls for them.",
  "- Copy [[wiki-links]] and #tags exactly as they are written.",
  "- Write mathematical notation as LaTeX between dollar signs, like $...$.",
  "- Where there is a drawing or diagram, put a short description of it in square brackets, such as [sketch: flow diagram].",
  "- Where a word cannot be read, write your best guess and put (?) after it.",
];

/** Only for an image of the whole page, rather than its ink drawn on white. */
const WHOLE_PAGE_RULES = [
  "- The image is one whole notebook page. Ignore the paper itself: its ruled lines, grid, dots and printed template.",
  "- Include typed text on the page in reading order, as it appears.",
  "- If the page is a printed document or slide with notes on it, transcribe the notes and sum up the printed material in one bracketed line like [slide: Fourier series].",
];

/**
 * What a page transcription asks for. The answer goes into the note, so it
 * has to be Markdown and nothing but the page's text.
 */
export function buildRecognitionPrompt(wholePage = false): string {
  return (wholePage ? [...TRANSCRIPTION_RULES, ...WHOLE_PAGE_RULES] : TRANSCRIPTION_RULES).join(
    "\n",
  );
}

// --- Endpoint URLs ---------------------------------------------------------------

/** A URL, or null for text that is not one. */
function parseUrl(text: string): URL | null {
  try {
    return new URL(text.trim());
  } catch {
    return null;
  }
}

/**
 * The chat endpoint of an OpenAI-compatible server, from the base URL the user
 * entered (e.g. `http://localhost:11434/v1`). Whether `/v1` belongs in it is
 * up to the server, so it is left as the user wrote it.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  return openAiEndpointUrl(baseUrl, "/chat/completions");
}

/**
 * Any endpoint of an OpenAI-compatible server (`/chat/completions`,
 * `/audio/transcriptions`, …) from the user's base URL. A base URL that
 * already names a *different* endpoint of the same family (someone pasted the
 * full chat URL) is cut back to its root first.
 */
export function openAiEndpointUrl(baseUrl: string, suffix: string): string {
  const text = baseUrl.trim();
  const url = parseUrl(text);
  if (!url) {
    const examples = "http://localhost:11434/v1 or https://yourbox.your-tailnet.ts.net/v1";
    throw new Error(`invalid endpoint URL "${text}" — write it out in full, such as ${examples}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`an endpoint URL starts with http:// or https:// — "${text}" does not`);
  }
  // The suffix goes on the path, so that a gateway's query string
  // (?api-version=…) stays after it.
  let path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith(suffix)) {
    for (const known of KNOWN_OPENAI_ENDPOINTS) {
      if (path.endsWith(known)) path = path.slice(0, -known.length);
    }
    path = `${path}${suffix}`;
  }
  url.pathname = path;
  url.hash = "";
  return url.href;
}

/** Endpoint suffixes {@link openAiEndpointUrl} recognises in a pasted base URL. */
const KNOWN_OPENAI_ENDPOINTS = [
  "/chat/completions",
  "/audio/transcriptions",
  "/images/generations",
];

/** Whether `url` parses and uses plain, unencrypted HTTP (in any letter case). */
export function isPlainHttpUrl(url: string): boolean {
  return parseUrl(url)?.protocol === "http:";
}

/**
 * Where requests go, for a message: the vendor's label, or the custom
 * endpoint's host — the part of its URL the user will recognise.
 */
export function describeLlmTarget(vendor: LlmVendor, baseUrl = ""): string {
  const { label, userEndpoint } = VENDORS[vendor];
  if (!userEndpoint) return label;
  const url = parseUrl(baseUrl);
  return url ? `your configured endpoint (${url.host})` : "your configured endpoint";
}

// --- Replies -----------------------------------------------------------------------

/** A JSON object (or array), as opposed to a primitive or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * `json` followed down `path` — a name into an object, an index into an
 * array — or undefined wherever the path breaks off. Replies come from
 * servers FineNotes does not control, so no shape is assumed.
 */
function dig(json: unknown, ...path: Array<string | number>): unknown {
  let at = json;
  for (const step of path) {
    if (typeof step === "number" ? !Array.isArray(at) : !isRecord(at)) return undefined;
    at = (at as Record<string | number, unknown>)[step];
  }
  return at;
}

function stringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

interface ReplyReader {
  /** The reply's text, or "". */
  text: (reply: unknown) => string;
  /** Whether the model stopped at the output cap rather than because it was done. */
  cutOff: (reply: unknown) => boolean;
}

const REPLIES: Record<LlmDialect, ReplyReader> = {
  // Messages: `content` is a list of blocks, of which the text blocks count.
  anthropic: {
    text: (reply) => {
      const blocks = dig(reply, "content");
      if (!Array.isArray(blocks)) return "";
      return blocks
        .filter((block) => dig(block, "type") === "text")
        .map((block) => dig(block, "text"))
        .join("\n");
    },
    cutOff: (reply) => dig(reply, "stop_reason") === "max_tokens",
  },
  // Chat Completions: the first choice's message.
  openai: {
    text: (reply) => stringOr(dig(reply, "choices", 0, "message", "content")),
    cutOff: (reply) => dig(reply, "choices", 0, "finish_reason") === "length",
  },
  // generateContent: the first candidate's parts, which may split one text.
  google: {
    text: (reply) => {
      const parts = dig(reply, "candidates", 0, "content", "parts");
      if (!Array.isArray(parts)) return "";
      return parts.map((part) => stringOr(dig(part, "text"))).join("");
    },
    cutOff: (reply) => dig(reply, "candidates", 0, "finishReason") === "MAX_TOKENS",
  },
};

/** The text of a vendor's reply, or "" when it has none. */
export function extractLlmText(vendor: LlmVendor, json: unknown): string {
  return REPLIES[VENDORS[vendor].dialect].text(json);
}

/**
 * Whether the reply ran into {@link MAX_OUTPUT_TOKENS}. Worth asking on its
 * own: such a reply may hold half a page that reads as if it were all of it,
 * or — from a model that thought until the cap — no text at all.
 */
export function isTruncatedLlmResponse(vendor: LlmVendor, json: unknown): boolean {
  return REPLIES[VENDORS[vendor].dialect].cutOff(json);
}

const MAX_ERROR_LENGTH = 300;

/**
 * The message in a vendor's error reply, or "". All three dialects send
 * `{error: {message}}`, and some compatible servers (Ollama) a bare
 * `{error: "…"}`. The status alone misleads: Google answers a model it does
 * not offer with a 404, and only the message says which model.
 */
export function extractLlmErrorMessage(json: unknown): string {
  const error = dig(json, "error");
  const message = stringOr(typeof error === "string" ? error : dig(error, "message")).trim();
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

/**
 * The reply as it goes into the note: trimmed, and taken out of a code fence
 * when the model wrapped all of it in one despite being asked not to.
 */
export function cleanTranscription(text: string): string {
  const reply = text.trim();
  const opening = /^```[a-z]*\n/i.exec(reply);
  const wrapped =
    opening !== null && reply.endsWith("```") && reply.length >= opening[0].length + 3;
  return wrapped ? reply.slice(opening[0].length, -3).trim() : reply;
}
