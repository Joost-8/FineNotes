/**
 * Swallows the click a browser makes from a tap that a control has already
 * acted on at pointerup.
 *
 * Controls over the page act on pointerup, because a Pencil tap on the iPad
 * makes no click (the surface cancels its touchstart). Android's Chrome
 * WebView does make one, after the pointerup handlers have run, and aims it
 * at whatever is under the finger *then*. When the action opened a dialog,
 * that is Obsidian's `.modal-bg`, whose click closes the dialog on mobile: a
 * lasso's "Add to contents" flashed up and vanished. `preventDefault` on
 * pointerdown does not stop that click; only cancelling touchstart would,
 * and a finger on a scrolling menu needs its touchstart.
 *
 *     button.addEventListener("pointerup", (event) => {
 *       swallowGhostClick(button.ownerDocument, event);
 *       run();
 *     });
 *
 * The next click is eaten (in the capture phase, before any target sees it)
 * only if it lands within {@link GHOST_CLICK_PX} of the lift and
 * {@link GHOST_CLICK_MS} after it. Any click ends the watch, so on the iPad,
 * where none comes, a later real click passes and clears it.
 */

/** Longest a synthesised click lags its pointerup, ms. */
export const GHOST_CLICK_MS = 700;
/** Farthest a synthesised click lands from its pointerup, px. */
export const GHOST_CLICK_PX = 24;

/** The watch now armed, if any: one at a time, the latest tap's. */
let disarm: (() => void) | null = null;

export function swallowGhostClick(doc: Document, up: PointerEvent): void {
  disarm?.();
  const onClick = (event: MouseEvent): void => {
    end();
    const late = event.timeStamp - up.timeStamp > GHOST_CLICK_MS;
    const far = Math.hypot(event.clientX - up.clientX, event.clientY - up.clientY) > GHOST_CLICK_PX;
    // A keyboard click (`detail === 0`) is never a ghost.
    if (late || far || event.detail === 0) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const end = (): void => {
    doc.removeEventListener("click", onClick, true);
    if (disarm === end) disarm = null;
  };
  doc.addEventListener("click", onClick, true);
  disarm = end;
}
