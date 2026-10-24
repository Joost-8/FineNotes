import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GHOST_CLICK_MS, GHOST_CLICK_PX, swallowGhostClick } from "../../src/view/ghost-click";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A document that records its capture-phase click listeners. */
function fakeDocument() {
  const listeners = new Set<(event: MouseEvent) => void>();
  const doc = {
    addEventListener: (name: string, fn: (event: MouseEvent) => void, capture: boolean) => {
      expect(name).toBe("click");
      expect(capture).toBe(true);
      listeners.add(fn);
    },
    removeEventListener: (_name: string, fn: (event: MouseEvent) => void) => {
      listeners.delete(fn);
    },
  };
  const click = (fields: Partial<MouseEvent> = {}) => {
    const event = {
      timeStamp: 1100,
      clientX: 100,
      clientY: 200,
      detail: 1,
      stopImmediatePropagation: vi.fn(),
      preventDefault: vi.fn(),
      ...fields,
    };
    for (const fn of [...listeners]) fn(event as unknown as MouseEvent);
    return event;
  };
  return { doc: doc as unknown as Document, listeners, click };
}

const up = (fields: Partial<PointerEvent> = {}) =>
  ({ timeStamp: 1000, clientX: 100, clientY: 200, ...fields }) as PointerEvent;

describe("swallowGhostClick", () => {
  it("eats the click Android makes from the tap, so a dialog it opened stays open", () => {
    const { doc, listeners, click } = fakeDocument();
    swallowGhostClick(doc, up());
    const ghost = click({ clientX: 104, clientY: 197 });
    expect(ghost.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(ghost.preventDefault).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("lets the next real click through when no ghost came (the iPad)", () => {
    const { doc, listeners, click } = fakeDocument();
    swallowGhostClick(doc, up());
    const late = click({ timeStamp: 1000 + GHOST_CLICK_MS + 1 });
    expect(late.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("stops watching after GHOST_CLICK_MS, so a quick second tap there is not eaten", () => {
    const { doc, listeners, click } = fakeDocument();
    swallowGhostClick(doc, up());
    vi.advanceTimersByTime(GHOST_CLICK_MS - 1);
    expect(listeners.size).toBe(1);
    vi.advanceTimersByTime(1);
    expect(listeners.size).toBe(0);
    expect(click().stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("lets a click elsewhere through, and stops watching", () => {
    const { doc, listeners, click } = fakeDocument();
    swallowGhostClick(doc, up());
    const far = click({ clientX: 100 + GHOST_CLICK_PX + 1 });
    expect(far.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(click().stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("never eats a keyboard click", () => {
    const { doc, click } = fakeDocument();
    swallowGhostClick(doc, up());
    expect(click({ detail: 0 }).stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("watches for one tap at a time: a new tap replaces the last one's watch", () => {
    const { doc, listeners, click } = fakeDocument();
    swallowGhostClick(doc, up());
    swallowGhostClick(doc, up({ timeStamp: 5000, clientX: 300 }));
    expect(listeners.size).toBe(1);
    const ghost = click({ timeStamp: 5050, clientX: 302 });
    expect(ghost.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});
