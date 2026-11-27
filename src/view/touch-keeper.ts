/**
 * Keeps the element a drag began on in the page until the drag ends.
 *
 * Android's WebView sends a touch's moves to the element the touch began on.
 * Once that element leaves the page (the ⋯ menu closing under a held row, the
 * pill rebuilt while the bar previews a pinned pen), nothing above it hears
 * them: the document's listener cannot hold off the scroll, Android takes the
 * touch as one and cancels the drag (`pointercancel`), and a drag listening
 * only on the element never hears its end. Moved into a hidden holder on the
 * body, the element stays on the event path to the document and window.
 */

/**
 * Move `el` into a hidden holder on the body, out of whatever is about to drop
 * it, and return what takes the holder (and `el`) away once the drag is over.
 */
export function keepInPage(el: HTMLElement): () => void {
  const holder = el.ownerDocument.body.createDiv({ cls: "goodobsidian-touch-keeper" });
  holder.hidden = true;
  holder.appendChild(el);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holder.remove();
  };
}

/** As {@link keepInPage}, only once `el` has already left the page; else nothing to release. */
export function keepIfDropped(el: HTMLElement): (() => void) | null {
  return el.isConnected ? null : keepInPage(el);
}
