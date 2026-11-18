/**
 * What an Ask AI answer cost: the tokens each reply reports, added up over
 * the tool rounds of one question, and, for the models whose price is known,
 * an estimate in dollars. Shown as a small mark under the answer; never sent.
 *
 * Prices are list prices per million tokens and change: an unknown model
 * shows tokens instead of a guess. OpenRouter reports what a request cost
 * itself (`usage.cost`), which is used as given. A server of the user's own
 * shows nothing: it costs nothing per token.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import { type LlmDialect, type LlmVendor, isRecord } from "./llm-request";

export interface AskUsage {
  vendor: LlmVendor;
  model: string;
  /** Input tokens at the full price (on Anthropic, including those written to the cache). */
  input: number;
  /** Input tokens read from the cache, at its lower price. */
  cacheRead: number;
  /** Input tokens written to the cache (Anthropic), at a quarter more. */
  cacheWrite: number;
  /** Output tokens, thinking included. */
  output: number;
  /** Dollars, when the vendor said (OpenRouter). */
  reportedCost?: number;
}

export function emptyUsage(vendor: LlmVendor, model: string): AskUsage {
  return { vendor, model, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** `usage` plus what one reply reports, in its dialect's shape. */
export function addReplyUsage(usage: AskUsage, dialect: LlmDialect, reply: unknown): AskUsage {
  if (!isRecord(reply)) return usage;
  const next = { ...usage };
  if (dialect === "anthropic" && isRecord(reply.usage)) {
    const u = reply.usage;
    next.input += num(u.input_tokens);
    next.cacheWrite += num(u.cache_creation_input_tokens);
    next.cacheRead += num(u.cache_read_input_tokens);
    next.output += num(u.output_tokens);
  } else if (dialect === "openai" && isRecord(reply.usage)) {
    const u = reply.usage;
    const cached = isRecord(u.prompt_tokens_details)
      ? num(u.prompt_tokens_details.cached_tokens)
      : 0;
    next.input += Math.max(0, num(u.prompt_tokens) - cached);
    next.cacheRead += cached;
    next.output += num(u.completion_tokens);
    if (typeof u.cost === "number" && Number.isFinite(u.cost) && u.cost >= 0) {
      next.reportedCost = (next.reportedCost ?? 0) + u.cost;
    }
  } else if (dialect === "google" && isRecord(reply.usageMetadata)) {
    const u = reply.usageMetadata;
    const cached = num(u.cachedContentTokenCount);
    next.input += Math.max(0, num(u.promptTokenCount) - cached);
    next.cacheRead += cached;
    next.output += num(u.candidatesTokenCount) + num(u.thoughtsTokenCount);
  }
  return next;
}

/** Dollars per million tokens: input, output, cache read. Cache writes cost 1.25 × input. */
type Price = readonly [input: number, output: number, cacheRead: number];

/** Anthropic's list prices (2026-11). Longest prefix wins, so a dated id finds its model. */
const ANTHROPIC_PRICES: ReadonlyArray<readonly [string, Price]> = [
  ["claude-fable-5-2", [8, 40, 0.2]],
  ["claude-fable-5-1", [10, 50, 1]],
  ["claude-fable-5", [10, 50, 1]],
  ["claude-opus-5-5", [4, 20, 0.2]],
  ["claude-opus-5", [5, 25, 0.5]],
  ["claude-opus-4-8", [5, 25, 0.5]],
  ["claude-opus-4-7", [5, 25, 0.5]],
  ["claude-opus-4-6", [5, 25, 0.5]],
  ["claude-sonnet-5-5", [2, 10, 0.1]],
  ["claude-sonnet-5", [2, 10, 0.2]],
  ["claude-sonnet-4-6", [3, 15, 0.3]],
  ["claude-haiku-5-5", [0.1, 0.5, 0.01]],
  ["claude-haiku-4-5", [1, 5, 0.1]],
];

function priceOf(vendor: LlmVendor, model: string): Price | null {
  if (vendor !== "anthropic") return null;
  const id = model.trim().toLowerCase();
  let best: (typeof ANTHROPIC_PRICES)[number] | null = null;
  for (const entry of ANTHROPIC_PRICES) {
    const [prefix] = entry;
    if ((id === prefix || id.startsWith(`${prefix}-`)) && (!best || prefix.length > best[0].length))
      best = entry;
  }
  return best ? best[1] : null;
}

/** The estimate in dollars, or null when the price is not known. */
export function usageCost(usage: AskUsage): number | null {
  if (usage.reportedCost !== undefined) return usage.reportedCost;
  const price = priceOf(usage.vendor, usage.model);
  if (!price) return null;
  const [input, output, cacheRead] = price;
  return (
    (usage.input * input +
      usage.cacheWrite * input * 1.25 +
      usage.cacheRead * cacheRead +
      usage.output * output) /
    1_000_000
  );
}

export function totalTokens(usage: AskUsage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
}

/**
 * The mark under an answer: "≈ $0.04", "< $0.01", or `tokensText("12k")`
 * ("12k tokens" in the interface's language) for a model whose price is
 * not known; null for nothing to show (a server of the
 * user's own, or a reply that reported no usage).
 */
export function usageMark(
  usage: AskUsage | undefined,
  tokensText: (count: string) => string,
): string | null {
  if (!usage || usage.vendor === "custom") return null;
  const tokens = totalTokens(usage);
  if (tokens === 0 && usage.reportedCost === undefined) return null;
  const cost = usageCost(usage);
  if (cost === null) return tokensText(compact(tokens));
  if (cost < 0.01) return "< $0.01";
  return `≈ $${cost.toFixed(2)}`;
}

/** 950 → "950", 12_345 → "12k", 1_234_567 → "1.2M". */
function compact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
