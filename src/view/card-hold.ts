/**
 * A long press on a Home card: every element under `root` with a
 * `data-hold-key` can be held. Touch events and a timer, as Obsidian's own
 * reorder does (ipad-input lessons, 2026-10-14), so a finger still scrolls
 * the list and nothing is prevented. The lift's click goes through
 * `swallowGhostClick`, and the long press's own menu is swallowed, so a hold
 * never also opens or picks again. A mouse never holds; it right-clicks.
 * Listens on `root` once, so cards painted later need nothing of their own.
 */

import { isElement, winOf } from "./host-window";
import { swallowGhostClick } from "./ghost-click";
import { HOLD_MS, HoldPress } from "./hold-press";

export function bindCardHold(root: HTMLElement, onHold: (key: string) => void): void {
  const win = winOf(root);
  const doc = root.ownerDocument;
  const press = new HoldPress();
  let timer = 0;
  const clear = (): void => {
    win.clearTimeout(timer);
    timer = 0;
  };
  const held = (key: string | null): void => {
    if (key === null) return;
    onHold(key);
    // The lift's click is the hold's; a cancelled touch makes none.
    const up = (event: PointerEvent): void => {
      off();
      swallowGhostClick(doc, event);
    };
    const off = (): void => {
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", off);
    };
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", off);
  };
  root.addEventListener(
    "touchstart",
    (event) => {
      clear();
      press.end();
      const touch = event.changedTouches[0];
      const target = isElement(event.target) ? event.target : null;
      const key = target?.closest<HTMLElement>("[data-hold-key]")?.dataset.holdKey;
      if (event.touches.length !== 1 || !touch || key === undefined) return;
      press.down(touch.identifier, touch.clientX, touch.clientY, key, win.performance.now());
      timer = win.setTimeout(() => {
        timer = 0;
        held(press.fire(win.performance.now()));
      }, HOLD_MS);
    },
    { passive: true },
  );
  root.addEventListener(
    "touchmove",
    (event) => {
      for (const touch of Array.from(event.changedTouches))
        press.move(touch.identifier, touch.clientX, touch.clientY);
    },
    { passive: true },
  );
  root.addEventListener("touchend", () => {
    clear();
    press.end();
  });
  root.addEventListener("touchcancel", () => {
    clear();
    held(press.cancelled(win.performance.now()));
  });
  root.addEventListener(
    "contextmenu",
    (event) => {
      if (!press.justHeld(win.performance.now())) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
}
