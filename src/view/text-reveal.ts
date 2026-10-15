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
