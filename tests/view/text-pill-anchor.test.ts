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

function pill(anchor: { left: number; top: number; right: number; bottom: number } | null) {
  const t: Fake = Object.assign(Object.create(Toolbar.prototype), {
    textAnchor: anchor,
    textTarget: { color: "#1a1a1a", fontSize: 18 },
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
