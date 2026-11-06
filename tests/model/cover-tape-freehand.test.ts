/**
 * Freehand cover tape (`model/cover-tape`): a tape with more than its two
 * end points is a band along the path through them, ends cut square.
 */

import { describe, expect, it } from "vitest";
import {
  FREEHAND_TAPE_TOLERANCE,
  freehandTapePoints,
  isFreehandTape,
  offsetPath,
  stretchTape,
  tapeBounds,
  tapeClipPath,
  tapeContains,
  tapeHandles,
  tapeModeOf,
  tapePath,
  tapePolygon,
} from "../../src/model/cover-tape";
import type { Stroke } from "../../src/model/document";

/** An L: right along y = 0 to x = 100, then down to y = 100. */
const L = [0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5];

function tape(pts: number[], size = 20): Stroke {
  return { id: "t", color: "#e6d3a3", size, tool: "tape", pts };
}

describe("which tapes are freehand", () => {
  it("is a tape with more than two points", () => {
    expect(isFreehandTape(L)).toBe(true);
    expect(isFreehandTape([0, 0, 0.5, 100, 0, 0.5])).toBe(false);
    expect(isFreehandTape([])).toBe(false);
  });

  it("drops repeated points, and draws one with a single distinct point as straight", () => {
    expect(tapePath([0, 0, 0.5, 0, 0, 0.5, 50, 0, 0.5])).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    expect(tapePath([5, 5, 0.5, 5, 5, 0.5, 5, 5, 0.5])).toBeNull();
    expect(tapePath([0, 0, 0.5, 10, 0, 0.5])).toBeNull();
  });

  it("reads a stored mode, straight for anything unknown", () => {
    expect(tapeModeOf("freehand")).toBe("freehand");
    expect(tapeModeOf("straight")).toBe("straight");
    expect(tapeModeOf(undefined)).toBe("straight");
    expect(tapeModeOf("wavy")).toBe("straight");
  });
});

describe("a freehand tape's band", () => {
  it("holds points along its path, not inside the L's elbow", () => {
    const t = tape(L);
    expect(tapeContains(t, 50, 9)).toBe(true);
    expect(tapeContains(t, 109, 50)).toBe(true);
    expect(tapeContains(t, 50, 50)).toBe(false);
    expect(tapeContains(t, 50, 12)).toBe(false);
    expect(tapeContains(t, 50, 12, 3)).toBe(true);
  });

  it("is cut square at its ends", () => {
    const t = tape(L);
    expect(tapeContains(t, -1, 0)).toBe(false);
    expect(tapeContains(t, -1, 0, 2)).toBe(true);
    expect(tapeContains(t, 100, 101)).toBe(false);
  });

  it("covers the outside of a corner round it", () => {
    // 10 from the elbow, diagonally out: in the round join.
    expect(tapeContains(tape(L), 107, -7)).toBe(true);
  });

  it("has bounds of its path and half its height", () => {
    expect(tapeBounds(L, 20)).toEqual({ minX: -10, minY: -10, maxX: 110, maxY: 110 });
    expect(tapeBounds(L, 0)).toBeNull();
  });

  it("outlines its band: left edge forward, right edge back", () => {
    const outline = tapePolygon(L, 20) ?? [];
    expect(outline).toHaveLength(6);
    expect(outline[0]).toEqual({ x: 0, y: -10 });
    // The outer corner reaches out to where the two edges meet.
    expect(outline[1].x).toBeCloseTo(110);
    expect(outline[1].y).toBeCloseTo(-10);
    expect(outline[2]).toEqual({ x: 110, y: 100 });
    expect(outline[3]).toEqual({ x: 90, y: 100 });
    expect(outline[4].x).toBeCloseTo(90);
    expect(outline[4].y).toBeCloseTo(10);
    expect(outline[5]).toEqual({ x: 0, y: 10 });
  });

  it("caps a hairpin's outline at twice the half height", () => {
    // Out to x = 100 and nearly straight back.
    const outline = tapePolygon([0, 0, 0.5, 100, 0, 0.5, 0, 2, 0.5], 20) ?? [];
    expect(Math.hypot(outline[1].x - 100, outline[1].y)).toBeLessThanOrEqual(20 + 1e-9);
  });

  it("keeps fibres inside the band", () => {
    const path = tapePath(L) ?? [];
    for (const offset of [-9, 9]) {
      for (const p of offsetPath(path, offset, false)) {
        expect(tapeContains(tape(L), p.x, p.y)).toBe(true);
      }
    }
  });

  it("cuts its own band out of a text box under it", () => {
    const clip = tapeClipPath([tape(L)], { x: 0, y: -20, w: 200, h: 200 }, 1);
    expect(clip.startsWith("polygon(evenodd")).toBe(true);
    expect(clip).toContain("110.0px 120.0px");
  });

  it("has no straight-tape side handles and does not stretch", () => {
    expect(tapeHandles(L, 20)).toBeNull();
    expect(stretchTape(L, 20, "end", { x: 200, y: 0 }, 8, 8)).toBeNull();
  });
});

describe("laying a freehand tape", () => {
  it("keeps the drag's shape within the tolerance, and drops the rest", () => {
    const samples = [];
    for (let x = 0; x <= 100; x += 2) samples.push({ x, y: 0.2 * Math.sin(x) });
    for (let y = 2; y <= 100; y += 2) samples.push({ x: 100, y });
    const pts = freehandTapePoints(samples, FREEHAND_TAPE_TOLERANCE) ?? [];
    expect(pts.length / 3).toBe(3);
    expect(pts[3]).toBe(100);
    expect(Math.abs(pts[4])).toBeLessThan(0.2);
    expect(pts.every((v, i) => i % 3 !== 2 || v === 0.5)).toBe(true);
  });

  it("keeps every point for a draft (tolerance 0)", () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(freehandTapePoints(samples, 0)).toEqual([0, 0, 0.5, 5, 0, 0.5, 10, 0, 0.5]);
  });

  it("is a straight tape when the drag was straight", () => {
    const samples = [];
    for (let x = 0; x <= 100; x += 1) samples.push({ x, y: 0 });
    expect(freehandTapePoints(samples, FREEHAND_TAPE_TOLERANCE)).toEqual([0, 0, 0.5, 100, 0, 0.5]);
  });

  it("lays nothing for a tap or a scribble shorter than the minimum", () => {
    expect(freehandTapePoints([{ x: 0, y: 0 }], 1)).toBeNull();
    expect(
      freehandTapePoints(
        [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 0, y: 3 },
        ],
        1,
      ),
    ).toBeNull();
  });

  it("measures the minimum along the path, not end to end", () => {
    // A loop back to its start: 0 apart end to end, 40 along.
    const loop = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    expect(freehandTapePoints(loop, 1)).not.toBeNull();
  });

  it("skips points that are not finite", () => {
    const pts = freehandTapePoints(
      [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 4 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
      1,
    );
    expect(pts).toEqual([0, 0, 0.5, 50, 0, 0.5, 50, 50, 0.5]);
  });
});
