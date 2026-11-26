/**
 * A long press on a Home card: every element under `root` with a
 * `data-hold-key` can be held. The lift's click and the long press's own
 * menu are swallowed, so a hold never also opens or picks again. Listens on
 * `root` once, so cards painted later need nothing of their own.
 */

import { winOf } from "./host-window";
import { HOLD_MS, HoldPress } from "./hold-press";

export function bindCardHold(root: HTMLElement, onHold: (key: string) => void): void {
  const win = winOf(root);
  const press = new HoldPress();
  let timer = 0;
  const stop = (): void => {
    win.clearTimeout(timer);
    timer = 0;
    press.end();
  };
  root.addEventListener("pointerdown", (event) => {
    stop();
    const card = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-hold-key]");
    const key = card?.dataset.holdKey;
    if (key === undefined || event.button > 0) return;
    if (!press.down(event.pointerId, event.pointerType, event.clientX, event.clientY, key)) return;
    timer = win.setTimeout(() => {
      timer = 0;
      const held = press.fire(Date.now());
      if (held !== null) onHold(held);
    }, HOLD_MS);
  });
  root.addEventListener("pointermove", (event) =>
    press.move(event.pointerId, event.clientX, event.clientY),
  );
  for (const type of ["pointerup", "pointercancel", "dragstart"] as const)
    root.addEventListener(type, stop);
  root.addEventListener("scroll", stop, { capture: true, passive: true });
  root.addEventListener(
    "click",
    (event) => {
      if (!press.takeClick(Date.now())) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
  root.addEventListener(
    "contextmenu",
    (event) => {
      if (!press.justHeld(Date.now())) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
}
