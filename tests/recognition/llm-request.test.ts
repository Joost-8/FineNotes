/**
 * `llm-request.ts`: the vendor table, endpoint URLs, the transcription
 * prompt and the reply readers, plus the three rules about keys that every
 * request builder must keep:
 *
 * - a custom endpoint gets its own key or none, never a cloud vendor's;
 * - a Google key travels in the `x-goog-api-key` header, never in the URL;
 * - OpenRouter's attribution headers go to OpenRouter and nowhere else.
 *
 * What a transcription sends end to end is pinned in `transcription.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODELS,
  LLM_PROVIDER_ID,
  type LlmVendor,
  MAX_OUTPUT_TOKENS,
  VENDORS,
  VENDOR_LABELS,
  buildRecognitionPrompt,
  chatCompletionsUrl,
  cleanTranscription,
  defaultModelFor,
  describeLlmTarget,
  extractLlmErrorMessage,
  extractLlmText,
  isPlainHttpUrl,
  isRecord,
  isTruncatedLlmResponse,
  jsonEndpoint,
  openAiEndpointUrl,
} from "../../src/recognition/llm-request";
import { buildChatRequest } from "../../src/recognition/ai-chat";
import { IMAGE_VENDORS, buildImageRequest } from "../../src/recognition/ai-image";
import { buildAudioRequest } from "../../src/recognition/audio-request";
import { AI_MAX_EDGE, AI_MAX_PIXELS, aiRenderWidth } from "../../src/recognition/page-render";

const ALL: LlmVendor[] = ["anthropic", "openai", "google", "openrouter", "custom"];

describe("aiRenderWidth", () => {
  it("keeps a page under both the edge and the pixel budget", () => {
    for (const [w, h] of [
      [1024, 1448],
      [1448, 1024],
      [600, 800],
      [4000, 300],
      [300, 4000],
    ]) {
      const width = aiRenderWidth(w, h);
      const height = (width * h) / w;
      expect(Math.max(width, height), `${w}x${h}`).toBeLessThanOrEqual(AI_MAX_EDGE + 1);
      expect(width * height, `${w}x${h}`).toBeLessThanOrEqual(AI_MAX_PIXELS + AI_MAX_EDGE);
    }
    // An A4-shaped page is limited by area, landing near 900 px wide.
    expect(aiRenderWidth(1024, 1448)).toBeGreaterThan(850);
    expect(aiRenderWidth(1024, 1448)).toBeLessThan(920);
    // A long strip is limited by its long edge.
    expect(aiRenderWidth(4000, 300)).toBe(AI_MAX_EDGE);
  });

  it("is 0 for a degenerate page", () => {
    expect(aiRenderWidth(0, 100)).toBe(0);
    expect(aiRenderWidth(100, Number.NaN)).toBe(0);
  });
});

describe("the vendor table", () => {
  it("lists five vendors under the ids data.json stores", () => {
    expect(Object.keys(VENDORS).sort()).toEqual([...ALL].sort());
    expect(LLM_PROVIDER_ID).toBe("llm-byok");
  });

  it("names each vendor as the settings and SELF_HOSTING.md do", () => {
    expect(VENDOR_LABELS).toEqual({
      anthropic: "Anthropic (Claude)",
      openai: "OpenAI (GPT)",
      google: "Google (Gemini)",
      openrouter: "OpenRouter (any model)",
      custom: "Custom endpoint (OpenAI-compatible)",
    });
    // In the table's order: the settings dropdown lists them so.
    expect(Object.keys(VENDOR_LABELS)).toEqual(ALL);
    for (const id of ALL) expect(VENDORS[id].label).toBe(VENDOR_LABELS[id]);
  });

  it("starts each vendor on a default model", () => {
    expect(DEFAULT_MODELS).toEqual({
      anthropic: "claude-opus-4-8",
      openai: "gpt-4o-mini",
      google: "gemini-3.5-flash",
      openrouter: "google/gemini-3.5-flash",
      custom: "qwen2.5vl:7b",
    });
    for (const id of ALL) {
      expect(defaultModelFor(id)).toBe(DEFAULT_MODELS[id]);
      expect(VENDORS[id].defaultModel).toBe(DEFAULT_MODELS[id]);
    }
  });

  it("speaks three wire dialects", () => {
    expect(Object.fromEntries(ALL.map((id) => [id, VENDORS[id].dialect]))).toEqual({
      anthropic: "anthropic",
      openai: "openai",
      google: "google",
      openrouter: "openai",
      custom: "openai",
    });
  });

  it("has exactly one user-supplied endpoint, the only vendor that may go without a key", () => {
    expect(ALL.filter((id) => VENDORS[id].userEndpoint)).toEqual(["custom"]);
    expect(ALL.filter((id) => !VENDORS[id].requiresKey)).toEqual(["custom"]);
  });

  it("offers the browser Connect for OpenRouter only", () => {
    expect(ALL.filter((id) => VENDORS[id].oauthConnect)).toEqual(["openrouter"]);
  });

  it("sends named vendors over HTTPS to fixed hosts", () => {
    const hosts = ALL.filter((id) => !VENDORS[id].userEndpoint).map((id) => {
      const url = new URL(VENDORS[id].url({ model: "m" }));
      expect(url.protocol, id).toBe("https:");
      return url.host;
    });
    expect(hosts).toEqual([
      "api.anthropic.com",
      "api.openai.com",
      "generativelanguage.googleapis.com",
      "openrouter.ai",
    ]);
  });

  it("allows 8192 output tokens per reply", () => {
    expect(MAX_OUTPUT_TOKENS).toBe(8192);
  });
});

describe("jsonEndpoint", () => {
  it("is the vendor's URL and headers, with a JSON content type", () => {
    expect(jsonEndpoint({ vendor: "anthropic", model: "m", apiKey: "k" })).toEqual({
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": "k",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    });
    expect(
      jsonEndpoint({ vendor: "custom", model: "m", apiKey: "", baseUrl: "http://h:1/v1" }),
    ).toEqual({
      url: "http://h:1/v1/chat/completions",
      headers: { "content-type": "application/json" },
    });
  });

  it("refuses a missing key where the vendor needs one", () => {
    const refused = ALL.filter((id) => {
      try {
        jsonEndpoint({ vendor: id, model: "m", apiKey: " ", baseUrl: "http://h/v1" });
        return false;
      } catch (error) {
        expect(String(error), id).toContain("missing API key");
        return true;
      }
    });
    expect(refused).toEqual(ALL.filter((id) => VENDORS[id].requiresKey));
  });
});

describe("the key rules, for every request builder", () => {
  const png = { base64: "AAAA", mimeType: "image/png" as const };
  const turn = [{ role: "user" as const, text: "q", images: [png] }];

  /** Every request the builders make for `vendor` with `apiKey`. */
  function requestsFor(vendor: LlmVendor, apiKey: string) {
    const base = { vendor, model: "m", apiKey, baseUrl: "https://box.example/v1" };
    const requests = [buildChatRequest({ ...base, turns: turn })];
    if ((IMAGE_VENDORS as readonly string[]).includes(vendor)) {
      requests.push(
        buildImageRequest({
          vendor: vendor as (typeof IMAGE_VENDORS)[number],
          model: "m",
          apiKey,
          prompt: "a cat",
          aspect: "square",
        }),
      );
    }
    if (vendor === "google" || vendor === "openai" || vendor === "custom") {
      const recording = { audio: new Uint8Array([1, 2, 3]), mimeType: "audio/mp4", boundary: "b" };
      requests.push(buildAudioRequest({ ...base, vendor, ...recording }));
    }
    return requests;
  }

  it("keeps Google's key out of the URL", () => {
    for (const request of requestsFor("google", "AIza-secret")) {
      expect(request.url).not.toContain("AIza-secret");
      expect(request.url).not.toMatch(/[?&]key=/);
      expect(request.headers["x-goog-api-key"]).toBe("AIza-secret");
    }
  });

  it("sends OpenRouter's attribution headers to openrouter.ai only", () => {
    for (const vendor of ALL) {
      for (const request of requestsFor(vendor, "k")) {
        const attributed = "x-title" in request.headers || "http-referer" in request.headers;
        expect(attributed, `${vendor} ${request.url}`).toBe(vendor === "openrouter");
        if (attributed) expect(new URL(request.url).host).toBe("openrouter.ai");
      }
    }
  });

  it("gives a custom endpoint its own key, or no key header at all", () => {
    for (const request of requestsFor("custom", "")) {
      expect(Object.keys(request.headers).filter((h) => h !== "content-type")).toEqual([]);
    }
    for (const request of requestsFor("custom", "own-key")) {
      expect(request.headers.authorization).toBe("Bearer own-key");
      expect(request.headers["x-api-key"]).toBeUndefined();
      expect(request.headers["x-goog-api-key"]).toBeUndefined();
      expect(new URL(request.url).host).toBe("box.example");
    }
  });

  it("puts each cloud vendor's key in that vendor's own header", () => {
    expect(VENDORS.anthropic.headers("k")).toEqual({
      "x-api-key": "k",
      "anthropic-version": "2023-06-01",
    });
    expect(VENDORS.openai.headers("k")).toEqual({ authorization: "Bearer k" });
    expect(VENDORS.google.headers("k")).toEqual({ "x-goog-api-key": "k" });
    expect(VENDORS.openrouter.headers("k")).toEqual({
      authorization: "Bearer k",
      "http-referer": "https://github.com/Joost-8/FineNotes",
      "x-title": "FineNotes",
    });
    expect(VENDORS.custom.headers("k")).toEqual({ authorization: "Bearer k" });
    expect(VENDORS.custom.headers(" ")).toEqual({});
  });
});

describe("how a destination is named in messages", () => {
  it("is the vendor's label for a named vendor, whatever the URL", () => {
    for (const id of ALL.filter((i) => !VENDORS[i].userEndpoint)) {
      expect(describeLlmTarget(id, "http://elsewhere:9/v1"), id).toBe(VENDOR_LABELS[id]);
    }
  });

  it("names the custom endpoint by its host and port", () => {
    expect(describeLlmTarget("custom", " https://box.tail.ts.net:8443/v1 ")).toBe(
      "your configured endpoint (box.tail.ts.net:8443)",
    );
  });

  it("stays readable without a usable URL", () => {
    for (const baseUrl of [undefined, "", "   ", "box with spaces"]) {
      expect(describeLlmTarget("custom", baseUrl), String(baseUrl)).toBe(
        "your configured endpoint",
      );
    }
  });
});

describe("the chat endpoint of a custom server", () => {
  const cases: Array<[string, string]> = [
    ["http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/v1/chat/completions"],
    // Surrounding space and trailing slashes are the user's typing, not the path.
    ["\thttps://llm.home.arpa/openai/v1///  ", "https://llm.home.arpa/openai/v1/chat/completions"],
    // Pasted with the endpoint already on it.
    ["https://llm.home.arpa/v1/chat/completions/", "https://llm.home.arpa/v1/chat/completions"],
    // A query string stays after the path; a fragment goes.
    ["https://proxy.test/v1?tenant=a&x=1", "https://proxy.test/v1/chat/completions?tenant=a&x=1"],
    ["http://127.0.0.1:8080/v1#models", "http://127.0.0.1:8080/v1/chat/completions"],
    // No `/v1` is added: whether the path has one is the server's business.
    ["http://127.0.0.1:1234", "http://127.0.0.1:1234/chat/completions"],
  ];

  it("is built from the base URL the user entered", () => {
    for (const [base, url] of cases) expect(chatCompletionsUrl(base), base).toBe(url);
  });

  it("says what is wrong with a URL that cannot be used", () => {
    expect(() => chatCompletionsUrl("  box  ")).toThrow(
      /^invalid endpoint URL "box" — .*http:\/\/localhost:11434\/v1/,
    );
    expect(() => chatCompletionsUrl("")).toThrow(/^invalid endpoint URL ""/);
    expect(() => chatCompletionsUrl("ftp://box/v1")).toThrow(
      'an endpoint URL starts with http:// or https:// — "ftp://box/v1" does not',
    );
  });
});

describe("openAiEndpointUrl", () => {
  it("appends any endpoint to a base URL", () => {
    expect(openAiEndpointUrl("http://localhost:8000/v1/", "/audio/transcriptions")).toBe(
      "http://localhost:8000/v1/audio/transcriptions",
    );
  });

  it("swaps a pasted endpoint of the same family for the one asked for", () => {
    expect(
      openAiEndpointUrl("https://gw.example.com/v1/chat/completions?k=1", "/audio/transcriptions"),
    ).toBe("https://gw.example.com/v1/audio/transcriptions?k=1");
    expect(openAiEndpointUrl("https://x.dev/v1/audio/transcriptions", "/chat/completions")).toBe(
      "https://x.dev/v1/chat/completions",
    );
  });

  it("validates like chatCompletionsUrl", () => {
    expect(() => openAiEndpointUrl("nope", "/audio/transcriptions")).toThrow(/endpoint URL/);
  });
});

describe("the plain-HTTP warning", () => {
  it("is for an http:// URL in any letter case, and nothing else", () => {
    const plain = ["http://10.0.0.7:11434/v1", " HTTP://box/v1 ", "Http://box"];
    const not = ["https://box/v1", "box", "", "ws://box", "httpx://box"];
    for (const url of plain) expect(isPlainHttpUrl(url), url).toBe(true);
    for (const url of not) expect(isPlainHttpUrl(url), url).toBe(false);
  });
});

describe("buildRecognitionPrompt", () => {
  it("tells the model about the paper only for a whole-page image", () => {
    expect(buildRecognitionPrompt()).not.toMatch(/notebook page/);
    const page = buildRecognitionPrompt(true);
    expect(page).toMatch(/whole notebook page/);
    expect(page).toMatch(/Ignore the paper/);
    expect(page).toMatch(/typed text/);
  });

  it("asks for every instruction the transcription relies on", () => {
    const prompt = buildRecognitionPrompt();
    // Output: Markdown, and only the transcription.
    expect(prompt).toMatch(/^Transcribe every piece of handwriting .* Markdown/);
    expect(prompt).toMatch(/transcription only: no introduction, no comments, no code fences/);
    // Structure: the writing's lines; headings and lists only where implied.
    expect(prompt).toMatch(/Keep the lines as they are written/);
    expect(prompt).toMatch(/headings or lists only where the writing plainly calls for them/);
    // Obsidian syntax, maths, drawings and unreadable words.
    expect(prompt).toContain("[[wiki-links]] and #tags exactly as they are written");
    expect(prompt).toContain("LaTeX between dollar signs, like $...$");
    expect(prompt).toContain("[sketch: flow diagram]");
    expect(prompt).toMatch(/best guess and put \(\?\) after it/);
  });

  it("adds the page rules after the others, one instruction a line", () => {
    const ink = buildRecognitionPrompt(false).split("\n");
    const page = buildRecognitionPrompt(true).split("\n");
    expect(page.slice(0, ink.length)).toEqual(ink);
    expect(page).toHaveLength(ink.length + 3);
    for (const line of page.slice(2)) expect(line.startsWith("- "), line).toBe(true);
  });
});

describe("isRecord", () => {
  it("is true for objects and arrays, false for null and primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
    for (const value of [null, undefined, 0, "", "x", true]) expect(isRecord(value)).toBe(false);
  });
});

describe("reading a reply's text", () => {
  it("joins Anthropic's text blocks with newlines, skipping every other kind of block", () => {
    const reply = {
      content: [
        { type: "thinking", thinking: "Let me look at the page." },
        { type: "text", text: "Shopping" },
        { type: "tool_use", id: "t1", name: "x", input: {} },
        { type: "text", text: "- milk" },
        42,
      ],
    };
    expect(extractLlmText("anthropic", reply)).toBe("Shopping\n- milk");
  });

  it("takes the first choice's message content in the OpenAI dialect, if it is a string", () => {
    const reply = {
      choices: [{ message: { content: "Chosen" } }, { message: { content: "Ignored" } }],
    };
    for (const vendor of ["openai", "openrouter", "custom"] as const) {
      expect(extractLlmText(vendor, reply), vendor).toBe("Chosen");
    }
    const odd = [
      { choices: [{ message: { content: [{ type: "text", text: "parts" }] } }] },
      { choices: [{ message: null }] },
      { choices: ["Chosen"] },
      // Keyed like an array, but not one.
      { choices: { 0: { message: { content: "Chosen" } } } },
    ];
    for (const json of odd) expect(extractLlmText("openai", json), JSON.stringify(json)).toBe("");
  });

  it("runs the first Gemini candidate's text parts together", () => {
    const reply = {
      candidates: [
        { content: { parts: [{ text: "Lec" }, { inlineData: {} }, { text: "ture 4" }, null] } },
        { content: { parts: [{ text: "second candidate" }] } },
      ],
    };
    expect(extractLlmText("google", reply)).toBe("Lecture 4");
    expect(extractLlmText("google", { candidates: [{ finishReason: "SAFETY" }] })).toBe("");
  });

  it("is empty for anything malformed", () => {
    const junk = [null, undefined, "text", 3, [], {}, { content: "x", choices: {}, candidates: 1 }];
    for (const vendor of ALL) {
      for (const json of junk) {
        expect(extractLlmText(vendor, json), `${vendor} ${JSON.stringify(json)}`).toBe("");
      }
    }
  });
});

describe("telling a reply that hit the output cap", () => {
  const cases: Array<[LlmVendor, unknown, boolean]> = [
    ["anthropic", { stop_reason: "max_tokens", content: [] }, true],
    ["anthropic", { stop_reason: "stop_sequence" }, false],
    ["openai", { choices: [{ finish_reason: "length" }] }, true],
    ["openrouter", { choices: [{ finish_reason: "length", message: { content: "half" } }] }, true],
    ["openai", { choices: [{ finish_reason: "content_filter" }] }, false],
    // Only the first choice counts.
    ["openai", { choices: [{ finish_reason: "stop" }, { finish_reason: "length" }] }, false],
    // A reasoning model (vLLM, say) whose thinking used up the cap: no text
    // at all, and this is the only sign of why.
    [
      "custom",
      { choices: [{ message: { content: null, reasoning: "…" }, finish_reason: "length" }] },
      true,
    ],
    ["google", { candidates: [{ finishReason: "MAX_TOKENS" }] }, true],
    ["google", { candidates: [{ finishReason: "RECITATION" }] }, false],
  ];

  it("reads each dialect's own signal", () => {
    for (const [vendor, reply, cutOff] of cases) {
      expect(isTruncatedLlmResponse(vendor, reply), `${vendor} ${JSON.stringify(reply)}`).toBe(
        cutOff,
      );
    }
  });

  it("is false for anything malformed", () => {
    const junk = [null, "length", {}, { choices: [] }, { candidates: [null] }, { choices: [7] }];
    for (const vendor of ALL) {
      for (const json of junk) expect(isTruncatedLlmResponse(vendor, json), vendor).toBe(false);
    }
  });
});

describe("the message in an error reply", () => {
  it("comes from {error: {message}} or a bare {error: string}, trimmed", () => {
    expect(extractLlmErrorMessage({ error: { message: "\n Quota exceeded. " } })).toBe(
      "Quota exceeded.",
    );
    expect(extractLlmErrorMessage({ error: "  model not loaded\t" })).toBe("model not loaded");
  });

  it("is clipped past 300 characters", () => {
    const at = "z".repeat(300);
    expect(extractLlmErrorMessage({ error: { message: at } })).toBe(at);
    expect(extractLlmErrorMessage({ error: { message: `${at}!` } })).toBe(`${at}…`);
  });

  it("is empty when there is none", () => {
    const none = [null, "oops", {}, { error: null }, { error: {} }, { error: { message: false } }];
    for (const json of none) expect(extractLlmErrorMessage(json), JSON.stringify(json)).toBe("");
    expect(extractLlmErrorMessage({ message: "not under error" })).toBe("");
  });
});

describe("cleaning a transcription", () => {
  it("trims it", () => {
    expect(cleanTranscription("\t \n# Monday\n- call Ana \n\n")).toBe("# Monday\n- call Ana");
  });

  it("takes it out of a fence that wraps all of it, with or without a language", () => {
    const cases: Array<[string, string]> = [
      ["```md\n## Week 3\nNotes\n```", "## Week 3\nNotes"],
      ["  ```\n  indented\n```  ", "indented"],
      ["```MARKDOWN\nx\n```", "x"],
      ["```\nno newline before the close```", "no newline before the close"],
      ["```\n```", ""],
      // First fence line to last fence, whatever lies between.
      ["```\na\n```\nb\n```", "a\n```\nb"],
    ];
    for (const [reply, text] of cases) expect(cleanTranscription(reply), reply).toBe(text);
  });

  it("leaves fences that do not wrap the whole reply", () => {
    for (const text of [
      "Before\n```\ncode\n```",
      "```\ncode\n```\nAfter",
      "```py 3\ncode\n```",
      "```c#\ncode\n```",
      "```inline```",
    ]) {
      expect(cleanTranscription(text), text).toBe(text);
    }
  });
});
