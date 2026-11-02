/**
 * Stretching a cover tape by its side handles (`model/cover-tape`): an end
 * slides along the tape, a long edge moves across it, and the other side
 * stays where it was.
 */

import { describe, expect, it } from "vitest";
import { selectionBounds } from "../../src/canvas/lasso";
import { TAPE_HANDLES, stretchTape, tapeBounds, tapeHandles } from "../../src/model/cover-tape";
import type { InkDocument, Page, Stroke } from "../../src/model/document";
import { StretchTape } from "../../src/model/selection-commands";

/** A level tape from (100, 200) to (300, 200), 40 tall. */
const LEVEL = [100, 200, 0.5, 300, 200, 0.5];

describe("tapeHandles", () => {
  it("puts the handles on the middles of the ends and the long edges", () => {
    expect(tapeHandles(LEVEL, 40)).toEqual({
      start: { x: 100, y: 200 },
      end: { x: 300, y: 200 },
      top: { x: 200, y: 180 },
      bottom: { x: 200, y: 220 },
    });
  });

  it("lands on the middles of the frame's sides when pushed out by its pad", () => {
    const handles = tapeHandles(LEVEL, 40, 5);
    const b = tapeBounds(LEVEL, 40);
    if (!handles || !b) throw new Error("no tape");
    expect(handles.start).toEqual({ x: b.minX - 5, y: 200 });
    expect(handles.end).toEqual({ x: b.maxX + 5, y: 200 });
    expect(handles.top).toEqual({ x: 200, y: b.minY - 5 });
    expect(handles.bottom).toEqual({ x: 200, y: b.maxY + 5 });
  });

  it("follows a turned tape", () => {
    const upright = [50, 0, 0.5, 50, 100, 0.5];
    const handles = tapeHandles(upright, 20);
    expect(handles?.top).toEqual({ x: 60, y: 50 });
    expect(handles?.bottom).toEqual({ x: 40, y: 50 });
  });

  it("has none for a tape with no points or no height", () => {
    expect(tapeHandles([], 40)).toBeNull();
    expect(tapeHandles(LEVEL, 0)).toBeNull();
  });
});

describe("stretchTape", () => {
  it("lengthens from the end, the start staying", () => {
    expect(stretchTape(LEVEL, 40, "end", { x: 380, y: 230 }, 8, 4)).toEqual({
      pts: [100, 200, 0.5, 380, 200, 0.5],
      size: 40,
    });
  });

  it("lengthens from the start, the end staying", () => {
    expect(stretchTape(LEVEL, 40, "start", { x: 40, y: 190 }, 8, 4)?.pts).toEqual([
      40, 200, 0.5, 300, 200, 0.5,
    ]);
  });

  it("raises the top edge, the bottom edge staying", () => {
    const out = stretchTape(LEVEL, 40, "top", { x: 150, y: 140 }, 8, 4);
    expect(out).toEqual({ pts: [100, 180, 0.5, 300, 180, 0.5], size: 80 });
    const b = out && tapeBounds(out.pts, out.size);
    expect(b?.maxY).toBe(220);
  });

  it("lowers the bottom edge, the top edge staying", () => {
    const out = stretchTape(LEVEL, 40, "bottom", { x: 250, y: 200 }, 8, 4);
    expect(out).toEqual({ pts: [100, 190, 0.5, 300, 190, 0.5], size: 20 });
    expect(out && tapeBounds(out.pts, out.size)?.minY).toBe(180);
  });

  it("never goes shorter or thinner than the floors, nor turns inside out", () => {
    expect(stretchTape(LEVEL, 40, "end", { x: 0, y: 200 }, 8, 4)?.pts).toEqual([
      100, 200, 0.5, 108, 200, 0.5,
    ]);
    const thin = stretchTape(LEVEL, 40, "top", { x: 200, y: 300 }, 8, 4);
    expect(thin?.size).toBe(4);
    expect(thin && tapeBounds(thin.pts, thin.size)?.maxY).toBe(220);
  });

  it("stretches a turned tape along and across itself", () => {
    const upright = [50, 0, 0.5, 50, 100, 0.5];
    expect(stretchTape(upright, 20, "end", { x: 70, y: 150 }, 8, 4)?.pts).toEqual([
      50, 0, 0.5, 50, 150, 0.5,
    ]);
    // `top` is to the right of a tape running down the page.
    expect(stretchTape(upright, 20, "top", { x: 80, y: 50 }, 8, 4)).toEqual({
      pts: [60, 0, 0.5, 60, 100, 0.5],
      size: 40,
    });
  });

  it("opens a square tape level from its far side", () => {
    expect(
      stretchTape([100, 100, 0.5, 100, 100, 0.5], 20, "end", { x: 150, y: 100 }, 8, 4)?.pts,
    ).toEqual([90, 100, 0.5, 150, 100, 0.5]);
  });

  it("is idempotent at a handle's own place", () => {
    const handles = tapeHandles(LEVEL, 40);
    if (!handles) throw new Error("no tape");
    for (const handle of TAPE_HANDLES) {
      expect(stretchTape(LEVEL, 40, handle, handles[handle], 8, 4)).toEqual({
        pts: LEVEL,
        size: 40,
      });
    }
  });
});

describe("a tape's bounds", () => {
  it("are its band, square at the ends, in a selection too", () => {
    const stroke: Stroke = { id: "t", color: "#e6d3a3", size: 40, tool: "tape", pts: LEVEL };
    const band = { minX: 100, minY: 180, maxX: 300, maxY: 220 };
    expect(tapeBounds(LEVEL, 40)).toEqual(band);
    expect(selectionBounds([stroke], [], [])).toEqual(band);
  });
});

describe("StretchTape", () => {
  it("sets the ends and height, and undo puts back the very array", () => {
    const pts = [...LEVEL];
    const stroke: Stroke = { id: "t", color: "#e6d3a3", size: 40, tool: "tape", pts };
    const page = { id: "p1", strokes: [stroke] } as unknown as Page;
    const doc = { pages: [page] } as unknown as InkDocument;
    const command = new StretchTape("p1", stroke, [100, 190, 0.5, 400, 190, 0.5], 60);
    command.apply(doc);
    expect(stroke.size).toBe(60);
    expect(stroke.pts).toEqual([100, 190, 0.5, 400, 190, 0.5]);
    command.invert();
    expect(stroke.size).toBe(40);
    expect(stroke.pts).toBe(pts);
  });

  it("does nothing to a tape no longer on its page", () => {
    const stroke: Stroke = { id: "t", color: "#e6d3a3", size: 40, tool: "tape", pts: LEVEL };
    const doc = { pages: [{ id: "p1", strokes: [] }] } as unknown as InkDocument;
    new StretchTape("p1", stroke, [0, 0, 0.5, 9, 9, 0.5], 10).apply(doc);
    expect(stroke.size).toBe(40);
  });
});
