import { describe, expect, it } from "vitest";
import {
  type FillInk,
  bucketFill,
  fillGrid,
  flood,
  grow,
  inkDistance,
  insidePolygon,
  polygonArea,
  rasterInk,
  simplifyClosed,
  traceOutline,
} from "../../src/canvas/bucket-fill";

const P = 0.5;

/** A polyline through `xy` (flat), as stroke points. */
function line(xy: number[], radius = 1): FillInk {
  const pts: number[] = [];
  for (let i = 0; i < xy.length; i += 2) pts.push(xy[i], xy[i + 1], P);
  return { pts, radius };
}

/** A square outline from (x, y), side `s`, with a gap of `gap` px in its top edge. */
function square(x: number, y: number, s: number, gap = 0, radius = 1): FillInk[] {
  if (gap === 0) return [line([x, y, x + s, y, x + s, y + s, x, y + s, x, y], radius)];
  const mid = x + s / 2;
  return [
    line([mid + gap / 2, y, x + s, y, x + s, y + s, x, y + s, x, y, mid - gap / 2, y], radius),
  ];
}

/** A circle of `n` segments. */
function circle(cx: number, cy: number, r: number, n = 64, radius = 1): FillInk {
  const xy: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    xy.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return line(xy, radius);
}

const PAGE = { width: 400, height: 300 };

describe("bucketFill", () => {
  it("fills a closed square up to its ink", () => {
    const result = bucketFill({ ...PAGE, ink: square(100, 100, 100), x: 150, y: 150, gap: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const o = result.outline;
    // Closed: the last point is the first.
    expect(o[o.length - 2]).toBe(o[0]);
    expect(o[o.length - 1]).toBe(o[1]);
    // Inside the outline's centreline, under its ink, never past it.
    for (let i = 0; i < o.length; i += 2) {
      expect(o[i]).toBeGreaterThanOrEqual(99);
      expect(o[i]).toBeLessThanOrEqual(201);
      expect(o[i + 1]).toBeGreaterThanOrEqual(99);
      expect(o[i + 1]).toBeLessThanOrEqual(201);
    }
    expect(polygonArea(o)).toBeGreaterThan(97 * 97);
    expect(result.area).toBeGreaterThan(97 * 97);
    // A square stays a few corners, not a staircase.
    expect(o.length / 2).toBeLessThan(12);
  });

  it("refuses a region that leaks to the page's edge", () => {
    expect(bucketFill({ ...PAGE, ink: [], x: 50, y: 50, gap: 8 })).toEqual({
      ok: false,
      reason: "open",
    });
    // Outside the square is open too.
    const out = bucketFill({ ...PAGE, ink: square(100, 100, 100), x: 20, y: 20, gap: 0 });
    expect(out).toEqual({ ok: false, reason: "open" });
  });

  it("closes a gap narrower than the tolerance, and only that", () => {
    const ink = square(100, 100, 100, 6);
    expect(bucketFill({ ...PAGE, ink, x: 150, y: 150, gap: 0 }).ok).toBe(false);
    const closed = bucketFill({ ...PAGE, ink, x: 150, y: 150, gap: 10 });
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      // The fill stops at the gap: nothing pokes far above the top edge.
      for (let i = 1; i < closed.outline.length; i += 2) {
        expect(closed.outline[i]).toBeGreaterThan(96);
      }
    }
    const wide = square(100, 100, 100, 30);
    expect(bucketFill({ ...PAGE, ink: wide, x: 150, y: 150, gap: 10 }).ok).toBe(false);
  });

  it("refuses a tap on the ink", () => {
    const result = bucketFill({
      ...PAGE,
      ink: square(100, 100, 100, 0, 3),
      x: 100,
      y: 150,
      gap: 0,
    });
    expect(result).toEqual({ ok: false, reason: "ink" });
  });

  it("starts beside the ink when the tap is in the widened band", () => {
    const result = bucketFill({ ...PAGE, ink: square(100, 100, 100), x: 104, y: 150, gap: 12 });
    expect(result.ok).toBe(true);
  });

  it("covers writing inside the outline: holes are not kept", () => {
    const ink = [...square(100, 100, 100), circle(150, 150, 10, 32)];
    const result = bucketFill({ ...PAGE, ink, x: 120, y: 120, gap: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(insidePolygon(result.outline, 150, 150)).toBe(true);
      expect(polygonArea(result.outline)).toBeGreaterThan(97 * 97);
    }
  });

  it("fills a circle to about its area", () => {
    const result = bucketFill({ ...PAGE, ink: [circle(200, 150, 60)], x: 200, y: 150, gap: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const area = polygonArea(result.outline);
      expect(area).toBeGreaterThan(Math.PI * 57 * 57);
      expect(area).toBeLessThan(Math.PI * 61 * 61);
    }
  });

  it("stays inside its memory cap on a huge page, and keeps the outline short", () => {
    const result = bucketFill({
      width: 100_000,
      height: 100_000,
      ink: square(10_000, 10_000, 50_000, 0, 200),
      x: 30_000,
      y: 30_000,
      gap: 0,
      maxCells: 40_000,
      maxPoints: 50,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outline.length / 2).toBeLessThanOrEqual(51);
    const grid = fillGrid(100_000, 100_000, 40_000);
    expect(grid && grid.w * grid.h).toBeLessThanOrEqual(40_000 * 1.02);
  });

  it("degrades on nonsense input", () => {
    expect(bucketFill({ width: 0, height: 10, ink: [], x: 1, y: 1, gap: 0 }).ok).toBe(false);
    expect(bucketFill({ ...PAGE, ink: [], x: Number.NaN, y: 1, gap: 0 }).ok).toBe(false);
    expect(bucketFill({ ...PAGE, ink: [], x: -5, y: 1, gap: 0 }).ok).toBe(false);
    const ragged: FillInk = { pts: [100, 100, P, Number.NaN, 5], radius: 1 };
    expect(bucketFill({ ...PAGE, ink: [ragged], x: 50, y: 50, gap: 0 }).ok).toBe(false);
  });
});

describe("the parts", () => {
  const grid = { w: 8, h: 6, scale: 1 };

  it("traces one cell as its four corners", () => {
    const region = new Uint8Array(48);
    region[2 * 8 + 3] = 1;
    expect(traceOutline(grid, region)).toEqual([3, 2, 4, 2, 4, 3, 3, 3]);
    expect(traceOutline(grid, new Uint8Array(48))).toEqual([]);
  });

  it("traces an L round its outside", () => {
    const region = new Uint8Array(48);
    for (const [i, j] of [
      [1, 1],
      [1, 2],
      [2, 2],
    ])
      region[j * 8 + i] = 1;
    const outline = traceOutline(grid, region);
    expect(polygonArea(outline)).toBe(3);
    expect(outline.length / 2).toBe(6);
  });

  it("floods four ways and says when it reached the edge", () => {
    const free = (k: number): boolean => k !== 9 && k !== 10;
    const result = flood(grid, free, 20);
    expect(result.open).toBe(true);
    expect(result.cells).toBe(46);
    const walls = new Set([9, 10, 11, 17, 19, 25, 26, 27]);
    const closed = flood(grid, (k) => !walls.has(k), 18);
    expect(closed).toMatchObject({ open: false, cells: 1 });
  });

  it("grows only where allowed", () => {
    const region = new Uint8Array(48);
    region[18] = 1;
    grow(grid, region, 1, (k) => k !== 19);
    expect([...region].reduce((a, b) => a + b, 0)).toBe(4);
    grow(grid, region, 1, () => true);
    expect(region[19]).toBe(1);
  });

  it("measures distance from the ink in thirds of a cell", () => {
    const mask = new Uint8Array(48);
    mask[0] = 1;
    const d = inkDistance(grid, mask);
    expect(d[0]).toBe(0);
    expect(d[1]).toBe(3);
    expect(d[9]).toBe(4);
    expect(d[2]).toBe(6);
  });

  it("rasterises a thin diagonal so a four-way flood cannot cross it", () => {
    const g = { w: 20, h: 20, scale: 1 };
    const mask = rasterInk(g, [line([0, 0, 20, 20], 0)]);
    const result = flood(g, (k) => mask[k] === 0, 19);
    expect(result.region[19 * 20]).toBe(0);
  });

  it("simplifies a staircase to its line", () => {
    const xy: number[] = [];
    for (let i = 0; i < 10; i++) xy.push(i, i, i + 1, i);
    xy.push(10, 10, 0, 10);
    const simple = simplifyClosed(xy, 0.75);
    expect(simple.length / 2).toBeLessThanOrEqual(4);
    expect(simplifyClosed([0, 0, 1, 0, 1, 1], 1)).toEqual([0, 0, 1, 0, 1, 1]);
  });

  it("tells inside from outside", () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(insidePolygon(sq, 5, 5)).toBe(true);
    expect(insidePolygon(sq, 15, 5)).toBe(false);
    expect(polygonArea(sq)).toBe(100);
  });
});
