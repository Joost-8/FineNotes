/**
 * `src/canvas/erase-look.ts`: the grey ink is drawn in while the Whole
 * stroke or By line eraser holds it ("Grey out while erasing", discussion
 * #51), and the stretches the By line eraser cuts, which are drawn grey.
 *
 * It must read as "about to go": fainter than any ink, yet still legible,
 * on white paper and on night paper, where `nightColor` shows it.
 */

import { describe, expect, it } from "vitest";
import {
  ERASING_GREY,
  erasedPieces,
  erasedStretches,
  erasesGrey,
  erasingLook,
} from "../../src/canvas/erase-look";
import { NIGHT_PAPER, nightColor } from "../../src/canvas/night";
import { PALETTE } from "../../src/constants";
import { eraseRectsFromPoints } from "../../src/ink/stroke-eraser";
import { contrastRatio } from "../../src/model/cover";

describe("the grey of a stroke being erased", () => {
  it("is faint but legible on white paper and on night paper", () => {
    const day = contrastRatio(ERASING_GREY, "#ffffff");
    const night = contrastRatio(nightColor(ERASING_GREY), NIGHT_PAPER);
    for (const ratio of [day, night]) {
      expect(ratio).toBeGreaterThan(2);
      expect(ratio).toBeLessThan(6);
    }
  });

  it("is fainter than the default ink, by day and at night", () => {
    const ink = PALETTE[0];
    expect(contrastRatio(ERASING_GREY, "#ffffff")).toBeLessThan(contrastRatio(ink, "#ffffff"));
    expect(contrastRatio(nightColor(ERASING_GREY), NIGHT_PAPER)).toBeLessThan(
      contrastRatio(nightColor(ink), NIGHT_PAPER),
    );
  });
});

describe("erasesGrey", () => {
  it("greys Whole stroke, and By line on lined paper, only with the switch on", () => {
    expect(erasesGrey("stroke", false, true)).toBe(true);
    expect(erasesGrey("ruled", true, true)).toBe(true);
    expect(erasesGrey("stroke", false, false)).toBe(false);
    expect(erasesGrey("ruled", true, false)).toBe(false);
  });

  it("never greys the standard eraser, nor By line where it erases as the standard one", () => {
    expect(erasesGrey("standard", false, true)).toBe(false);
    expect(erasesGrey("standard", true, true)).toBe(false);
    expect(erasesGrey("ruled", false, true)).toBe(false);
  });
});

describe("erasingLook", () => {
  it("greys the colour and keeps the tool, leaving the stroke as it was", () => {
    const stroke = { id: "s", color: "#e03131", tool: "highlighter" as const, size: 12 };
    const look = erasingLook(stroke);
    expect(look).toEqual({ ...stroke, color: ERASING_GREY });
    expect(stroke.color).toBe("#e03131");
  });

  it("greys a shape's fill at the fill's own opacity", () => {
    expect(erasingLook({ color: "#1971c2", fill: "#1971c240" }).fill).toBe(`${ERASING_GREY}40`);
    expect(erasingLook({ color: "#1971c2", fill: "#1971c2" }).fill).toBe(ERASING_GREY);
  });

  it("adds no fill to a stroke without one", () => {
    expect("fill" in erasingLook({ color: "#1a1a1a" })).toBe(false);
  });
});

describe("erasedStretches", () => {
  // A level line at y 10, x 0 to 100 through a point at 50, pressure 0.2 to 0.6.
  const line = [0, 10, 0.2, 50, 10, 0.4, 100, 10, 0.6];
  const band = (minX: number, maxX: number) => ({ minX, maxX, minY: 0, maxY: 20 });

  it("is the stretch the cut takes, widened sideways by half the stroke", () => {
    const [stretch, ...rest] = erasedStretches(line, 4, [band(40, 60)]);
    expect(rest).toEqual([]);
    // One stretch across the middle point, its pressure interpolated.
    expect(stretch.filter((_, i) => i % 3 === 0)).toEqual([38, 50, 62]);
    expect(stretch[2]).toBeCloseTo(0.2 + 0.2 * (38 / 50));
    expect(stretch[8]).toBeCloseTo(0.4 + 0.2 * (12 / 50));
  });

  it("fills exactly the gap between the pieces the cut leaves", () => {
    const rects = [band(10, 20), band(70, 80)];
    const pieces = eraseRectsFromPoints(line, 4, rects) ?? [];
    const stretches = erasedStretches(line, 4, rects);
    const ends = (runs: number[][]) => runs.map((r) => [r[0], r[r.length - 3]]);
    expect(ends(pieces)).toEqual([
      [0, 8],
      [22, 68],
      [82, 100],
    ]);
    expect(ends(stretches)).toEqual([
      [8, 22],
      [68, 82],
    ]);
  });

  it("is nothing when no rectangle reaches the line", () => {
    expect(erasedStretches(line, 4, [{ minX: 0, maxX: 100, minY: 30, maxY: 40 }])).toEqual([]);
    expect(erasedStretches(line, 4, [])).toEqual([]);
    expect(erasedStretches([], 4, [band(0, 100)])).toEqual([]);
  });

  it("takes all of a line inside, and a dot inside as it is", () => {
    expect(erasedStretches(line, 4, [band(-10, 110)])).toEqual([line]);
    expect(erasedStretches([30, 10, 0.5], 4, [band(20, 40)])).toEqual([[30, 10, 0.5]]);
    expect(erasedStretches([30, 10, 0.5], 4, [band(50, 60)])).toEqual([]);
  });
});

describe("erasedPieces", () => {
  it("are the cut stretches in the stroke's style, open, with ids of their own", () => {
    const box = {
      id: "box",
      color: "#2f9e44",
      size: 4,
      tool: "pen" as const,
      shape: "rect" as const,
      fill: "#b2f2bb80",
      dash: "dash" as const,
      heads: { end: "arrow" },
      pts: [0, 10, 0.5, 100, 10, 0.5],
    };
    const [piece, ...rest] = erasedPieces(box as never, [
      { minX: 40, maxX: 60, minY: 0, maxY: 20 },
    ]);
    expect(rest).toEqual([]);
    expect(piece).toEqual({
      id: "box~erasing0",
      color: "#2f9e44",
      size: 4,
      tool: "pen",
      shape: "rect",
      dash: "dash",
      // The cut takes 38 to 62; the pieces left keep their round ends 2 px
      // into it, so the grey starts and stops where they end.
      pts: [40, 10, 0.5, 60, 10, 0.5],
    });
  });

  it("keep the stroke's own round end, trimming only where a piece stays", () => {
    const pen = { id: "p", color: "#1a1a1a", size: 4, tool: "pen" as const };
    const line = { ...pen, pts: [0, 10, 0.2, 50, 10, 0.4, 100, 10, 0.6] };
    // From the stroke's start to 60: only the far end is trimmed, across the middle point.
    const [head] = erasedPieces(line, [{ minX: -10, maxX: 60, minY: 0, maxY: 20 }]);
    expect(head.pts.filter((_, i) => i % 3 === 0)).toEqual([0, 50, 60]);
    expect(head.pts[8]).toBeCloseTo(0.44);
    // All of it: nothing trimmed.
    expect(erasedPieces(line, [{ minX: -10, maxX: 110, minY: 0, maxY: 20 }])[0].pts).toEqual(
      line.pts,
    );
  });

  it("drop a stretch no longer than the round ends either side already cover", () => {
    const thick = { id: "t", color: "#ffd43b", size: 30, tool: "highlighter" as const };
    const band = { ...thick, pts: [0, 10, 0.5, 200, 10, 0.5] };
    // A 1 px band keeps 1 px of grey; a zero-width one keeps none.
    const [kept, ...rest] = erasedPieces(band, [{ minX: 99, maxX: 100, minY: 0, maxY: 20 }]);
    expect(rest).toEqual([]);
    expect(kept.pts[0]).toBeCloseTo(99);
    expect(kept.pts[3]).toBeCloseTo(100);
    expect(
      erasedPieces({ ...band, size: 40 }, [{ minX: 100, maxX: 100, minY: 0, maxY: 20 }]),
    ).toEqual([]);
  });
});
