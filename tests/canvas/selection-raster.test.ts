import { describe, expect, it } from "vitest";
import {
  SELECTION_RASTER_MAX_DETAIL,
  SELECTION_RASTER_MAX_PIXELS,
  selectionRasterBox,
  selectionRasterDetail,
} from "../../src/canvas/selection-raster";

const bounds = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("selectionRasterBox", () => {
  it("starts on a whole device px and covers the bounds", () => {
    const box = selectionRasterBox(bounds(10.2, 20.7, 50.1, 60.3), 2);
    expect(box).toEqual({ x: 10, y: 20.5, width: 81, height: 80 });
    if (!box) return;
    expect(box.x + box.width / 2).toBeGreaterThanOrEqual(50.1);
    expect(box.y + box.height / 2).toBeGreaterThanOrEqual(60.3);
  });

  it("handles a negative corner, which a page's overhang can have", () => {
    expect(selectionRasterBox(bounds(-1.25, -0.5, 1, 1), 2)).toEqual({
      x: -1.5,
      y: -0.5,
      width: 5,
      height: 3,
    });
  });

  it("refuses a picture past the budget and accepts one at it", () => {
    expect(selectionRasterBox(bounds(0, 0, 100, 100), 1, 10_000)).not.toBeNull();
    expect(selectionRasterBox(bounds(0, 0, 100, 101), 1, 10_000)).toBeNull();
    expect(selectionRasterBox(bounds(0, 0, 4000, 4000), 1)).toBeNull();
    expect(SELECTION_RASTER_MAX_PIXELS).toBeGreaterThan(2360 * 1640);
  });

  it("refuses empty or broken input", () => {
    expect(selectionRasterBox(bounds(5, 5, 5, 9), 2)).toBeNull();
    expect(selectionRasterBox(bounds(0, 0, 10, 10), 0)).toBeNull();
    expect(selectionRasterBox(bounds(0, 0, 10, 10), Number.NaN)).toBeNull();
    expect(selectionRasterBox(bounds(0, 0, Number.POSITIVE_INFINITY, 10), 1)).toBeNull();
  });
});

describe("selectionRasterDetail", () => {
  it("keeps the view's detail until the picture is half as large again", () => {
    expect(selectionRasterDetail(0.3)).toBe(1);
    expect(selectionRasterDetail(1)).toBe(1);
    expect(selectionRasterDetail(1.5)).toBe(1);
  });

  it("doubles it in steps, up to the most", () => {
    expect(selectionRasterDetail(1.51)).toBe(2);
    expect(selectionRasterDetail(3)).toBe(2);
    expect(selectionRasterDetail(3.1)).toBe(4);
    expect(selectionRasterDetail(40)).toBe(SELECTION_RASTER_MAX_DETAIL);
  });

  it("answers 1 for a size that is no size", () => {
    expect(selectionRasterDetail(Number.NaN)).toBe(1);
    expect(selectionRasterDetail(Number.POSITIVE_INFINITY)).toBe(1);
    expect(selectionRasterDetail(-2)).toBe(1);
  });
});
