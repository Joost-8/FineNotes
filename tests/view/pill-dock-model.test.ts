import { describe, expect, it } from "vitest";
import {
  DEFAULT_PILL_DOCK,
  dockPlace,
  isUpright,
  nearestDock,
  parsePillDock,
  colorWindow,
  popoverSide,
} from "../../src/view/pill-dock-model";

const area = { left: 0, top: 60, right: 1000, bottom: 760 };

describe("reading a stored place", () => {
  it("keeps a known place and reads anything else as under the tool bar", () => {
    expect(parsePillDock("bottom")).toBe("bottom");
    expect(parsePillDock("right")).toBe("right");
    expect(DEFAULT_PILL_DOCK).toBe("top");
    for (const raw of [undefined, null, "", "middle", 3, { dock: "left" }, "toString"]) {
      expect(parsePillDock(raw)).toBe("top");
    }
  });
});

describe("the place nearest where the pill is let go", () => {
  it("is the edge it is closest to", () => {
    expect(nearestDock(area, 500, 100)).toBe("top");
    expect(nearestDock(area, 500, 720)).toBe("bottom");
    expect(nearestDock(area, 30, 400)).toBe("left");
    expect(nearestDock(area, 970, 400)).toBe("right");
  });

  it("goes back under the tool bar from dead centre", () => {
    // Equally far from top and bottom; left and right are further.
    expect(nearestDock({ left: 0, top: 0, right: 1000, bottom: 400 }, 500, 200)).toBe("top");
  });

  it("chooses only among the places offered", () => {
    expect(nearestDock(area, 30, 450, ["top", "bottom"])).toBe("bottom");
    expect(nearestDock(area, 30, 300, ["top", "bottom"])).toBe("top");
    expect(nearestDock(area, 30, 300, [])).toBe("top");
  });
});

describe("where the pill rests", () => {
  it("is centred under the tool bar, or along the bottom", () => {
    expect(dockPlace("top", area, 400, 44, 8)).toEqual({ left: 300, top: 60 });
    expect(dockPlace("bottom", area, 400, 44, 8)).toEqual({ left: 300, top: 708 });
  });

  it("is centred in the area right of a panel", () => {
    const beside = { ...area, left: 300 };
    expect(dockPlace("top", beside, 400, 44, 8).left).toBe(450);
  });

  it("starts near the top along a side", () => {
    expect(dockPlace("left", area, 44, 400, 8)).toEqual({ left: 8, top: 68 });
    expect(dockPlace("right", area, 44, 400, 8)).toEqual({ left: 948, top: 68 });
  });

  it("stays inside the area when it is wider or taller than there is room for", () => {
    expect(dockPlace("top", { ...area, right: 300 }, 400, 44, 8).left).toBe(8);
    expect(dockPlace("left", { ...area, bottom: 200 }, 44, 400, 8).top).toBe(60);
  });

  it("stands upright only at the sides", () => {
    expect(isUpright("left")).toBe(true);
    expect(isUpright("right")).toBe(true);
    expect(isUpright("top")).toBe(false);
    expect(isUpright("bottom")).toBe(false);
  });
});

describe("popovers from the pill", () => {
  it("open toward the page from every place", () => {
    expect(popoverSide("top")).toBe("down");
    expect(popoverSide("bottom")).toBe("up");
    expect(popoverSide("left")).toBe("right");
    expect(popoverSide("right")).toBe("left");
  });
});

describe("the colours an upright pill shows", () => {
  it("shows the whole row when it is short", () => {
    expect(colorWindow(3, 2, 3)).toBe(0);
    expect(colorWindow(2, 0, 3)).toBe(0);
  });

  it("keeps the chosen colour in the middle where it can", () => {
    expect(colorWindow(9, 4, 3)).toBe(3);
    expect(colorWindow(9, 0, 3)).toBe(0);
    expect(colorWindow(9, 8, 3)).toBe(6);
    expect(colorWindow(9, 7, 3)).toBe(6);
  });

  it("starts at the beginning when no colour of the row is chosen", () => {
    expect(colorWindow(9, -1, 3)).toBe(0);
  });
});
