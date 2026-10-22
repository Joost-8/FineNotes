/**
 * Keeping the text box being typed in on screen while the on-screen
 * keyboard covers the bottom of it, as GoodNotes does: how far to scroll so
 * the box sits between the room the floating text pill needs above it and
 * the keyboard's top.
 *
 * PURE: numbers in, a number out. The surface measures (client px) and
 * scrolls.
 */

/** A vertical span on screen, client px. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * How far to scroll the page (positive: the page moves up, as the scroll
 * position grows) so that `box` lies inside `view`. A box that already fits
 * stays where it is. A box taller than the view shows its bottom when the
 * caret is at the end of its text (`caretAtEnd`, where typing usually goes
 * on), else its top. A view with no height asks for nothing.
 */
export function revealDelta(box: Span, view: Span, caretAtEnd: boolean): number {
  const room = view.bottom - view.top;
  const height = box.bottom - box.top;
  if (!(room > 0) || !Number.isFinite(height)) return 0;
  if (height > room) return caretAtEnd ? box.bottom - view.bottom : box.top - view.top;
  if (box.bottom > view.bottom) return box.bottom - view.bottom;
  if (box.top < view.top) return box.top - view.top;
  return 0;
}

/** A rectangle on screen, client px. */
export interface ScreenRect extends Span {
  left: number;
  right: number;
}

/** Whether any pixel of `box` shows in `pane`. */
export function showsIn(box: ScreenRect, pane: ScreenRect): boolean {
  return (
    box.bottom > pane.top && box.top < pane.bottom && box.right > pane.left && box.left < pane.right
  );
}

/** Where the view is: its scroll position and its zoom. */
export interface ViewSpot {
  x: number;
  y: number;
  scale: number;
}

/**
 * Whether the view has carried a held or typed-in box out of sight, so it
 * is let go for good (GoodNotes): no pixel of `box` shows in `pane`, and
 * the view has scrolled or zoomed since `seen`, where it was when the box
 * last showed. The pane shrinking under a box moves nothing, so it never
 * lets one go: on the iPad the keyboard opening did that to a box just
 * made, before it could be scrolled clear, and the empty box was removed
 * (2026-10-21). A pane with no size shows nothing to judge by.
 */
export function carriedOutOfSight(
  box: ScreenRect,
  pane: ScreenRect,
  seen: ViewSpot,
  view: ViewSpot,
): boolean {
  if (!(pane.bottom > pane.top) || !(pane.right > pane.left)) return false;
  if (showsIn(box, pane)) return false;
  return (
    Math.abs(view.x - seen.x) > 0.5 ||
    Math.abs(view.y - seen.y) > 0.5 ||
    Math.abs(view.scale - seen.scale) > 1e-6
  );
}
