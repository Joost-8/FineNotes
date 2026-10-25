import { describe, expect, it } from "vitest";
import { OFF_BAR_PX, hiddenEnds, offBar, scrollToShow } from "../../src/view/swatch-drag-model";

describe("a swatch dragged off the pen pill", () => {
  const bar = { left: 100, top: 50, right: 500, bottom: 94 };

  it("stays when let go on the pill or just beside it", () => {
    expect(offBar(bar, 300, 70)).toBe(false);
    expect(offBar(bar, 300, 94 + OFF_BAR_PX)).toBe(false);
    expect(offBar(bar, 100 - OFF_BAR_PX, 70)).toBe(false);
  });

  it("leaves the row once let go clear of the pill, in any direction", () => {
    expect(offBar(bar, 300, 94 + OFF_BAR_PX + 1)).toBe(true);
    expect(offBar(bar, 300, 50 - OFF_BAR_PX - 1)).toBe(true);
    expect(offBar(bar, 99 - OFF_BAR_PX, 70)).toBe(true);
    expect(offBar(bar, 501 + OFF_BAR_PX, 70)).toBe(true);
  });
});

describe("the colour row's faded ends", () => {
  it("fades only the ends that hide colours", () => {
    expect(hiddenEnds(0, 180, 180)).toEqual({ start: false, end: false });
    expect(hiddenEnds(0, 180, 400)).toEqual({ start: false, end: true });
    expect(hiddenEnds(100, 180, 400)).toEqual({ start: true, end: true });
    expect(hiddenEnds(220, 180, 400)).toEqual({ start: true, end: false });
  });

  it("reads half a pixel of rounding as no more", () => {
    expect(hiddenEnds(0.4, 180, 180.4)).toEqual({ start: false, end: false });
  });
});

describe("scrolling the row to a swatch", () => {
  it("leaves the row alone when the swatch shows", () => {
    expect(scrollToShow(50, 180, 100, 36)).toBe(50);
  });

  it("moves as little as it can, clear of the faded edge", () => {
    expect(scrollToShow(0, 180, 300, 36)).toBe(156);
    expect(scrollToShow(0, 180, 300, 36, 12)).toBe(168);
    expect(scrollToShow(200, 180, 120, 36, 12)).toBe(108);
    expect(scrollToShow(200, 180, 4, 36, 12)).toBe(0);
  });
});
