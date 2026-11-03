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

/**
 * Whether the RGBA image (a small copy of the page is enough: draw it
 * downscaled, which keeps thin text as grey) holds no ink.
 */
export function isBlank(rgba: Uint8ClampedArray | Uint8Array, level = INK_LEVEL): boolean {
  const pixels = rgba.length / 4;
  if (pixels === 0) return true;
  let ink = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    // Luma; transparent pixels count as white.
    const a = rgba[i + 3] / 255;
    const grey = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
    if (grey < level) ink++;
  }
  return ink / pixels < BLANK_SHARE;
}
