/**
 * Which model a text request goes to (FineNotes#265): page transcription
 * may use a model of its own, cheaper than the one Ask AI answers with, and
 * a request the model turned down for its rate limit or quota is sent once
 * more to the fallback model, when the settings name one. Both are models
 * of the same service, so the same key and the same consent cover them.
 *
 * No DOM, no Obsidian, no network: the caller sends.
 */

import { type LlmVendor, defaultModelFor } from "./llm-request";

/**
 * A reply with a failing status. Its message is the one the user sees; the
 * status and the service's own words are kept for {@link isQuotaFailure}.
 */
export class VendorStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(message);
  }
}

/** The model page transcription uses: its own when one is set, else the AI model. */
export function transcriptionModel(aiModel: string, transcribeModel: string): string {
  return transcribeModel.trim() || aiModel;
}

/**
 * Statuses that mean "not now, not this model" rather than "this request is
 * wrong": 429 is every service's rate limit and spent quota (OpenAI's
 * `insufficient_quota`, Gemini's `RESOURCE_EXHAUSTED`), 402 is OpenRouter's
 * spent credits (a free model still answers), 529 is Anthropic's overloaded.
 */
const QUOTA_STATUSES = new Set([402, 429, 529]);

/** The service's words for the same, under another status. */
const QUOTA_WORDS = /quota|rate[ _-]?limit|resource[ _-]?exhausted|insufficient[ _-]?credits/i;

/**
 * Whether a failure is one another model of the same service may not have:
 * a rate limit, a spent quota or credit, an overloaded model. A wrong key
 * (401, 403 without such words) or a malformed request is not: the
 * fallback would fail the same way, and cost a second request to learn it.
 */
export function isQuotaFailure(status: number, detail: string): boolean {
  if (status < 400) return false;
  return QUOTA_STATUSES.has(status) || QUOTA_WORDS.test(detail);
}

/** What a request's model is chosen from. */
export interface ModelChoice {
  vendor: LlmVendor;
  /** Empty for the vendor's default. */
  model: string;
  /** Empty or absent: no fallback. */
  fallbackModel?: string;
}

/**
 * The model to try after `config.model` was turned down, or null when
 * there is none: no fallback set, or the fallback is the model that just
 * failed (empty means the vendor's default on both sides).
 */
export function fallbackModelOf(config: ModelChoice): string | null {
  const fallback = config.fallbackModel?.trim() ?? "";
  if (!fallback) return null;
  const tried = config.model.trim() || defaultModelFor(config.vendor);
  return fallback === tried ? null : fallback;
}

/** Whether `error` is a turned-down request that the fallback model should get. */
export function shouldFallBack(config: ModelChoice, error: unknown): boolean {
  return (
    error instanceof VendorStatusError &&
    isQuotaFailure(error.status, error.detail) &&
    fallbackModelOf(config) !== null
  );
}

/**
 * Run `send` with `config`'s model and, when the service turns it down for
 * its rate limit or quota and a fallback is set, once more with the
 * fallback model. Exactly one retry: the fallback's own failure is the
 * error the user sees, with nothing tried after it.
 */
export async function withModelFallback<C extends ModelChoice, T>(
  config: C,
  send: (config: C) => Promise<T>,
): Promise<T> {
  try {
    return await send(config);
  } catch (error) {
    if (!shouldFallBack(config, error)) throw error;
    return send({ ...config, model: fallbackModelOf(config) ?? config.model, fallbackModel: "" });
  }
}
