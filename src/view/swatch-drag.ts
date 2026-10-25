/**
 * Holding a colour in the pen pill and dragging it off the pill removes it,
 * as an app leaves the Dock. The geometry is `swatch-drag-model.ts`; this is
 * the input and the drawing.
 *
 * - **Finger and Pencil:** touch events, as `page-drag.ts` reorders pages
 *   (CLAUDE.md ledger, "Finger drags in a scrolling panel"): rest on the
 *   colour for {@link HOLD_MS}, then move. A touch that moves sooner swipes
 *   the row, which scrolls natively, so `touchstart` is never cancelled;
 *   once the colour has lifted, `touchmove` is, and the long-press
 *   `contextmenu` is swallowed. Whether a held Pencil gets through WebKit's
 *   long press this way is unproven on the iPad.
 * - **Mouse:** the same hold, on pointer events.
 *
 * While held, a copy of the disc follows the pointer and the colour fades
 * where it was; the copy shrinks once it is clear of the pill. Let go there
 * and `onRemove` runs; anywhere else it goes back. The click a hold ends in
 * is swallowed, so it does not also pick the colour.
 */

import { HOLD_MS, POINTER_SLOP_PX, TOUCH_SLOP_PX } from "./page-drag-model";
import { offBar } from "./swatch-drag-model";

export interface SwatchDragOptions {
  /** The pill: a colour let go clear of it leaves the row. */
  bar: () => HTMLElement;
  onRemove: () => void;
}

/** How long after a hold ends its click is swallowed, ms. */
const SWALLOW_CLICK_MS = 700;

export function bindSwatchDrag(swatch: HTMLElement, options: SwatchDragOptions): void {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let touchId: number | null = null;
  let ghost: HTMLElement | null = null;
  let swallowUntil = 0;

  const place = (x: number, y: number): void => {
    if (!ghost) return;
    ghost.setCssProps({ "--gob-ghost-x": `${x}px`, "--gob-ghost-y": `${y}px` });
    const box = options.bar().getBoundingClientRect();
    ghost.toggleClass("is-off", offBar(box, x, y));
  };

  const lift = (x: number, y: number): void => {
    timer = 0;
    ghost = document.body.createDiv({ cls: "goodobsidian-swatch-ghost" });
    // The disc's own colour: the one inline style, as the swatch has.
    ghost.setCssStyles({ backgroundColor: getComputedStyle(swatch).backgroundColor });
    swatch.addClass("is-lifted");
    place(x, y);
  };

  const end = (x: number, y: number, cancelled: boolean): void => {
    window.clearTimeout(timer);
    timer = 0;
    touchId = null;
    if (!ghost) return;
    ghost.remove();
    ghost = null;
    swatch.removeClass("is-lifted");
    swallowUntil = Date.now() + SWALLOW_CLICK_MS;
    if (!cancelled && offBar(options.bar().getBoundingClientRect(), x, y)) options.onRemove();
  };

  const press = (x: number, y: number): void => {
    window.clearTimeout(timer);
    startX = x;
    startY = y;
    timer = window.setTimeout(() => lift(startX, startY), HOLD_MS);
  };

  /** A move before the hold: past the slop it is a swipe, and the hold is off. */
  const early = (x: number, y: number, slop: number): void => {
    if (timer && Math.hypot(x - startX, y - startY) > slop) {
      window.clearTimeout(timer);
      timer = 0;
    }
  };

  const touchOf = (event: TouchEvent): Touch | null => {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === touchId) return touch;
    }
    return null;
  };

  swatch.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        const last = event.changedTouches[0];
        end(last?.clientX ?? 0, last?.clientY ?? 0, true);
        return;
      }
      const touch = event.changedTouches[0];
      if (!touch) return;
      touchId = touch.identifier;
      press(touch.clientX, touch.clientY);
    },
    { passive: true },
  );
  swatch.addEventListener(
    "touchmove",
    (event) => {
      const touch = touchOf(event);
      if (!touch) return;
      if (!ghost) {
        early(touch.clientX, touch.clientY, TOUCH_SLOP_PX);
        return;
      }
      event.preventDefault();
      place(touch.clientX, touch.clientY);
    },
    { passive: false },
  );
  swatch.addEventListener("touchend", (event) => {
    const touch = touchOf(event);
    if (!touch) return;
    if (ghost) event.preventDefault();
    end(touch.clientX, touch.clientY, false);
  });
  swatch.addEventListener("touchcancel", (event) => {
    const touch = touchOf(event);
    end(touch?.clientX ?? 0, touch?.clientY ?? 0, true);
  });

  swatch.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    press(event.clientX, event.clientY);
    const move = (e: PointerEvent): void => {
      if (!ghost) early(e.clientX, e.clientY, POINTER_SLOP_PX);
      else place(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      end(e.clientX, e.clientY, e.type === "pointercancel");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });

  // The long press's menu, and the click a hold ends in.
  swatch.addEventListener("contextmenu", (event) => {
    if (timer || ghost) event.preventDefault();
  });
  swatch.addEventListener(
    "click",
    (event) => {
      if (Date.now() < swallowUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}
