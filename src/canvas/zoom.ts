/**
 * Zoom arithmetic, kept out of the surface so it can be tested: the zoom
 * range, the floor that shows a whole page, how that floor follows a pane
 * that changes shape, and the scroll that keeps a pinch anchored.
 */

import { PAGE_MARGIN_Y } from "./page-layout";
import type { Vec2 } from "./viewport";

/**
 * User zoom is relative to fit-to-width: 1 fills the pane's width with the
 * page. The live floor is {@link fitPageZoom} — the whole page on screen, as
 * GoodNotes opens a page — which is at most 1 and depends on the pane, so the
 * surface computes it per layout. `MIN_SCALE` is only the hard floor under
 * that, for a pane so short that fitting the page would make it a stamp.
 */
export const MIN_SCALE = 0.1;
/** The closest a pinch can zoom in, relative to fit-to-width. */
export const MAX_SCALE = 8;

/**
 * The user zoom at which a page `pageHeight` layout px tall, shown at
 * `baseScale` CSS px per layout px, fits in a pane `paneHeight` CSS px tall
 * together with the layout's margin above and below it — so a single page
 * sits whole and centred with nothing left to scroll. Never above 1
 * (fit-to-width) and never below {@link MIN_SCALE}.
 */
export function fitPageZoom(
  pageHeight: number,
  baseScale: number,
  paneHeight: number,
  marginY = PAGE_MARGIN_Y,
): number {
  const shown = (pageHeight + 2 * marginY) * baseScale;
  if (!(shown > 0) || !(paneHeight > 0)) return 1;
  return Math.min(1, Math.max(MIN_SCALE, paneHeight / shown));
}

/** What {@link nextZoomFloor} decides: the new floor, and the zoom to show. */
export interface ZoomFloorStep {
  floor: number;
  zoom: number;
}

/**
 * The zoom floor and zoom after the pane changed shape. The first layout
 * opens at the floor; afterwards a view sitting on the floor stays on it (a
 * rotation re-fits the page), and a view below a new floor is lifted onto it.
 *
 * Except while the on-screen keyboard is up (`keyboard`): then the pane is
 * only short because the keyboard covers it, and following the floor down
 * would shrink the whole page into the strip above the keyboard — the page
 * "went way back" when a text box was tapped at fit-to-page zoom (Joost's
 * recording, 2026-09-22). The floor and zoom are held until it goes down.
 */
export function nextZoomFloor(options: {
  zoom: number;
  floor: number;
  newFloor: number;
  initialised: boolean;
  keyboard: boolean;
}): ZoomFloorStep {
  const { zoom, floor, newFloor, initialised, keyboard } = options;
  if (!initialised) return { floor: newFloor, zoom: newFloor };
  if (keyboard) return { floor, zoom };
  const atFloor = Math.abs(zoom - floor) < 1e-6;
  return { floor: newFloor, zoom: atFloor || zoom < newFloor ? newFloor : zoom };
}

/**
 * The scroll, in screen px, that puts the layout point a pinch started on
 * back under the fingers. `was` is the layout point that was under them,
 * `now` the one under them at the new `scale`. One screen px of scroll
 * moves the view 1 / `scale` layout px, so undoing a drift of `was - now`
 * layout px takes that drift times `scale` screen px.
 */
export function anchorScrollDelta(was: Vec2, now: Vec2, scale: number): Vec2 {
  return { x: (was.x - now.x) * scale, y: (was.y - now.y) * scale };
}
