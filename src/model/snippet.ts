/**
 * Snippets: an area of a PDF's slide, lassoed on its tab and dragged onto
 * the notes, where it lands as a picture linked back to that slide
 * (`ImageElement.slide`). This module is the arithmetic of it: which patch
 * of the slide is drawn and how sharp, where the picture lands on the notes
 * page, and when a drag held over the Notes tab turns to the notes.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Bounds, PageGeometry } from "./document";

/** No side of a snippet's picture is drawn past this many px. */
export const SNIPPET_MAX_SIDE = 2048;
/** A snippet is drawn at least this many px per page px, however far out the view is. */
export const SNIPPET_MIN_SCALE = 2;
/** The whole slide is painted before it is cropped: no side of it past this many px. */
export const SNIPPET_MAX_PAGE_SIDE = 4096;
/** How long a dragged snippet rests over the Notes tab before the notes show, ms. */
export const SNIPPET_FLIP_MS = 300;

/** The patch of a slide a snippet shows (page px), and the scale it is drawn at. */
export interface SnippetCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Canvas px per page px. */
  scale: number;
}

/**
 * `area` cut to the slide (`pageWidth` × `pageHeight`), drawn as sharp as
 * the view shows it (`viewScale`, device px per page px) but never under
 * {@link SNIPPET_MIN_SCALE}; no side of the picture past
 * {@link SNIPPET_MAX_SIDE} px, and no side of the slide past
 * {@link SNIPPET_MAX_PAGE_SIDE}. Null when less than a page px of it is on
 * the slide.
 */
export function snippetCrop(
  area: Bounds,
  pageWidth: number,
  pageHeight: number,
  viewScale: number,
): SnippetCrop | null {
  const x = Math.max(0, area.minX);
  const y = Math.max(0, area.minY);
  const width = Math.min(pageWidth, area.maxX) - x;
  const height = Math.min(pageHeight, area.maxY) - y;
  if (!(width >= 1) || !(height >= 1)) return null;
  const want = Math.max(SNIPPET_MIN_SCALE, Number.isFinite(viewScale) ? viewScale : 0);
  const scale = Math.min(
    want,
    SNIPPET_MAX_SIDE / Math.max(width, height),
    SNIPPET_MAX_PAGE_SIDE / Math.max(pageWidth, pageHeight),
  );
  return { x, y, width, height, scale };
}

/** The picture's size in px for a crop: at least one px a side. */
export function snippetPixels(crop: SnippetCrop): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(crop.width * crop.scale)),
    height: Math.max(1, Math.round(crop.height * crop.scale)),
  };
}

/** The notes page's margin either side that a snippet's width is measured inside, a share of its width. */
export const SNIPPET_PAGE_MARGIN = 0.06;

/**
 * How large a snippet of `size` (page px, as it was on a slide
 * `slideWidth` page px wide) is on a notes page of `page`'s size: it keeps
 * its share of the slide's width, of the page's width inside a margin of
 * {@link SNIPPET_PAGE_MARGIN} each side (half the slide's width becomes half
 * of that), its height by its own aspect ratio, and never taller than the
 * page (it shrinks, aspect kept, to fit).
 */
export function snippetSize(
  size: { width: number; height: number },
  slideWidth: number,
  page: PageGeometry,
): { w: number; h: number } {
  const share =
    slideWidth > 0 && Number.isFinite(slideWidth) ? Math.min(1, size.width / slideWidth) : 1;
  const usable = page.width * (1 - 2 * SNIPPET_PAGE_MARGIN);
  const aspect = size.width > 0 ? size.height / size.width : 1;
  let w = Math.max(1, share * usable);
  let h = w * aspect;
  if (h > page.height) {
    w *= page.height / h;
    h = page.height;
  }
  return { w, h };
}

/**
 * Where a snippet of `size` (page px, as it was on a slide `slideWidth`
 * wide) lands on a notes page of `page`'s size, dropped at page point `at`:
 * centred there at {@link snippetSize}, and moved in so that all of it is
 * on the page.
 */
export function snippetBox(
  size: { width: number; height: number },
  slideWidth: number,
  at: { x: number; y: number },
  page: PageGeometry,
): { x: number; y: number; w: number; h: number } {
  const { w, h } = snippetSize(size, slideWidth, page);
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, v));
  return { x: clamp(at.x - w / 2, page.width - w), y: clamp(at.y - h / 2, page.height - h), w, h };
}

/** A drag over the Notes tab: since when it has been there (`null`: not over it). */
export interface SnippetHover {
  since: number | null;
}

/**
 * A dragged snippet's pointer moved, or a timer asked again, at time `now`
 * (ms), `over` the Notes tab or not: the hover as it now is, and whether
 * the notes should show now (it has rested there {@link SNIPPET_FLIP_MS}).
 * Leaving the tab starts the wait again.
 */
export function stepSnippetHover(
  hover: SnippetHover,
  over: boolean,
  now: number,
): { hover: SnippetHover; flip: boolean } {
  if (!over) return { hover: { since: null }, flip: false };
  const since = hover.since ?? now;
  return { hover: { since }, flip: now - since >= SNIPPET_FLIP_MS };
}
