/**
 * The pixel buffer the document scanner works on, and the few whole-image
 * operations it needs before straightening: an area-averaging downscale, a
 * quarter turn, and luma. Pure — no DOM, no canvas — so every step of a scan
 * can be tested on synthetic pictures.
 *
 * An {@link RgbaImage} has exactly the layout of `ImageData` (4 bytes per
 * pixel, row-major, no padding), so the view moves pixels in and out of a
 * canvas with one `getImageData` / `putImageData` and no conversion.
 */

import { fitLongSide } from "./image-raster";

/** An RGBA raster in `ImageData`'s layout. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** A point in a raster's continuous pixel space: (0, 0) is the top-left pixel's top-left edge. */
export interface Point {
  x: number;
  y: number;
}

/** A blank (transparent black) raster of the given size, at least 1 × 1. */
export function createRgba(width: number, height: number): RgbaImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

/**
 * Per-output-pixel source taps for an area-average resample of one axis:
 * output pixel `i` covers source span `[i·r, (i+1)·r)` with `r = from/to`,
 * and each source pixel it overlaps is weighted by the overlap. Stored flat,
 * `stride` taps per output pixel, unused taps weighted 0.
 */
interface AxisTaps {
  stride: number;
  index: Int32Array;
  weight: Float32Array;
}

function axisTaps(from: number, to: number): AxisTaps {
  const r = from / to;
  const stride = Math.ceil(r) + 1;
  const index = new Int32Array(to * stride);
  const weight = new Float32Array(to * stride);
  for (let i = 0; i < to; i++) {
    const a = i * r;
    const b = Math.min(from, (i + 1) * r);
    let k = 0;
    for (let j = Math.floor(a); j < b && k < stride; j++, k++) {
      const overlap = Math.min(b, j + 1) - Math.max(a, j);
      index[i * stride + k] = Math.min(from - 1, j);
      weight[i * stride + k] = overlap / (b - a);
    }
  }
  return { stride, index, weight };
}

/**
 * Resample `src` to exactly `width × height` by area averaging: every output
 * pixel is the mean of the source area it covers. That is the right filter
 * for shrinking a photo — bilinear sampling at a 4:1 ratio reads one source
 * pixel in four and makes text shimmer — and it works row by row, so a
 * 2560 px photo never needs a second full-size float buffer on an iPad.
 */
export function resizeRgba(src: RgbaImage, width: number, height: number): RgbaImage {
  const out = createRgba(width, height);
  const ow = out.width;
  const oh = out.height;
  const sw = src.width;
  const cols = axisTaps(sw, ow);
  const rows = axisTaps(src.height, oh);
  const row = new Float32Array(ow * 4);
  const acc = new Float32Array(ow * 4);
  const s = src.data;
  const d = out.data;

  for (let y = 0; y < oh; y++) {
    acc.fill(0);
    for (let k = 0; k < rows.stride; k++) {
      const wy = rows.weight[y * rows.stride + k];
      if (wy === 0) continue;
      const sy = rows.index[y * rows.stride + k];
      // Horizontal pass over source row `sy` into `row`.
      const base = sy * sw * 4;
      for (let x = 0; x < ow; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let t = 0; t < cols.stride; t++) {
          const wx = cols.weight[x * cols.stride + t];
          if (wx === 0) continue;
          const p = base + cols.index[x * cols.stride + t] * 4;
          r += s[p] * wx;
          g += s[p + 1] * wx;
          b += s[p + 2] * wx;
          a += s[p + 3] * wx;
        }
        const q = x * 4;
        row[q] = r;
        row[q + 1] = g;
        row[q + 2] = b;
        row[q + 3] = a;
      }
      for (let q = 0; q < acc.length; q++) acc[q] += row[q] * wy;
    }
    const o = y * ow * 4;
    // A Uint8ClampedArray rounds on assignment; adding ½ first would bias it.
    for (let q = 0; q < acc.length; q++) d[o + q] = acc[q];
  }
  return out;
}

/**
 * `src` shrunk so its long side is at most `maxLongSide`, by area averaging.
 * Returns `src` itself when it already fits — callers must not mutate the
 * result in place unless they own `src` too.
 */
export function downscaleRgba(src: RgbaImage, maxLongSide: number): RgbaImage {
  const fit = fitLongSide(src.width, src.height, maxLongSide);
  if (fit.width === src.width && fit.height === src.height) return src;
  return resizeRgba(src, fit.width, fit.height);
}

/** A 32-bit view of an RGBA buffer, one element per pixel. */
function pixels32(img: RgbaImage): Uint32Array {
  return new Uint32Array(img.data.buffer, img.data.byteOffset, img.width * img.height);
}

/**
 * `src` turned a quarter clockwise (or counter-clockwise): a `w × h` picture
 * becomes `h × w`. Moves whole pixels, so it is exact and cheap — the scan
 * sheet's Rotate button for a photo whose orientation came out wrong.
 */
export function rotateRgba90(src: RgbaImage, clockwise = true): RgbaImage {
  const w = src.width;
  const h = src.height;
  const out = createRgba(h, w);
  const from = pixels32(src);
  const to = pixels32(out);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      // Clockwise: (x, y) lands at column h-1-y of row x.
      // Counter-clockwise: at column y of row w-1-x.
      const at = clockwise ? x * h + (h - 1 - y) : (w - 1 - x) * h + y;
      to[at] = from[row + x];
    }
  }
  return out;
}

/**
 * Where point `p` of a `width × height` raster lands after
 * {@link rotateRgba90}. Continuous coordinates, so a corner handle on a
 * pixel edge stays on that edge.
 */
export function rotatePoint90(p: Point, width: number, height: number, clockwise = true): Point {
  return clockwise ? { x: height - p.y, y: p.x } : { x: p.y, y: width - p.x };
}

/**
 * Composite `img` over white, in place, leaving it opaque. A scan is saved as
 * JPEG, which has no alpha and would show a transparent screenshot's
 * see-through parts as black; and the filters read only colour, so they
 * must see what the page will actually look like.
 */
export function flattenOnWhite(img: RgbaImage): void {
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const a = d[p + 3];
    if (a === 255) continue;
    const k = a / 255;
    const white = 255 * (1 - k);
    d[p] = d[p] * k + white;
    d[p + 1] = d[p + 1] * k + white;
    d[p + 2] = d[p + 2] * k + white;
    d[p + 3] = 255;
  }
}

/**
 * Rec. 601 luma of every pixel, `0..255` — `(77 R + 150 G + 29 B) / 256`,
 * the integer weights every JPEG decoder uses. Alpha is ignored.
 */
export function lumaOf(src: RgbaImage): Uint8Array {
  const n = src.width * src.height;
  const out = new Uint8Array(n);
  const d = src.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = (77 * d[p] + 150 * d[p + 1] + 29 * d[p + 2]) >> 8;
  }
  return out;
}
