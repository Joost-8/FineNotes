/**
 * Alignment while moving a selection (`src/canvas/align-snap.ts`), against
 * what Goodnotes for the web did in research/goodnotes-shapes-2026-11-08.md.
 */

import { describe, expect, it } from "vitest";
import { type AlignBox, alignMove } from "../../src/canvas/align-snap";

const box = (x: number, y: number, w: number, h: number): AlignBox => ({
  minX: x,
  minY: y,
  maxX: x + w,
  maxY: y + h,
});

// The study's page: an ellipse and a pill stacked, centres at x = 730.
const ellipse = box(660, 140, 140, 80);
const pill = box(660, 260, 140, 80);
const rect = box(500, 140, 120, 80);

describe("alignMove", () => {
  it("snaps the box's centre onto a centre 4 px away, and draws a dashed guide through both", () => {
    // Moved so its centre would be at x = 734 (Goodnotes' 08- screenshot).
    const r = alignMove(rect, 174, 260, [ellipse, pill], 10, 12);
    expect(r.dx).toBe(170);
    expect(r.dy).toBe(260);
    const centre = r.guides.find((g) => g.axis === "x" && g.centre);
    expect(centre).toMatchObject({ at: 730, from: 140 - 12, to: 480 + 12 });
    expect(r.dot).toEqual({ x: 730, y: 440 });
  });

  it("snaps an edge onto an edge within the radius, and lets go past it", () => {
    // Right edge 8 px past the ellipse's: snaps (Goodnotes did at 8 and 10).
    const near = alignMove(rect, 188, 300, [ellipse], 10);
    expect(near.dx).toBe(180);
    expect(near.guides).toEqual([{ axis: "x", at: 800, from: 140, to: 520, centre: false }]);
    expect(near.dot).toBeNull();
    // 12 px past: free (Goodnotes let go at 12).
    const far = alignMove(rect, 192, 300, [ellipse], 10);
    expect(far.dx).toBe(192);
    expect(far.guides).toEqual([]);
  });

  it("snaps a right edge onto a neighbour's left edge", () => {
    // Right edge would be at 664, the pill's left is at 660.
    const r = alignMove(rect, 44, 260, [pill], 10);
    expect(r.dx).toBe(40);
    expect(r.guides.map((g) => g.at)).toEqual([660]);
  });

  it("never pairs a centre with an edge", () => {
    // Centre would be at 662, 2 px from the pill's left edge: no snap there.
    const r = alignMove(rect, 102, 400, [pill], 10);
    expect(r.dx).toBe(102);
  });

  it("snaps each axis on its own, and shows every line that meets", () => {
    // The study's 11- screenshot: moved onto a triangle's box, level with the ellipse.
    const triangle = box(845, 140, 150, 80);
    const r = alignMove(rect, 355, 3, [ellipse, triangle], 10, 0);
    expect(r.dy).toBe(0);
    // Centre across onto the triangle's (920 - 560 = 360).
    expect(r.dx).toBe(360);
    const down = r.guides.filter((g) => g.axis === "y");
    expect(down.map((g) => [g.at, g.centre])).toEqual([
      [140, false],
      [180, true],
      [220, false],
    ]);
    // A guide runs across every box on it.
    expect(down[0]).toMatchObject({ from: 660, to: 995 });
    expect(r.guides.find((g) => g.axis === "x")).toMatchObject({ at: 920, centre: true });
  });

  it("takes the nearest line when two are in reach", () => {
    const a = box(0, 0, 10, 10);
    const r = alignMove(a, 0, 0, [box(13, 100, 10, 10), box(-4, 200, 10, 10)], 10);
    // Its right edge is 3 px from one box's left edge, its left edge 4 px from the other's: 3 wins.
    expect(r.dx).toBe(3);
  });

  it("leaves the move alone with no targets, a bad box or a bad move", () => {
    expect(alignMove(rect, 5, 5, [], 10)).toEqual({ dx: 5, dy: 5, guides: [], dot: null });
    expect(alignMove(rect, NaN, 5, [ellipse], 10).guides).toEqual([]);
    expect(alignMove(box(0, 0, NaN, 1), 1, 1, [ellipse], 10).dx).toBe(1);
    expect(alignMove(rect, 1, 1, [box(0, 0, -5, 3)], 10).dx).toBe(1);
    expect(alignMove(rect, 1, 1, [ellipse], 0).dx).toBe(1);
  });
});
