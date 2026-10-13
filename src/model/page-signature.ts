/**
 * A cheap fingerprint of everything a page's picture shows, for the views
 * that keep a painted copy of a page (the sidebar's thumbnails, page embeds
 * in other notes) and repaint only when it moves.
 *
 * No DOM, no Obsidian.
 */

import type { Page } from "./document";
import { textStyleKey } from "./text-style";

/**
 * Not a hash of every coordinate — that would cost as much as painting — but
 * it moves whenever a stroke is added, erased, split, moved or snapped, a
 * text box or an image changes, or the paper does. A stroke move shifts its
 * first point; a snap or a partial erase changes its point count.
 */
export function pageSignature(page: Page): string {
  let strokes = 0;
  for (const stroke of page.strokes) {
    const x = stroke.pts[0] ?? 0;
    const y = stroke.pts[1] ?? 0;
    strokes = (strokes * 31 + stroke.pts.length + x * 7 + y * 13 + stroke.id.length) % 1e9;
  }
  const text = page.textBoxes
    .map((t) => `${t.x},${t.y},${t.w},${t.h ?? ""},${textStyleKey(t)},${t.text}`)
    .join("|");
  const images = page.images
    .map((i) => `${i.path},${i.x},${i.y},${i.w},${i.h},${i.rotation ?? 0}`)
    .join("|");
  return [
    page.id,
    page.strokes.length,
    page.strokes[page.strokes.length - 1]?.id ?? "",
    strokes.toFixed(2),
    text,
    images,
    JSON.stringify(page.backdrop),
    page.geometry.width,
    page.geometry.height,
  ].join("#");
}
