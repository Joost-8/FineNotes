/**
 * `model-choice.ts` (FineNotes#265): transcription's own model, and the one
 * retry with the fallback model when a service turns a request down for its
 * rate limit or quota.
 */

import { describe, expect, it } from "vitest";
import {
  VendorStatusError,
  fallbackModelOf,
  isQuotaFailure,
  shouldFallBack,
  transcriptionModel,
  withModelFallback,
} from "../../src/recognition/model-choice";
import { defaultModelFor } from "../../src/recognition/llm-request";

describe("transcriptionModel", () => {
  it("is the AI model while transcription has none of its own", () => {
    expect(transcriptionModel("claude-sonnet-4-5", "")).toBe("claude-sonnet-4-5");
    expect(transcriptionModel("claude-sonnet-4-5", "   ")).toBe("claude-sonnet-4-5");
    expect(transcriptionModel("", "")).toBe("");
  });

  it("is transcription's own model once one is set, trimmed", () => {
    expect(transcriptionModel("claude-sonnet-4-5", " claude-haiku-4-5 ")).toBe("claude-haiku-4-5");
    expect(transcriptionModel("", "gpt-4.1-mini")).toBe("gpt-4.1-mini");
  });
});

describe("isQuotaFailure", () => {
  it("counts rate limits, spent quota or credits, and an overloaded model", () => {
    expect(isQuotaFailure(429, "")).toBe(true);
    expect(isQuotaFailure(402, "Insufficient credits")).toBe(true);
    expect(isQuotaFailure(529, "Overloaded")).toBe(true);
  });

  it("counts the service's own words under another status", () => {
    expect(isQuotaFailure(403, "You exceeded your current quota")).toBe(true);
    expect(isQuotaFailure(400, "RESOURCE_EXHAUSTED")).toBe(true);
    expect(isQuotaFailure(503, "rate limited upstream")).toBe(true);
    expect(isQuotaFailure(400, "rate_limit_error")).toBe(true);
  });

  it("does not count a wrong key, a bad request or a missing model", () => {
    expect(isQuotaFailure(401, "invalid x-api-key")).toBe(false);
    expect(isQuotaFailure(403, "")).toBe(false);
    expect(isQuotaFailure(400, "messages: field required")).toBe(false);
    expect(isQuotaFailure(404, "model not found")).toBe(false);
    expect(isQuotaFailure(500, "")).toBe(false);
  });

  it("never counts a success", () => {
    expect(isQuotaFailure(200, "quota")).toBe(false);
  });
});

describe("fallbackModelOf", () => {
  it("is null without a fallback", () => {
    expect(fallbackModelOf({ vendor: "anthropic", model: "x" })).toBeNull();
    expect(fallbackModelOf({ vendor: "anthropic", model: "x", fallbackModel: "  " })).toBeNull();
  });

  it("is the fallback, trimmed", () => {
    expect(fallbackModelOf({ vendor: "openrouter", model: "a", fallbackModel: " b " })).toBe("b");
  });

  it("is null when the fallback is the model that failed, the default included", () => {
    expect(fallbackModelOf({ vendor: "openai", model: "a", fallbackModel: "a" })).toBeNull();
    const fallbackModel = defaultModelFor("google");
    expect(fallbackModelOf({ vendor: "google", model: "", fallbackModel })).toBeNull();
  });

  it("is the default's alternative when the model is the default", () => {
    expect(fallbackModelOf({ vendor: "google", model: "", fallbackModel: "other" })).toBe("other");
  });
});

describe("shouldFallBack", () => {
  const config = { vendor: "openrouter" as const, model: "a", fallbackModel: "b" };

  it("is true only for a turned-down request with a fallback to go to", () => {
    expect(shouldFallBack(config, new VendorStatusError("m", 429, ""))).toBe(true);
    expect(shouldFallBack(config, new VendorStatusError("m", 401, ""))).toBe(false);
    expect(shouldFallBack(config, new Error("unreachable"))).toBe(false);
    expect(
      shouldFallBack({ ...config, fallbackModel: "" }, new VendorStatusError("m", 429, "")),
    ).toBe(false);
  });
});

describe("withModelFallback", () => {
  const config = { vendor: "openrouter" as const, model: "a", fallbackModel: "b", apiKey: "k" };

  it("sends once when the model answers", async () => {
    const models: string[] = [];
    const result = await withModelFallback(config, (c) => {
      models.push(c.model);
      return Promise.resolve(`from ${c.model}`);
    });
    expect(result).toBe("from a");
    expect(models).toEqual(["a"]);
  });

  it("sends once more, to the fallback with the rest kept, after a rate limit", async () => {
    const seen: (typeof config)[] = [];
    const result = await withModelFallback(config, (c) => {
      seen.push(c);
      if (c.model === "a") return Promise.reject(new VendorStatusError("busy", 429, ""));
      return Promise.resolve(`from ${c.model}`);
    });
    expect(result).toBe("from b");
    expect(seen.map((c) => c.model)).toEqual(["a", "b"]);
    expect(seen[1]).toMatchObject({ vendor: "openrouter", apiKey: "k", fallbackModel: "" });
  });

  it("retries exactly once: the fallback's own failure is the error", async () => {
    let calls = 0;
    const failure = new VendorStatusError("still busy", 429, "");
    await expect(
      withModelFallback(config, () => {
        calls++;
        return Promise.reject(calls === 1 ? new VendorStatusError("busy", 429, "") : failure);
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(2);
  });

  it("does not retry other failures", async () => {
    let calls = 0;
    const failure = new VendorStatusError("bad key", 401, "");
    await expect(
      withModelFallback(config, () => {
        calls++;
        return Promise.reject(failure);
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
  });
});
