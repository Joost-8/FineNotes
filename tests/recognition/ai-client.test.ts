/**
 * `ai-client.ts` against a fake `requestUrl`: how "Ask AI" reads a reply
 * (refusals, cut-off answers, empty ones), and `sendVendorRequest`'s mapping
 * of every failure to one sentence. Transcription's use of the same path is
 * pinned in `transcription.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

const obsidian = await import("obsidian");
const { askAi, sendVendorRequest, targetLabel, assertConfigured } =
  await import("../../src/recognition/ai-client");
const { ConnectionError } = await import("../../src/recognition/http");

const requestUrl = vi.mocked(obsidian.requestUrl);
let sent: RequestUrlParam[] = [];
let answer: () => Promise<RequestUrlResponse>;

function response(status: number, body: unknown): RequestUrlResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    text,
    get json(): unknown {
      return JSON.parse(text) as unknown;
    },
  } as RequestUrlResponse;
}

beforeEach(() => {
  sent = [];
  requestUrl.mockReset();
  requestUrl.mockImplementation(((param: RequestUrlParam) => {
    sent.push(param);
    return answer();
  }) as typeof obsidian.requestUrl);
});

const anthropic = { vendor: "anthropic" as const, model: "", apiKey: "sk-ant", baseUrl: "" };
const openai = { vendor: "openai" as const, model: "m", apiKey: "sk", baseUrl: "" };
const custom = {
  vendor: "custom" as const,
  model: "",
  apiKey: "",
  baseUrl: "https://box.example.ts.net/v1",
};
const question = [{ role: "user" as const, text: "What is this?" }];

describe("askAi", () => {
  it("sends the system prompt and the turns, and returns the cleaned answer", async () => {
    answer = () =>
      Promise.resolve(response(200, { content: [{ type: "text", text: "  It is a proof. " }] }));
    expect(await askAi(anthropic, "be brief", question)).toBe("It is a proof.");
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0].body as string) as Record<string, unknown>;
    expect(body.system).toBe("be brief");
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "What is this?" }] },
    ]);
  });

  it("reports a refusal in the vendor's words", async () => {
    answer = () => Promise.resolve(response(200, { content: [], stop_reason: "refusal" }));
    await expect(askAi(anthropic, "", question)).rejects.toThrow(
      "Anthropic (Claude): the model declined to answer.",
    );
  });

  it("keeps a cut-off answer, saying so, and refuses an empty cut-off one", async () => {
    answer = () =>
      Promise.resolve(
        response(200, { choices: [{ message: { content: "half" }, finish_reason: "length" }] }),
      );
    expect(await askAi(openai, "", question)).toBe(
      "half\n\n*(The answer was cut off at 8192 tokens.)*",
    );
    answer = () =>
      Promise.resolve(
        response(200, { choices: [{ message: { content: "" }, finish_reason: "length" }] }),
      );
    await expect(askAi(openai, "", question)).rejects.toThrow(/8192-token output limit/);
  });

  it("says so when there is no answer", async () => {
    answer = () => Promise.resolve(response(200, { choices: [] }));
    await expect(askAi(openai, "", question)).rejects.toThrow("OpenAI (GPT) returned no answer.");
  });
});

describe("sendVendorRequest", () => {
  it("hands back the parsed JSON of a 2xx reply", async () => {
    const json = await sendVendorRequest(openai, () => Promise.resolve(response(201, { a: 1 })));
    expect(json).toEqual({ a: 1 });
  });

  it("turns a request that never arrived into 'could not reach', with the cause", async () => {
    const failure = sendVendorRequest(openai, () =>
      Promise.reject(new ConnectionError("getaddrinfo ENOTFOUND")),
    );
    await expect(failure).rejects.toThrow(
      "could not reach OpenAI (GPT) — check your network connection. (getaddrinfo ENOTFOUND)",
    );
    await expect(sendVendorRequest(custom, () => Promise.reject(new Error("")))).rejects.toThrow(
      "could not reach your configured endpoint (box.example.ts.net) — is the server running " +
        "and reachable from this device?",
    );
  });

  it("blames the key for a named vendor's 401 and 403, and only then", async () => {
    for (const status of [401, 403]) {
      const failure = sendVendorRequest(openai, () =>
        Promise.resolve(response(status, { error: { message: "Incorrect API key provided." } })),
      );
      await expect(failure).rejects.toThrow(/^OpenAI \(GPT\) .*API key.*settings/);
    }
    const other = sendVendorRequest(openai, () =>
      Promise.resolve(response(429, { error: { message: "Rate limit reached." } })),
    );
    await expect(other).rejects.toThrow(
      "OpenAI (GPT) request failed (HTTP 429): Rate limit reached.",
    );
  });

  it("points a self-hosted 401 or 403 at the server's access rules", async () => {
    const failure = sendVendorRequest(custom, () => Promise.resolve(response(403, "")));
    await expect(failure).rejects.toThrow(
      /^your configured endpoint \(box\.example\.ts\.net\) denied the request \(HTTP 403\)\./,
    );
    await expect(failure).rejects.toThrow(/tunnel or proxy/);
    await expect(failure).rejects.toThrow(/OLLAMA_HOST=0\.0\.0\.0/);
    await expect(failure).rejects.toThrow(/network exposure/);
    await expect(failure).rejects.toThrow(/SELF_HOSTING\.md/);
  });

  it("reads an error body that is JSON, and survives one that is not", async () => {
    await expect(
      sendVendorRequest(openai, () => Promise.resolve(response(500, "Internal Server Error"))),
    ).rejects.toThrow(/^OpenAI \(GPT\) request failed \(HTTP 500\)\.$/);
    await expect(
      sendVendorRequest(openai, () => Promise.resolve(response(400, { error: { message: 7 } }))),
    ).rejects.toThrow(/^OpenAI \(GPT\) request failed \(HTTP 400\)\.$/);
  });
});

describe("labels and configuration", () => {
  it("names the vendor, or the custom endpoint's host", () => {
    expect(targetLabel(openai)).toBe("OpenAI (GPT)");
    expect(targetLabel(custom)).toBe("your configured endpoint (box.example.ts.net)");
  });

  it("refuses a missing key or URL in the settings' words", () => {
    expect(() => assertConfigured({ ...openai, apiKey: " " })).toThrow(
      "no API key set for OpenAI (GPT) — add one in FineNotes settings.",
    );
    expect(() => assertConfigured({ ...custom, baseUrl: "" })).toThrow(/no endpoint URL set/);
    expect(() => assertConfigured(custom)).not.toThrow();
  });
});
