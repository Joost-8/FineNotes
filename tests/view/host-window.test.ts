import { afterEach, describe, expect, it, vi } from "vitest";
import {
  docOf,
  isElement,
  isHTMLElement,
  isNode,
  onWindowMoved,
  shownDoc,
  sizeObserver,
  watchSize,
  winOf,
} from "../../src/view/host-window";

afterEach(() => vi.unstubAllGlobals());

interface FakeObserver {
  observed: unknown[];
  disconnected: boolean;
  callback: () => void;
}

/** A window with its own `ResizeObserver`, as a popout has. */
function fakeWindow(): { win: object; made: FakeObserver[] } {
  const made: FakeObserver[] = [];
  class Observer {
    readonly record: FakeObserver;
    constructor(callback: () => void) {
      this.record = { observed: [], disconnected: false, callback };
      made.push(this.record);
    }
    observe(el: unknown): void {
      this.record.observed.push(el);
    }
    disconnect(): void {
      this.record.disconnected = true;
    }
  }
  return { win: { ResizeObserver: Observer }, made };
}

describe("the window an element is shown in", () => {
  it("is the element's own, not the main one", () => {
    const main = { name: "main" };
    const popout = { name: "popout" };
    vi.stubGlobal("window", main);
    const el = { ownerDocument: { defaultView: popout } } as unknown as Node;
    expect(winOf(el)).toBe(popout);
    expect(docOf(el)).toBe(el.ownerDocument);
  });

  it("falls back to the main window for an element in no window", () => {
    const main = { name: "main" };
    vi.stubGlobal("window", main);
    expect(winOf({ ownerDocument: { defaultView: null } } as unknown as Node)).toBe(main);
    expect(winOf(undefined)).toBe(main);
  });

  it("opens popovers in the window in use", () => {
    const main = { body: {} };
    const popout = { body: {} };
    vi.stubGlobal("document", main);
    expect(shownDoc()).toBe(main);
    vi.stubGlobal("activeDocument", popout);
    expect(shownDoc()).toBe(popout);
  });
});

describe("watching an element across windows", () => {
  it("does nothing where Obsidian has no window moves", () => {
    expect(() => onWindowMoved({} as HTMLElement, () => {})()).not.toThrow();
  });

  it("takes its ResizeObserver from the element's window", () => {
    const { win, made } = fakeWindow();
    const el = { ownerDocument: { defaultView: win } } as unknown as Node;
    sizeObserver(el, () => {});
    expect(made).toHaveLength(1);
  });

  it("observes again in the new window when the element moves", () => {
    const first = fakeWindow();
    const second = fakeWindow();
    let moved: () => void = () => {};
    const stopMoves = vi.fn();
    const shownIn = { defaultView: first.win };
    const el = {
      ownerDocument: shownIn,
      onWindowMigrated: (listener: () => void) => {
        moved = listener;
        return stopMoves;
      },
    } as unknown as HTMLElement;
    const stop = watchSize(el, () => {});
    expect(first.made[0].observed).toEqual([el]);

    shownIn.defaultView = second.win;
    moved();
    expect(first.made[0].disconnected).toBe(true);
    expect(second.made[0].observed).toEqual([el]);

    stop();
    expect(stopMoves).toHaveBeenCalled();
    expect(second.made[0].disconnected).toBe(true);
  });
});

describe("nodes from another window", () => {
  it("are recognised without this window's classes", () => {
    const element = { nodeType: 1, dataset: {} };
    const svg = { nodeType: 1 };
    const text = { nodeType: 3 };
    expect(isNode(text)).toBe(true);
    expect(isElement(element)).toBe(true);
    expect(isElement(text)).toBe(false);
    expect(isHTMLElement(element)).toBe(true);
    expect(isHTMLElement(svg)).toBe(false);
  });

  it("are not confused with other values", () => {
    for (const value of [null, undefined, 1, "x", {}]) {
      expect(isNode(value)).toBe(false);
      expect(isElement(value)).toBe(false);
      expect(isHTMLElement(value)).toBe(false);
    }
  });
});
