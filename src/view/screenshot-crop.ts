/**
 * Which patch of a page a screenshot shows, and how sharp: the lasso's
 * Screenshot with the page behind its ink (paper, PDF, everything drawn
 * there, as the page shows it), the selection sent to Ask AI, and a lasso
 * drawn round nothing.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Bounds } from "../model/document";

/** A patch of a page, page px, and the scale it is painted at. */
export interface PageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Canvas px per page px. */
  scale: number;
}

/**
 * `bounds` cut to the page (`pageWidth` × `pageHeight`); null when less
 * than a pixel of it is on the page. Sharp at three times its size, but no side of the patch past
 * 2048 px; and since the whole page is painted first, no side of the page
 * past 4096 px.
 */
export function pageCrop(bounds: Bounds, pageWidth: number, pageHeight: number): PageCrop | null {
  const x = Math.max(0, bounds.minX);
  const y = Math.max(0, bounds.minY);
  const width = Math.min(pageWidth, bounds.maxX) - x;
  const height = Math.min(pageHeight, bounds.maxY) - y;
  if (!(width >= 1) || !(height >= 1)) return null;
  const scale = Math.min(3, 2048 / Math.max(width, height), 4096 / Math.max(pageWidth, pageHeight));
  return { x, y, width, height, scale };
}
