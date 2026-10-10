/**
 * The eraser-size slider: its range and stops, the three quick sizes the
 * toolbar shows, and how big each is drawn there.
 *
 * Sizes are diameters in page px at fit-to-page zoom (the surface scales them
 * for the zoom, so the eraser covers the same screen area at any zoom). The
 * three presets in `ERASER_SIZES` stay the quick picks; the slider reaches
 * finer and much larger sizes in between and beyond them.
 *
 * PURE: no DOM.
 */

import { DEFAULT_ERASER_SIZE, ERASER_SIZES } from "../constants";

/** The smallest diameter the slider offers, page px: a precise tip for single letters. */
export const ERASER_MIN_SIZE = 4;

/** The largest diameter the slider offers, page px: clears a wide band at once. */
export const ERASER_MAX_SIZE = 120;

/**
 * The slider's stops, smallest first: single px where small sizes differ
 * most, then coarser, so the thumb moves evenly through what you can see.
 */
export function eraserStops(): number[] {
  const stops: number[] = [];
  for (let s = ERASER_MIN_SIZE; s < 20; s += 1) stops.push(s);
  for (let s = 20; s < 60; s += 2) stops.push(s);
  for (let s = 60; s <= ERASER_MAX_SIZE; s += 5) stops.push(s);
  return stops;
}

/**
 * A size kept inside the slider's range. Not a number, or not above zero,
 * is no size at all: that is the default, not the smallest.
 */
export function clampEraserSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return DEFAULT_ERASER_SIZE;
  return Math.min(ERASER_MAX_SIZE, Math.max(ERASER_MIN_SIZE, size));
}

/**
 * The three sizes the toolbar shows: the presets, unless the live size is
 * none of them, when it takes the place of the preset nearest it (by ratio,
 * as sizes are compared by eye). Smallest first, as the glyphs grow.
 */
export function quickEraserSizes(
  live: number,
  presets: readonly number[] = ERASER_SIZES,
): number[] {
  const quick = [...presets];
  if (!quick.includes(live) && Number.isFinite(live) && live > 0) {
    let nearest = 0;
    for (let i = 1; i < quick.length; i++) {
      if (Math.abs(Math.log(quick[i] / live)) < Math.abs(Math.log(quick[nearest] / live))) {
        nearest = i;
      }
    }
    quick[nearest] = live;
  }
  return quick.sort((a, b) => a - b);
}

/** Smallest and largest radius of a size glyph in its 28 px box. */
const GLYPH_MIN_R = 3;
const GLYPH_MAX_R = 12;

/**
 * The radius a size's glyph is drawn at, on a log scale across the slider's
 * range, so a small size still reads as a circle and the largest fills the box.
 */
export function eraserGlyphRadius(size: number): number {
  const s = clampEraserSize(size);
  const k = Math.log(s / ERASER_MIN_SIZE) / Math.log(ERASER_MAX_SIZE / ERASER_MIN_SIZE);
  return GLYPH_MIN_R + (GLYPH_MAX_R - GLYPH_MIN_R) * k;
}
