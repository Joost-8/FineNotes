import { describe, expect, it, vi } from "vitest";
import { AFTER_PAINTED_MAX_MS, afterPainted } from "../../src/view/after-painted";

function host() {
  const frames = new Map<number, () => void>();
  let next = 1;
  const win = {
    requestAnimationFrame: (run: () => void) => {
      frames.set(next, run);
      return next++;
    },
    cancelAnimationFrame: (id: number) => void frames.delete(id),
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  } as unknown as Window;
  const frame = (): void => {
    const due = [...frames.values()];
    frames.clear();
    for (const run of due) run();
  };
  return { win, frame, pending: () => frames.size };
}

describe("afterPainted", () => {
  it("runs after the second frame, once", () => {
    vi.useFakeTimers();
    const { win, frame } = host();
    const go = vi.fn();
    afterPainted(win, go);
    frame();
    expect(go).not.toHaveBeenCalled();
    frame();
    expect(go).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AFTER_PAINTED_MAX_MS * 2);
    expect(go).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("runs anyway when no frame comes", () => {
    vi.useFakeTimers();
    const { win, pending } = host();
    const go = vi.fn();
    afterPainted(win, go);
    vi.advanceTimersByTime(AFTER_PAINTED_MAX_MS);
    expect(go).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(0);
    vi.useRealTimers();
  });

  it("runs nothing once cancelled", () => {
    vi.useFakeTimers();
    const { win, frame } = host();
    const go = vi.fn();
    const stop = afterPainted(win, go);
    frame();
    stop();
    frame();
    vi.advanceTimersByTime(AFTER_PAINTED_MAX_MS * 2);
    expect(go).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
