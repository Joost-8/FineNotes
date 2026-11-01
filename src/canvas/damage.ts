/**
 * Where a change to a page shows on the pictures cached of it: which device
 * px of a tile, a page preview or the dry layer were drawn from an older
 * state of the page and must be painted again. Painting those again in
 * place, instead of throwing the picture away, is what keeps the eraser
 * from repainting every tile under a long stroke on every pen event. PURE.
 */

import type { Bounds } from "../model/document";
import type { PixelRect } from "./layer-rect";

/** `area` added to `stale` (page px), which may be empty. */
export function unite(stale: Bounds | undefined, area: Bounds): Bounds {
  if (!stale) return { ...area };
  return {
    minX: Math.min(stale.minX, area.minX),
    minY: Math.min(stale.minY, area.minY),
    maxX: Math.max(stale.maxX, area.maxX),
    maxY: Math.max(stale.maxY, area.maxY),
  };
}

/** `bounds` grown by `pad` on every side. */
export function grow(bounds: Bounds, pad: number): Bounds {
  return {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
  };
}

/**
 * The whole device px of a raster `width` x `height` that page-space `area`
 * touches, where the raster shows the page at `scale` device px per page px
 * and its top-left px is page px (`originX`, `originY`) times `scale`. Null
 * when the area misses the raster.
 */
export function staleRect(
  area: Bounds,
  scale: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
): PixelRect | null {
  const values = [area.minX, area.minY, area.maxX, area.maxY, scale, originX, originY];
  if (!values.every(Number.isFinite) || !(scale > 0)) return null;
  const x0 = Math.max(0, Math.floor(area.minX * scale - originX));
  const y0 = Math.max(0, Math.floor(area.minY * scale - originY));
  const x1 = Math.min(width, Math.ceil(area.maxX * scale - originX));
  const y1 = Math.min(height, Math.ceil(area.maxY * scale - originY));
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The page area a raster's px `rect` shows: {@link staleRect}'s way back. */
export function rectArea(rect: PixelRect, scale: number, originX: number, originY: number): Bounds {
  return {
    minX: (originX + rect.x) / scale,
    minY: (originY + rect.y) / scale,
    maxX: (originX + rect.x + rect.w) / scale,
    maxY: (originY + rect.y + rect.h) / scale,
  };
}

/** Whether two px rectangles share any px. */
export function rectsMeet(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function hull(a: PixelRect, b: PixelRect): PixelRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Rectangles past this many are drawn again as one: each is a clip rectangle and a pass over the tiles. */
export const MAX_DAMAGE_RECTS = 16;

/**
 * `rect` added to the damage `list`: merged into a rectangle it overlaps
 * (the eraser's dabs overlap one another), and the whole list made one
 * rectangle once it is longer than {@link MAX_DAMAGE_RECTS}. Returns a new list.
 */
export function addDamage(list: readonly PixelRect[], rect: PixelRect): PixelRect[] {
  if (!(rect.w > 0) || !(rect.h > 0)) return [...list];
  let merged = rect;
  const rest: PixelRect[] = [];
  for (const other of list) {
    if (rectsMeet(other, merged)) merged = hull(other, merged);
    else rest.push(other);
  }
  rest.push(merged);
  if (rest.length <= MAX_DAMAGE_RECTS) return rest;
  return [rest.reduce(hull)];
}

/** The px the rectangles cover, at most: one left overlapping another counts twice. */
export function damageArea(list: readonly PixelRect[]): number {
  return list.reduce((sum, r) => sum + r.w * r.h, 0);
}
