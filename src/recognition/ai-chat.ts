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

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Only meaningful on user turns; the model's turns are text. */
  images?: readonly ChatImage[];
}

/** A conversation for one vendor. A transcription is one of these, one question long. */
export interface ChatRequestInput extends VendorTarget {
  system?: string;
  /** Oldest first. Must start with a user turn and alternate. */
  turns: readonly ChatTurn[];
  maxTokens?: number;
}

/**
 * Most pages one question sends as images. Every page is roughly 1,500 input
 * tokens at the render size `page-render.ts` uses, and every follow-up
 * resends them all, so a 40-page notebook would cost 60k tokens a question.
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
  // user content is a block list with the images before the text.
  anthropic: (input, maxTokens) => ({
    model: input.model,
    max_tokens: maxTokens,
    ...(input.system ? { system: input.system } : {}),
    messages: input.turns.map((turn) =>
      turn.role === "assistant"
        ? { role: "assistant", content: turn.text }
        : {
            role: "user",
            content: [
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
  // string, which the oldest compatible servers insist on.
  openai: (input, maxTokens) => ({
    model: input.model,
    max_completion_tokens: maxTokens,
    messages: [
      ...(input.system ? [{ role: "system", content: input.system }] : []),
      ...input.turns.map((turn) =>
        turn.role === "assistant" || !turn.images?.length
          ? { role: turn.role, content: turn.text }
          : {
              role: "user",
              content: [
                ...turn.images.map((image) => ({
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
  // and the system prompt is its own `systemInstruction` content.
  google: (input, maxTokens) => ({
    ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
    contents: input.turns.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [
        ...(turn.role === "user" ? (turn.images ?? []) : []).map((image) => ({
          inline_data: { mime_type: image.mimeType, data: image.base64 },
        })),
        { text: turn.text },
      ],
    })),
    generationConfig: { maxOutputTokens: maxTokens },
  }),
};

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

export type AskScope = "page" | "notebook";

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
 * Which pages a question about the whole notebook sends, as 0-based indexes in
 * document order: pages with something on them, nearest to the page being
 * read first, at most `max`. A 40-page notebook asked about from page 30 sends
 * pages 26–35, not pages 1–10.
 */
export function selectAskPages(
  hasContent: readonly boolean[],
  current: number,
  max = ASK_MAX_PAGES,
): number[] {
  const candidates = hasContent.flatMap((has, index) => (has ? [index] : []));
  const chosen = candidates
    .map((index) => ({ index, distance: Math.abs(index - current) }))
    // Ties (one page either side) prefer the later page: a question is more
    // often about what follows than what came before.
    .sort((a, b) => a.distance - b.distance || b.index - a.index)
    .slice(0, Math.max(0, max))
    .map((c) => c.index);
  return chosen.sort((a, b) => a - b);
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
