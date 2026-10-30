import { describe, expect, it } from "vitest";
import { inkPixelRect } from "../../src/canvas/layer-rect";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

describe("inkPixelRect (FineNotes#85)", () => {
  it("covers the line's half width and a pixel of anti-aliasing", () => {
    const runs = [{ width: 10, pts: [20, 30, 60, 30] }];
    expect(inkPixelRect(runs, identity, 500, 500)).toEqual({ x: 14, y: 24, w: 52, h: 12 });
  });

  it("goes through the transform: scale and offset", () => {
    const runs = [{ width: 4, pts: [10, 10, 20, 10] }];
    const m = { a: 2, b: 0, c: 0, d: 2, e: -5, f: 100 };
    // Page box 8..22 x 8..12 -> device 11..39 x 116..124, plus a pixel.
    expect(inkPixelRect(runs, m, 500, 500)).toEqual({ x: 10, y: 115, w: 30, h: 10 });
  });

  it("holds a turned stroke whole", () => {
    const runs = [{ width: 2, pts: [0, 0, 10, 0] }];
    const turn = { a: 0, b: 1, c: -1, d: 0, e: 50, f: 50 };
    const r = inkPixelRect(runs, turn, 500, 500);
    expect(r).toEqual({ x: 48, y: 48, w: 4, h: 14 });
  });

  it("is cut to the canvas, and null off it", () => {
    const runs = [{ width: 10, pts: [-20, 5, 30, 5] }];
    expect(inkPixelRect(runs, identity, 20, 8)).toEqual({ x: 0, y: 0, w: 20, h: 8 });
    expect(inkPixelRect(runs, { ...identity, e: 1000 }, 20, 8)).toBeNull();
  });

  it("is null for no ink, and skips points that are not numbers", () => {
    expect(inkPixelRect([], identity, 100, 100)).toBeNull();
    const runs = [{ width: 2, pts: [Number.NaN, 0, 10, 10] }];
    expect(inkPixelRect(runs, identity, 100, 100)).toEqual({ x: 8, y: 8, w: 4, h: 4 });
  });
});
