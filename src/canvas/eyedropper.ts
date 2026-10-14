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

/** A colour stored on something under the tap, and how opaque it is drawn (1: solid). */
export interface StoredCandidate {
  color: string;
  alpha?: number;
}

/**
 * A stored colour as `#rrggbb` with its own opacity: `#rgb`, `#rrggbb` and
 * a fill's `#rrggbbaa` all read; anything else is `null`.
 */
export function storedColor(input: string): { color: string; alpha: number } | null {
  const text = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{8}$/.test(text)) {
    return { color: `#${text.slice(0, 6)}`, alpha: Number.parseInt(text.slice(6), 16) / 255 };
  }
  const color = parseHexColor(text);
  return color ? { color, alpha: 1 } : null;
}

/** How a candidate looks over white paper: its colour at its opacity. */
function onPaper(candidate: StoredCandidate): [number, number, number] | null {
  const read = storedColor(candidate.color);
  if (!read) return null;
  const a = Math.max(0, Math.min(1, read.alpha * (candidate.alpha ?? 1)));
  const n = Number.parseInt(read.color.slice(1), 16);
  const mix = (c: number): number => c * a + 255 * (1 - a);
  return [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
}

/**
 * Which of the colours stored under the tap (topmost first) the user is
 * pointing at: the one that looks most like the pixels there, each judged as
 * it is drawn (a highlighter's or a fill's opacity over the paper). Without
 * pixels, or with one candidate, the topmost. Returns the stored colour as
 * `#rrggbb`, never the blended look; `null` when no candidate is a colour.
 */
export function nearestStored(
  candidates: readonly StoredCandidate[],
  pixel: string | null,
): string | null {
  const usable = candidates.filter((c) => storedColor(c.color) !== null);
  if (usable.length === 0) return null;
  const sampled = pixel ? parseHexColor(pixel) : null;
  if (usable.length === 1 || !sampled) return storedColor(usable[0].color)?.color ?? null;
  const n = Number.parseInt(sampled.slice(1), 16);
  const px = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = usable[0];
  let bestDistance = Infinity;
  for (const candidate of usable) {
    const look = onPaper(candidate);
    if (!look) continue;
    const d = (look[0] - px[0]) ** 2 + (look[1] - px[1]) ** 2 + (look[2] - px[2]) ** 2;
    // Ties keep the higher one.
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return storedColor(best.color)?.color ?? null;
}

/** A text box as the eyedropper sees it: its look, and its frame in page space. */
export interface EyedropTextBox {
  text: string;
  color: string;
  fill?: string;
  border?: { width: number; color: string } | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The colours a text box shows at page point `p`: its border when `p` is on
 * it (the border is drawn inside the frame's edge, `reach` page px of
 * forgiveness either side), else its text's colour when it has text, and its
 * fill. Topmost first; empty when `p` is off the box.
 */
export function textBoxCandidates(
  box: EyedropTextBox,
  p: { x: number; y: number },
  reach: number,
): StoredCandidate[] {
  const r = Math.max(0, reach);
  const inside = p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  const near =
    p.x >= box.x - r && p.x <= box.x + box.w + r && p.y >= box.y - r && p.y <= box.y + box.h + r;
  const border = box.border && box.border.width > 0 ? box.border : null;
  if (border && near) {
    const toEdge = Math.min(p.x - box.x, box.x + box.w - p.x, p.y - box.y, box.y + box.h - p.y);
    // Negative outside the frame: within reach of the edge counts as on it.
    if (toEdge <= border.width + r) return [{ color: border.color }];
  }
  if (!inside) return [];
  const out: StoredCandidate[] = [];
  if (box.text.trim() !== "") out.push({ color: box.color });
  if (box.fill) out.push({ color: box.fill });
  return out;
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
