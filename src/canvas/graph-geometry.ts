/**
 * How finely a graph element's curves are sampled: at the resolution they
 * are drawn at, bucketed so nearby zooms share one sampling (and one cached
 * set of curves). The sampling itself is the calculator's (`model/graph`).
 *
 * Pure: no DOM, no canvas.
 */

/** The narrowest and widest a curve is sampled for, device px across. */
export const GRAPH_MIN_SAMPLES = 64;
export const GRAPH_MAX_SAMPLES = 4096;

/**
 * The resolution a curve `framePx` page px wide is sampled for at `level`
 * device px per page px: its width in device px, rounded up to a power of
 * two so nearby zoom levels share one sampling.
 */
export function sampleCount(framePx: number, level: number): number {
  const device = framePx * level;
  if (!(device > 0) || !Number.isFinite(device)) return GRAPH_MIN_SAMPLES;
  const pow = 2 ** Math.ceil(Math.log2(device));
  return Math.min(GRAPH_MAX_SAMPLES, Math.max(GRAPH_MIN_SAMPLES, pow));
}
