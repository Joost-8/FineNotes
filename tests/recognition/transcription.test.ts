/**
 * Transcription end to end: `LlmProvider.recognize` against a fake
 * `requestUrl`, so what is pinned here is what actually leaves the device —
 * the URL, the headers, the JSON body — and how every kind of reply and
 * failure comes back to the note. Written before the recognition code was
 * rewritten, and run against both versions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { Stroke } from "../../src/model/document";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));
vi.mock("../../src/recognition/render", () => ({ renderStrokesForRecognition: vi.fn() }));

const obsidian = await import("obsidian");
const render = await import("../../src/recognition/render");
const { LlmProvider } = await import("../../src/recognition/llm");

type Vendor = "anthropic" | "openai" | "google" | "openrouter" | "custom";
interface Config {
  vendor: Vendor;
  model: string;
  apiKey: string;
  baseUrl: string;
}

const requestUrl = vi.mocked(obsidian.requestUrl);
const renderInk = vi.mocked(render.renderStrokesForRecognition);

/** Every request the code under test sent, in order. */
let sent: RequestUrlParam[] = [];
/** What the fake server answers. */
let answer: () => Promise<RequestUrlResponse> = () => Promise.resolve(response(200, {}));

function response(status: number, body: unknown): RequestUrlResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    text,
    // Like Obsidian's: parsing happens on read, and a non-JSON body throws.
    get json(): unknown {
      return JSON.parse(text) as unknown;
    },
  } as RequestUrlResponse;
}

beforeEach(() => {
  sent = [];
  answer = () => Promise.resolve(response(200, {}));
  requestUrl.mockReset();
  requestUrl.mockImplementation(((param: RequestUrlParam | string) => {
    sent.push(typeof param === "string" ? { url: param } : param);
    return answer();
  }) as typeof obsidian.requestUrl);
  renderInk.mockReset();
  renderInk.mockReturnValue({ base64: "INK", width: 10, height: 10 });
});

const configs: Record<Vendor, Config> = {
  anthropic: { vendor: "anthropic", model: "", apiKey: " sk-ant-1 ", baseUrl: "" },
  openai: { vendor: "openai", model: "", apiKey: "sk-1", baseUrl: "" },
  google: { vendor: "google", model: "", apiKey: "AIza-1", baseUrl: "" },
  openrouter: { vendor: "openrouter", model: "", apiKey: "sk-or-1", baseUrl: "" },
  custom: { vendor: "custom", model: "", apiKey: "", baseUrl: "http://localhost:11434/v1" },
};

const strokes: Stroke[] = [
  { id: "s1", color: "#000000", size: 3, tool: "pen", pts: [10, 10, 0.5, 20, 20, 0.5] },
];

/** A reply that transcribes to `text`, in the vendor's dialect. */
function textReply(vendor: Vendor, text: string): unknown {
  if (vendor === "anthropic") return { content: [{ type: "text", text }], stop_reason: "end_turn" };
  if (vendor === "google") {
    return { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] };
  }
  return { choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] };
}

async function transcribe(
  config: Config,
  request: { pageImage?: { base64: string }; strokes?: Stroke[] } = {
    pageImage: { base64: "PAGE" },
  },
): Promise<string> {
  const provider = new LlmProvider(() => config);
  const result = await provider.recognize({ strokes: request.strokes ?? strokes, ...request });
  return result.text;
}

/** The single request sent, with its body parsed. */
function onlyRequest(): RequestUrlParam & { json: Record<string, unknown> } {
  expect(sent).toHaveLength(1);
  const [request] = sent;
  expect(typeof request.body).toBe("string");
  return { ...request, json: JSON.parse(request.body as string) as Record<string, unknown> };
}

/** The prompt text inside a request body, whatever the dialect. */
function promptOf(body: Record<string, unknown>): string {
  const text = JSON.stringify(body).match(/"text":"((?:[^"\\]|\\.)*)"/);
  expect(text).not.toBeNull();
  return JSON.parse(`"${text![1]}"`) as string;
}

describe("the request a transcription sends", () => {
  it("Anthropic: Messages API, key in x-api-key, image block before the prompt", async () => {
    answer = () => Promise.resolve(response(200, textReply("anthropic", "ok")));
    await transcribe(configs.anthropic);
    const request = onlyRequest();
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.method).toBe("POST");
    expect(request.throw).toBe(false);
    expect(request.headers).toEqual({
      "x-api-key": "sk-ant-1",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(request.json).toEqual({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "PAGE" } },
            { type: "text", text: promptOf(request.json) },
          ],
        },
      ],
    });
  });

  it("OpenAI: Chat Completions, bearer key, the image as a PNG data URL", async () => {
    answer = () => Promise.resolve(response(200, textReply("openai", "ok")));
    await transcribe(configs.openai);
    const request = onlyRequest();
    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request.headers).toEqual({
      authorization: "Bearer sk-1",
      "content-type": "application/json",
    });
    expect(request.json).toEqual({
      model: "gpt-4o-mini",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,PAGE" } },
            { type: "text", text: promptOf(request.json) },
          ],
        },
      ],
    });
  });

  it("Google: generateContent on the model's URL, key in a header", async () => {
    answer = () => Promise.resolve(response(200, textReply("google", "ok")));
    await transcribe(configs.google);
    const request = onlyRequest();
    expect(request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    );
    expect(request.headers).toEqual({
      "x-goog-api-key": "AIza-1",
      "content-type": "application/json",
    });
    const [content] = request.json.contents as Array<Record<string, unknown>>;
    // Since the 2026-09 rewrite a transcription is a one-question chat, and
    // the chat body names the role; before, this content had none. For a
    // single turn the Gemini API reads a missing role as "user", and the
    // audio transcription already sent it.
    expect(Object.keys(content).sort()).toEqual(["parts", "role"]);
    expect(content.role).toBe("user");
    expect(content.parts).toEqual([
      { inline_data: { mime_type: "image/png", data: "PAGE" } },
      { text: promptOf(request.json) },
    ]);
    expect(request.json.generationConfig).toEqual({ maxOutputTokens: 8192 });
    expect(Object.keys(request.json).sort()).toEqual(["contents", "generationConfig"]);
  });

  it("OpenRouter: the OpenAI dialect on openrouter.ai, with attribution headers", async () => {
    answer = () => Promise.resolve(response(200, textReply("openrouter", "ok")));
    await transcribe(configs.openrouter);
    const request = onlyRequest();
    expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request.headers).toEqual({
      authorization: "Bearer sk-or-1",
      "http-referer": "https://github.com/Joost-8/FineNotes",
      "x-title": "FineNotes",
      "content-type": "application/json",
    });
    expect(request.json.model).toBe("google/gemini-3.5-flash");
    expect(request.json.max_completion_tokens).toBe(8192);
  });

  it("a custom endpoint: its own URL, no key header without a key", async () => {
    answer = () => Promise.resolve(response(200, textReply("custom", "ok")));
    await transcribe(configs.custom);
    const request = onlyRequest();
    expect(request.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(request.headers).toEqual({ "content-type": "application/json" });
    expect(request.json.model).toBe("qwen2.5vl:7b");
    expect(request.json.max_completion_tokens).toBe(8192);
    const [message] = request.json.messages as Array<{ content: unknown[] }>;
    expect(message.content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,PAGE" },
    });
  });

  it("a custom endpoint with a key sends exactly that key", async () => {
    answer = () => Promise.resolve(response(200, textReply("custom", "ok")));
    await transcribe({ ...configs.custom, apiKey: "local-secret" });
    expect(onlyRequest().headers).toEqual({
      authorization: "Bearer local-secret",
      "content-type": "application/json",
    });
  });

  it("uses the configured model, trimmed, and escapes it in Google's URL", async () => {
    answer = () => Promise.resolve(response(200, textReply("openai", "ok")));
    await transcribe({ ...configs.openai, model: "  gpt-5-vision " });
    expect(onlyRequest().json.model).toBe("gpt-5-vision");

    sent = [];
    answer = () => Promise.resolve(response(200, textReply("google", "ok")));
    await transcribe({ ...configs.google, model: "tuned/model x" });
    expect(onlyRequest().url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/tuned%2Fmodel%20x:generateContent",
    );
  });

  it("asks for markdown and says how to treat links, tags, maths, drawings and unclear words", async () => {
    answer = () => Promise.resolve(response(200, textReply("openai", "ok")));
    await transcribe(configs.openai);
    const prompt = promptOf(onlyRequest().json);
    expect(prompt).toMatch(/markdown/i);
    expect(prompt).toMatch(/\bonly\b/i);
    expect(prompt).toMatch(/code fences/);
    expect(prompt).toMatch(/line/);
    expect(prompt).toContain("[[wiki-links]]");
    expect(prompt).toContain("#tags");
    expect(prompt).toContain("$...$");
    expect(prompt).toContain("[sketch: flow diagram]");
    expect(prompt).toContain("(?)");
  });

  it("describes the paper only when the whole page is sent", async () => {
    answer = () => Promise.resolve(response(200, textReply("openai", "ok")));
    await transcribe(configs.openai);
    const page = promptOf(onlyRequest().json);
    expect(page).toContain(
      "- The image is one whole notebook page. Ignore the paper itself: its ruled lines, grid, dots and printed template.",
    );
    expect(page).toContain("- Include typed text on the page in reading order, as it appears.");
    expect(page).toContain("[slide: Fourier series]");

    sent = [];
    await transcribe(configs.openai, {});
    const ink = promptOf(onlyRequest().json);
    expect(ink).not.toMatch(/notebook page/);
    expect(ink).not.toMatch(/slide/);
    // Everything else is the same prompt.
    expect(page.startsWith(ink)).toBe(true);
  });
});

describe("what is sent when there is no page image", () => {
  it("renders the strokes on white and sends that", async () => {
    answer = () => Promise.resolve(response(200, textReply("anthropic", "ok")));
    await transcribe(configs.anthropic, {});
    expect(renderInk).toHaveBeenCalledWith(strokes);
    const body = onlyRequest().json as {
      messages: Array<{ content: Array<{ source?: unknown }> }>;
    };
    expect(body.messages[0].content[0].source).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "INK",
    });
  });

  it("returns empty text without a request when there is nothing to draw", async () => {
    renderInk.mockReturnValue(null);
    expect(await transcribe(configs.anthropic, {})).toBe("");
    expect(sent).toHaveLength(0);
  });

  it("never renders when the view sent the page", async () => {
    answer = () => Promise.resolve(response(200, textReply("anthropic", "ok")));
    await transcribe(configs.anthropic);
    expect(renderInk).not.toHaveBeenCalled();
  });
});

describe("refusing before anything is sent", () => {
  it("needs a key for a named vendor, checked before rendering", async () => {
    renderInk.mockReturnValue(null);
    await expect(transcribe({ ...configs.google, apiKey: "  " }, {})).rejects.toThrow(
      /API key.*Google \(Gemini\)|Google \(Gemini\).*API key/,
    );
    expect(renderInk).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("needs a URL for the custom endpoint", async () => {
    await expect(transcribe({ ...configs.custom, baseUrl: " " })).rejects.toThrow(/endpoint URL/);
    expect(sent).toHaveLength(0);
  });

  it("reports an unusable custom URL in the words the troubleshooting guide uses", async () => {
    await expect(transcribe({ ...configs.custom, baseUrl: "my box" })).rejects.toThrow(
      /invalid endpoint URL "my box"/,
    );
    // "localhost:11434" parses, with "localhost:" as its scheme.
    await expect(transcribe({ ...configs.custom, baseUrl: "localhost:11434" })).rejects.toThrow(
      /http:\/\/ or https:\/\/.*"localhost:11434"/,
    );
    expect(sent).toHaveLength(0);
  });
});

describe("reading the reply", () => {
  it("returns each dialect's text, trimmed and unwrapped from a stray code fence", async () => {
    for (const vendor of Object.keys(configs) as Vendor[]) {
      answer = () =>
        Promise.resolve(response(200, textReply(vendor, "```markdown\n# Notes\n- one\n```\n")));
      expect(await transcribe(configs[vendor]), vendor).toBe("# Notes\n- one");
    }
  });

  it("joins Anthropic's text blocks with newlines and Google's parts without", async () => {
    answer = () =>
      Promise.resolve(
        response(200, {
          content: [
            { type: "text", text: "one" },
            { type: "tool_use", id: "t" },
            { type: "text", text: "two" },
          ],
        }),
      );
    expect(await transcribe(configs.anthropic)).toBe("one\ntwo");
    answer = () =>
      Promise.resolve(
        response(200, { candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] }),
      );
    expect(await transcribe(configs.google)).toBe("ab");
  });

  it("discards a reply cut off at the output limit, even with text in it", async () => {
    const cutOff: Record<Vendor, unknown> = {
      anthropic: { content: [{ type: "text", text: "half" }], stop_reason: "max_tokens" },
      openai: { choices: [{ message: { content: "half" }, finish_reason: "length" }] },
      google: {
        candidates: [{ content: { parts: [{ text: "half" }] }, finishReason: "MAX_TOKENS" }],
      },
      openrouter: { choices: [{ message: { content: "half" }, finish_reason: "length" }] },
      custom: {
        choices: [{ message: { content: null, reasoning: "…" }, finish_reason: "length" }],
      },
    };
    for (const vendor of Object.keys(configs) as Vendor[]) {
      answer = () => Promise.resolve(response(200, cutOff[vendor]));
      await expect(transcribe(configs[vendor]), vendor).rejects.toThrow(
        /hit FineNotes's 8192-token output limit/,
      );
    }
  });

  it("says so when the model returned no text", async () => {
    answer = () => Promise.resolve(response(200, { content: [], stop_reason: "end_turn" }));
    await expect(transcribe(configs.anthropic)).rejects.toThrow(
      "Anthropic (Claude) returned no transcription.",
    );
    // A refusal carries no text either, and reads the same.
    answer = () =>
      Promise.resolve(response(200, { choices: [{ message: { content: null, refusal: "No." } }] }));
    await expect(transcribe(configs.openai)).rejects.toThrow(
      "OpenAI (GPT) returned no transcription.",
    );
    answer = () => Promise.resolve(response(200, { unexpected: true }));
    await expect(transcribe(configs.custom)).rejects.toThrow(
      "your configured endpoint (localhost:11434) returned no transcription.",
    );
  });
});

describe("failures on the way", () => {
  it("names the vendor when the network fails, and passes the reason on", async () => {
    answer = () => Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED"));
    await expect(transcribe(configs.openai)).rejects.toThrow(
      /could not reach OpenAI \(GPT\).*\(net::ERR_INTERNET_DISCONNECTED\)/,
    );
    await expect(transcribe(configs.custom)).rejects.toThrow(
      /could not reach your configured endpoint \(localhost:11434\)/,
    );
  });

  it("blames the key on a 401 or 403 from a named vendor", async () => {
    for (const status of [401, 403]) {
      answer = () => Promise.resolve(response(status, { error: { message: "bad key" } }));
      const failure = transcribe(configs.anthropic);
      await expect(failure).rejects.toThrow(/Anthropic \(Claude\)/);
      await expect(failure).rejects.toThrow(/API key/);
      await expect(failure).rejects.toThrow(/settings/);
    }
  });

  it("explains a self-hosted server's own access control on a 401 or 403", async () => {
    for (const status of [401, 403]) {
      answer = () => Promise.resolve(response(status, ""));
      const failure = transcribe(configs.custom);
      await expect(failure).rejects.toThrow(
        `your configured endpoint (localhost:11434) denied the request (HTTP ${status})`,
      );
      await expect(failure).rejects.toThrow(/API key/);
      await expect(failure).rejects.toThrow(/OLLAMA_HOST=0\.0\.0\.0/);
      await expect(failure).rejects.toThrow(/SELF_HOSTING\.md/);
    }
  });

  it("quotes the vendor's own error message for other statuses", async () => {
    answer = () =>
      Promise.resolve(
        response(404, {
          error: { code: 404, message: " models/x is not found. ", status: "NOT_FOUND" },
        }),
      );
    await expect(transcribe(configs.google)).rejects.toThrow(
      "Google (Gemini) request failed (HTTP 404): models/x is not found.",
    );
    answer = () => Promise.resolve(response(500, { error: 'model "y" not found' }));
    await expect(transcribe(configs.custom)).rejects.toThrow(
      'your configured endpoint (localhost:11434) request failed (HTTP 500): model "y" not found',
    );
  });

  it("clips a long error message", async () => {
    answer = () => Promise.resolve(response(400, { error: { message: "x".repeat(400) } }));
    await expect(transcribe(configs.openai)).rejects.toThrow(
      `OpenAI (GPT) request failed (HTTP 400): ${"x".repeat(300)}…`,
    );
  });

  it("falls back to the status when the error body is not JSON", async () => {
    answer = () => Promise.resolve(response(502, "<html>Bad gateway</html>"));
    await expect(transcribe(configs.openrouter)).rejects.toThrow(
      "OpenRouter (any model) request failed (HTTP 502).",
    );
  });

  it("says so when a successful reply cannot be read", async () => {
    answer = () => Promise.resolve(response(200, "not json"));
    await expect(transcribe(configs.openai)).rejects.toThrow(
      "OpenAI (GPT) returned an unreadable response.",
    );
  });
});
