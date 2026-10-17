import { describe, expect, it } from "vitest";
import {
  type ChatTurn,
  assertAlternating,
  buildAskFirstTurn,
  buildAskSystemPrompt,
  buildChatRequest,
  extractRefusal,
  markdownToPlainText,
} from "../../src/recognition/ai-chat";
import {
  MAX_OUTPUT_TOKENS,
  extractLlmErrorMessage,
  extractLlmText,
  isTruncatedLlmResponse,
  type LlmVendor,
  VENDORS,
} from "../../src/recognition/llm-request";

const png = { base64: "AAAA", mimeType: "image/png" as const };
const conversation: ChatTurn[] = [
  { role: "user", text: "What is on page 2?", images: [png, { ...png, base64: "BBBB" }] },
  { role: "assistant", text: "A proof." },
  { role: "user", text: "Is it correct?" },
];
const base = { model: "m", apiKey: "sk-test", system: "be brief", turns: conversation };

type AnthropicBody = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{
    role: string;
    content:
      | string
      | Array<{ type: string; text?: string; source?: { data: string; media_type: string } }>;
  }>;
};
type OpenAiBody = {
  max_completion_tokens: number;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
};
type GoogleBody = {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{
    role: string;
    parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
  }>;
  generationConfig: { maxOutputTokens: number };
};

describe("buildChatRequest", () => {
  it("builds a multi-turn Anthropic Messages request with images before the first question", () => {
    const req = buildChatRequest({ ...base, vendor: "anthropic" });
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers).toEqual({
      "x-api-key": "sk-test",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    const body = req.body as AnthropicBody;
    expect(body.system).toBe("be brief");
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const first = body.messages[0].content as Array<{ type: string; source?: { data: string } }>;
    expect(first.map((b) => b.type)).toEqual(["image", "image", "text"]);
    expect(first[1].source?.data).toBe("BBBB");
    expect(body.messages[1].content).toBe("A proof.");
    const last = body.messages[2].content as Array<{ type: string; text?: string }>;
    expect(last).toEqual([{ type: "text", text: "Is it correct?" }]);
  });

  it("asks Anthropic to cache the conversation only when told to", () => {
    const cached = buildChatRequest({ ...base, vendor: "anthropic", cache: true }).body;
    expect((cached as Record<string, unknown>).cache_control).toEqual({ type: "ephemeral" });
    const plain = buildChatRequest({ ...base, vendor: "anthropic" }).body;
    expect(plain).not.toHaveProperty("cache_control");
    // The other dialects cache on their own and would reject the field.
    for (const vendor of ["openai", "openrouter", "google"] as const) {
      const body = JSON.stringify(buildChatRequest({ ...base, vendor, cache: true }).body);
      expect(body, vendor).not.toContain("cache_control");
    }
  });

  it("omits the system prompt when there is none", () => {
    const req = buildChatRequest({ ...base, system: undefined, vendor: "anthropic" });
    expect((req.body as AnthropicBody).system).toBeUndefined();
    const openai = buildChatRequest({ ...base, system: "", vendor: "openai" });
    expect((openai.body as OpenAiBody).messages[0].role).toBe("user");
  });

  it("builds OpenAI Chat Completions with a system message and data-URL images", () => {
    const req = buildChatRequest({ ...base, vendor: "openai", maxTokens: 1000 });
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers).toMatchObject({ authorization: "Bearer sk-test" });
    const body = req.body as OpenAiBody;
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    const first = body.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(first[0].image_url?.url).toBe("data:image/png;base64,AAAA");
    expect(first[2]).toEqual({ type: "text", text: "What is on page 2?" });
    // A text-only follow-up stays a plain string (older compatible servers need it).
    expect(body.messages[3].content).toBe("Is it correct?");
  });

  it("uses the OpenAI dialect for OpenRouter and the custom endpoint", () => {
    const openrouter = buildChatRequest({ ...base, vendor: "openrouter" });
    expect(openrouter.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(openrouter.headers["x-title"]).toBe("FineNotes");
    const ollama = { vendor: "custom" as const, apiKey: "", baseUrl: "http://localhost:11434/v1" };
    const custom = buildChatRequest({ ...base, ...ollama });
    expect(custom.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(custom.headers.authorization).toBeUndefined();
    expect((custom.body as OpenAiBody).messages).toHaveLength(4);
  });

  it("builds Gemini generateContent with model turns and a systemInstruction", () => {
    const req = buildChatRequest({ ...base, vendor: "google" });
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent",
    );
    expect(req.headers["x-goog-api-key"]).toBe("sk-test");
    const body = req.body as GoogleBody;
    expect(body.systemInstruction?.parts[0].text).toBe("be brief");
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "image/png", data: "AAAA" });
    expect(body.contents[0].parts[2].text).toBe("What is on page 2?");
    expect(body.contents[1].parts).toEqual([{ text: "A proof." }]);
    expect(body.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it("sends attached files before the page images, in each vendor's shape", () => {
    const files = [
      { name: "Slides.pdf", mimeType: "application/pdf", base64: "PDF", path: "L/Slides.pdf" },
      { name: "photo.jpg", mimeType: "image/jpeg", base64: "JPG" },
      { name: "notes.md", mimeType: "text/plain", text: "# Notes" },
    ];
    const turns: ChatTurn[] = [{ role: "user", text: "Q", images: [png], files }];

    const anthropic = buildChatRequest({ ...base, turns, vendor: "anthropic" }).body as {
      messages: Array<{ content: unknown[] }>;
    };
    expect(anthropic.messages[0].content).toEqual([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "PDF" } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "JPG" } },
      { type: "text", text: '<file name="notes.md">\n# Notes\n</file>' },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "text", text: "Q" },
    ]);

    const openai = buildChatRequest({ ...base, turns, vendor: "openai" }).body as OpenAiBody;
    expect(openai.messages[1].content).toEqual([
      {
        type: "file",
        file: { filename: "Slides.pdf", file_data: "data:application/pdf;base64,PDF" },
      },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,JPG" } },
      { type: "text", text: '<file name="notes.md">\n# Notes\n</file>' },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "text", text: "Q" },
    ]);
    // A question with only a file is still a list, not a plain string.
    const fileOnly = buildChatRequest({
      ...base,
      turns: [{ role: "user", text: "Q", files: [files[2]] }],
      vendor: "openai",
    }).body as OpenAiBody;
    expect(Array.isArray(fileOnly.messages[1].content)).toBe(true);

    const google = buildChatRequest({ ...base, turns, vendor: "google" }).body as GoogleBody;
    expect(google.contents[0].parts.slice(0, 3)).toEqual([
      { inline_data: { mime_type: "application/pdf", data: "PDF" } },
      { inline_data: { mime_type: "image/jpeg", data: "JPG" } },
      { text: '<file name="notes.md">\n# Notes\n</file>' },
    ]);
    // The vault path is never sent.
    for (const vendor of ["anthropic", "openai", "google"] as const) {
      expect(JSON.stringify(buildChatRequest({ ...base, turns, vendor }).body)).not.toContain(
        "L/Slides.pdf",
      );
    }
  });

  it("never attaches images to the model's own turns", () => {
    const turns: ChatTurn[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "a", images: [png] },
      { role: "user", text: "q2" },
    ];
    for (const vendor of ["anthropic", "openai", "google"] as const) {
      const body = JSON.stringify(buildChatRequest({ ...base, turns, vendor }).body);
      expect(body, vendor).not.toContain("AAAA");
    }
  });

  it("requires a key for named vendors and a well-formed history", () => {
    expect(() => buildChatRequest({ ...base, vendor: "google", apiKey: " " })).toThrow(/API key/);
    expect(() => buildChatRequest({ ...base, vendor: "openai", turns: [] })).toThrow(/question/);
    expect(() =>
      buildChatRequest({
        ...base,
        vendor: "openai",
        turns: [{ role: "assistant", text: "hi" }],
      }),
    ).toThrow(/user/);
  });
});

describe("assertAlternating", () => {
  it("accepts user/assistant/user and rejects two user turns in a row", () => {
    expect(() => assertAlternating(conversation)).not.toThrow();
    expect(() =>
      assertAlternating([
        { role: "user", text: "a" },
        { role: "user", text: "b" },
      ]),
    ).toThrow(/turn 2/);
  });
});

// Response fixtures follow each vendor's documented shapes.
const answers: Record<"anthropic" | "openai" | "google", unknown> = {
  anthropic: {
    id: "msg_01",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Yes, it holds." }],
    stop_reason: "end_turn",
  },
  openai: {
    id: "chatcmpl-1",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Yes, it holds.", refusal: null },
        finish_reason: "stop",
      },
    ],
  },
  google: {
    candidates: [
      { content: { role: "model", parts: [{ text: "Yes, it holds." }] }, finishReason: "STOP" },
    ],
  },
};

describe("chat responses", () => {
  it("extracts the answer from every dialect", () => {
    for (const vendor of ["anthropic", "openai", "google"] as const) {
      expect(extractLlmText(vendor, answers[vendor]), vendor).toBe("Yes, it holds.");
      expect(extractRefusal(vendor, answers[vendor]), vendor).toBe("");
      expect(isTruncatedLlmResponse(vendor, answers[vendor]), vendor).toBe(false);
    }
  });

  it("reads each vendor's documented error body", () => {
    expect(
      extractLlmErrorMessage({
        type: "error",
        error: { type: "invalid_request_error", message: "messages: roles must alternate" },
      }),
    ).toBe("messages: roles must alternate");
    expect(
      extractLlmErrorMessage({
        error: {
          message: "Incorrect API key provided.",
          type: "invalid_request_error",
          param: null,
          code: "invalid_api_key",
        },
      }),
    ).toBe("Incorrect API key provided.");
    expect(
      extractLlmErrorMessage({
        error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" },
      }),
    ).toBe("API key not valid.");
  });

  it("detects truncation on chat responses", () => {
    expect(isTruncatedLlmResponse("anthropic", { content: [], stop_reason: "max_tokens" })).toBe(
      true,
    );
    expect(
      isTruncatedLlmResponse("openrouter", {
        choices: [{ message: { content: "partial" }, finish_reason: "length" }],
      }),
    ).toBe(true);
    expect(
      isTruncatedLlmResponse("google", {
        candidates: [{ content: { parts: [{ text: "part" }] }, finishReason: "MAX_TOKENS" }],
      }),
    ).toBe(true);
  });
});

describe("extractRefusal", () => {
  it("reads Anthropic's refusal stop reason", () => {
    expect(extractRefusal("anthropic", { stop_reason: "refusal", content: [] })).toMatch(
      /declined/,
    );
  });

  it("reads OpenAI's refusal text and content filter", () => {
    expect(
      extractRefusal("openai", {
        choices: [{ message: { content: null, refusal: "I can't help with that." } }],
      }),
    ).toBe("I can't help with that.");
    expect(
      extractRefusal("custom", { choices: [{ message: {}, finish_reason: "content_filter" }] }),
    ).toMatch(/content filter/);
    expect(extractRefusal("openai", { choices: [] })).toBe("");
  });

  it("reads Google's blocked prompt and blocked candidate", () => {
    expect(extractRefusal("google", { promptFeedback: { blockReason: "SAFETY" } })).toBe(
      "the question was blocked (SAFETY)",
    );
    expect(extractRefusal("google", { candidates: [{ finishReason: "PROHIBITED_CONTENT" }] })).toBe(
      "the answer was blocked (PROHIBITED_CONTENT)",
    );
    expect(extractRefusal("google", { candidates: [{ finishReason: "MAX_TOKENS" }] })).toBe("");
  });

  it("is empty for malformed payloads", () => {
    const vendors = Object.keys(VENDORS) as LlmVendor[];
    for (const vendor of vendors) {
      expect(extractRefusal(vendor, null), vendor).toBe("");
      expect(extractRefusal(vendor, "nope"), vendor).toBe("");
    }
  });
});

describe("the first question", () => {
  it("names the pages its images show", () => {
    const one = buildAskFirstTurn("  What is this?  ", [png], [3], 9);
    expect(one.role).toBe("user");
    expect(one.images).toEqual([png]);
    expect(one.text).toBe("The image is page 3 of 9.\n\nWhat is this?");

    const some = buildAskFirstTurn("Summarise", [png, png], [2, 3], 9);
    expect(some.text).toContain("pages 2, 3 of 9, in that order");
    expect(some.text).toContain("other pages of the notebook were not sent");

    const all = buildAskFirstTurn("Summarise", [png, png], [1, 2], 2);
    expect(all.text).not.toContain("were not sent");
  });

  it("has a system prompt that grounds answers in the pages", () => {
    expect(buildAskSystemPrompt()).toMatch(/pages/);
  });
});

describe("markdownToPlainText", () => {
  it("drops markdown syntax but keeps structure", () => {
    const md = [
      "## Summary",
      "",
      "The **key** idea is *induction* and `P(n)`.",
      "- first point",
      "* second point",
      "- [ ] open task",
      "> quoted",
      "See [the notes](https://example.com) and [[Lecture 3|lecture three]] or [[Lecture 4]].",
      "~~old~~ new, __strong__ and _em_ but snake_case stays.",
      "",
      "---",
      "",
      "```python",
      "print(1)",
      "```",
      "",
      "",
      "",
      "End.",
    ].join("\n");
    expect(markdownToPlainText(md)).toBe(
      [
        "Summary",
        "",
        "The key idea is induction and P(n).",
        "• first point",
        "• second point",
        "☐ open task",
        "quoted",
        "See the notes and lecture three or Lecture 4.",
        "old new, strong and em but snake_case stays.",
        "",
        "print(1)",
        "",
        "End.",
      ].join("\n"),
    );
  });

  it("normalises CRLF and trims", () => {
    expect(markdownToPlainText("\r\n  hello\r\nworld  \r\n")).toBe("hello\nworld");
  });
});
