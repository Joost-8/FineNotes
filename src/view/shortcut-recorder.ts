/**
 * Recording a shortcut: while a binding slot waits, every key, pen button and
 * mouse button is heard on the way down, before Obsidian or the notebook sees
 * it, and the first one becomes the row's input. Escape cancels, and the
 * primary contact (left click, the pen's tip) is never a binding: it is how
 * the page draws.
 *
 * Kept out of the settings tab so the listeners are attached, stopped and
 * removed in one place. The reading itself is pure (`model/shortcut-bindings`).
 */

import {
  type ShortcutInput,
  isModifierKey,
  keyInput,
  pointerInput,
} from "../model/shortcut-bindings";

export interface ShortcutRecorder {
  /** Stop listening without recording anything. */
  cancel(): void;
}

export interface RecorderCallbacks {
  record(input: ShortcutInput): void;
  cancel(): void;
}

/**
 * Listen for one input on `doc`'s window until one arrives or Escape is
 * pressed. Every event read is consumed: nothing reaches the notebook, the
 * settings search field or a browser menu.
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
    if (done) return;
    if (!input) return;
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
    // A modifier alone is not a shortcut yet: wait for the key that follows,
    // or for Escape. (A bare modifier would be impossible to trigger again,
    // since the notebook ignores modifiers on their own.)
    if (isModifierKey(event.key)) return;
    finish(keyInput(event));
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    // Letting a modifier go without a key after it changes nothing.
    if (isModifierKey(event.key)) stop(event);
  };

  const onPointerDown = (event: PointerEvent): void => {
    // The primary contact is a left click or the pen's tip: it is drawing,
    // never a binding, and it must not reach a control behind the recorder.
    stop(event);
    const input = pointerInput(event);
    if (input) finish(input);
  };

  const onAuxClick = (event: MouseEvent): void => {
    const input = pointerInput(event);
    if (!input) return;
    stop(event);
    finish(input);
  };

  // A primary click's pointerdown is stopped above, but the click that follows
  // may still be dispatched; keep it from pressing the slot again or anything
  // else. Escape is the way to stop recording.
  const onClick = (event: MouseEvent): void => stop(event);
  const onMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) stop(event);
  };

  const onContextMenu = (event: MouseEvent): void => {
    // A stylus barrel button often arrives as nothing but a right-click.
    stop(event);
    finish(pointerInput(event));
  };

  const onBlur = (): void => cancel();

  const cleanup = (): void => {
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("keyup", onKeyUp, true);
    win.removeEventListener("pointerdown", onPointerDown, true);
    win.removeEventListener("auxclick", onAuxClick, true);
    win.removeEventListener("click", onClick, true);
    win.removeEventListener("mousedown", onMouseDown, true);
    win.removeEventListener("contextmenu", onContextMenu, true);
    win.removeEventListener("blur", onBlur, true);
  };

  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("keyup", onKeyUp, true);
  win.addEventListener("pointerdown", onPointerDown, true);
  win.addEventListener("auxclick", onAuxClick, true);
  win.addEventListener("click", onClick, true);
  win.addEventListener("mousedown", onMouseDown, true);
  win.addEventListener("contextmenu", onContextMenu, true);
  win.addEventListener("blur", onBlur, true);

  return { cancel };
}
