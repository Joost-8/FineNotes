/**
 * Recording a shortcut: while a binding slot waits, every key is heard on
 * the way down, before Obsidian or the notebook sees it, and the first one
 * becomes the row's input. Escape cancels, and so does a tap or a click
 * anywhere: an iPad with no keyboard must always have a way out.
 *
 * Kept out of the settings tab so the listeners are attached, stopped and
 * removed in one place. The reading itself is pure (`model/shortcut-bindings`).
 */

import { type ShortcutInput, isModifierKey, keyInput } from "../model/shortcut-bindings";

export interface ShortcutRecorder {
  /** Stop listening without recording anything. */
  cancel(): void;
}

export interface RecorderCallbacks {
  record(input: ShortcutInput): void;
  cancel(): void;
}

/** How long the tap that cancelled recording may take to send its click, ms. */
const CLICK_AFTER_TAP_MS = 600;

/**
 * Listen for one key on `doc`'s window until one arrives, Escape is
 * pressed, or the pointer goes down anywhere. Every event read is consumed:
 * nothing reaches the notebook, the settings search field or the control
 * under the tap that cancelled.
 */
export function recordShortcut(doc: Document, callbacks: RecorderCallbacks): ShortcutRecorder {
  const win = doc.defaultView ?? window;
  let done = false;

  const stop = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const finish = (input: ShortcutInput | null): void => {
    if (done || !input) return;
    done = true;
    cleanup();
    callbacks.record(input);
  };

  const cancel = (): void => {
    if (done) return;
    done = true;
    cleanup();
    callbacks.cancel();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    stop(event);
    if (event.key === "Escape") {
      cancel();
      return;
    }
    if (event.repeat) return;
    // A modifier alone is not a shortcut yet: wait for the key that follows.
    if (isModifierKey(event.key)) return;
    finish(keyInput(event));
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    // Letting a modifier go without a key after it changes nothing.
    if (isModifierKey(event.key)) stop(event);
  };

  // The tap that cancels must not also press what is under it (the slot
  // again, or another row): its click is swallowed once, then let be.
  const swallowClick = (event: MouseEvent): void => {
    stop(event);
    win.removeEventListener("click", swallowClick, true);
  };

  const onPointerDown = (event: PointerEvent): void => {
    stop(event);
    win.addEventListener("click", swallowClick, true);
    win.setTimeout(() => win.removeEventListener("click", swallowClick, true), CLICK_AFTER_TAP_MS);
    cancel();
  };

  const onContextMenu = (event: MouseEvent): void => stop(event);

  const onBlur = (): void => cancel();

  const cleanup = (): void => {
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("keyup", onKeyUp, true);
    win.removeEventListener("pointerdown", onPointerDown, true);
    win.removeEventListener("contextmenu", onContextMenu, true);
    win.removeEventListener("blur", onBlur, true);
  };

  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("keyup", onKeyUp, true);
  win.addEventListener("pointerdown", onPointerDown, true);
  win.addEventListener("contextmenu", onContextMenu, true);
  win.addEventListener("blur", onBlur, true);

  return { cancel };
}
