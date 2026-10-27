/**
 * Picking the tool options pill up and putting it elsewhere, as in
 * GoodNotes: hold the pill for {@link HOLD_MS}, and it leaves its place and
 * shrinks to a small square showing the tool, which follows the finger; let
 * go and the host springs the pill to the nearest place (`pill-dock-model.ts`).
 *
 * - A colour in the row is not a handle: holding one drags the colour off
 *   instead (`swatch-drag.ts`). Anywhere else on the pill is, buttons
 *   included; the click a hold ends in is swallowed.
 * - **Finger and Pencil:** touch events, as `page-drag.ts`: `touchstart` is
 *   never cancelled (the colour row must still swipe), a touch that moves
 *   past the slop before the hold is a swipe or a tap, and once the pill has
 *   lifted `touchmove` is cancelled. Whether WebKit's long press cancels a
 *   held finger or Pencil here is unproven on the iPad.
 * - **Mouse:** the same hold, on pointer events.
 *
 * The tool bar is carried the same way (`toolbar.ts`, `dropBar`): its square
 * shows the edge it would land on (`iconAt`).
 */

import { setIcon } from "obsidian";
import { swallowGhostClick } from "./ghost-click";
import { HOLD_MS, POINTER_SLOP_PX, TOUCH_SLOP_PX } from "./page-drag-model";

export interface PillDragHost {
  /** The element the pill is placed in; the square is drawn there too. */
  host: HTMLElement;
  /** Whether the pill can be moved now (not while it floats by a text box). */
  canDrag(): boolean;
  /** The Lucide icon of the tool whose pill it is, for the square. */
  icon(): string;
  /** The icon the square shows while it is carried over (`x`, `y`), host px, if it changes. */
  iconAt?(x: number, y: number): string;
  /** The pill was let go at (`x`, `y`), host px: put it in its place. */
  onDrop(x: number, y: number): void;
}

/** How long after a hold ends its click is swallowed, ms. */
const SWALLOW_CLICK_MS = 700;

/** What on the pill is not a handle: a colour, which has its own hold. */
const NOT_A_HANDLE = ".goodobsidian-swatch";

export function bindPillDrag(pill: HTMLElement, drag: PillDragHost): void {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let touchId: number | null = null;
  let square: HTMLElement | null = null;
  let squareIcon = "";
  let swallowUntil = 0;

  const local = (x: number, y: number): { x: number; y: number } => {
    const box = drag.host.getBoundingClientRect();
    return { x: x - box.left, y: y - box.top };
  };

  const place = (x: number, y: number): void => {
    if (!square) return;
    const at = local(x, y);
    square.setCssProps({ "--gob-square-x": `${at.x}px`, "--gob-square-y": `${at.y}px` });
    const icon = drag.iconAt?.(at.x, at.y);
    if (icon && icon !== squareIcon) {
      squareIcon = icon;
      setIcon(square, icon);
    }
  };

  const lift = (x: number, y: number): void => {
    timer = 0;
    square = drag.host.createDiv({ cls: "goodobsidian-pill-square" });
    squareIcon = drag.icon();
    setIcon(square, squareIcon);
    pill.addClass("is-lifted");
    place(x, y);
  };

  const end = (x: number, y: number): void => {
    window.clearTimeout(timer);
    timer = 0;
    touchId = null;
    if (!square) return;
    square.remove();
    square = null;
    pill.removeClass("is-lifted");
    swallowUntil = Date.now() + SWALLOW_CLICK_MS;
    // Let go anywhere, a cancelled touch included: it goes to the place
    // nearest where the finger left it.
    const at = local(x, y);
    drag.onDrop(at.x, at.y);
  };

  const press = (target: EventTarget | null, x: number, y: number): boolean => {
    if (!drag.canDrag()) return false;
    if (target instanceof Element && target.closest(NOT_A_HANDLE)) return false;
    window.clearTimeout(timer);
    startX = x;
    startY = y;
    timer = window.setTimeout(() => lift(startX, startY), HOLD_MS);
    return true;
  };

  /** A move before the hold: past the slop it is a swipe or a tap, and the hold is off. */
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

  pill.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      if (event.touches.length !== 1 || !touch) {
        if (square) end(startX, startY);
        else window.clearTimeout(timer);
        return;
      }
      if (press(event.target, touch.clientX, touch.clientY)) touchId = touch.identifier;
    },
    { passive: true },
  );
  pill.addEventListener(
    "touchmove",
    (event) => {
      const touch = touchOf(event);
      if (!touch) return;
      if (!square) {
        early(touch.clientX, touch.clientY, TOUCH_SLOP_PX);
        return;
      }
      event.preventDefault();
      startX = touch.clientX;
      startY = touch.clientY;
      place(touch.clientX, touch.clientY);
    },
    { passive: false },
  );
  pill.addEventListener("touchend", (event) => {
    const touch = touchOf(event);
    if (!touch) return;
    if (square) event.preventDefault();
    end(touch.clientX, touch.clientY);
  });
  pill.addEventListener("touchcancel", (event) => {
    const touch = touchOf(event);
    end(touch?.clientX ?? startX, touch?.clientY ?? startY);
  });

  pill.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (!press(event.target, event.clientX, event.clientY)) return;
    const move = (e: PointerEvent): void => {
      if (!square) early(e.clientX, e.clientY, POINTER_SLOP_PX);
      else place(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      // Let go off the element it moved away from, the click goes to whatever is there.
      if (square) swallowGhostClick(pill.ownerDocument, e);
      end(e.clientX, e.clientY);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });

  // The long press's menu, and the click a hold ends in.
  pill.addEventListener("contextmenu", (event) => {
    if (timer || square) event.preventDefault();
  });
  pill.addEventListener(
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
