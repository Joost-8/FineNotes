import { describe, expect, it } from "vitest";
import { TEXT_TAPE_PAD, textTapeBand, textTapeStrokes } from "../../src/model/tape-text";
import { tapeContains, tapeCorners } from "../../src/model/cover-tape";

describe("a tape snapped to a line of text", () => {
  it("covers the whole line with a margin on every side", () => {
    const rect = { x: 100, y: 200, w: 300, h: 20 };
    const band = textTapeBand(rect);
    expect(band).not.toBeNull();
    const pad = rect.h * TEXT_TAPE_PAD;
    expect(band?.size).toBeCloseTo(rect.h + 2 * pad);
    const corners = tapeCorners(band?.pts ?? [], band?.size ?? 0);
    const xs = corners?.map((c) => c.x) ?? [];
    const ys = corners?.map((c) => c.y) ?? [];
    expect(Math.min(...xs)).toBeCloseTo(rect.x - pad);
    expect(Math.max(...xs)).toBeCloseTo(rect.x + rect.w + pad);
    expect(Math.min(...ys)).toBeCloseTo(rect.y - pad);
    expect(Math.max(...ys)).toBeCloseTo(rect.y + rect.h + pad);
  });

  it("is level and hides every corner of the line's letters", () => {
    const rect = { x: 12.345, y: 67.891, w: 80.5, h: 13.2 };
    const band = textTapeBand(rect);
    expect(band?.pts[1]).toBe(band?.pts[4]);
    const stroke = { pts: band?.pts ?? [], size: band?.size ?? 0 };
    for (const [x, y] of [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ]) {
      expect(tapeContains(stroke, x, y, 0)).toBe(true);
    }
  });

  it("stores hundredths, as every snapped mark does", () => {
    const band = textTapeBand({ x: 1.23456, y: 2.34567, w: 3.45678, h: 4.56789 });
    for (const value of [...(band?.pts ?? []), band?.size ?? 0]) {
      expect(Math.round(value * 100) / 100).toBe(value);
    }
  });

  it("refuses an empty or broken rectangle", () => {
    expect(textTapeBand({ x: 0, y: 0, w: 0, h: 10 })).toBeNull();
    expect(textTapeBand({ x: 0, y: 0, w: 10, h: -1 })).toBeNull();
    expect(textTapeBand({ x: Number.NaN, y: 0, w: 10, h: 10 })).toBeNull();
  });

  it("lays one tape per line, skipping empty ones", () => {
    let n = 0;
    const strokes = textTapeStrokes(
      [
        { x: 10, y: 10, w: 100, h: 12 },
        { x: 10, y: 30, w: 0, h: 12 },
        { x: 10, y: 50, w: 60, h: 12 },
      ],
      "#e6d3a3",
      () => `t${++n}`,
    );
    expect(strokes.map((s) => s.id)).toEqual(["t1", "t2"]);
    expect(strokes.every((s) => s.tool === "tape" && s.color === "#e6d3a3")).toBe(true);
    expect(strokes[1].pts[1]).toBe(56);
  });
});
