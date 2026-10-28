/**
 * Holding a pen type in the pen's row and dragging it puts it elsewhere in
 * the row, as Goodnotes' pens are reordered. The order is
 * `model/pen-type-order.ts`; this is the input and the drawing.
 *
 * - **Finger and Pencil:** touch events, as the colours are dragged off
 *   (`swatch-drag.ts`; CLAUDE.md ledger, "Finger drags in a scrolling
 *   panel"): rest on the pen for {@link HOLD_MS}, then move. A touch that
 *   moves sooner swipes the row, which scrolls natively, so `touchstart` is
 *   never cancelled; once the pen has lifted, `touchmove` is, and the
 *   long-press `contextmenu` is swallowed. Whether a held Pencil gets
 *   through WebKit's long press this way is unproven on the iPad.
 * - **Mouse:** the same hold, on pointer events.
 *
 * While held, the pen follows the pointer along the row and a line marks
 * the gap it would land in. Let go and `onMove` gets that gap; a cancelled
 * touch puts it back. The click a hold ends in is swallowed, so it does not
 * also pick the pen.
 */

import { HOLD_MS, POINTER_SLOP_PX, TOUCH_SLOP_PX } from "./page-drag-model";
import { gapAt, gapMark } from "../model/pen-type-order";

export interface PenTypeDragOptions {
  /** The row the pens stand in; the gap's mark is drawn there. */
  row: () => HTMLElement;
  /** Whether the row runs down (an upright pill) rather than across. */
  upright: () => boolean;
  /** The pen was let go in `gap` (`movePenType`). */
  onMove: (gap: number) => void;
}

/** How long after a hold ends its click is swallowed, ms. */
const SWALLOW_CLICK_MS = 700;

export function bindPenTypeDrag(pen: HTMLElement, options: PenTypeDragOptions): void {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let touchId: number | null = null;
  let mark: HTMLElement | null = null;
  /** The pens' spans along the row as it stood when this one was lifted. */
  let spans: Array<{ start: number; end: number }> = [];
  let gap = 0;
  let swallowUntil = 0;

  const along = (x: number, y: number): number => (options.upright() ? y : x);

  const place = (x: number, y: number): void => {
    if (!mark) return;
    const upright = options.upright();
    const shift = along(x, y) - along(startX, startY);
    pen.setCssProps({ "--gob-pen-shift": `${shift}px` });
    gap = gapAt(
      spans.map((span) => (span.start + span.end) / 2),
      along(x, y),
    );
    // In the row's own coordinates, which scroll with it.
    const rowEl = options.row();
    const row = rowEl.getBoundingClientRect();
    const at = upright
      ? gapMark(spans, gap) - row.top + rowEl.scrollTop
      : gapMark(spans, gap) - row.left + rowEl.scrollLeft;
    mark.setCssProps({ "--gob-pen-gap": `${at}px` });
  };

  const lift = (): void => {
    timer = 0;
    const row = options.row();
    const upright = options.upright();
    spans = Array.from(row.querySelectorAll<HTMLElement>(".goodobsidian-pentype")).map((each) => {
      const box = each.getBoundingClientRect();
      return upright ? { start: box.top, end: box.bottom } : { start: box.left, end: box.right };
    });
    mark = row.createDiv({ cls: "goodobsidian-pentype-gap" });
    pen.addClass("is-lifted");
    place(startX, startY);
  };

  const end = (cancelled: boolean): void => {
    window.clearTimeout(timer);
    timer = 0;
    touchId = null;
    if (!mark) return;
    mark.remove();
    mark = null;
    pen.removeClass("is-lifted");
    pen.setCssProps({ "--gob-pen-shift": "0px" });
    swallowUntil = Date.now() + SWALLOW_CLICK_MS;
    if (!cancelled) options.onMove(gap);
  };

  const press = (x: number, y: number): void => {
    window.clearTimeout(timer);
    startX = x;
    startY = y;
    timer = window.setTimeout(lift, HOLD_MS);
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

  pen.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        end(true);
        return;
      }
      const touch = event.changedTouches[0];
      if (!touch) return;
      touchId = touch.identifier;
      press(touch.clientX, touch.clientY);
    },
    { passive: true },
  );
  pen.addEventListener(
    "touchmove",
    (event) => {
      const touch = touchOf(event);
      if (!touch) return;
      if (!mark) {
        early(touch.clientX, touch.clientY, TOUCH_SLOP_PX);
        return;
      }
      event.preventDefault();
      place(touch.clientX, touch.clientY);
    },
    { passive: false },
  );
  pen.addEventListener("touchend", (event) => {
    const touch = touchOf(event);
    if (!touch) return;
    if (mark) event.preventDefault();
    end(false);
  });
  pen.addEventListener("touchcancel", (event) => {
    if (touchOf(event)) end(true);
  });

  pen.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    press(event.clientX, event.clientY);
    const move = (e: PointerEvent): void => {
      if (!mark) early(e.clientX, e.clientY, POINTER_SLOP_PX);
      else place(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      end(e.type === "pointercancel");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });

  // The long press's menu, and the click a hold ends in.
  pen.addEventListener("contextmenu", (event) => {
    if (timer || mark) event.preventDefault();
  });
  pen.addEventListener(
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
