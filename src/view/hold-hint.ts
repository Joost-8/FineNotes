/**
 * A long press on a control shows what it does, in Obsidian's own tooltip.
 * A mouse shows a control's name on hover; a finger or the Pencil cannot
 * hover, so on the iPad the export dialog's icon buttons said nothing at all
 * (Joost, 2026-11-02). The press that showed the hint does not also press
 * the control, and a mouse keeps its hover tooltip.
 */

import { displayTooltip } from "obsidian";

/** How long a finger or the Pencil rests before the hint shows, ms. */
export const HOLD_HINT_MS = 450;

/** Moving further than this, CSS px, is a scroll or a drag: no hint. */
const HOLD_SLOP_PX = 10;

/** Show `hint()` over `el` after a long press; read when shown, so it follows a control's state. */
export function holdForHint(el: HTMLElement, hint: () => string): void {
  let timer = 0;
  let start: { x: number; y: number } | null = null;
  let shown = false;
  // No text selection or callout under a held finger (styles.css).
  el.addClass("goodobsidian-hold-hint");
  const stop = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    start = null;
  };
  el.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    stop();
    shown = false;
    start = { x: event.clientX, y: event.clientY };
    timer = window.setTimeout(() => {
      timer = 0;
      shown = true;
      displayTooltip(el, hint(), { placement: "top" });
    }, HOLD_HINT_MS);
  });
  el.addEventListener("pointermove", (event) => {
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOLD_SLOP_PX) stop();
  });
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  // WebKit's own long press would open a callout or a menu over the hint.
  el.addEventListener("contextmenu", (event) => {
    if (shown || timer) event.preventDefault();
  });
  // Captured first, so the control's own click handler never sees it.
  el.addEventListener(
    "click",
    (event) => {
      if (!shown) return;
      shown = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
