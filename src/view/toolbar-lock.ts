/**
 * Lock toolbar (PURE): while on, holding a tool on the bar, in ⋯ or a pen in
 * the pill drags nothing, and neither does holding the bar's blank space to
 * move it to another edge (`bar-direct-gestures.ts`, `pen-type-drag.ts`).
 * The bar then changes only inside Customize toolbar, whose tray holds the
 * switch (`toolbar-edit.ts`). Off until the user turns it on.
 *
 * Kept per device, as the bar's edge is: the plugin hands in what it stored
 * and how to store a change (`initToolbarLock`), and every open notebook
 * reads the one value, so each window agrees without being told.
 */

let locked = false;
let persist: ((on: boolean) => void) | null = null;

/** What the device stored (anything but `true` / `"true"` is unlocked), and how to keep a change. */
export function initToolbarLock(stored: unknown, save: (on: boolean) => void): void {
  locked = stored === true || stored === "true";
  persist = save;
}

/** Whether the bar is locked now. */
export function toolbarLocked(): boolean {
  return locked;
}

/** Lock or unlock the bar, and keep it. */
export function setToolbarLocked(on: boolean): void {
  if (on === locked) return;
  locked = on;
  persist?.(on);
}
