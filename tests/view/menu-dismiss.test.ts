import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Menu } from "obsidian";
import { closeMenuOnPressOutside } from "../../src/view/menu-dismiss";

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

class FakeElement {
  constructor(private readonly inside: FakeElement[] = []) {}
  contains(other: unknown): boolean {
    return other === this || this.inside.includes(other as FakeElement);
  }
}

type Listener = (event: Record<string, unknown>) => void;

/** A document and its window, recording capture-phase listeners by name. */
function fakeDom() {
  const item = new FakeElement();
  const menuEl = new FakeElement([item]);
  const listeners = new Map<string, Set<Listener>>();
  const on = (name: string, fn: Listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)?.add(fn);
  };
  const off = (name: string, fn: Listener) => listeners.get(name)?.delete(fn);
  const win = { Element: FakeElement, addEventListener: on, removeEventListener: off };
  const doc = {
    defaultView: win,
    querySelectorAll: () => [menuEl],
    addEventListener: on,
    removeEventListener: off,
  };
  const fire = (name: string, fields: Record<string, unknown>) => {
    const event = {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      timeStamp: 1000,
      clientX: 50,
      clientY: 60,
      detail: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      ...fields,
    };
    for (const fn of [...(listeners.get(name) ?? [])]) fn(event);
    return event;
  };
  return { doc: doc as unknown as Document, item, fire, listeners };
}

function fakeMenu() {
  const hides: Array<() => void> = [];
  const menu = {
    hidden: 0,
    hide: () => {
      menu.hidden++;
      for (const fn of hides) fn();
    },
    onHide: (fn: () => void) => hides.push(fn),
  };
  return menu;
}

describe("closeMenuOnPressOutside", () => {
  it("leaves the menu open for a press on it", () => {
    const dom = fakeDom();
    const menu = fakeMenu();
    closeMenuOnPressOutside(menu as unknown as Menu, dom.doc, () => false);
    dom.fire("pointerdown", { target: dom.item });
    expect(menu.hidden).toBe(0);
  });

  it("closes on a press anywhere else, and stops listening", () => {
    const dom = fakeDom();
    const menu = fakeMenu();
    closeMenuOnPressOutside(menu as unknown as Menu, dom.doc, () => false);
    dom.fire("pointerdown", { target: new FakeElement() });
    expect(menu.hidden).toBe(1);
    expect(dom.listeners.get("pointerdown")?.size).toBe(0);
  });

  it("stops a pen's closing press on the page, so it does not draw", () => {
    const dom = fakeDom();
    const menu = fakeMenu();
    closeMenuOnPressOutside(menu as unknown as Menu, dom.doc, () => true);
    const down = dom.fire("pointerdown", { target: new FakeElement(), pointerType: "pen" });
    expect(down.preventDefault).toHaveBeenCalled();
    expect(menu.hidden).toBe(1);
  });

  it("with swallowClick, the closing tap's click does not reach what is under it", () => {
    const dom = fakeDom();
    const menu = fakeMenu();
    closeMenuOnPressOutside(menu as unknown as Menu, dom.doc, () => false, {
      swallowClick: true,
    });
    dom.fire("pointerdown", { target: new FakeElement() });
    dom.fire("pointerup", { timeStamp: 1080 });
    const click = dom.fire("click", { timeStamp: 1120 });
    expect(click.stopImmediatePropagation).toHaveBeenCalled();
    // The next tap is an ordinary one.
    const next = dom.fire("click", { timeStamp: 1200 });
    expect(next.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("without swallowClick, the click goes on as before", () => {
    const dom = fakeDom();
    const menu = fakeMenu();
    closeMenuOnPressOutside(menu as unknown as Menu, dom.doc, () => false);
    dom.fire("pointerdown", { target: new FakeElement() });
    dom.fire("pointerup", { timeStamp: 1080 });
    const click = dom.fire("click", { timeStamp: 1120 });
    expect(click.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("a cancelled press (a scroll) arms nothing", () => {
    const dom = fakeDom();
    const menu = fakeMenu();
    closeMenuOnPressOutside(menu as unknown as Menu, dom.doc, () => false, {
      swallowClick: true,
    });
    dom.fire("pointerdown", { target: new FakeElement() });
    dom.fire("pointercancel", {});
    expect(dom.listeners.get("pointerup")?.size).toBe(0);
    expect(dom.listeners.get("click")?.size ?? 0).toBe(0);
  });
});
