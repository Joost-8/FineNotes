import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../CHANGELOG.md", () => ({ default: "" }));

const { InkSurface } = await import("../../src/view/ink-surface");

interface Moved {
  surfaceEl: unknown;
  boundWin: unknown;
  frameReq: number;
  wetFrame: number;
  relayoutFrame: number;
  zoomPaintFrame: number;
  windowListeners: (() => void) | null;
  renderer: unknown;
  frame: () => void;
  scheduleRelayout: () => void;
  windowMoved(): void;
  bindWindow(): void;
}

function fakeWin() {
  const listeners = new Set<string>();
  const doc = {
    addEventListener: (type: string) => listeners.add(type),
    removeEventListener: (type: string) => listeners.delete(type),
    visibilityState: "visible",
  };
  const win = {
    document: doc,
    requestAnimationFrame: vi.fn(() => 7),
    cancelAnimationFrame: vi.fn(),
    addEventListener: (type: string) => listeners.add(type),
    removeEventListener: (type: string) => listeners.delete(type),
    visualViewport: null,
  };
  Object.assign(doc, { defaultView: win });
  return { win, doc, listeners };
}

describe("a notebook moved to another window (FineNotes#199)", () => {
  it("asks the new window for frames, and drops those the old one owed", () => {
    const from = fakeWin();
    const to = fakeWin();
    const surface = Object.create(InkSurface.prototype) as Moved;
    Object.assign(surface, {
      surfaceEl: { ownerDocument: from.doc },
      frameReq: 11,
      wetFrame: 12,
      relayoutFrame: 0,
      zoomPaintFrame: 13,
      windowListeners: null,
      renderer: { repaintAll: vi.fn() },
      scheduleRelayout: vi.fn(),
    });
    surface.bindWindow();
    expect(from.listeners.has("visibilitychange")).toBe(true);

    surface.surfaceEl = { ownerDocument: to.doc };
    surface.windowMoved();

    expect(from.win.cancelAnimationFrame.mock.calls.map(([id]) => id as number)).toEqual([
      11, 12, 13,
    ]);
    expect(surface.wetFrame).toBe(0);
    expect(surface.zoomPaintFrame).toBe(0);
    // A request standing on the old window no longer blocks the next frame.
    expect(to.win.requestAnimationFrame).toHaveBeenCalledWith(surface.frame);
    expect(surface.frameReq).toBe(7);
    expect(from.listeners.size).toBe(0);
    expect(to.listeners.has("visibilitychange")).toBe(true);
    expect(to.listeners.has("blur")).toBe(true);
  });
});
