/**
 * The pages a scroll shows next. Pure.
 *
 * A PDF page's image used to be asked for only once part of the page was on
 * screen (or within the 512 px the renderer rasterises ahead), and pdf.js
 * takes 40 to 150 ms a page, more on an older iPad: a fast scroll showed
 * every new page as blank paper until then (FineNotes#80, measured with the
 * real surface: on a fling through a 65-page handout, pages were asked for
 * 15-20 ms before they came on screen). Asked for a screen or so ahead, in
 * the direction the view moves, they are ready when they arrive.
 */

import type { Bounds } from "../model/document";
import type { PageBox } from "./page-layout";

/** How far around the view pages count as near, in screens. */
export const AHEAD_SCREENS = 1.5;

/**
 * The pages not in `view` (layout px) but within `screens` of it, nearest
 * first, those the view moves towards (`motion`, layout px since the last
 * look) counted at half their distance, so they come before the ones it
 * leaves behind.
 */
export function pagesAhead(
  boxes: readonly PageBox[],
  view: Bounds,
  motion: { x: number; y: number },
  screens = AHEAD_SCREENS,
): PageBox[] {
  const w = view.maxX - view.minX;
  const h = view.maxY - view.minY;
  if (!(w > 0 && h > 0) || ![view.minX, view.minY, w, h].every(Number.isFinite)) return [];
  const reach = {
    minX: view.minX - w * screens,
    minY: view.minY - h * screens,
    maxX: view.maxX + w * screens,
    maxY: view.maxY + h * screens,
  };
  const near: Array<{ box: PageBox; distance: number }> = [];
  for (const box of boxes) {
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const onScreen =
      right > view.minX && box.x < view.maxX && bottom > view.minY && box.y < view.maxY;
    const within =
      right > reach.minX && box.x < reach.maxX && bottom > reach.minY && box.y < reach.maxY;
    if (onScreen || !within) continue;
    // From the view to the nearest edge of the page, along each axis.
    const dx = box.x >= view.maxX ? box.x - view.maxX : right <= view.minX ? right - view.minX : 0;
    const dy =
      box.y >= view.maxY ? box.y - view.maxY : bottom <= view.minY ? bottom - view.minY : 0;
    const towards = dx * motion.x + dy * motion.y > 0;
    const distance = Math.hypot(dx, dy) * (towards ? 0.5 : 1);
    near.push({ box, distance });
  }
  near.sort((a, b) => a.distance - b.distance);
  return near.map((n) => n.box);
}
