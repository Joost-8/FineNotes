/**
 * Holding a pen type in the pen's row and dragging it puts it elsewhere in
 * the row — or onto the main toolbar to pin it there (`barDrop`).
 *
 * Unified with direct toolbar dragging (`bar-direct-gestures.ts`): once held
 * for {@link HOLD_MS}, a floating `.goodobsidian-edit-ghost` chip follows the
 * pointer while the dimmed button moves live between its siblings (shifting
 * other pens out of the way). Dragging onto the main toolbar keeps the same
 * ghost chip and live-previews pinning the pen into any bar slot.
 */

import { HOLD_MS, POINTER_SLOP_PX, TOUCH_SLOP_PX } from "./page-drag-model";
import { gapAt } from "../model/pen-type-order";
import { onWindowMoved, winOf } from "./host-window";
import { moveGhost } from "./bar-direct-gestures";

export interface PenTypeDragOptions {
  /** The row the pens stand in. */
  row: () => HTMLElement;
  /** Whether the row runs down (an upright pill) rather than across. */
  upright: () => boolean;
  /** The pen was let go in `gap` (`movePenType`). */
  onMove: (gap: number) => void;
  /** Optional drag-to-toolbar pinning: returns true while the pointer is over the main bar. */
  barDrop?: {
    onHover: (x: number, y: number) => boolean;
    onDrop: () => void;
    onCancel: () => void;
  };
}

/** How long after a hold ends its click is swallowed, ms. */
const SWALLOW_CLICK_MS = 700;

export function bindPenTypeDrag(pen: HTMLElement, options: PenTypeDragOptions): () => void {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let touchId: number | null = null;
  let ghost: HTMLElement | null = null;
  let activeWin: Window | null = null;
  let stopPointer: (() => void) | null = null;
  /** Other pen buttons in the row and their original order, for live reorder + cancel restore. */
  let startOrder: HTMLElement[] = [];
  let gap = 0;
  let overBar = false;
  let swallowUntil = 0;

  const along = (x: number, y: number): number => (options.upright() ? y : x);

  const restoreRowOrder = (): void => {
    const rowEl = options.row();
    for (const el of startOrder) rowEl.appendChild(el);
  };

  const place = (x: number, y: number): void => {
    if (!ghost) return;
    moveGhost(ghost, x, y);
    if (options.barDrop) {
      const hit = options.barDrop.onHover(x, y);
      if (hit) {
        if (!overBar) {
          overBar = true;
          restoreRowOrder();
        }
        return;
      }
      if (overBar) {
        overBar = false;
        options.barDrop.onCancel();
      }
    }

    const rowEl = options.row();
    const upright = options.upright();
    const others = Array.from(rowEl.querySelectorAll<HTMLElement>(".goodobsidian-pentype")).filter(
      (el) => el !== pen,
    );
    const centres = others.map((each) => {
      const box = each.getBoundingClientRect();
      return upright ? (box.top + box.bottom) / 2 : (box.left + box.right) / 2;
    });
    const otherGap = gapAt(centres, along(x, y));
    // Move `pen` live in the row so other pens slide out of the way.
    const before = others[otherGap] ?? null;
    if (before) {
      if (pen.nextElementSibling !== before) rowEl.insertBefore(pen, before);
    } else if (rowEl.lastElementChild !== pen) {
      rowEl.appendChild(pen);
    }
    // Convert index among `others` back to `movePenType`'s gap in the full `startOrder`.
    const origIdx = startOrder.indexOf(pen);
    gap = otherGap >= origIdx ? otherGap + 1 : otherGap;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    end(true);
  };

  const onBlur = (): void => {
    end(true);
  };

  const lift = (): void => {
    timer = 0;
    const row = options.row();
    if (!pen.isConnected || !row.isConnected) {
      end(true);
      return;
    }
    startOrder = Array.from(row.querySelectorAll<HTMLElement>(".goodobsidian-pentype"));
    gap = startOrder.indexOf(pen);
    const doc = pen.ownerDocument;
    ghost = doc.body.createDiv({ cls: "goodobsidian-edit-ghost" });
    const svg = pen.querySelector("svg");
    if (svg) ghost.appendChild(svg.cloneNode(true));
    pen.addClass("is-lifted");
    place(startX, startY);
  };

  const end = (cancelled: boolean): void => {
    window.clearTimeout(timer);
    timer = 0;
    touchId = null;
    stopPointer?.();
    stopPointer = null;
    if (activeWin) {
      activeWin.removeEventListener("keydown", onKeyDown, true);
      activeWin.removeEventListener("blur", onBlur);
      activeWin = null;
    }
    if (!ghost) return;
    const droppedOnBar = overBar;
    overBar = false;
    ghost.remove();
    ghost = null;
    pen.removeClass("is-lifted");
    swallowUntil = Date.now() + SWALLOW_CLICK_MS;
    if (droppedOnBar) {
      if (cancelled) options.barDrop?.onCancel();
      else options.barDrop?.onDrop();
      return;
    }
    if (cancelled) {
      restoreRowOrder();
      return;
    }
    options.onMove(gap);
  };

  const press = (x: number, y: number): void => {
    window.clearTimeout(timer);
    startX = x;
    startY = y;
    const win = winOf(pen);
    if (activeWin !== win) {
      activeWin?.removeEventListener("keydown", onKeyDown, true);
      activeWin?.removeEventListener("blur", onBlur);
      activeWin = win;
      win.addEventListener("keydown", onKeyDown, true);
      win.addEventListener("blur", onBlur);
    }
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
      if (!ghost) {
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
    if (ghost) {
      event.preventDefault();
      place(touch.clientX, touch.clientY);
    }
    end(false);
  });
  pen.addEventListener("touchcancel", (event) => {
    if (touchOf(event)) end(true);
  });

  pen.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    press(event.clientX, event.clientY);
    const win = winOf(pen);
    const move = (e: PointerEvent): void => {
      if (!ghost) early(e.clientX, e.clientY, POINTER_SLOP_PX);
      else place(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent): void => {
      if (ghost && e.type !== "pointercancel") place(e.clientX, e.clientY);
      end(e.type === "pointercancel");
    };
    stopPointer = () => {
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", up);
      win.removeEventListener("pointercancel", up);
    };
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", up);
    win.addEventListener("pointercancel", up);
  });

  // The long press's menu, and the click a hold ends in.
  pen.addEventListener("contextmenu", (event) => {
    if (timer || ghost) event.preventDefault();
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

  const stopMove = onWindowMoved(pen, () => end(true));
  return () => {
    stopMove();
    end(true);
  };
}
