/**
 * A long press shows a control's hint (the iPad has no hover), and the
 * press that showed it does not also press the control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));
const { tooltips } = await import("./fake-obsidian");
const { HOLD_HINT_MS, holdForHint } = await import("../../src/view/hold-hint");

type Handler = (event: Record<string, unknown>) => void;

/** An element that keeps its listeners, capture ones first as the browser runs them. */
function control(): {
  el: HTMLElement;
  fire: (type: string, event?: Record<string, unknown>) => Record<string, unknown>;
  pressed: ReturnType<typeof vi.fn>;
} {
  const listeners: Array<{ type: string; handler: Handler; capture: boolean }> = [];
  const pressed = vi.fn();
  const el = {
    addClass: vi.fn(),
    addEventListener: (type: string, handler: Handler, capture?: boolean) =>
      listeners.push({ type, handler, capture: capture === true }),
  } as unknown as HTMLElement;
  listeners.push({ type: "click", handler: () => pressed(), capture: false });
  const fire = (type: string, extra: Record<string, unknown> = {}): Record<string, unknown> => {
    let stopped = false;
    const event: Record<string, unknown> = {
      clientX: 0,
      clientY: 0,
      pointerType: "touch",
      ...extra,
      preventDefault: vi.fn(),
      stopImmediatePropagation: () => {
        stopped = true;
      },
    };
    const order = [...listeners.filter((l) => l.capture), ...listeners.filter((l) => !l.capture)];
    for (const listener of order) {
      if (stopped) break;
      if (listener.type === type) listener.handler(event);
    }
    return event;
  };
  return { el, fire, pressed };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  tooltips.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("holdForHint", () => {
  it("shows the hint after a long press, and that press does not press the control", () => {
    const { el, fire, pressed } = control();
    let state = "on";
    holdForHint(el, () => `Template: ${state}`);
    state = "off";
    fire("pointerdown");
    vi.advanceTimersByTime(HOLD_HINT_MS);
    expect(tooltips).toEqual(["Template: off"]);
    fire("pointerup");
    fire("click");
    expect(pressed).not.toHaveBeenCalled();
    // The next tap is a tap again.
    fire("pointerdown");
    fire("pointerup");
    fire("click");
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a quick tap, a mouse, or a finger that moves away", () => {
    const { el, fire, pressed } = control();
    holdForHint(el, () => "hint");
    fire("pointerdown");
    vi.advanceTimersByTime(HOLD_HINT_MS / 2);
    fire("pointerup");
    fire("click");
    fire("pointerdown", { pointerType: "mouse" });
    vi.advanceTimersByTime(HOLD_HINT_MS);
    fire("pointerdown");
    fire("pointermove", { clientX: 30 });
    vi.advanceTimersByTime(HOLD_HINT_MS);
    expect(tooltips).toEqual([]);
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});
