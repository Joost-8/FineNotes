import { describe, expect, it } from "vitest";
import {
  ZOOM_BOX_MIN,
  ZOOM_BOX_STEP,
  clampZoomBox,
  magnifierTapClosesZoomBox,
  moveZoomBox,
  newLineZoomBox,
  panToShow,
  resizeZoomBox,
  scaleZoomBox,
  stepZoomBox,
  zoomBoxFromPoints,
  zoomButtonState,
  zoomTargetPress,
  zoomView,
  zoomViewPoint,
  zoomWindowDragAllowed,
} from "../../src/model/zoom-box";

const box = { x: 100, y: 200, w: 160, h: 80 };

describe("zoom box geometry", () => {
  it("makes a target box from a drag in either direction", () => {
    expect(zoomBoxFromPoints({ x: 80, y: 60 }, { x: 240, y: 180 }, 800, 600)).toEqual({
      x: 80,
      y: 60,
      w: 160,
      h: 120,
    });
    expect(zoomBoxFromPoints({ x: 240, y: 180 }, { x: 80, y: 60 }, 800, 600)).toEqual({
      x: 80,
      y: 60,
      w: 160,
      h: 120,
    });
  });

  it("clamps the marquee to the page and refuses a box too small to write in", () => {
    expect(zoomBoxFromPoints({ x: -20, y: -10 }, { x: 100, y: 50 }, 800, 600)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
    expect(
      zoomBoxFromPoints(
        { x: 10, y: 10 },
        { x: 10 + ZOOM_BOX_MIN - 1, y: 10 + ZOOM_BOX_MIN },
        800,
        600,
      ),
    ).toBeNull();
  });

  it("keeps the box inside the page when it is moved or clamped", () => {
    expect(moveZoomBox(box, 1000, -1000, 800, 600)).toEqual({
      x: 640,
      y: 0,
      w: 160,
      h: 80,
    });
    expect(clampZoomBox({ x: -50, y: 590, w: 900, h: 40 }, 800, 600)).toEqual({
      x: 0,
      y: 560,
      w: 800,
      h: 40,
    });
    // A page smaller than the minimum still bounds the box.
    expect(clampZoomBox({ x: -5, y: -5, w: 80, h: 80 }, 20, 16)).toEqual({
      x: 0,
      y: 0,
      w: 20,
      h: 16,
    });
  });

  it("resizes from each handle without turning the box inside out", () => {
    expect(resizeZoomBox(box, "se", 40, 20, 800, 600)).toEqual({
      x: 100,
      y: 200,
      w: 200,
      h: 100,
    });
    expect(resizeZoomBox(box, "nw", 40, 20, 800, 600)).toEqual({
      x: 140,
      y: 220,
      w: 120,
      h: 60,
    });
    expect(resizeZoomBox(box, "nw", 1000, 1000, 800, 600)).toEqual({
      x: 236,
      y: 256,
      w: ZOOM_BOX_MIN,
      h: ZOOM_BOX_MIN,
    });
    expect(resizeZoomBox(box, "s", 0, -1000, 800, 600)).toEqual({
      ...box,
      h: ZOOM_BOX_MIN,
    });
  });

  it("steps by 70% of the width and stops at the page's edges", () => {
    expect(stepZoomBox(box, 1, 800, 600).x).toBe(100 + Math.round(160 * ZOOM_BOX_STEP));
    expect(stepZoomBox(box, 1, 800, 600)).toMatchObject({ y: 200, w: 160 });
    expect(stepZoomBox(box, -1, 800, 600).x).toBe(0);
    expect(stepZoomBox({ ...box, x: 630 }, 1, 800, 600).x).toBe(640);
  });

  it("returns to the line's left edge and moves down one box height", () => {
    expect(newLineZoomBox({ ...box, x: 400 }, 100, 800, 600)).toEqual({
      x: 100,
      y: 280,
      w: 160,
      h: 80,
    });
    expect(newLineZoomBox({ ...box, y: 500 }, 100, 800, 600).y).toBe(520);
  });

  it("trades box size for magnification around its centre", () => {
    expect(scaleZoomBox(box, 2, 800, 600)).toEqual({
      x: 140,
      y: 220,
      w: 80,
      h: 40,
    });
    expect(scaleZoomBox(box, 100, 800, 600)).toEqual({
      x: 168,
      y: 228,
      w: ZOOM_BOX_MIN,
      h: ZOOM_BOX_MIN,
    });
  });
});

describe("zoom box view", () => {
  it("fits the target box in the window, keeping its aspect and centring it", () => {
    const view = zoomView(box, 400, 400);
    expect(view.scale).toBe(2.5);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(100);
    expect(view.width).toBe(400);
    expect(view.height).toBe(200);
  });

  it("maps a window point back into the target box", () => {
    const view = zoomView(box, 400, 400);
    expect(zoomViewPoint(box, view, 100, 150)).toEqual({ x: 140, y: 220 });
    expect(zoomViewPoint(box, view, 400, 250)).toEqual({ x: 260, y: 260 });
    expect(zoomViewPoint(box, view, -1, 150)).toBeNull();
    expect(zoomViewPoint(box, view, 100, 50)).toBeNull();
  });
});

describe("panning the page to keep the box in view", () => {
  const view = { x: 0, y: 0, w: 400, h: 300 };

  it("does not move when the box is already inside the margin", () => {
    expect(panToShow({ x: 50, y: 50, w: 100, h: 100 }, view, 16)).toEqual({ x: 0, y: 0 });
  });

  it("moves just enough at each edge", () => {
    expect(panToShow({ x: -20, y: 0, w: 100, h: 100 }, view, 16)).toEqual({ x: -36, y: -16 });
    expect(panToShow({ x: 350, y: 250, w: 100, h: 100 }, view, 16)).toEqual({ x: 66, y: 66 });
    expect(panToShow({ x: 0, y: -5, w: 100, h: 100 }, view, 16)).toEqual({ x: -16, y: -21 });
  });

  it("aligns a box larger than the view with its top-left margin", () => {
    expect(panToShow({ x: 20, y: 30, w: 500, h: 400 }, view, 16)).toEqual({
      x: 4,
      y: 14,
    });
  });
});

describe("the viewfinder target's presses", () => {
  it("resizes from a corner or edge before anything else", () => {
    expect(zoomTargetPress(true, true, "nw", true)).toBe("nw");
    expect(zoomTargetPress(false, false, "e", false)).toBe("e");
  });

  it("moves from the badge with any pointer, even a writing tool", () => {
    expect(zoomTargetPress(false, false, null, true)).toBe("move");
    expect(zoomTargetPress(false, true, null, true)).toBe("move");
  });

  it("moves the body with a finger or the Magnifier, and draws with a pen otherwise", () => {
    expect(zoomTargetPress(false, true, null, false)).toBe("move");
    expect(zoomTargetPress(true, false, null, false)).toBe("move");
    expect(zoomTargetPress(false, false, null, false)).toBe("draw");
  });
});

describe("stylus-only window drags", () => {
  it("keeps a palm's touch from moving or resizing the floating window", () => {
    expect(zoomWindowDragAllowed("touch", true)).toBe(false);
    expect(zoomWindowDragAllowed("touch", false)).toBe(true);
  });

  it("always lets the stylus and a mouse drag it", () => {
    expect(zoomWindowDragAllowed("pen", true)).toBe(true);
    expect(zoomWindowDragAllowed("mouse", true)).toBe(true);
  });
});

describe("the Magnifier's button and toggle", () => {
  it("stays highlighted while a box is open under another tool", () => {
    expect(zoomButtonState("pen", true)).toEqual({ highlighted: true, pressed: true });
    expect(zoomButtonState("zoom", false)).toEqual({ highlighted: false, pressed: true });
    expect(zoomButtonState("pen", false)).toEqual({ highlighted: false, pressed: false });
  });

  it("closes the box when the Magnifier is tapped with one open", () => {
    expect(magnifierTapClosesZoomBox("zoom", true)).toBe(true);
    expect(magnifierTapClosesZoomBox("zoom", false)).toBe(false);
    expect(magnifierTapClosesZoomBox("pen", true)).toBe(false);
  });
});
