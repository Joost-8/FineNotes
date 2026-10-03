import { describe, expect, it, vi } from "vitest";
import { bindScrollThumb, type ScrollThumbState } from "../../src/view/scroll-thumb-drag";
function setup(vertical = true) {
  const handlers = new Map<string, (event: PointerEvent) => void>();
  const classes = new Set<string>();
  const captures = new Set<number>();
  const element = {
    ownerDocument: {
      defaultView: {
        addEventListener: (_name: string, fn: (event: PointerEvent) => void) =>
          handlers.set("window:blur", fn),
        removeEventListener: () => handlers.delete("window:blur"),
      },
    },
    classList: { add: (s: string) => classes.add(s), remove: (s: string) => classes.delete(s) },
    addEventListener: (name: string, listener: (event: PointerEvent) => void) =>
      handlers.set(name, listener),
    removeEventListener: (name: string) => handlers.delete(name),
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
  };
  const state: ScrollThumbState = {
    position: -100,
    minimum: -200,
    maximum: 800,
    viewport: 500,
    track: 500,
  };
  const activity = vi.fn();
  const scroll = vi.fn((position: number) => {
    state.position = position;
  });
  const dispose = bindScrollThumb(
    element as unknown as HTMLElement,
    vertical,
    () => state,
    scroll,
    activity,
  );
  const fire = (name: string, flags = {}) => {
    const e = {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 50,
      clientY: 50,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...flags,
    };
    handlers.get(name)?.(e as unknown as PointerEvent);
    return e;
  };
  return { state, activity, scroll, dispose, fire, classes, captures, handlers };
}
describe("scroll thumb pointer lifecycle", () => {
  it.each([true, false])(
    "drags axis %s using capture without propagating drawing input",
    (vertical) => {
      const s = setup(vertical);
      const down = s.fire("pointerdown");
      expect(down.preventDefault).toHaveBeenCalledOnce();
      expect(down.stopPropagation).toHaveBeenCalledOnce();
      expect(s.captures.has(1)).toBe(true);
      expect(s.classes.has("is-dragging")).toBe(true);
      const move = s.fire("pointermove", vertical ? { clientY: 150 } : { clientX: 150 });
      expect(s.state.position).toBeCloseTo(200);
      expect(move.preventDefault).toHaveBeenCalledOnce();
      s.fire("pointermove", vertical ? { clientY: 10000 } : { clientX: 10000 });
      expect(s.state.position).toBe(800);
      s.fire("pointerup");
      expect(s.captures.size).toBe(0);
      expect(s.classes.size).toBe(0);
    },
  );
  it.each(["pointercancel", "lostpointercapture", "window:blur"])("ends cleanly on %s", (event) => {
    const s = setup();
    s.fire("pointerdown");
    if (event === "lostpointercapture") s.captures.clear();
    s.fire(event);
    expect(s.classes.size).toBe(0);
    expect(s.captures.size).toBe(0);
    const calls = s.scroll.mock.calls.length;
    s.fire("pointermove", { clientY: 200 });
    expect(s.scroll).toHaveBeenCalledTimes(calls);
  });
  it("ignores secondary pointers/buttons, fitted content and unrelated moves/releases", () => {
    const s = setup();
    s.fire("pointermove");
    s.fire("pointerup");
    s.fire("pointerdown", { button: 2 });
    s.fire("pointerdown", { isPrimary: false });
    expect(s.scroll).not.toHaveBeenCalled();
    s.fire("pointerdown");
    s.fire("pointerdown", { pointerId: 2 });
    s.fire("pointermove", { pointerId: 2 });
    s.fire("pointerup", { pointerId: 2 });
    expect(s.scroll).toHaveBeenCalledOnce();
    s.fire("pointerup");
    s.state.maximum = s.state.minimum;
    s.fire("pointerdown");
    expect(s.scroll).toHaveBeenCalledOnce();
  });
  it("clamps overscroll, handles changed metrics and unloads without restarting activity timers", () => {
    const s = setup();
    s.state.position = -300;
    s.fire("pointerdown");
    expect(s.state.position).toBe(-200);
    s.state.viewport = 100;
    s.state.track = 100;
    s.fire("pointermove", { clientY: 114 });
    expect(s.state.position).toBe(800);
    const calls = s.activity.mock.calls.length;
    s.dispose();
    expect(s.activity).toHaveBeenCalledTimes(calls);
    expect(s.handlers.size).toBe(0);
    expect(s.captures.size).toBe(0);
    expect(s.classes.size).toBe(0);
    s.dispose();
  });
});
