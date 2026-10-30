import { describe, expect, it } from "vitest";
import {
  MAX_DAMAGE_RECTS,
  addDamage,
  damageArea,
  grow,
  rectArea,
  rectsMeet,
  staleRect,
  unite,
} from "../../src/canvas/damage";

describe("unite and grow", () => {
  it("unites with nothing as a copy, and with bounds as their hull", () => {
    const a = { minX: 0, minY: 10, maxX: 20, maxY: 30 };
    const alone = unite(undefined, a);
    expect(alone).toEqual(a);
    expect(alone).not.toBe(a);
    expect(unite(a, { minX: -5, minY: 15, maxX: 10, maxY: 40 })).toEqual({
      minX: -5,
      minY: 10,
      maxX: 20,
      maxY: 40,
    });
  });

  it("grows every side by the pad", () => {
    expect(grow({ minX: 10, minY: 10, maxX: 20, maxY: 30 }, 4)).toEqual({
      minX: 6,
      minY: 6,
      maxX: 24,
      maxY: 34,
    });
  });
});

describe("staleRect: the whole px of a raster a page area touches", () => {
  it("rounds outward, so a px the area only partly covers is painted again", () => {
    // Page 10.2..20.6 at 2 px a page px: device 20.4..41.2 -> px 20..42.
    const area = { minX: 10.2, minY: 5, maxX: 20.6, maxY: 6 };
    expect(staleRect(area, 2, 0, 0, 512, 512)).toEqual({ x: 20, y: 10, w: 22, h: 2 });
  });

  it("is in the raster's own px: a tile's origin is taken off", () => {
    // A tile whose first px is device px (512, 1024) at level 1.5.
    const area = { minX: 400, minY: 700, maxX: 420, maxY: 710 };
    expect(staleRect(area, 1.5, 512, 1024, 512, 512)).toEqual({ x: 88, y: 26, w: 30, h: 15 });
  });

  it("is cut to the raster, and null where the area misses it", () => {
    const area = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
    expect(staleRect(area, 1, 0, 0, 5, 5)).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(staleRect(area, 1, 100, 100, 50, 50)).toBeNull();
  });

  it("is null for an area or scale that is no number", () => {
    expect(staleRect({ minX: NaN, minY: 0, maxX: 1, maxY: 1 }, 1, 0, 0, 9, 9)).toBeNull();
    expect(staleRect({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0, 0, 0, 9, 9)).toBeNull();
  });

  it("goes back to the page area its px show (rectArea)", () => {
    const px = { x: 88, y: 26, w: 30, h: 15 };
    expect(rectArea(px, 1.5, 512, 1024)).toEqual({
      minX: 400,
      minY: 700,
      maxX: 420,
      maxY: 710,
    });
  });
});

describe("addDamage: the dry layer's list of px to paint again", () => {
  it("merges a rectangle into one it overlaps, as the eraser's dabs do", () => {
    const list = addDamage([{ x: 0, y: 0, w: 10, h: 10 }], { x: 5, y: 5, w: 10, h: 10 });
    expect(list).toEqual([{ x: 0, y: 0, w: 15, h: 15 }]);
  });

  it("keeps apart ones that do not touch, and leaves the list it was given", () => {
    const first = [{ x: 0, y: 0, w: 10, h: 10 }];
    const list = addDamage(first, { x: 20, y: 0, w: 10, h: 10 });
    expect(list).toHaveLength(2);
    expect(first).toHaveLength(1);
    // Touching edges share no px.
    expect(rectsMeet({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it("drops an empty rectangle", () => {
    expect(addDamage([], { x: 3, y: 3, w: 0, h: 9 })).toEqual([]);
  });

  it("becomes one rectangle round them all past the most it keeps", () => {
    let list: ReturnType<typeof addDamage> = [];
    for (let i = 0; i <= MAX_DAMAGE_RECTS; i++)
      list = addDamage(list, { x: i * 20, y: 0, w: 10, h: 10 });
    expect(list).toEqual([{ x: 0, y: 0, w: MAX_DAMAGE_RECTS * 20 + 10, h: 10 }]);
    expect(damageArea(list)).toBe((MAX_DAMAGE_RECTS * 20 + 10) * 10);
  });
});
