import { describe, expect, it } from "vitest";
import { PDF_TILE_PX, tileRegion, tileSide, tilesFor } from "../../src/canvas/pdf-tiles";

const geometry = { width: 1024, height: 1448 };

describe("PDF tile grid", () => {
  it("is 512 device px a side at any level", () => {
    expect(tileSide(8) * 8).toBe(PDF_TILE_PX);
    expect(tileRegion(geometry, 8, 1, 2)).toEqual({ minX: 64, minY: 128, maxX: 128, maxY: 192 });
  });

  it("cuts the last tiles at the page's edges", () => {
    // 1024 / 64 = 16 tiles across exactly; 1448 / 64 = 22.6 down.
    expect(tileRegion(geometry, 8, 15, 22)).toEqual({
      minX: 960,
      minY: 1408,
      maxX: 1024,
      maxY: 1448,
    });
  });

  it("lists the tiles on screen first, nearest the middle, then a ring", () => {
    const view = { minX: 100, minY: 100, maxX: 228, maxY: 228 }; // 2 x 2 tiles' worth at 8x
    const tiles = tilesFor(geometry, view, 8);
    const shown = tiles.filter((t) => t.visible);
    // 100..228 at 64 px a tile: columns 1-3, rows 1-3.
    expect(shown.map((t) => `${t.col},${t.row}`).sort()).toEqual(
      ["1,1", "1,2", "1,3", "2,1", "2,2", "2,3", "3,1", "3,2", "3,3"].sort(),
    );
    expect(tiles[0]).toMatchObject({ col: 2, row: 2, visible: true });
    expect(tiles.slice(0, shown.length).every((t) => t.visible)).toBe(true);
    // A one-tile ring: columns and rows 0-4.
    expect(tiles).toHaveLength(25);
  });

  it("reaches one tile further the way the view moves", () => {
    const view = { minX: 256, minY: 256, maxX: 320, maxY: 320 }; // exactly tile 4,4
    const still = tilesFor(geometry, view, 8);
    const right = tilesFor(geometry, view, 8, 1, { x: 30, y: 0 });
    expect(still).toHaveLength(9);
    expect(right).toHaveLength(12);
    expect(right.some((t) => t.col === 6)).toBe(true);
    expect(right.some((t) => t.col === 2)).toBe(false);
    const up = tilesFor(geometry, view, 8, 1, { x: 0, y: -5 });
    expect(up.some((t) => t.row === 2)).toBe(true);
  });

  it("stays on the page at its corners", () => {
    const tiles = tilesFor(geometry, { minX: -50, minY: -50, maxX: 30, maxY: 30 }, 8);
    expect(Math.min(...tiles.map((t) => t.col))).toBe(0);
    expect(Math.min(...tiles.map((t) => t.row))).toBe(0);
    const end = tilesFor(geometry, { minX: 1000, minY: 1430, maxX: 1100, maxY: 1500 }, 8);
    expect(Math.max(...end.map((t) => t.col))).toBe(15);
    expect(Math.max(...end.map((t) => t.row))).toBe(22);
  });

  it("asks for nothing off the page or at a meaningless level", () => {
    expect(tilesFor(geometry, { minX: 2000, minY: 0, maxX: 2100, maxY: 100 }, 8)).toEqual([]);
    expect(tilesFor(geometry, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0)).toEqual([]);
    expect(tilesFor(geometry, { minX: 0, minY: 0, maxX: Number.NaN, maxY: 100 }, 8)).toEqual([]);
  });
});
