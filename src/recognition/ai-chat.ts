/**
 * Pure request/response shapes for "Ask AI": a multi-turn chat whose first
 * question carries rendered page images, for every vendor the transcription
 * already speaks to (Anthropic Messages, OpenAI Chat Completions — also the
 * dialect of OpenRouter and of a self-hosted OpenAI-compatible server — and
 * Google generateContent).
 *
 * The APIs are stateless, so a follow-up question resends the whole
 * conversation, first question's images included. The modal keeps that
 * history in memory for its own lifetime only; nothing here is persisted.
 *
 * No DOM, no Obsidian, no network — the IO lives in `ai-client.ts`.
 */

import {
  type LlmDialect,
  type LlmHttpRequest,
  type LlmVendor,
  MAX_OUTPUT_TOKENS,
  VENDORS,
  type VendorTarget,
  isRecord,
  jsonEndpoint,
} from "./llm-request";

/** A rendered page, base64 without a data-URL prefix. */
export interface ChatImage {
  base64: string;
  mimeType: "image/png" | "image/jpeg";
}

export const PDF_MIME = "application/pdf";

/**
 * A file the user attached: a PDF or a picture as base64, or a text file
 * (markdown, code, …) as its text. Exactly one of `base64` and `text` is set.
 */
export interface ChatFile {
  name: string;
  /** `application/pdf`, `image/png|jpeg|gif|webp`, or `text/plain` for text. */
  mimeType: string;
  base64?: string;
  text?: string;
  /** Its vault path, when it came from the vault, so a saved chat can read it again. Never sent. */
  path?: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Only meaningful on user turns; the model's turns are text. */
  images?: readonly ChatImage[];
  /** Files attached to a question; sent before its page images. */
  files?: readonly ChatFile[];
  /**
   * The question as the user typed it, where `text` adds to it (the first
   * question's line naming its pages). Shown and saved; never sent.
   */
  shown?: string;
  /** 1-based: the pages `images` show, on a question that sent some. Never sent. */
  pages?: readonly number[];
}

/** A conversation for one vendor. A transcription is one of these, one question long. */
export interface ChatRequestInput extends VendorTarget {
  system?: string;
  /** Oldest first. Must start with a user turn and alternate. */
  turns: readonly ChatTurn[];
  maxTokens?: number;
  /**
   * Ask the vendor to keep the conversation so far, for a follow-up that
   * resends it. Only Anthropic needs telling (OpenAI and Google cache on
   * their own); a one-question transcription leaves it off, since writing
   * the cache costs a quarter more and nothing would read it.
   */
  cache?: boolean;
}

/**
 * Most pages the Ask AI page picker takes at once. Every page is roughly
 * 1,500 input tokens at the render size `page-render.ts` uses, and every
 * follow-up resends them, so 40 pages would cost 60k tokens a question.
 */
export const ASK_MAX_PAGES = 10;

/** Throws unless `turns` starts with a user turn and alternates roles. */
export function assertAlternating(turns: readonly ChatTurn[]): void {
  if (turns.length === 0) throw new Error("a conversation needs at least one question");
  turns.forEach((turn, i) => {
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (turn.role !== expected) {
      throw new Error(`turn ${i + 1} should be from the ${expected}, not the ${turn.role}`);
    }
  });
}

const DIALECT_CHAT_BODIES: Record<
  LlmDialect,
  (input: ChatRequestInput, maxTokens: number) => unknown
> = {
  // https://docs.anthropic.com/en/api/messages — `system` is top level, and
  // user content is a block list: attached files, then page images, then the
  // text. A PDF is a `document` block (the model reads its text and its
  // pages). A top-level `cache_control` caches up to the last block, so each
  // follow-up reads the pages and files back from the cache (a tenth of the
  // price, for 5 minutes) and moves the cache on to include its own question.
  anthropic: (input, maxTokens) => ({
    model: input.model,
    max_tokens: maxTokens,
    ...(input.cache ? { cache_control: { type: "ephemeral" } } : {}),
    ...(input.system ? { system: input.system } : {}),
    messages: input.turns.map((turn) =>
      turn.role === "assistant"
        ? { role: "assistant", content: turn.text }
        : {
            role: "user",
            content: [
              ...(turn.files ?? []).map((file) =>
                file.text !== undefined
                  ? { type: "text", text: textFileBlock(file) }
                  : {
                      type: file.mimeType === PDF_MIME ? "document" : "image",
                      source: { type: "base64", media_type: file.mimeType, data: file.base64 },
                    },
              ),
              ...(turn.images ?? []).map((image) => ({
                type: "image",
                source: { type: "base64", media_type: image.mimeType, data: image.base64 },
              })),
              { type: "text", text: turn.text },
            ],
          },
    ),
  }),

  // Chat Completions — the same endpoint transcription uses, so OpenRouter and
  // self-hosted servers work unchanged. A text-only user turn stays a plain
  // string, which the oldest compatible servers insist on. A PDF is a `file`
  // part with its bytes as a data URL.
  openai: (input, maxTokens) => ({
    model: input.model,
    max_completion_tokens: maxTokens,
    messages: [
      ...(input.system ? [{ role: "system", content: input.system }] : []),
      ...input.turns.map((turn) =>
        turn.role === "assistant" || (!turn.images?.length && !turn.files?.length)
          ? { role: turn.role, content: turn.text }
          : {
              role: "user",
              content: [
                ...(turn.files ?? []).map((file) =>
                  file.text !== undefined
                    ? { type: "text", text: textFileBlock(file) }
                    : file.mimeType === PDF_MIME
                      ? {
                          type: "file",
                          file: {
                            filename: file.name,
                            file_data: `data:${PDF_MIME};base64,${file.base64 ?? ""}`,
                          },
                        }
                      : {
                          type: "image_url",
                          image_url: { url: `data:${file.mimeType};base64,${file.base64 ?? ""}` },
                        },
                ),
                ...(turn.images ?? []).map((image) => ({
                  type: "image_url",
                  image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
                })),
                { type: "text", text: turn.text },
              ],
            },
      ),
    ],
  }),

  // https://ai.google.dev/api/generate-content — the model's role is "model",
  // and the system prompt is its own `systemInstruction` content. A PDF is
  // inline data like an image.
  google: (input, maxTokens) => ({
    ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
    contents: input.turns.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [
        ...(turn.role === "user" ? (turn.files ?? []) : []).map((file) =>
          file.text !== undefined
            ? { text: textFileBlock(file) }
            : { inline_data: { mime_type: file.mimeType, data: file.base64 } },
        ),
        ...(turn.role === "user" ? (turn.images ?? []) : []).map((image) => ({
          inline_data: { mime_type: image.mimeType, data: image.base64 },
        })),
        { text: turn.text },
      ],
    })),
    generationConfig: { maxOutputTokens: maxTokens },
  }),
};

/** A text file as the model reads it: its name, then its text. */
function textFileBlock(file: ChatFile): string {
  return `<file name="${file.name.replace(/"/g, "'")}">\n${file.text ?? ""}\n</file>`;
}

/** Build the vendor's HTTP request for a conversation. Throws on a missing key or a malformed history. */
export function buildChatRequest(input: ChatRequestInput): LlmHttpRequest {
  const endpoint = jsonEndpoint(input);
  assertAlternating(input.turns);
  const toBody = DIALECT_CHAT_BODIES[VENDORS[input.vendor].dialect];
  return { ...endpoint, body: toBody(input, input.maxTokens ?? MAX_OUTPUT_TOKENS) };
}

/** First element of an array read from JSON, as `unknown` (never `any`). */
function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? (value as unknown[])[0] : undefined;
}

/**
 * Why the model declined to answer, or "" when it did not. Each vendor says it
 * differently: Anthropic stops with `refusal`, OpenAI fills `message.refusal`
 * or stops with `content_filter`, and Google blocks the prompt
 * (`promptFeedback.blockReason`) or the candidate (`finishReason`).
 */
export function extractRefusal(vendor: LlmVendor, json: unknown): string {
  if (!isRecord(json)) return "";
  switch (VENDORS[vendor].dialect) {
    case "anthropic":
      return json.stop_reason === "refusal" ? "the model declined to answer" : "";

    case "openai": {
      const choice = firstOf(json.choices);
      if (!isRecord(choice)) return "";
      const message = choice.message;
      if (isRecord(message) && typeof message.refusal === "string" && message.refusal.trim()) {
        return message.refusal.trim();
      }
      return choice.finish_reason === "content_filter" ? "blocked by the content filter" : "";
    }

    case "google": {
      const feedback = json.promptFeedback;
      if (isRecord(feedback) && typeof feedback.blockReason === "string") {
        return `the question was blocked (${feedback.blockReason})`;
      }
      const candidate = firstOf(json.candidates);
      const reason = isRecord(candidate) ? candidate.finishReason : undefined;
      return typeof reason === "string" && GOOGLE_BLOCKED.has(reason)
        ? `the answer was blocked (${reason})`
        : "";
    }
  }
}

/** Google finish reasons that mean "withheld", not "finished" or "ran out". */
const GOOGLE_BLOCKED = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
]);

/** The standing instructions for a question about notebook pages. */
export function buildAskSystemPrompt(): string {
  return [
    "You are helping someone with their own handwritten notebook in Obsidian.",
    "Their question comes with images of one or more notebook pages: handwriting, typed text boxes and the paper they are on.",
    "Answer from what the pages show; when you add something the pages do not say, say so.",
    "Answer in the language of the question, in concise markdown. Use $...$ LaTeX for mathematics.",
    "Refer to pages by the numbers you are given.",
  ].join("\n");
}

/**
 * The first question of a conversation: the page images, then a line naming
 * each image's page number, then the question. `pageNumbers` are 1-based and
 * in the same order as `images`.
 */
export function buildAskFirstTurn(
  question: string,
  images: readonly ChatImage[],
  pageNumbers: readonly number[],
  totalPages: number,
): ChatTurn {
  const lines: string[] = [];
  if (pageNumbers.length === 1) {
    lines.push(`The image is page ${pageNumbers[0]} of ${totalPages}.`);
  } else if (pageNumbers.length > 1) {
    lines.push(`The images are pages ${pageNumbers.join(", ")} of ${totalPages}, in that order.`);
    if (pageNumbers.length < totalPages) {
      lines.push("The other pages of the notebook were not sent.");
    }
  }
  lines.push("", question.trim());
  return { role: "user", text: lines.join("\n").trim(), images };
}

/**
 * Markdown to plain text, for an answer placed on the page as a text box
 * (which shows text, not markdown). Keeps line structure and list bullets;
 * drops emphasis, heading marks, link targets and code fences.
 */
export function markdownToPlainText(markdown: string): string {
  const out: string[] = [];
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) continue;
    // A thematic break (--- / *** / ___) is decoration, not content.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      out.push("");
      continue;
    }
    const line = raw
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s{0,3}>\s?/, "")
      .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, "$1☐ ")
      .replace(/^(\s*)[-*+]\s+/, "$1• ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^*\w])[*_]([^*_\s][^*_]*?)[*_](?=[^*\w]|$)/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
    out.push(line.replace(/\s+$/, ""));
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
