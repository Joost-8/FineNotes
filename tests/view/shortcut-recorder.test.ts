/**
 * Recording a binding (`src/view/shortcut-recorder.ts`): the listeners are on
 * the capture phase, the first key or non-primary button wins, Escape cancels,
 * and nothing is left listening afterwards. The readings themselves are
 * `model/shortcut-bindings.ts`; this pins when a reading is taken.
 */

import { describe, expect, it, vi } from "vitest";
import { recordShortcut } from "../../src/view/shortcut-recorder";

type Handler = (event: unknown) => void;

class FakeWindow {
  readonly listeners = new Map<string, Set<Handler>>();

  addEventListener(type: string, handler: Handler): void {
    const set = this.listeners.get(type) ?? new Set<Handler>();
    set.add(handler);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, handler: Handler): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type: string, event: unknown): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
  }

  get listening(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

function recording() {
  const win = new FakeWindow();
  const record = vi.fn();
  const cancel = vi.fn();
  const recorder = recordShortcut({ defaultView: win } as unknown as Document, { record, cancel });
  return { win, record, cancel, recorder };
}

function keyEvent(
  key: string,
  mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...mods,
  };
}

function pointerEvent(button: number, buttons = 0) {
  return {
    button,
    buttons,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

describe("recording an input", () => {
  it("takes the first key and stops listening", () => {
    const { win, record, recorder } = recording();
    win.emit("keydown", keyEvent("p", { ctrlKey: true }));
    expect(record).toHaveBeenCalledWith({ type: "key", key: "p", mods: ["Mod"] });
    expect(win.listening).toBe(0);
    recorder.cancel();
    expect(win.listening).toBe(0);
  });

  it("waits through a bare modifier until a key follows", () => {
    const { win, record } = recording();
    win.emit("keydown", keyEvent("Shift"));
    expect(record).not.toHaveBeenCalled();
    expect(win.listening).toBeGreaterThan(0);
    win.emit("keydown", keyEvent("Z", { shiftKey: true }));
    expect(record).toHaveBeenCalledWith({ type: "key", key: "z", mods: ["Shift"] });
  });

  it("cancels on Escape without recording", () => {
    const { win, record, cancel, recorder } = recording();
    win.emit("keydown", keyEvent("Escape"));
    expect(cancel).toHaveBeenCalledOnce();
    expect(record).not.toHaveBeenCalled();
    expect(win.listening).toBe(0);
    recorder.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("ignores and consumes the primary contact, then takes the barrel button", () => {
    const { win, record } = recording();
    const tip = pointerEvent(0);
    win.emit("pointerdown", tip);
    expect(record).not.toHaveBeenCalled();
    // It is not a binding, but it must not press a control behind the slot.
    expect(tip.preventDefault).toHaveBeenCalled();
    expect(tip.stopImmediatePropagation).toHaveBeenCalled();
    expect(win.listening).toBeGreaterThan(0);

    const click = pointerEvent(0);
    win.emit("click", click);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();

    const barrel = pointerEvent(2);
    win.emit("pointerdown", barrel);
    expect(record).toHaveBeenCalledWith({ type: "pointer", button: 2, mods: [] });
    expect(barrel.preventDefault).toHaveBeenCalled();
    expect(barrel.stopImmediatePropagation).toHaveBeenCalled();
  });

  it("takes the eraser end reported as no button but with its bit", () => {
    const { win, record } = recording();
    win.emit("pointerdown", pointerEvent(0, 32));
    expect(record).toHaveBeenCalledWith({ type: "pointer", button: 5, mods: [] });
  });

  it("turns a right-click into the same pointer input", () => {
    const { win, record } = recording();
    win.emit("contextmenu", pointerEvent(2));
    expect(record).toHaveBeenCalledWith({ type: "pointer", button: 2, mods: [] });
  });
});
