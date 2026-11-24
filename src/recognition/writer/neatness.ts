/**
 * Beautify's neatness dial: where its slider sits (0 "most like my ink",
 * 0.5 the model's own, 1 "neatest") as the guidance the writer samples at.
 *
 * Guidance is the style dial (research/handwriting-rig/RESEARCH-LOG.md,
 * 24 November 21:00): lower guidance writes a plainer, smaller hand and
 * likeness falls; higher keeps more of the writer. Joost's mapping for C2
 * (guidance 1.0 by default): about 1.2 at "most like my ink", 0.75 at
 * "neatest". The ends are taken as shares of the model's guidance, so a
 * model whose own guidance differs (A long's 1.5) gets the same dial.
 * Below 1 the sampler also mixes the curve counts toward none's
 * (`sampler.ts` `WriteOptions.guidance`).
 *
 * PURE: no DOM, no Obsidian.
 */

/** The slider's middle: the model's own guidance. */
export const NEATNESS_DEFAULT = 0.5;

/** Guidance at the two ends, as shares of the model's own. */
export const LIKE_MY_INK = 1.2;
export const NEATEST = 0.75;

/** The slider's stops: like my ink, between, the model's own, between, neatest. */
export const NEATNESS_STEPS = 4;

/** `value` held to the dial, with anything not a number read as the default. */
export function neatnessOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return NEATNESS_DEFAULT;
  return Math.min(1, Math.max(0, value));
}

/** The guidance at slider position `neatness` for a model whose own guidance is `base`. */
export function guidanceAt(neatness: number, base: number): number {
  const p = neatnessOf(neatness);
  const share =
    p <= NEATNESS_DEFAULT
      ? LIKE_MY_INK + (1 - LIKE_MY_INK) * (p / NEATNESS_DEFAULT)
      : 1 + (NEATEST - 1) * ((p - NEATNESS_DEFAULT) / (1 - NEATNESS_DEFAULT));
  return base * share;
}
