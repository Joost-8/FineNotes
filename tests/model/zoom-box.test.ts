import { describe, expect, it } from "vitest";
import {
  ZOOM_AUTO_ADVANCE_STEP,
  ZOOM_BOX_MIN,
  ZOOM_BOX_STEP,
  autoAdvanceZoomBox,
  clampZoomBox,
  ZOOM_BOX_PLACED_MAGNIFICATION,
  autoAdvanceAcrossPages,
  dragZoomBoxAcrossPages,
  newLineAcrossPages,
  pinchZoomBox,
  magnifierTap,
  placedZoomBox,
  zoomWindowFirstPlace,
  moveZoomBox,
  newLineZoomBox,
  panToShow,
  previousZoomBox,
  resizeZoomBox,
  scaleZoomBox,
  stepZoomBox,
  zoomAutoAdvanceDue,
  zoomAutoAdvanceThreshold,
  zoomBoxFromPoints,
  zoomButtonState,
  zoomDeskColor,
  zoomTargetPress,
  zoomView,
  zoomBoxGestureZoom,
  zoomCatcherWanted,
  zoomViewPoint,
  zoomViewPointFree,
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

  it("keeps the aspect from a corner and moves only one edge from an edge handle", () => {
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
      x: 212,
      y: 256,
      w: 48,
      h: 24,
    });
    expect(resizeZoomBox(box, "s", 0, -1000, 800, 600)).toEqual({
      ...box,
      h: ZOOM_BOX_MIN,
    });
    expect(resizeZoomBox(box, "e", 40, 20, 800, 600)).toEqual({
      ...box,
      w: 200,
    });
  });

  it("steps by 70% of the width and stops at the page's edges", () => {
    expect(stepZoomBox(box, 1, 800, 600).x).toBe(100 + Math.round(160 * ZOOM_BOX_STEP));
    expect(stepZoomBox(box, 1, 800, 600)).toMatchObject({ y: 200, w: 160 });
    expect(stepZoomBox(box, -1, 800, 600).x).toBe(0);
    expect(stepZoomBox({ ...box, x: 630 }, 1, 800, 600).x).toBe(640);
  });

  it("falls back from the left margin to the end of the previous line", () => {
    expect(previousZoomBox({ ...box, x: 0, y: 280 }, 800, 600)).toEqual({
      x: 640,
      y: 200,
      w: 160,
      h: 80,
    });
    expect(previousZoomBox(box, 800, 600)).toMatchObject({ x: 0, y: 200 });
  });

  it("returns to the line's left edge and moves down one box height plus the offset", () => {
    expect(newLineZoomBox({ ...box, x: 400 }, 100, 800, 600)).toEqual({
      x: 100,
      y: 280,
      w: 160,
      h: 80,
    });
    expect(newLineZoomBox({ ...box, x: 400 }, 100, 800, 600, 25).y).toBe(305);
    expect(newLineZoomBox({ ...box, x: 400 }, 100, 800, 600, -25).y).toBe(255);
    expect(newLineZoomBox({ ...box, y: 500 }, 100, 800, 600).y).toBe(520);
  });

  it("advances right by part of a box, stops at the margin, then wraps", () => {
    const step = Math.round(box.w * ZOOM_AUTO_ADVANCE_STEP);
    expect(autoAdvanceZoomBox(box, 100, 800, 600)).toMatchObject({ x: 100 + step, y: 200 });
    expect(autoAdvanceZoomBox({ ...box, x: 630 }, 100, 800, 600)).toMatchObject({
      x: 640,
      y: 200,
    });
    expect(autoAdvanceZoomBox({ ...box, x: 640 }, 100, 800, 600)).toMatchObject({
      x: 100,
      y: 280,
    });
    expect(autoAdvanceZoomBox({ ...box, x: 640 }, 100, 800, 600, -20)).toMatchObject({
      x: 100,
      y: 260,
    });
  });

  it("triggers auto-advance only once a stroke reaches two thirds of the box", () => {
    expect(zoomAutoAdvanceDue(box.x + box.w * (2 / 3) - 0.1, box)).toBe(false);
    expect(zoomAutoAdvanceDue(box.x + box.w * 0.67, box)).toBe(true);
    expect(zoomAutoAdvanceDue(box.x + box.w, box)).toBe(true);
  });

  it("uses the configured percentage of the right edge as the trigger", () => {
    expect(zoomAutoAdvanceDue(box.x + box.w * 0.6, box, 33)).toBe(false);
    expect(zoomAutoAdvanceDue(box.x + box.w * 0.67, box, 33)).toBe(true);
    expect(zoomAutoAdvanceDue(box.x + box.w * 0.5, box, 50)).toBe(true);
    expect(zoomAutoAdvanceDue(box.x + box.w * 0.49, box, 50)).toBe(false);
    expect(zoomAutoAdvanceThreshold(0)).toBe(10);
    expect(zoomAutoAdvanceThreshold(80)).toBe(50);
  });

  it("uses the workspace desk inside the Zoom box", () => {
    expect(zoomDeskColor(undefined, "#e6e7ea")).toBe("#e6e7ea");
    expect(zoomDeskColor(undefined, "#0e0f11")).toBe("#0e0f11");
    expect(zoomDeskColor("#123456", "#e6e7ea")).toBe("#123456");
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

  it("follows a captured pen past the content's edge", () => {
    const view = zoomView(box, 400, 400);
    expect(zoomViewPointFree(box, view, 100, 150)).toEqual({ x: 140, y: 220 });
    // In the margin above the content: above the box, not nowhere.
    expect(zoomViewPointFree(box, view, 100, 50)).toEqual({ x: 140, y: 180 });
  });
});

describe("gesture lengths inside the box", () => {
  it("measures the box's magnification as a page zoom", () => {
    // The page fits at 0.8 CSS px per page px; the box shows 4 px per page px.
    expect(zoomBoxGestureZoom(4, 0.8)).toBeCloseTo(5);
    expect(zoomBoxGestureZoom(0.8, 0.8)).toBe(1);
  });

  it("has no answer for a scale it cannot use", () => {
    expect(zoomBoxGestureZoom(0, 1)).toBeNull();
    expect(zoomBoxGestureZoom(2, 0)).toBeNull();
    expect(zoomBoxGestureZoom(Number.NaN, 1)).toBeNull();
    expect(zoomBoxGestureZoom(2, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("the first-drag catcher", () => {
  it("lies over the page only in Stylus-only mode, so fingers still pan and pinch", () => {
    expect(zoomCatcherWanted(true, true)).toBe(true);
    expect(zoomCatcherWanted(true, false)).toBe(false);
    expect(zoomCatcherWanted(false, true)).toBe(false);
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
  it("is a control at all times, as Goodnotes' blue box: the body moves, a handle resizes", () => {
    expect(zoomTargetPress("nw")).toBe("nw");
    expect(zoomTargetPress("e")).toBe("e");
    expect(zoomTargetPress(null)).toBe("move");
  });
});

describe("stylus-only window drags", () => {
  it("keeps a palm's touch from moving or resizing the floating window", () => {
    expect(zoomWindowDragAllowed("touch", true, "resize")).toBe(false);
    expect(zoomWindowDragAllowed("touch", false, "resize")).toBe(true);
  });

  it("lets a finger move the window by its bar in Stylus-only mode", () => {
    expect(zoomWindowDragAllowed("touch", true, "move")).toBe(true);
    expect(zoomWindowDragAllowed("touch", true)).toBe(true);
  });

  it("never lets a finger move or size it while the pen writes in the box", () => {
    for (const only of [true, false]) {
      expect(zoomWindowDragAllowed("touch", only, "move", true)).toBe(false);
      expect(zoomWindowDragAllowed("touch", only, "resize", true)).toBe(false);
    }
    expect(zoomWindowDragAllowed("pen", true, "resize", true)).toBe(true);
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

  it("opens the box in one tap in Zoom box mode, the tool in hand kept", () => {
    expect(magnifierTap("pen", true, false)).toBe("open");
    expect(magnifierTap("eraser", true, false)).toBe("open");
    // In Page zoom mode it is a tool like any other.
    expect(magnifierTap("pen", false, false)).toBe("select");
    // The Magnifier already in hand (the pill open): a tap is the pill's, as for any tool.
    expect(magnifierTap("zoom", true, false)).toBe("select");
  });

  it("picks the Magnifier with a box open, and closes it on the next tap", () => {
    expect(magnifierTap("pen", true, true)).toBe("select");
    expect(magnifierTap("zoom", true, true)).toBe("close");
    expect(magnifierTap("zoom", false, true)).toBe("close");
  });
});

describe("a Zoom box placed with one tap", () => {
  const page = { width: 800, height: 1100 };
  const visible = { minX: 0, minY: 300, maxX: 800, maxY: 900 };

  it("sits at the top left of the page in view, the window's shape, 2.5x the view", () => {
    // Window 420 x 240 CSS px over a page shown at 1 CSS px per page px.
    const placed = placedZoomBox(visible, page, 420, 240, 1);
    expect(placed).not.toBeNull();
    const b = placed as NonNullable<typeof placed>;
    expect(b.w).toBeCloseTo(420 / ZOOM_BOX_PLACED_MAGNIFICATION);
    expect(b.h).toBeCloseTo(240 / ZOOM_BOX_PLACED_MAGNIFICATION);
    expect(b.w / b.h).toBeCloseTo(420 / 240);
    // Inside the part in view, near its top left.
    expect(b.x).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(100);
    expect(b.y).toBeGreaterThan(300);
    expect(b.y).toBeLessThan(400);
  });

  it("magnifies the view, not the page: zoomed in, it covers less page", () => {
    const fit = placedZoomBox(visible, page, 420, 240, 1);
    const zoomed = placedZoomBox(visible, page, 420, 240, 2);
    expect(zoomed?.w).toBeCloseTo((fit?.w ?? 0) / 2);
  });

  it("never comes out wider than what is in view, nor off the page", () => {
    const narrow = { minX: 700, minY: 0, maxX: 800, maxY: 1100 };
    const b = placedZoomBox(narrow, page, 420, 240, 0.2);
    expect(b).not.toBeNull();
    const placed = b as NonNullable<typeof b>;
    expect(placed.w).toBeLessThanOrEqual(100);
    expect(placed.x + placed.w).toBeLessThanOrEqual(800);
    expect(placed.w / placed.h).toBeCloseTo(420 / 240);
  });

  it("places nothing on nothing", () => {
    expect(placedZoomBox({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, page, 420, 240, 1)).toBeNull();
    expect(placedZoomBox(visible, page, 420, 240, 0)).toBeNull();
    expect(placedZoomBox(visible, page, Number.NaN, 240, 1)).toBeNull();
  });

  it("opens the window at the bottom, centred, within its size limits", () => {
    expect(zoomWindowFirstPlace({ w: 1000, h: 800 })).toEqual({ x: 290, y: 428, w: 420, h: 280 });
    expect(zoomWindowFirstPlace({ w: 400, h: 300 })).toEqual({ x: 48, y: 48, w: 304, h: 160 });
  });
});

describe("a Zoom box going from page to page", () => {
  const pages = [
    { width: 800, height: 1000 },
    { width: 800, height: 1000 },
    { width: 800, height: 1000 },
  ];
  const box = { x: 100, y: 900, w: 200, h: 80 };

  it("stays on its page while its middle does", () => {
    expect(dragZoomBoxAcrossPages(box, 10, 20, pages, 0)).toEqual({
      index: 0,
      box: { x: 110, y: 920, w: 200, h: 80 },
    });
  });

  it("carries on to the next page once its middle passes the bottom, and back up", () => {
    const down = dragZoomBoxAcrossPages(box, 0, 100, pages, 0);
    expect(down.index).toBe(1);
    expect(down.box.y).toBeCloseTo(0);
    // From the same start, dragged further: deeper into the next page.
    expect(dragZoomBoxAcrossPages(box, 0, 400, pages, 0)).toEqual({
      index: 1,
      box: { x: 100, y: 300, w: 200, h: 80 },
    });
    const up = dragZoomBoxAcrossPages({ ...box, y: 10 }, 0, -100, pages, 1);
    expect(up.index).toBe(0);
    expect(up.box.y).toBeCloseTo(910);
  });

  it("keeps the box on the first and last pages at their ends", () => {
    expect(dragZoomBoxAcrossPages({ ...box, y: 0 }, 0, -500, pages, 0)).toEqual({
      index: 0,
      box: { x: 100, y: 0, w: 200, h: 80 },
    });
    expect(dragZoomBoxAcrossPages(box, 0, 500, pages, 2).index).toBe(2);
  });

  it("starts the next page with ↵ when no whole line is left below", () => {
    // 900 + 80 + 80 > 1000: the next line would not fit.
    expect(newLineAcrossPages(box, 40, pages, 0)).toEqual({
      index: 1,
      box: { x: 40, y: 0, w: 200, h: 80 },
    });
    // With room left, the next line on this page.
    expect(newLineAcrossPages({ ...box, y: 500 }, 40, pages, 0)).toEqual({
      index: 0,
      box: { x: 40, y: 580, w: 200, h: 80 },
    });
    // The last page keeps its last line.
    expect(newLineAcrossPages(box, 40, pages, 2).index).toBe(2);
  });

  it("auto-advances along the line, then onto the next page at the page's end", () => {
    expect(autoAdvanceAcrossPages(box, 40, pages, 0).index).toBe(0);
    expect(autoAdvanceAcrossPages({ ...box, x: 600 }, 40, pages, 0)).toEqual({
      index: 1,
      box: { x: 40, y: 0, w: 200, h: 80 },
    });
  });
});

describe("pinching in the Zoom box window", () => {
  const start = { x: 300, y: 400, w: 200, h: 100 };

  it("magnifies when the fingers spread, about the box's middle, keeping its shape", () => {
    const b = pinchZoomBox(start, 2, 800, 1000);
    expect(b).toEqual({ x: 350, y: 425, w: 100, h: 50 });
  });

  it("zooms out until the box is as wide as the page, its limit", () => {
    const b = pinchZoomBox(start, 0.1, 800, 1000);
    expect(b.w).toBeCloseTo(800);
    expect(b.h).toBeCloseTo(400);
    expect(b.x).toBe(0);
  });

  it("magnifies at most so far: a twelfth of the page's width", () => {
    const b = pinchZoomBox(start, 100, 800, 1000);
    expect(b.w).toBeCloseTo(800 / 12);
    expect(b.w / b.h).toBeCloseTo(2);
  });

  it("ignores a pinch it cannot read", () => {
    expect(pinchZoomBox(start, 0, 800, 1000)).toBe(start);
    expect(pinchZoomBox(start, Number.NaN, 800, 1000)).toBe(start);
  });
});
