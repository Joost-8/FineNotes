/**
 * Recording a shortcut: while a binding slot waits, every key and button is
 * heard on the way down, before Obsidian or the notebook sees it, and the
 * first one becomes the row's input: a key, a right click, a pen's side
 * button or eraser end, a mouse's middle, back or forward button. Escape
 * cancels, and so does a plain tap or click anywhere: an iPad with no
 * keyboard must always have a way out.
 *
 * Kept out of the settings tab so the listeners are attached, stopped and
 * removed in one place. The reading itself is pure (`model/shortcut-bindings`).
 */

import {
  type ShortcutInput,
  buttonInput,
  isModifierKey,
  keyInput,
} from "../model/shortcut-bindings";

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
 * Listen for one key or button on `doc`'s window until one arrives, Escape
 * is pressed, or a plain tap or click lands anywhere. Every event read is
 * consumed: nothing reaches the notebook, the settings search field or the
 * control under the press (a right click's menu included).
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

  // The press that ends recording must not also press what is under it (the
  // slot again, or another row), nor open a right click's menu: what it
  // sends after (a tap's click; a button's menu and auxclick) is swallowed
  // once each, or let be if it does not come soon.
  const swallowNext = (types: readonly string[]): void => {
    for (const type of types) {
      const swallow = (event: Event): void => {
        stop(event);
        win.removeEventListener(type, swallow, true);
      };
      win.addEventListener(type, swallow, true);
      win.setTimeout(() => win.removeEventListener(type, swallow, true), CLICK_AFTER_TAP_MS);
    }
  };
  const AFTER_TAP = ["click"];
  const AFTER_BUTTON = ["contextmenu", "auxclick"];

  const onPointerDown = (event: PointerEvent): void => {
    stop(event);
    const input = buttonInput(event);
    swallowNext(input ? AFTER_BUTTON : AFTER_TAP);
    if (input) finish(input);
    else cancel();
  };

  // A hovering pen's side button or eraser end may come as moves alone.
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "pen" || (event.buttons & 1) !== 0) return;
    const input = buttonInput(event);
    if (!input) return;
    stop(event);
    swallowNext(AFTER_BUTTON);
    finish(input);
  };

  // An Android WebView may send a pen's side button (and some drivers a
  // right click) as this alone, with no press before it.
  const onContextMenu = (event: MouseEvent): void => {
    stop(event);
    const type = (event as Partial<PointerEvent>).pointerType;
    if (type === "touch") return;
    finish({
      type: "button",
      button: 2,
      mods: [],
      ...(type === "pen" ? { pen: true } : {}),
    });
  };

  const onBlur = (): void => cancel();

  const cleanup = (): void => {
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("keyup", onKeyUp, true);
    win.removeEventListener("pointerdown", onPointerDown, true);
    win.removeEventListener("pointermove", onPointerMove, true);
    win.removeEventListener("contextmenu", onContextMenu, true);
    win.removeEventListener("blur", onBlur, true);
  };

  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("keyup", onKeyUp, true);
  win.addEventListener("pointerdown", onPointerDown, true);
  win.addEventListener("pointermove", onPointerMove, true);
  win.addEventListener("contextmenu", onContextMenu, true);
  win.addEventListener("blur", onBlur, true);

  return { cancel };
}
