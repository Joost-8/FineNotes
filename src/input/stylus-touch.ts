/**
 * The Pencil's touch events, which the page must cancel for the Pencil to
 * stay its own on iPadOS.
 *
 * WebKit runs its own long-press recogniser on the raw touch stream, and a
 * pen held still is claimed by it and ended in `pointercancel`; with Scribble
 * on, the system watches every Pencil stroke for handwriting and swallows
 * the pointer events it claims (WebKit bug 217430). Neither `touch-action`
 * nor `stopPropagation` reaches either one; cancelling the stylus's
 * `touchstart` and `touchmove` does, and pointer events are dispatched first,
 * so drawing is unaffected (CLAUDE.md, the 2026-09-21 entries).
 *
 * Every element the Pencil writes or drags on cancels them: the page, the
 * Zoom box's window and its first-drag catcher.
 */

/** What this module reads of a `Touch`: Safari's `touchType` ("stylus" or "direct"). */
export interface TouchKind {
  touchType?: string;
}

/** Whether any of a touch event's changed touches is the stylus. */
export function hasStylusTouch(changed: ArrayLike<TouchKind | undefined>): boolean {
  for (let i = 0; i < changed.length; i++) {
    if (changed[i]?.touchType === "stylus") return true;
  }
  return false;
}

/** Whether a touch event of `type` is one to cancel: the stylus landing or moving. */
export function cancelsStylusTouch(
  type: string,
  changed: ArrayLike<TouchKind | undefined>,
): boolean {
  return (type === "touchstart" || type === "touchmove") && hasStylusTouch(changed);
}
