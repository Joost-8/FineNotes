/**
 * What every flow-matching writer kind (A long's "dual", C2's "pieces")
 * reads from its manifest: row statistics, reference size and the sampling
 * section, checked once here and handed to the sampler as a
 * {@link WriterMeta}.
 *
 * PURE: no DOM, no Obsidian.
 */

import { type WriterManifest, isCount, isNum } from "./manifest";
import type { WriterMeta } from "./sampler";
import { need } from "./tensors";

/** Tries of a line when the manifest does not say (A long's recipe: best of 3). */
export const DEFAULT_TRIES = 3;

/** Why a flow-matching kind cannot run `m`'s shared sections; null when it can. */
export function flowCheck(m: WriterManifest): string | null {
  const { rows, reference, sampling: s } = m;
  if (
    !Array.isArray(rows.mean) ||
    !Array.isArray(rows.std) ||
    rows.mean.length !== rows.channels ||
    rows.std.length !== rows.channels ||
    !rows.mean.every(isNum) ||
    !rows.std.every((v) => isNum(v) && v > 0)
  )
    return "rows mean and std";
  if (!isCount(reference.curves) || !isNum(reference.hold) || reference.hold < 0)
    return "reference curves and hold";
  if (
    !s ||
    !isCount(s.steps) ||
    !isCount(s.maxDur) ||
    ![s.sigma, s.guidance, s.lowGuidance, s.lowMix].every(isNum) ||
    (s.tries !== undefined && !isCount(s.tries))
  )
    return "sampling";
  return null;
}

/** The sampler's numbers, from a manifest a flow-matching kind has checked. */
export function samplerMeta(m: WriterManifest): WriterMeta {
  const s = need(m.sampling, "sampling");
  return {
    chars: m.chars,
    mean: need(m.rows.mean, "rows.mean"),
    std: need(m.rows.std, "rows.std"),
    maxDur: s.maxDur,
    refCurves: need(m.reference.curves, "reference.curves"),
    steps: s.steps,
    sigma: s.sigma,
    guidance: s.guidance,
    lowGuidance: s.lowGuidance,
    lowMix: s.lowMix,
    hold: need(m.reference.hold, "reference.hold"),
    refLines: m.reference.lines,
  };
}
