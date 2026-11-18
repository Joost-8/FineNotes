/**
 * The eraser-size slider: its range and stops.
 *
 * Sizes are diameters in page px at fit-to-page zoom (the surface scales them
 * for the zoom, so the eraser covers the same screen area at any zoom). The
 * presets the toolbar shows are in `model/width-presets.ts`; the slider
 * reaches finer and much larger sizes in between and beyond them.
 *
 * PURE: no DOM.
 */

import { DEFAULT_ERASER_SIZE } from "../constants";

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
