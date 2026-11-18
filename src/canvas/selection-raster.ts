/**
 * Where the picture of a dragged lasso selection is made: moving a big
 * selection copies one picture each frame instead of redrawing every stroke.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Bounds } from "../model/document";

/** Below this many strokes, redrawing them costs less than keeping a picture. */
export const SELECTION_RASTER_MIN_STROKES = 24;

/** A full iPad screen is about 3.9 MP; past this much, the strokes are redrawn. */
export const SELECTION_RASTER_MAX_PIXELS = 9_000_000;

/** The most detail a picture is made with, times the view's own. */
export const SELECTION_RASTER_MAX_DETAIL = 4;

/**
 * How much detail the picture of a selection drawn `grown` times its size
 * needs, times the view's own: 1, 2 or 4. A picture is enlarged by up to a
 * half before the next step is asked for, which keeps the steps few (each
 * one draws every stroke again) and the ink at least two thirds as sharp as
 * the tiles will make it.
 */
export function selectionRasterDetail(grown: number): number {
  if (!(grown > 1.5) || !Number.isFinite(grown)) return 1;
  let detail = 1;
  while (detail < SELECTION_RASTER_MAX_DETAIL && grown > 1.5 * detail) detail *= 2;
  return detail;
}

export interface SelectionRasterBox {
  /** The picture's top-left corner, page px, on a whole device px. */
  x: number;
  y: number;
  /** The picture's size, device px. */
  width: number;
  height: number;
}

/**
 * The picture that holds `bounds` at `level` device px per page px, or `null`
 * for one that is empty, not finite or larger than `maxPixels`.
 */
export function selectionRasterBox(
  bounds: Bounds,
  level: number,
  maxPixels: number = SELECTION_RASTER_MAX_PIXELS,
): SelectionRasterBox | null {
  if (!(level > 0) || !Number.isFinite(level)) return null;
  const left = Math.floor(bounds.minX * level);
  const top = Math.floor(bounds.minY * level);
  const width = Math.ceil(bounds.maxX * level) - left;
  const height = Math.ceil(bounds.maxY * level) - top;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0 || width * height > maxPixels) return null;
  return { x: left / level, y: top / level, width, height };
}
