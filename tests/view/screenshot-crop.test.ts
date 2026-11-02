/**
 * The patch a screenshot of a page shows (`pageCrop`,
 * `src/view/screenshot-crop.ts`): the selection's bounds cut to the page,
 * and the scale it is painted at.
 */

import { describe, expect, it } from "vitest";
import { pageCrop } from "../../src/view/screenshot-crop";

describe("pageCrop", () => {
  it("is the bounds where they lie on the page", () => {
    const crop = pageCrop({ minX: 92, minY: 192, maxX: 308, maxY: 268 }, 800, 1000);
    expect(crop).toEqual({ x: 92, y: 192, width: 216, height: 76, scale: 3 });
  });

  it("cuts the patch to the page", () => {
    const crop = pageCrop({ minX: -40, minY: 942, maxX: 128, maxY: 1100 }, 800, 1000);
    expect(crop).toMatchObject({ x: 0, y: 942, width: 128, height: 58 });
  });

  it("is null for a patch with less than a pixel on the page", () => {
    expect(pageCrop({ minX: 900, minY: 10, maxX: 950, maxY: 40 }, 800, 1000)).toBeNull();
    expect(pageCrop({ minX: 10, minY: 10, maxX: 10.5, maxY: 40 }, 800, 1000)).toBeNull();
    expect(pageCrop({ minX: Number.NaN, minY: 0, maxX: 10, maxY: 10 }, 800, 1000)).toBeNull();
  });

  it("keeps the patch under 2048 px a side, and the painted page under 4096", () => {
    expect(pageCrop({ minX: 0, minY: 0, maxX: 1024, maxY: 100 }, 1100, 1100)?.scale).toBe(2);
    // A tall page: its side caps the scale, though the patch is small.
    expect(pageCrop({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 800, 2048)?.scale).toBe(2);
  });
});
