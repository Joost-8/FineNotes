import { describe, expect, it } from "vitest";
import {
  type BarDock,
  type Box,
  DEFAULT_BAR_DOCK,
  barDockIcon,
  barMenuSide,
  isBarUpright,
  menuPlace,
  menuRoom,
  menuAnchor,
  nearestBarDock,
  pageArea,
  parseBarDock,
  pillAfterBarMove,
} from "../../src/view/bar-dock-model";
import { PILL_DOCKS, dockPlace } from "../../src/view/pill-dock-model";

/** An iPad in landscape: the view 1180 wide, its page body ending at 760. */
const view = { left: 0, right: 1180, bottom: 760 };
/** The bar at each edge, as styles.css lays it out: 57 px thick. */
const BARS: Record<BarDock, Box> = {
  top: { left: 0, top: 0, right: 1180, bottom: 57 },
  bottom: { left: 0, top: 703, right: 1180, bottom: 760 },
  left: { left: 0, top: 0, right: 57, bottom: 760 },
  right: { left: 1123, top: 0, right: 1180, bottom: 760 },
};

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("reading a stored place", () => {
  it("keeps a known place and reads anything else as the top", () => {
    for (const dock of PILL_DOCKS) expect(parseBarDock(dock)).toBe(dock);
    expect(DEFAULT_BAR_DOCK).toBe("top");
    for (const raw of [undefined, null, "", "middle", 3, { dock: "left" }, "toString"]) {
      expect(parseBarDock(raw)).toBe("top");
    }
  });
});

describe("the edge nearest where the bar is let go", () => {
  it("is the edge of the view it is closest to", () => {
    expect(nearestBarDock(1180, 760, 590, 40)).toBe("top");
    expect(nearestBarDock(1180, 760, 590, 730)).toBe("bottom");
    expect(nearestBarDock(1180, 760, 30, 380)).toBe("left");
    expect(nearestBarDock(1180, 760, 1150, 380)).toBe("right");
  });

  it("goes back to the top from dead centre", () => {
    expect(nearestBarDock(800, 800, 400, 400)).toBe("top");
  });
});

describe("the page area", () => {
  it("is the view less the bar's side, a gap clear of the bar", () => {
    expect(pageArea("top", BARS.top, view, 8, 0, 300)).toEqual({
      left: 0,
      top: 65,
      right: 1180,
      bottom: 760,
    });
    expect(pageArea("bottom", BARS.bottom, view, 8, 0, 300)).toEqual({
      left: 0,
      top: 8,
      right: 1180,
      bottom: 703,
    });
    expect(pageArea("left", BARS.left, view, 8, 0, 300)).toEqual({
      left: 57,
      top: 8,
      right: 1180,
      bottom: 760,
    });
    expect(pageArea("right", BARS.right, view, 8, 0, 300)).toEqual({
      left: 0,
      top: 8,
      right: 1123,
      bottom: 760,
    });
  });

  it("ends above the keyboard, which covers a bar along the bottom", () => {
    const keyboard = { left: 0, right: 1180, bottom: 420 };
    expect(pageArea("bottom", BARS.bottom, keyboard, 8, 0, 300).bottom).toBe(420);
    expect(pageArea("top", BARS.top, keyboard, 8, 0, 300).bottom).toBe(420);
  });

  it("runs inside the view's padding, as the page does", () => {
    const padded = { left: 12, right: 1168, bottom: 760 };
    expect(pageArea("top", BARS.top, padded, 8, 0, 300)).toEqual({
      left: 12,
      top: 65,
      right: 1168,
      bottom: 760,
    });
    expect(pageArea("left", BARS.left, padded, 8, 0, 300).right).toBe(1168);
    expect(pageArea("right", BARS.right, padded, 8, 0, 300).left).toBe(12);
  });

  it("keeps clear of a panel docked at the page's left, beside a bar at the left too", () => {
    expect(pageArea("top", BARS.top, view, 8, 320, 300).left).toBe(320);
    expect(pageArea("left", BARS.left, view, 8, 320, 300).left).toBe(377);
    // A pill that would not fit beside the panel may cover it, never the bar.
    expect(
      pageArea("left", BARS.left, { left: 0, right: 600, bottom: 760 }, 8, 320, 400).left,
    ).toBe(200);
    expect(
      pageArea("left", BARS.left, { left: 0, right: 400, bottom: 760 }, 8, 320, 400).left,
    ).toBe(57);
  });

  it("never lets the pill rest on the bar, in any of the sixteen pairs", () => {
    const pills = { horizontal: { width: 420, height: 46 }, upright: { width: 46, height: 420 } };
    for (const bar of PILL_DOCKS) {
      for (const pill of PILL_DOCKS) {
        const size = pill === "left" || pill === "right" ? pills.upright : pills.horizontal;
        const area = pageArea(bar, BARS[bar], view, 8, 0, size.width);
        const at = dockPlace(pill, area, size.width, size.height, 8);
        const box = { ...at, right: at.left + size.width, bottom: at.top + size.height };
        expect(overlaps(box, BARS[bar]), `bar ${bar}, pill ${pill}`).toBe(false);
        // …and stays inside the view.
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(view.right);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(view.bottom);
      }
    }
  });

  it("puts a pill at the bar's own edge right beside the bar", () => {
    const below = dockPlace("top", pageArea("top", BARS.top, view, 8, 0, 420), 420, 46, 8);
    expect(below.top).toBe(65);
    const above = dockPlace("bottom", pageArea("bottom", BARS.bottom, view, 8, 0, 420), 420, 46, 8);
    expect(above.top + 46).toBe(695);
    const beside = dockPlace("left", pageArea("left", BARS.left, view, 8, 0, 46), 46, 420, 8);
    expect(beside.left).toBe(65);
    const besideRight = dockPlace(
      "right",
      pageArea("right", BARS.right, view, 8, 0, 46),
      46,
      420,
      8,
    );
    expect(besideRight.left + 46).toBe(1115);
  });
});

describe("the pill when the bar moves", () => {
  it("goes with the bar when it rested by it", () => {
    expect(pillAfterBarMove("top", "top", "left")).toBe("left");
    expect(pillAfterBarMove("bottom", "bottom", "top")).toBe("top");
  });

  it("stays where the user put it otherwise, beside the bar should the bar come there", () => {
    expect(pillAfterBarMove("bottom", "top", "left")).toBe("bottom");
    expect(pillAfterBarMove("left", "top", "left")).toBe("left");
  });

  it("does not move when the bar comes back to its own edge", () => {
    for (const pill of PILL_DOCKS) expect(pillAfterBarMove(pill, "top", "top")).toBe(pill);
  });
});

describe("the bar at each edge", () => {
  it("stands upright only at the sides", () => {
    expect(PILL_DOCKS.filter(isBarUpright)).toEqual(["left", "right"]);
  });

  it("opens its menus toward the page", () => {
    expect(barMenuSide("top")).toBe("down");
    expect(barMenuSide("bottom")).toBe("up");
    expect(barMenuSide("left")).toBe("right");
    expect(barMenuSide("right")).toBe("left");
  });

  it("is carried as the icon of the edge it lands on", () => {
    expect(PILL_DOCKS.map(barDockIcon)).toEqual([
      "panel-top",
      "panel-bottom",
      "panel-left",
      "panel-right",
    ]);
  });
});

describe("a menu opened from a bar button", () => {
  const room = { width: 1180, height: 820 };
  const size = { width: 300, height: 400 };
  const button = (left: number, top: number): Box => ({
    left,
    top,
    right: left + 44,
    bottom: top + 44,
  });

  it("hangs below a button on the top bar, along either edge", () => {
    expect(menuPlace("down", button(100, 10), size, room, "start", 6, 8)).toEqual({
      left: 100,
      top: 60,
    });
    expect(menuPlace("down", button(1100, 10), size, room, "end", 6, 8)).toEqual({
      left: 844,
      top: 60,
    });
  });

  it("rises above a button on the bottom bar", () => {
    expect(menuPlace("up", button(100, 760), size, room, "start", 6, 8)).toEqual({
      left: 100,
      top: 354,
    });
  });

  it("opens beside a button on an upright bar, level with it", () => {
    expect(menuPlace("right", button(6, 100), size, room, "start", 6, 8)).toEqual({
      left: 56,
      top: 100,
    });
    expect(menuPlace("left", button(1130, 100), size, room, "end", 6, 8)).toEqual({
      left: 824,
      top: 100,
    });
  });

  it("slides up beside a low button, to stay on screen", () => {
    expect(menuPlace("right", button(6, 700), size, room, "start", 6, 8).top).toBe(412);
  });

  it("turns to the other side only when its own has no room", () => {
    // Below a bottom-bar button there is no room either: it stays above.
    expect(
      menuPlace("up", button(100, 760), { width: 300, height: 900 }, room, "start", 6, 8).top,
    ).toBe(8);
    // A top-bar button low in a short window: above, where there is room.
    expect(menuPlace("down", button(100, 600), size, room, "start", 6, 8).top).toBe(194);
    // An upright bar at the left of a narrow window: the menu goes where it fits.
    expect(menuPlace("left", button(6, 100), size, room, "start", 6, 8).left).toBe(56);
  });

  it("is never off the window's edges", () => {
    const narrow = { width: 280, height: 300 };
    const at = menuPlace("right", button(6, 100), size, narrow, "start", 6, 8);
    expect(at).toEqual({ left: 8, top: 8 });
  });

  it("has room to the window's edge on its side, or the whole window beside", () => {
    expect(menuRoom("down", button(100, 10), room, 6, 8)).toBe(752);
    expect(menuRoom("up", button(100, 760), room, 6, 8)).toBe(746);
    expect(menuRoom("right", button(6, 400), room, 6, 8)).toBe(804);
    expect(menuRoom("left", button(1130, 400), room, 6, 8)).toBe(804);
  });
});

describe("which way a menu opens from a button", () => {
  const button = { left: 1133, top: 700, right: 1177, bottom: 744 };
  const inBar = (dock: string | null, bar: Box) => ({
    getBoundingClientRect: () => button,
    closest: (selector: string) =>
      selector === ".goodobsidian-toolbar"
        ? { getAttribute: () => dock, getBoundingClientRect: () => bar }
        : null,
  });

  it("opens toward the page from a bar button, from the bar's own edge", () => {
    expect(menuAnchor(inBar("right", BARS.right))).toEqual({
      side: "left",
      box: { ...button, left: 1123 },
    });
    expect(menuAnchor(inBar("bottom", BARS.bottom))).toEqual({
      side: "up",
      box: { ...button, top: 703 },
    });
    expect(menuAnchor(inBar("left", BARS.left))).toEqual({
      side: "right",
      box: { ...button, right: 57 },
    });
  });

  it("hangs from the button itself under the bar along the top", () => {
    expect(menuAnchor(inBar("top", BARS.top))).toEqual({ side: "down", box: button });
    expect(menuAnchor(inBar(null, BARS.top))).toEqual({ side: "down", box: button });
  });

  it("opens down from anything else, a page sidebar button say", () => {
    expect(menuAnchor({ getBoundingClientRect: () => button, closest: () => null })).toEqual({
      side: "down",
      box: button,
    });
  });
});
