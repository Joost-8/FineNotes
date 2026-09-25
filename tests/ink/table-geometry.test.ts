/**
 * Tests for `src/ink/table-geometry.ts`: the Shape tool's tables, placed as
 * ordinary ink strokes.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_SIZE,
  TABLE_CELL_HEIGHT,
  TABLE_CELL_WIDTH,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  TABLE_MIN_CELL,
  draggedTableBox,
  isTableSize,
  tableSizeLabel,
  tableStrokes,
  tappedTableBox,
} from "../../src/ink/table-geometry";
import { dequantizePts, quantizePts } from "../../src/model/serialize";

const PAGE = { width: 1024, height: 1448 };

describe("tableStrokes", () => {
  const from = { x: 100, y: 200 };
  const to = { x: 460, y: 368 };
  const strokes = tableStrokes(from, to, { rows: 3, cols: 4 }, 0.5);

  it("is an outline plus one line per inner row and column boundary", () => {
    expect(strokes).toHaveLength(1 + 2 + 3);
    expect(strokes.map((s) => s.shape)).toEqual(["rect", "line", "line", "line", "line", "line"]);
  });

  it("draws the outline as the contract's closed five-point rect over the box", () => {
    const [outline] = strokes;
    expect(outline.pts).toEqual([
      100, 200, 0.5, 460, 200, 0.5, 460, 368, 0.5, 100, 368, 0.5, 100, 200, 0.5,
    ]);
  });

  it("spaces the rows and columns evenly, edge to edge", () => {
    const rows = strokes.slice(1, 3).map((s) => s.pts);
    expect(rows).toEqual([
      [100, 256, 0.5, 460, 256, 0.5],
      [100, 312, 0.5, 460, 312, 0.5],
    ]);
    const cols = strokes.slice(3).map((s) => s.pts);
    expect(cols).toEqual([
      [190, 200, 0.5, 190, 368, 0.5],
      [280, 200, 0.5, 280, 368, 0.5],
      [370, 200, 0.5, 370, 368, 0.5],
    ]);
  });

  it("does not care which corner the drag started from", () => {
    expect(tableStrokes(to, from, { rows: 3, cols: 4 }, 0.5)).toEqual(strokes);
  });

  it("makes a one-by-one table a lone rectangle", () => {
    const one = tableStrokes(from, to, { rows: 1, cols: 1 }, 0.5);
    expect(one.map((s) => s.shape)).toEqual(["rect"]);
  });

  it("returns nothing for a degenerate box or an invalid size", () => {
    expect(tableStrokes(from, { x: 100, y: 500 }, { rows: 2, cols: 2 }, 0.5)).toEqual([]);
    expect(tableStrokes(from, { x: NaN, y: 500 }, { rows: 2, cols: 2 }, 0.5)).toEqual([]);
    expect(tableStrokes(from, to, { rows: 0, cols: 2 }, 0.5)).toEqual([]);
    expect(tableStrokes(from, to, { rows: 2, cols: 99 }, 0.5)).toEqual([]);
  });

  it("rounds coordinates to serialize.ts's grid, so a saved table does not drift", () => {
    // Pressure is the caller's (the Shape tool passes FALLBACK_PRESSURE, as
    // for every preset); only the geometry is this module's to round.
    const odd = tableStrokes(
      { x: 10.123, y: 20.456 },
      { x: 333.333, y: 222.222 },
      { rows: 7, cols: 3 },
      0.5,
    );
    const coords = (pts: number[]): number[] => pts.filter((_, i) => i % 3 !== 2);
    for (const s of odd) expect(coords(dequantizePts(quantizePts(s.pts)))).toEqual(coords(s.pts));
  });
});

describe("isTableSize / tableSizeLabel", () => {
  it("accepts whole sizes from 1 × 1 to the picker's largest", () => {
    expect(isTableSize(DEFAULT_TABLE_SIZE)).toBe(true);
    expect(isTableSize({ rows: 1, cols: 1 })).toBe(true);
    expect(isTableSize({ rows: TABLE_MAX_ROWS, cols: TABLE_MAX_COLS })).toBe(true);
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      undefined,
      "3x3",
      { rows: 0, cols: 3 },
      { rows: 3, cols: TABLE_MAX_COLS + 1 },
      { rows: 2.5, cols: 3 },
      { rows: NaN, cols: 3 },
      { rows: 3 },
    ]) {
      expect(isTableSize(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("reads rows by columns", () => {
    expect(tableSizeLabel({ rows: 3, cols: 4 })).toBe("3 × 4");
  });
});

describe("draggedTableBox", () => {
  it("keeps a drag that is big enough exactly as dragged", () => {
    const box = draggedTableBox({ x: 100, y: 100 }, { x: 400, y: 300 }, { rows: 3, cols: 3 }, PAGE);
    expect(box).toEqual({ from: { x: 100, y: 100 }, to: { x: 400, y: 300 } });
  });

  it("grows a flat drag away from the press until every cell has room", () => {
    const box = draggedTableBox({ x: 300, y: 300 }, { x: 600, y: 305 }, { rows: 4, cols: 3 }, PAGE);
    expect(box.to.x).toBe(600);
    expect(box.to.y - box.from.y).toBe(4 * TABLE_MIN_CELL);
    // Up and to the left, it grows up and to the left.
    const back = draggedTableBox(
      { x: 300, y: 300 },
      { x: 298, y: 200 },
      { rows: 2, cols: 5 },
      PAGE,
    );
    expect(back.to.x).toBe(300 - 5 * TABLE_MIN_CELL);
    expect(back.to.y).toBe(200);
  });

  it("moves a grown box back onto the page", () => {
    const box = draggedTableBox({ x: 1020, y: 10 }, { x: 1022, y: 12 }, { rows: 3, cols: 3 }, PAGE);
    expect(Math.max(box.from.x, box.to.x)).toBeLessThanOrEqual(PAGE.width);
    expect(Math.min(box.from.x, box.to.x)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(box.to.x - box.from.x)).toBe(3 * TABLE_MIN_CELL);
  });
});

describe("tappedTableBox", () => {
  it("puts a default-size table's top-left corner at the tap", () => {
    const box = tappedTableBox({ x: 100, y: 200 }, { rows: 3, cols: 4 }, PAGE);
    expect(box.from).toEqual({ x: 100, y: 200 });
    expect(box.to).toEqual({ x: 100 + 4 * TABLE_CELL_WIDTH, y: 200 + 3 * TABLE_CELL_HEIGHT });
  });

  it("moves a table tapped near the edge back onto the page", () => {
    const box = tappedTableBox({ x: 900, y: 1440 }, { rows: 2, cols: 2 }, PAGE);
    expect(box.to.x).toBeLessThanOrEqual(PAGE.width - 24);
    expect(box.to.y).toBeLessThanOrEqual(PAGE.height - 24);
    expect(box.to.x - box.from.x).toBe(2 * TABLE_CELL_WIDTH);
  });

  it("fits the largest table across a standard page at full cell width", () => {
    const box = tappedTableBox({ x: 10, y: 50 }, { rows: 8, cols: 8 }, PAGE);
    expect(box.to.x - box.from.x).toBe(8 * TABLE_CELL_WIDTH);
    expect(box.from.x).toBe(24);
  });

  it("narrows the cells evenly when the whole table would not fit across the page", () => {
    const narrow = { width: 600, height: 800 };
    const box = tappedTableBox({ x: 50, y: 50 }, { rows: 8, cols: 8 }, narrow);
    expect(box.from.x).toBe(24);
    expect(box.to.x).toBe(narrow.width - 24);
    expect(box.to.y - box.from.y).toBe(8 * TABLE_CELL_HEIGHT);
  });
});

describe("tables at zoom (cellScale)", () => {
  const page = { width: 1024, height: 1448 };
  const size = { rows: 3, cols: 4 };

  it("taps a table a fifth the size at 5x zoom, so it looks the same on screen", () => {
    const fit = tappedTableBox({ x: 100, y: 100 }, size, page);
    const zoomed = tappedTableBox({ x: 100, y: 100 }, size, page, 1 / 5);
    expect(zoomed.to.x - zoomed.from.x).toBeCloseTo((fit.to.x - fit.from.x) / 5, 6);
    expect(zoomed.to.y - zoomed.from.y).toBeCloseTo((fit.to.y - fit.from.y) / 5, 6);
  });

  it("lets a small drag at 5x zoom make a small table", () => {
    const from = { x: 100, y: 100 };
    const to = { x: 120, y: 105 };
    const fit = draggedTableBox(from, to, size, page);
    const zoomed = draggedTableBox(from, to, size, page, 1 / 5);
    // At fit the drag is grown to the minimum cell; at 5x the minimum is a fifth.
    expect(fit.to.x - fit.from.x).toBe(size.cols * TABLE_MIN_CELL);
    expect(zoomed.to.x - zoomed.from.x).toBe(20);
    expect(zoomed.to.y - zoomed.from.y).toBeCloseTo((size.rows * TABLE_MIN_CELL) / 5, 6);
  });

  it("is the old behaviour at fit zoom", () => {
    expect(tappedTableBox({ x: 50, y: 60 }, size, page, 1)).toEqual(
      tappedTableBox({ x: 50, y: 60 }, size, page),
    );
  });
});
