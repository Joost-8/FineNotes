/**
 * The eyedropper's decisions: what colour a tap on the page picks.
 *
 * A tap on something the note stores with a colour (ink, a shape, a text
 * box) picks that element's stored colour, exactly. Anywhere else (the
 * paper, a picture, a PDF page) the pixels under the tap are averaged over a
 * small square in device px, so a single anti-aliased or dithered pixel does
 * not decide it.
 *
 * Dark pages are a view (`./night`): what is painted there is inverted, the
 * note's colours are not. The stored colour is never the night-mapped one by
 * construction; for pixels the surface samples a fresh render of the square
 * on light paper ({@link EYEDROP_THEME}), so a picture, a PDF page or the
 * paper give the colours they have by day, never their night form. Mapping
 * a night pixel back was the alternative, and is not exact: a PDF page is
 * inverted by compositing, which is not the inverse of the ink's curve, and
 * a colour already at the night band's ends cannot be told apart.
 *
 * PURE: no DOM, no Obsidian.
 */

import { parseHexColor } from "../model/colors";

/** How far the averaged square reaches from the tapped pixel, in device px: a 5 × 5 square. */
export const EYEDROP_RADIUS_PX = 2;

/** How near ink must be to the tap, in screen px, to count as a tap on it. */
export const EYEDROP_REACH_PX = 3;

/** The paper theme a sampled pixel is painted in: always the day's. */
export const EYEDROP_THEME = "light";

export interface EyedropResult {
  /** `#rrggbb`. */
  color: string;
  /** The element's stored colour, or the averaged pixels. */
  source: "element" | "pixel";
}

/** The square of device px averaged round the tapped one: its top-left corner and side. */
export function eyedropSquare(
  x: number,
  y: number,
  radius = EYEDROP_RADIUS_PX,
): { x: number; y: number; size: number } {
  const r = Math.max(0, Math.floor(radius));
  return { x: Math.floor(x) - r, y: Math.floor(y) - r, size: 2 * r + 1 };
}

function byte(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, "0");
}

/**
 * The mean colour of RGBA pixels (as `ImageData.data` holds them), each
 * weighted by its alpha, as `#rrggbb`; `null` when every pixel is fully
 * transparent or there are none. A partial pixel left at the end of a
 * ragged array is ignored.
 */
export function averagePixels(data: ArrayLike<number>): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  const usable = data.length - (data.length % 4);
  for (let i = 0; i < usable; i += 4) {
    const a = data[i + 3];
    if (!(a > 0)) continue;
    r += data[i] * a;
    g += data[i + 1] * a;
    b += data[i + 2] * a;
    weight += a;
  }
  if (weight === 0) return null;
  return `#${byte(r / weight)}${byte(g / weight)}${byte(b / weight)}`;
}

/** What a text box gives the eyedropper: its text's colour, or its fill when it has no text. */
export function textBoxColor(box: { text: string; color: string; fill?: string }): string | null {
  if (box.text.trim() !== "") return box.color;
  return box.fill ?? null;
}

/**
 * The colour a tap picks: the element's stored colour when the tap landed on
 * one and it is a colour, else the averaged pixels, else nothing.
 */
export function eyedropColor(
  element: string | null | undefined,
  pixel: string | null,
): EyedropResult | null {
  const stored = element ? parseHexColor(element) : null;
  if (stored) return { color: stored, source: "element" };
  const sampled = pixel ? parseHexColor(pixel) : null;
  return sampled ? { color: sampled, source: "pixel" } : null;
}
