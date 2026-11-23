/**
 * Where the Translate window opens, and how big: sized to the text it opens
 * with (a word gets a small window, a paragraph a wider and taller one), and
 * placed beside what was selected, below it when there is room, above it
 * when not, always inside the view.
 *
 * PURE: no DOM.
 */

import type { WindowPlace } from "../model/calculator-store";

/** The smallest the window may be sized to. */
export const TRANSLATE_MIN = { w: 300, h: 260 };

/** Gap between the selection and the window, px. */
const GAP = 12;
/** Kept clear of the view's edges, px. */
const MARGIN = 8;

/** The window's size for `chars` characters of text, in a view of `bounds`. */
export function translateSize(
  chars: number,
  bounds: { w: number; h: number },
): { w: number; h: number } {
  const w = chars <= 80 ? 360 : chars <= 400 ? 440 : 540;
  const h = chars <= 80 ? 340 : chars <= 400 ? 420 : 520;
  return {
    w: Math.max(TRANSLATE_MIN.w, Math.min(w, bounds.w - 2 * MARGIN)),
    h: Math.max(TRANSLATE_MIN.h, Math.min(h, bounds.h - 2 * MARGIN)),
  };
}

/**
 * The first place for a window of `chars` characters: under `anchor` (the
 * selection's bottom centre, in view px) when it fits there, else above
 * `anchorTop` (the selection's top), else as low as fits; centred across
 * on the anchor. Without an anchor: centred, a little above the middle.
 */
export function translatePlace(
  chars: number,
  bounds: { w: number; h: number },
  anchor: { x: number; y: number; top: number } | null,
): WindowPlace {
  const { w, h } = translateSize(chars, bounds);
  const clampX = (x: number): number =>
    Math.max(MARGIN, Math.min(Math.round(x), bounds.w - w - MARGIN));
  const clampY = (y: number): number =>
    Math.max(MARGIN, Math.min(Math.round(y), bounds.h - h - MARGIN));
  if (!anchor) return { x: clampX((bounds.w - w) / 2), y: clampY((bounds.h - h) / 3), w, h };
  const below = anchor.y + GAP;
  const above = anchor.top - GAP - h;
  const y = below + h <= bounds.h - MARGIN ? below : above >= MARGIN ? above : clampY(below);
  return { x: clampX(anchor.x - w / 2), y: clampY(y), w, h };
}
