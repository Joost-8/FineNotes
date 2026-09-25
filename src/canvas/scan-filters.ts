/**
 * The scan sheet's clean-up filters — Colour, Greyscale, Black & white —
 * applied in place to a straightened scan. Pure, so each is tested on
 * synthetic pages with known paper, ink and shadows.
 *
 * - **Colour** stretches levels so the paper turns white and the ink deep,
 *   and white-balances on the paper (a yellowish indoor cast goes neutral).
 * - **Greyscale** is luma, then the same stretch.
 * - **Black & white** thresholds each pixel against the mean of its own
 *   neighbourhood (Bradley–Roth, via an integral image), not against one
 *   global level: a shadow across half the page lowers the paper *and* its
 *   local mean together, so the shaded half stays white instead of going
 *   black the way a global threshold would take it.
 */

import { type RgbaImage, lumaOf } from "./scan-raster";

export type ScanFilter = "colour" | "greyscale" | "bw";

/** The filters in the order the sheet offers them, with their labels. */
export const SCAN_FILTERS: ReadonlyArray<{ id: ScanFilter; label: string }> = [
  { id: "colour", label: "Colour" },
  { id: "greyscale", label: "Greyscale" },
  { id: "bw", label: "Black & white" },
];

/** Whether `value` names a filter (for a remembered choice read back from storage). */
export function isScanFilter(value: unknown): value is ScanFilter {
  return SCAN_FILTERS.some((f) => f.id === value);
}

/** Luma histogram, 256 bins. */
export function lumaHistogram(img: RgbaImage): Uint32Array {
  const hist = new Uint32Array(256);
  const luma = lumaOf(img);
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++;
  return hist;
}

/** The smallest value at or below which a fraction `p` of `total` tallied values lie. */
export function histogramPercentile(hist: ArrayLike<number>, total: number, p: number): number {
  let seen = 0;
  const target = Math.max(1, total * p);
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return 255;
}

/** A levels stretch: `black` maps to 0 and each channel's `white` to 255. */
export interface Levels {
  black: number;
  white: [number, number, number];
}

/** Fraction of pixels allowed to clip to black (the darkest ink). */
const BLACK_PERCENTILE = 0.01;
/** Pixels within this many levels of the paper's luma count as paper for white balance. */
const PAPER_BAND = 8;
/** A picture with less tonal range than this is left alone: stretching it only amplifies noise. */
const MIN_RANGE = 40;

/**
 * Levels that whiten the paper: black at the 1st percentile of luma; the
 * paper's own tone as white. The paper is the most common tone in the upper
 * half of the histogram (smoothed over 5 levels), and each channel's white
 * point is the mean of that channel over pixels within {@link PAPER_BAND} of
 * it — which both whitens and white-balances the paper. `null` when the
 * picture is too flat to stretch.
 */
export function planLevels(img: RgbaImage): Levels | null {
  const n = img.width * img.height;
  const luma = lumaOf(img);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[luma[i]]++;
  const black = histogramPercentile(hist, n, BLACK_PERCENTILE);
  const median = histogramPercentile(hist, n, 0.5);
  let paper = median;
  let peak = -1;
  for (let v = median; v < 256; v++) {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += hist[Math.max(0, Math.min(255, v + k))];
    if (sum > peak) {
      peak = sum;
      paper = v;
    }
  }
  if (paper - black < MIN_RANGE) return null;
  const sum = [0, 0, 0];
  let count = 0;
  const d = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (Math.abs(luma[i] - paper) > PAPER_BAND) continue;
    sum[0] += d[p];
    sum[1] += d[p + 1];
    sum[2] += d[p + 2];
    count++;
  }
  const white = sum.map((s) => Math.max(black + MIN_RANGE / 2, count ? s / count : paper)) as [
    number,
    number,
    number,
  ];
  return { black, white };
}

/** Apply `levels` in place, per channel through a lookup table. Alpha is untouched. */
export function applyLevels(img: RgbaImage, levels: Levels): void {
  const luts = levels.white.map((white) => {
    const lut = new Uint8ClampedArray(256);
    const span = Math.max(1, white - levels.black);
    for (let v = 0; v < 256; v++) lut[v] = ((v - levels.black) * 255) / span;
    return lut;
  });
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    d[p] = luts[0][d[p]];
    d[p + 1] = luts[1][d[p + 1]];
    d[p + 2] = luts[2][d[p + 2]];
  }
}

/** Replace every pixel by its luma, in place. */
export function toGreyscale(img: RgbaImage): void {
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const y = (77 * d[p] + 150 * d[p + 1] + 29 * d[p + 2]) >> 8;
    d[p] = y;
    d[p + 1] = y;
    d[p + 2] = y;
  }
}

export interface ThresholdOptions {
  /** Neighbourhood radius as a fraction of the long side. Default 1/40 (51 px at 2048). */
  radiusFraction?: number;
  /** How far below its neighbourhood's mean a pixel must be to count as ink. Default 0.12. */
  sensitivity?: number;
}

/**
 * Black & white by adaptive thresholding (Bradley–Roth), in place: a pixel
 * is ink when its luma is more than `sensitivity` below the mean of the
 * square around it. The means come from an integral image, so the cost does
 * not depend on the window size.
 *
 * The window is a trade-off the numbers came from: big enough that a thick
 * marker stroke is not hollowed out, small enough to follow a shadow's edge.
 * Across a hard shadow line a band about one radius wide can still go dark.
 */
export function adaptiveThreshold(img: RgbaImage, options: ThresholdOptions = {}): void {
  const w = img.width;
  const h = img.height;
  const luma = lumaOf(img);
  const r = Math.max(4, Math.round(Math.max(w, h) * (options.radiusFraction ?? 1 / 40)));
  const keep = 1 - (options.sensitivity ?? 0.12);
  // Sums reach 255·w·h: past 2³² for a picture over ~16.8 MP, so switch.
  const stride = w + 1;
  const integral =
    255 * w * h < 2 ** 32 ? new Uint32Array(stride * (h + 1)) : new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += luma[y * w + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum =
        integral[y1 * stride + x1] -
        integral[y0 * stride + x1] -
        integral[y1 * stride + x0] +
        integral[y0 * stride + x0];
      const area = (x1 - x0) * (y1 - y0);
      const i = y * w + x;
      const v = luma[i] * area < sum * keep ? 0 : 255;
      const p = i * 4;
      d[p] = v;
      d[p + 1] = v;
      d[p + 2] = v;
    }
  }
}

/** Apply one of the sheet's filters to a straightened scan, in place. */
export function applyScanFilter(img: RgbaImage, filter: ScanFilter): void {
  if (filter === "bw") {
    adaptiveThreshold(img);
    return;
  }
  if (filter === "greyscale") toGreyscale(img);
  const levels = planLevels(img);
  if (levels) applyLevels(img, levels);
}
