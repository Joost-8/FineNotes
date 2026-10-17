/**
 * The notebook tools (`ask-tools.ts`) in each vendor's own shape: how the
 * tools are declared, how a reply asks for calls, and how the results go
 * back. One loop (`askAiWithTools`) runs them all:
 *
 * - **Anthropic** Messages: `tools`, `tool_use` blocks, `tool_result` blocks.
 * - **OpenAI** Chat Completions: `tools` of type function, `tool_calls` on
 *   the message, a `tool` message per call. A tool message holds only text,
 *   so page images follow in a user message. OpenRouter and OpenAI-compatible
 *   servers (Grok's xAI API among them) speak the same.
 * - **Google** generateContent: `functionDeclarations`, `functionCall` parts,
 *   `functionResponse` parts. Gemini's schema is OpenAPI's subset, so the
 *   JSON Schema keywords it does not know are left out.
 *
 * Every reply goes back as it came (Anthropic's thinking blocks, Gemini's
 * thought signatures), and the declarations never change during a
 * conversation, as the APIs require of a tool loop.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import type { ChatImage } from "./ai-chat";
import { ASK_TOOLS, type ToolUse, toolUsesOf } from "./ask-tools";
import type { LlmDialect } from "./llm-request";
import { isRecord } from "./llm-request";

/** A call's outcome, as it goes back to the model. */
export interface ToolResult {
  use: ToolUse;
  text: string;
  images?: readonly ChatImage[];
  isError?: boolean;
}

export interface ToolDialect {
  /**
   * The request: the conversation's own body with the tools added and the
   * rounds so far (`more`) after its messages. `last`: answer now, no more calls.
   */
  body: (base: Record<string, unknown>, more: readonly unknown[], last: boolean) => unknown;
  /** The calls a reply asks for; none when it answered. */
  calls: (reply: unknown) => ToolUse[];
  /** The reply itself, as it goes back into the conversation. */
  reply: (reply: unknown) => unknown[];
  /** The results, as they go back after it. */
  results: (results: readonly ToolResult[]) => unknown[];
}

const ANTHROPIC: ToolDialect = {
  body: (base, more, last) => ({
    ...base,
    tools: ASK_TOOLS,
    ...(last ? { tool_choice: { type: "none" } } : {}),
    messages: [...listOf(base.messages), ...more],
  }),
  calls: (reply) => (isRecord(reply) && reply.stop_reason === "tool_use" ? toolUsesOf(reply) : []),
  reply: (reply) => [{ role: "assistant", content: isRecord(reply) ? reply.content : [] }],
  results: (results) => [
    {
      role: "user",
      content: results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.use.id,
        content: [
          { type: "text", text: r.text },
          ...(r.images ?? []).map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mimeType, data: image.base64 },
          })),
        ],
        ...(r.isError ? { is_error: true } : {}),
      })),
    },
  ],
};

const OPENAI_TOOLS = ASK_TOOLS.map((tool) => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
}));

/** The first choice's message of a Chat Completions reply. */
function messageOf(reply: unknown): Record<string, unknown> | null {
  if (!isRecord(reply) || !Array.isArray(reply.choices)) return null;
  const choice: unknown = (reply.choices as unknown[])[0];
  return isRecord(choice) && isRecord(choice.message) ? choice.message : null;
}

const OPENAI: ToolDialect = {
  body: (base, more, last) => ({
    ...base,
    tools: OPENAI_TOOLS,
    ...(last ? { tool_choice: "none" } : {}),
    messages: [...listOf(base.messages), ...more],
  }),
  calls: (reply) => {
    const calls = messageOf(reply)?.tool_calls;
    if (!Array.isArray(calls)) return [];
    const uses: ToolUse[] = [];
    for (const call of calls as unknown[]) {
      if (!isRecord(call) || typeof call.id !== "string" || !isRecord(call.function)) continue;
      const { name, arguments: args } = call.function;
      if (typeof name !== "string") continue;
      uses.push({ id: call.id, name, input: parseArguments(args) });
    }
    return uses;
  },
  // Only what the API takes back: some servers refuse the extra fields a
  // reply carries (`refusal`, `annotations`).
  reply: (reply) => {
    const message = messageOf(reply);
    return [
      {
        role: "assistant",
        content: typeof message?.content === "string" ? message.content : null,
        tool_calls: message?.tool_calls ?? [],
      },
    ];
  },
  results: (results) => {
    const images = results.flatMap((r) => r.images ?? []);
    return [
      ...results.map((r) => ({
        role: "tool",
        tool_call_id: r.use.id,
        content: r.isError ? `Error: ${r.text}` : r.text,
      })),
      // A tool message holds only text: the pages follow as the user's.
      ...(images.length
        ? [
            {
              role: "user",
              content: [
                { type: "text", text: "The page images read_pages returned, in order." },
                ...images.map((image) => ({
                  type: "image_url",
                  image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
                })),
              ],
            },
          ]
        : []),
    ];
  },
};

/** A JSON Schema as Gemini's OpenAPI subset takes it: without the keywords it rejects. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!isRecord(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      key === "additionalProperties" ||
      key === "minimum" ||
      key === "minItems" ||
      key === "maxItems"
    ) {
      continue;
    }
    out[key] = geminiSchema(value);
  }
  return out;
}

const GOOGLE_TOOLS = [
  {
    functionDeclarations: ASK_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: geminiSchema(tool.input_schema),
    })),
  },
];

/** The first candidate's content of a generateContent reply. */
function contentOf(reply: unknown): Record<string, unknown> | null {
  if (!isRecord(reply) || !Array.isArray(reply.candidates)) return null;
  const candidate: unknown = (reply.candidates as unknown[])[0];
  return isRecord(candidate) && isRecord(candidate.content) ? candidate.content : null;
}

const GOOGLE: ToolDialect = {
  body: (base, more, last) => ({
    ...base,
    tools: GOOGLE_TOOLS,
    ...(last ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } } : {}),
    contents: [...listOf(base.contents), ...more],
  }),
  calls: (reply) => {
    const parts = contentOf(reply)?.parts;
    if (!Array.isArray(parts)) return [];
    const uses: ToolUse[] = [];
    for (const part of parts as unknown[]) {
      if (!isRecord(part) || !isRecord(part.functionCall)) continue;
      const { name, args, id } = part.functionCall;
      if (typeof name !== "string") continue;
      // Newer models number their calls; older ones are matched by name and order.
      uses.push({ id: typeof id === "string" ? id : "", name, input: args ?? {} });
    }
    return uses;
  },
  // As it came: a thinking model's parts carry thought signatures it needs back.
  reply: (reply) => {
    const content = contentOf(reply);
    return [content ? { ...content, role: "model" } : { role: "model", parts: [] }];
  },
  results: (results) => [
    {
      role: "user",
      parts: [
        ...results.map((r) => ({
          functionResponse: {
            ...(r.use.id ? { id: r.use.id } : {}),
            name: r.use.name,
            response: r.isError ? { error: r.text } : { result: r.text },
          },
        })),
        ...results
          .flatMap((r) => r.images ?? [])
          .map((image) => ({ inline_data: { mime_type: image.mimeType, data: image.base64 } })),
      ],
    },
  ],
};

export const TOOL_DIALECTS: Record<LlmDialect, ToolDialect> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  google: GOOGLE,
};

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** OpenAI sends a call's arguments as a JSON string; a broken one becomes no arguments. */
function parseArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return isRecord(raw) ? raw : {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
