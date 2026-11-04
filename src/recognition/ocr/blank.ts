/**
 * Whether a page image is blank: a separator page, or a scan of nothing.
 * Such a page needs no OCR (and must not make the plugin offer the model's
 * download); it is cached as read, with no words.
 *
 * PURE: no DOM, no Obsidian.
 */

/** A pixel darker than this (0..255 grey) counts as ink. */
export const INK_LEVEL = 225;
/** A page with a smaller share of ink than this is blank: dust and noise, not text. */
export const BLANK_SHARE = 0.0002;

/** A rectangle in the raster's pixels. */
export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How far a masked rectangle is widened, px: the edges of drawn text are grey too. */
const MASK_PAD = 2;

/**
 * Whether the RGBA image of `width` x `height` (a small copy of the page is
 * enough: draw it downscaled, which keeps thin text as grey) has ink
 * anywhere outside `masked` (the page's own text, which needs no reading).
 */
export function hasInkOutside(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  masked: readonly PixelRect[],
  level = INK_LEVEL,
): boolean {
  const pixels = rgba.length / 4;
  if (pixels === 0 || width <= 0) return false;
  let ink = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    // Luma; transparent pixels count as white.
    const a = rgba[i + 3] / 255;
    const grey = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
    if (!(grey < level)) continue;
    if (masked.length > 0) {
      const y = Math.floor(p / width);
      const x = p - y * width;
      if (
        masked.some(
          (r) =>
            x >= r.x0 - MASK_PAD &&
            x <= r.x1 + MASK_PAD &&
            y >= r.y0 - MASK_PAD &&
            y <= r.y1 + MASK_PAD,
        )
      ) {
        continue;
      }
    }
    ink++;
  }
  return ink / pixels >= BLANK_SHARE;
}

/** Whether the RGBA image holds no ink at all (a separator page, a scan of nothing). */
export function isBlank(rgba: Uint8ClampedArray | Uint8Array, level = INK_LEVEL): boolean {
  return !hasInkOutside(rgba, 1, [], level);
}

/** A step in luminance between neighbouring pixels at least this large is an edge: a stroke, not a smooth fill. */
export const EDGE_STEP = 40;
/** An area with a smaller share of edge pixels than this has no content: a plain, gradient or paper-textured fill. */
export const EDGE_SHARE = 0.0004;

function luma(rgba: Uint8ClampedArray | Uint8Array, i: number): number {
  const a = rgba[i + 3] / 255;
  return (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
}

/**
 * Whether the RGBA image of `width` x `height` has content outside `masked`:
 * edges (strokes of text or drawing) rather than ink. A page background, a
 * watermark or a paper texture, however dark, is smooth, so it has no edges
 * and does not count; a figure with labels does. Pixels within the masked
 * rectangles (the page's own text, other figures) are ignored.
 */
export function hasEdgesOutside(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  masked: readonly PixelRect[],
  step = EDGE_STEP,
): boolean {
  const pixels = rgba.length / 4;
  if (pixels === 0 || width <= 1) return false;
  const height = Math.floor(pixels / width);
  const covered = (x: number, y: number): boolean =>
    masked.some(
      (r) =>
        x >= r.x0 - MASK_PAD &&
        x <= r.x1 + MASK_PAD &&
        y >= r.y0 - MASK_PAD &&
        y <= r.y1 + MASK_PAD,
    );
  let edges = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const here = luma(rgba, i);
      const right = luma(rgba, i + 4);
      const below = luma(rgba, i + width * 4);
      if (Math.abs(here - right) < step && Math.abs(here - below) < step) continue;
      if (masked.length > 0 && covered(x, y)) continue;
      edges++;
    }
  }
  return edges / pixels >= EDGE_SHARE;
}
