/**
 * Where the text pill floats by its box (`Toolbar.anchoredPlace`): under
 * it, centred; over it when the keyboard or the screen's bottom leaves no
 * room under it; under the tool bar when neither side has room.
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const keyboard = { height: 0 };
vi.mock("../../src/view/keyboard", () => ({ keyboardHeight: () => keyboard.height }));
const { Toolbar } = await import("../../src/view/toolbar");

type Fake = Record<string, unknown>;
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

function pill(
  anchor: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    typing?: boolean;
    clipTop?: number;
    clipBottom?: number;
    moving?: boolean;
  } | null,
  pinned = false,
) {
  const t: Fake = Object.assign(Object.create(Toolbar.prototype), {
    textAnchor: anchor,
    textTarget: { color: "#1a1a1a", fontSize: 18 },
    state: { textPinned: pinned },
    leftInset: 0,
    optionsEl: { hasClass: (c: string) => c === "is-text" },
    // The host fills an 1180 x 820 window from y = 50; the tool bar ends at y = 120.
    host: { ownerDocument: { defaultView: { innerHeight: 820 } } },
    barBottom: () => 78,
  });
  const place = (pillW = 600, pillH = 46) =>
    (t.anchoredPlace as (h: DOMRect, p: DOMRect) => { left: number; top: number } | null).call(
      t,
      rect(0, 50, 1180, 770),
      rect(0, 0, pillW, pillH),
    );
  return place;
}

describe("the floating text pill", () => {
  it("floats under its box, centred on it", () => {
    keyboard.height = 0;
    const place = pill({ left: 500, top: 300, right: 700, bottom: 340 });
    // Host px: the box's bottom 340 - 50 + a 10 px gap; centred on x 600.
    expect(place()).toEqual({ left: 300, top: 300 });
  });

  it("goes over the box when the keyboard covers the room under it", () => {
    keyboard.height = 450;
    const place = pill({ left: 500, top: 300, right: 700, bottom: 340 });
    // 300 - 50 - 10 - 46: just over the box.
    expect(place()).toEqual({ left: 300, top: 194 });
    keyboard.height = 0;
  });

  it("floats over a box being typed in, as GoodNotes does, even with room under it", () => {
    keyboard.height = 0;
    const place = pill({ left: 500, top: 300, right: 700, bottom: 340, typing: true });
    expect(place()).toEqual({ left: 300, top: 194 });
    // No room over it (just under the tool bar): under it after all.
    const high = pill({ left: 500, top: 140, right: 700, bottom: 180, typing: true });
    expect(high()).toEqual({ left: 300, top: 140 });
  });

  it("stays inside the page area at the sides", () => {
    keyboard.height = 0;
    expect(pill({ left: 0, top: 300, right: 40, bottom: 340 })()?.left).toBe(8);
    expect(pill({ left: 1140, top: 300, right: 1180, bottom: 340 })()?.left).toBe(1180 - 600 - 8);
  });

  it("gives up for a box with no room on either side, and without a box", () => {
    keyboard.height = 0;
    expect(pill({ left: 500, top: 60, right: 700, bottom: 800 })()).toBeNull();
    expect(pill(null)()).toBeNull();
  });
});

describe("the floating text pill and a box out of sight", () => {
  it("hides with a box scrolled above the tool bar or below the screen", () => {
    keyboard.height = 0;
    expect(pill({ left: 500, top: 40, right: 700, bottom: 120 })()).toBe("hidden");
    expect(pill({ left: 500, top: 900, right: 700, bottom: 950 })()).toBe("hidden");
    // Under the keyboard counts as out of sight.
    keyboard.height = 450;
    expect(pill({ left: 500, top: 400, right: 700, bottom: 440 })()).toBe("hidden");
    keyboard.height = 0;
  });

  it("hides with a box below the page that is still inside the window (the iPad)", () => {
    keyboard.height = 0;
    // The page ends at 760 on screen; the window and the host go on to 820.
    const below = { left: 500, top: 765, right: 700, bottom: 800, clipTop: 50, clipBottom: 760 };
    expect(pill(below)()).toBe("hidden");
  });

  it("hides when only a sliver of the box shows, and stays while most of it does", () => {
    keyboard.height = 0;
    const page = { clipTop: 50, clipBottom: 760 };
    expect(pill({ left: 500, top: 752, right: 700, bottom: 792, ...page })()).toBe("hidden");
    expect(pill({ left: 500, top: 700, right: 700, bottom: 740, ...page })()).not.toBe("hidden");
  });

  it("with the Text tool pinned, stays (under the tool bar) when its box goes", () => {
    keyboard.height = 0;
    expect(pill({ left: 500, top: 900, right: 700, bottom: 950 }, true)()).toBeNull();
  });

  it("leaves while the page moves and comes back by its box once it settles", () => {
    keyboard.height = 0;
    const box = { left: 500, top: 300, right: 700, bottom: 340, clipTop: 50, clipBottom: 760 };
    expect(pill({ ...box, moving: true })()).toBe("hidden");
    expect(pill({ ...box, moving: false })()).toEqual({ left: 300, top: 300 });
    // Pinned, it waits under the tool bar instead.
    expect(pill({ ...box, moving: true }, true)()).toBeNull();
  });
});

describe("the text pill's decision, for the debug HUD", () => {
  it("says where the pill went or why it hid", () => {
    keyboard.height = 0;
    const toolbar = (anchor: Record<string, unknown> | null, pinned = false) => {
      const t = Object.assign(Object.create(Toolbar.prototype), {
        textAnchor: anchor,
        textTarget: anchor ? { color: "#1a1a1a", fontSize: 18 } : null,
        state: { textPinned: pinned },
        leftInset: 0,
        optionsEl: { hasClass: (c: string) => c === "is-text" },
        host: { ownerDocument: { defaultView: { innerHeight: 820 } } },
        barBottom: () => 78,
      });
      (t.anchoredPlace as (h: DOMRect, p: DOMRect) => unknown).call(
        t,
        rect(0, 50, 1180, 770),
        rect(0, 0, 600, 46),
      );
      return (t as { textPillState: string }).textPillState;
    };
    const box = { left: 500, top: 300, right: 700, bottom: 340 };
    expect(toolbar(box)).toBe("below the box");
    expect(toolbar({ ...box, typing: true })).toBe("above the box");
    expect(toolbar({ ...box, moving: true })).toBe("hidden (page moving)");
    expect(toolbar({ ...box, top: 900, bottom: 950 })).toBe("hidden (box out of view)");
    expect(toolbar({ ...box, moving: true }, true)).toBe("toolbar (pinned)");
    expect(toolbar(null)).toBe("toolbar");
  });
});
