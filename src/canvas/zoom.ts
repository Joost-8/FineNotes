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

/** A coarse mouse-wheel event changes zoom by at most 15%, in either direction. */
const WHEEL_ZOOM_LOG_STEP = Math.log(1.15);

/**
 * Wheel zoom from a delta already converted to CSS px. A detented wheel can
 * report 120 px in one event: the trackpad's exponential response would
 * multiply zoom by 3.32. Bound that jump without changing small trackpad
 * deltas. Opposite deltas are reciprocal, so reversing a step undoes it.
 */
export function wheelZoomFactor(deltaPx: number): number {
  if (!Number.isFinite(deltaPx)) return 1;
  const exponent = Math.max(-WHEEL_ZOOM_LOG_STEP, Math.min(WHEEL_ZOOM_LOG_STEP, -deltaPx * 0.01));
  return Math.exp(exponent);
}

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
 * How far a pinch must close past the zoom floor, as a multiple of the floor,
 * for letting go to open the page overview (every page in a grid) instead of
 * springing back to the page. At half the fit the rubber-banded page shows at
 * about 0.8 of it: well past a zoom-out that only overshoots the fit on its
 * way back (Joost, 2026-10-21).
 */
export const OVERVIEW_PINCH_ZOOM = 0.5;

/** Whether a pinch whose fingers ask for zoom `raw` (unstretched) opens the overview. */
export function pinchOpensOverview(raw: number, floor: number): boolean {
  return floor > 0 && raw > 0 && raw <= floor * OVERVIEW_PINCH_ZOOM;
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

/** A zoom this close to the page-filling one (as a fraction of it) counts as filling. */
const AT_FILL = 0.02;

/**
 * The user zoom at which a page `width` by `height` layout px, shown at
 * `baseScale`, covers a pane `paneWidth` by `paneHeight` exactly: as small
 * as it can be with no desk showing beside or around it. For a page taller
 * than the pane is wide, its width fills the pane. Never past {@link MAX_SCALE}.
 */
export function pageFillZoom(
  width: number,
  height: number,
  baseScale: number,
  paneWidth: number,
  paneHeight: number,
): number {
  if (!(width > 0) || !(height > 0) || !(baseScale > 0) || !(paneWidth > 0) || !(paneHeight > 0)) {
    return 1;
  }
  const fill = Math.max(paneWidth / (width * baseScale), paneHeight / (height * baseScale));
  return Math.min(MAX_SCALE, fill);
}

/**
 * Where a one-finger double tap zooms: to `fill`, the page covering the
 * pane ({@link pageFillZoom}), from anywhere else, and from there back to
 * the whole page (`floor`).
 */
export function doubleTapZoom(zoom: number, floor: number, fill: number): number {
  return fill > 0 && Math.abs(zoom / fill - 1) <= AT_FILL ? floor : fill;
}

/**
 * The screen point (on one axis) to zoom about so that a view whose layout
 * origin sits at `fromOffset` screen px at scale `fromScale` ends with it at
 * `toOffset` at `toScale`: the fixed point of that move, so zoom and scroll
 * land together as one motion. Null when the scale does not change.
 */
export function zoomAnchorFor(
  fromOffset: number,
  fromScale: number,
  toOffset: number,
  toScale: number,
): number | null {
  const k = toScale / fromScale;
  if (!Number.isFinite(k) || Math.abs(k - 1) < 1e-6) return null;
  return (k * fromOffset - toOffset) / (k - 1);
}
