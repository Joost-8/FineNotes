/**
 * The arithmetic `InkSurface` does for a "Handwrite here" block and for a
 * page opened from one: when the pen near the bottom of a block makes it
 * grow, and where the ring goes that marks a page jumped to.
 *
 * Pure: no DOM, no Obsidian.
 */

/** How far above the block's bottom the pen makes it grow, in screen px. */
export const INLINE_GROW_REACH_PX = 64;

/**
 * Whether the pen at `at` (page px) is in the band along the bottom of a
 * block `width` x `height` where writing makes the block taller: within
 * `buffer` above or below its bottom edge, across its width.
 */
export function inGrowBand(
  at: { x: number; y: number },
  size: { width: number; height: number },
  buffer: number,
): boolean {
  if (at.x < 0 || at.x >= size.width) return false;
  return at.y >= size.height - buffer && at.y <= size.height + buffer;
}

/** A box on the page, page px. */
export interface PageRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The ring around the page a block was opened at, in the surface's screen
 * px: around its drawing (with `pad` of room) when it has one, else the
 * whole page; never smaller than `min` px a side.
 */
export function flashRing(
  box: { x: number; y: number; width: number; height: number },
  drawn: PageRect | null,
  view: { scale: number; offsetX: number; scrollY: number },
  pad = 20,
  min = 40,
): { left: number; top: number; width: number; height: number } {
  const { scale } = view;
  const rx = drawn ? Math.max(0, drawn.minX - pad) : 0;
  const ry = drawn ? Math.max(0, drawn.minY - pad) : 0;
  const rw = drawn ? Math.min(box.width - rx, drawn.maxX - drawn.minX + pad * 2) : box.width;
  const rh = drawn ? Math.min(box.height - ry, drawn.maxY - drawn.minY + pad * 2) : box.height;
  return {
    left: Math.round(view.offsetX + (box.x + rx) * scale),
    top: Math.round((box.y + ry - view.scrollY) * scale),
    width: Math.max(min, Math.round(rw * scale)),
    height: Math.max(min, Math.round(rh * scale)),
  };
}
