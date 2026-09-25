import { describe, expect, it } from "vitest";
import {
  ByteLru,
  TILE_SIZE,
  previewScale,
  quantiseLevel,
  rasterSize,
  tileKey,
  tilesCovering,
  tilesForBounds,
} from "../../src/canvas/tile-grid";

describe("tilesCovering", () => {
  it("cuts edge tiles to the raster and covers exactly the requested region", () => {
    // 1024 x 1448 page at level 2 -> 2048 x 2896 device px -> 4 x 6 tiles.
    const all = tilesCovering(1024, 1448, 2, 0, 0, 1e9, 1e9);
    expect(all).toHaveLength(4 * 6);
    const last = all[all.length - 1];
    expect(last).toMatchObject({
      col: 3,
      row: 5,
      w: 2048 - 3 * TILE_SIZE,
      h: 2896 - 5 * TILE_SIZE,
    });
    expect(all[0]).toEqual({ col: 0, row: 0, x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE });
  });

  it("returns only the tiles a viewport band touches", () => {
    const band = tilesCovering(1024, 1448, 2, -100, 600, 3000, 1100);
    expect(band.map((t) => `${t.col},${t.row}`)).toEqual([
      "0,1",
      "1,1",
      "2,1",
      "3,1",
      "0,2",
      "1,2",
      "2,2",
      "3,2",
    ]);
  });

  it("is empty for a region off the page", () => {
    expect(tilesCovering(1024, 1448, 2, -500, -500, -1, -1)).toEqual([]);
    expect(tilesCovering(1024, 1448, 2, 5000, 0, 6000, 100)).toEqual([]);
    expect(tilesCovering(1024, 1448, 2, 100, 100, 100, 200)).toEqual([]);
  });

  it("treats the right and bottom edges as exclusive", () => {
    expect(tilesCovering(1024, 1448, 2, 0, 0, TILE_SIZE, TILE_SIZE)).toHaveLength(1);
    expect(tilesCovering(1024, 1448, 2, 0, 0, TILE_SIZE + 1, TILE_SIZE)).toHaveLength(2);
  });
});

describe("tilesForBounds", () => {
  it("maps a page-space rectangle through the level and the padding", () => {
    const hit = tilesForBounds(1024, 1448, 2, { minX: 250, minY: 250, maxX: 255, maxY: 255 }, 0);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ col: 0, row: 0 });
    // Padded by 24 page px it reaches 548 device px: the next column and row.
    const padded = tilesForBounds(
      1024,
      1448,
      2,
      { minX: 250, minY: 250, maxX: 255, maxY: 255 },
      24,
    );
    expect(padded).toHaveLength(4);
  });
});

describe("keys and sizes", () => {
  it("quantises the level so keys from float drift agree", () => {
    expect(tileKey("p1", 2.00001, 1, 2)).toBe(tileKey("p1", 2.00004, 1, 2));
    expect(tileKey("p1", 2, 1, 2)).not.toBe(tileKey("p1", 2.5, 1, 2));
    expect(tileKey("p1", 2, 1, 2)).not.toBe(tileKey("p2", 2, 1, 2));
    expect(quantiseLevel(1.23456789)).toBe(1.2346);
  });

  it("rounds raster sizes up so the last row of pixels is never lost", () => {
    expect(rasterSize(1024, 1448, 1.5)).toEqual({ w: 1536, h: 2172 });
    expect(rasterSize(1000, 1000, 0.3333)).toEqual({ w: 334, h: 334 });
  });

  it("scales a preview to its longest side and never magnifies", () => {
    expect(previewScale(1024, 1448)).toBeCloseTo(1024 / 1448, 10);
    expect(previewScale(100, 100)).toBe(1);
    expect(previewScale(0, 0)).toBe(1);
  });
});

describe("ByteLru", () => {
  it("evicts the least recently used entries to stay within budget", () => {
    const gone: string[] = [];
    const lru = new ByteLru<string>(10, (_v, key) => gone.push(key));
    lru.set("a", "A", 4);
    lru.set("b", "B", 4);
    expect(lru.get("a")).toBe("A"); // a is now the most recent
    lru.set("c", "C", 4); // must evict b, not a
    expect(gone).toEqual(["b"]);
    expect(lru.has("a")).toBe(true);
    expect(lru.bytes).toBe(8);
    expect(lru.size).toBe(2);
  });

  it("peek does not count as a use", () => {
    const lru = new ByteLru<number>(8);
    lru.set("a", 1, 4);
    lru.set("b", 2, 4);
    lru.peek("a");
    lru.set("c", 3, 4);
    expect(lru.has("a")).toBe(false);
    expect(lru.has("b")).toBe(true);
  });

  it("admits an oversized entry alone and accounts for replacement", () => {
    const lru = new ByteLru<number>(8);
    lru.set("a", 1, 4);
    lru.set("big", 2, 100);
    expect(lru.size).toBe(1);
    expect(lru.bytes).toBe(100);
    lru.set("big", 3, 2);
    expect(lru.bytes).toBe(2);
    expect(lru.get("big")).toBe(3);
  });

  it("a smaller budget evicts at once and fits() never evicts", () => {
    const lru = new ByteLru<number>(12);
    lru.set("a", 1, 4);
    lru.set("b", 2, 4);
    lru.set("c", 3, 4);
    expect(lru.fits(1)).toBe(false);
    lru.setBudget(8);
    expect(lru.limit).toBe(8);
    expect(lru.has("a")).toBe(false);
    expect(lru.size).toBe(2);
    expect(lru.fits(0)).toBe(true);
    expect(lru.fits(1)).toBe(false);
  });

  it("deleteWhere and clear report through onEvict", () => {
    const gone: string[] = [];
    const lru = new ByteLru<number>(100, (_v, key) => gone.push(key));
    lru.set("p1:0", 1, 1);
    lru.set("p1:1", 1, 1);
    lru.set("p2:0", 1, 1);
    expect(lru.deleteWhere((_v, key) => key.startsWith("p1"))).toBe(2);
    expect([...lru.values()]).toEqual([1]);
    lru.clear();
    expect(lru.size).toBe(0);
    expect(lru.bytes).toBe(0);
    expect(gone).toEqual(["p1:0", "p1:1", "p2:0"]);
    expect(lru.delete("nope")).toBe(false);
  });
});
