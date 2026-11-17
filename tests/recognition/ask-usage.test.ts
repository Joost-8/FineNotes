import { describe, expect, it } from "vitest";
import {
  addReplyUsage,
  emptyUsage,
  totalTokens,
  usageCost,
  usageMark,
} from "../../src/recognition/ask-usage";

const tokens = (count: string): string => `${count} tokens`;

describe("ask usage", () => {
  it("adds up Anthropic replies over the rounds of one answer", () => {
    let usage = emptyUsage("anthropic", "claude-sonnet-5-5");
    usage = addReplyUsage(usage, "anthropic", {
      usage: { input_tokens: 5000, cache_creation_input_tokens: 0, output_tokens: 100 },
    });
    usage = addReplyUsage(usage, "anthropic", {
      usage: {
        input_tokens: 4000,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 5000,
        output_tokens: 700,
      },
    });
    expect(usage).toMatchObject({ input: 9000, cacheWrite: 1000, cacheRead: 5000, output: 800 });
    expect(totalTokens(usage)).toBe(15_800);
    // 9000 × 2 + 1000 × 2.5 + 5000 × 0.1 + 800 × 10, per million.
    expect(usageCost(usage)).toBeCloseTo(0.029, 6);
    expect(usageMark(usage, tokens)).toBe("≈ $0.03");
  });

  it("reads OpenAI's cached tokens, and uses OpenRouter's own cost when it gives one", () => {
    let usage = emptyUsage("openrouter", "google/gemini-3.5-flash");
    usage = addReplyUsage(usage, "openai", {
      usage: {
        prompt_tokens: 3000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 1000 },
        cost: 0.0042,
      },
    });
    expect(usage).toMatchObject({
      input: 2000,
      cacheRead: 1000,
      output: 200,
      reportedCost: 0.0042,
    });
    expect(usageMark(usage, tokens)).toBe("< $0.01");
  });

  it("counts Gemini's thinking as output", () => {
    const usage = addReplyUsage(emptyUsage("google", "gemini-3.5-flash"), "google", {
      usageMetadata: {
        promptTokenCount: 12_000,
        cachedContentTokenCount: 2000,
        candidatesTokenCount: 300,
        thoughtsTokenCount: 700,
      },
    });
    expect(usage).toMatchObject({ input: 10_000, cacheRead: 2000, output: 1000 });
    // No price kept for Gemini: tokens, not a guess.
    expect(usageCost(usage)).toBeNull();
    expect(usageMark(usage, tokens)).toBe("13k tokens");
  });

  it("finds a dated or longer model id by its model, never a shorter one's price", () => {
    const at = (model: string) => ({
      ...emptyUsage("anthropic", model),
      input: 1_000_000,
    });
    expect(usageCost(at("claude-opus-5-5"))).toBe(4);
    expect(usageCost(at("claude-opus-5"))).toBe(5);
    expect(usageCost(at("claude-haiku-4-5-20251001"))).toBe(1);
    expect(usageCost(at("claude-sonnet-5-5"))).toBe(2);
    expect(usageCost(at("claude-3-opus"))).toBeNull();
  });

  it("shows nothing for a server of the user's own, or a reply without usage", () => {
    const own = { ...emptyUsage("custom", "qwen"), input: 500 };
    expect(usageMark(own, tokens)).toBeNull();
    expect(usageMark(undefined, tokens)).toBeNull();
    expect(usageMark(emptyUsage("anthropic", "claude-sonnet-5-5"), tokens)).toBeNull();
    expect(addReplyUsage(emptyUsage("openai", "x"), "openai", "garbage")).toEqual(
      emptyUsage("openai", "x"),
    );
  });

  it("shortens large counts", () => {
    const at = (input: number) => ({ ...emptyUsage("openai", "gpt-x"), input });
    expect(usageMark(at(950), tokens)).toBe("950 tokens");
    expect(usageMark(at(1_234_567), tokens)).toBe("1.2M tokens");
    const dollars = { ...emptyUsage("anthropic", "claude-opus-5-5"), output: 100_000 };
    expect(usageMark(dollars, tokens)).toBe("≈ $2.00");
  });
});
