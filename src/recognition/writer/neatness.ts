/**
 * Beautify's neatness dial: where its slider sits (0 "most like my ink",
 * 0.5 the middle, 1 "neatest") as how far the written line is straightened
 * (`straighten.ts`: the share of the way each pen-lift unit goes to its
 * word's foot line and to the line's own lean).
 *
 * The dial used to move the model's guidance (1.2 to 0.75; Joost's mapping
 * of 24 November 2026). Measured the next day (research/handwriting-rig/
 * RESEARCH-LOG.md, 25 November): guidance changes whose hand it is, not how
 * even the line is. At 0.75 a line reads better and is less the writer's,
 * and no more even; straightening what was written makes it even and keeps
 * the hand. So the model writes at its own guidance everywhere, and the
 * dial is the straightening (Joost, 25 November). Words are always set flat
 * and level; the dial is how far the letters follow.
 *
 * PURE: no DOM, no Obsidian.
 */

/** The slider's middle. */
export const NEATNESS_DEFAULT = 0.5;

/** How far the letters are straightened at the two ends (the middle is halfway: 0.7). */
export const LIKE_MY_INK = 0.4;
export const NEATEST = 1;

/** The slider's stops: like my ink, between, the middle, between, neatest. */
export const NEATNESS_STEPS = 4;

/** `value` held to the dial, with anything not a number read as the default. */
export function neatnessOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return NEATNESS_DEFAULT;
  return Math.min(1, Math.max(0, value));
}

/** How far the letters of a written line are straightened at slider position `neatness`. */
export function strengthAt(neatness: number): number {
  return LIKE_MY_INK + (NEATEST - LIKE_MY_INK) * neatnessOf(neatness);
}

/**
 * The guidance a line is written at, at any slider position: the model's
 * own (`base`). The dial no longer moves it; everything that writes in the
 * hand (Beautify, known text) still asks here, so one place says so.
 */
export function guidanceAt(_neatness: number, base: number): number {
  return base;
}
