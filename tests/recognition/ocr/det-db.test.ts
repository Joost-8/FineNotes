import { describe, expect, it } from "vitest";
import { boxBounds, findTextBoxes } from "../../../src/recognition/ocr/db";
import {
  DET_TILE_SIDE,
  OCR_MAX_EDGE,
  planTiles,
  rasterScale,
  roundUp32,
  stitchProbability,
  tileTensor,
} from "../../../src/recognition/ocr/det";
import { readingOrder } from "../../../src/recognition/ocr/reading-order";

/** A probability map with filled rectangles of probability `p`. */
function map(
  w: number,
  h: number,
  rects: { x: number; y: number; w: number; h: number; p?: number }[],
): Float32Array {
  const out = new Float32Array(w * h);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) out[y * w + x] = r.p ?? 0.9;
  }
  return out;
}

describe("tiles for the detector", () => {
  it("rounds a side up to a multiple of 32, at least 32", () => {
    expect(roundUp32(1)).toBe(32);
    expect(roundUp32(32)).toBe(32);
    expect(roundUp32(33)).toBe(64);
  });

  it("keeps a small image as one tile, padded to multiples of 32", () => {
    const tiles = planTiles(500, 300);
    expect(tiles).toEqual([{ x: 0, y: 0, w: 500, h: 300, padW: 512, padH: 320 }]);
  });

  it("cuts a page at 170 dpi into overlapping tiles no larger than DET_TILE_SIDE that cover it", () => {
    const tiles = planTiles(1403, 1984);
    expect(DET_TILE_SIDE).toBe(800);
    expect(tiles.length).toBe(6);
    const covered = new Uint8Array(1403 * 1984);
    for (const t of tiles) {
      expect(t.padW).toBeLessThanOrEqual(DET_TILE_SIDE);
      expect(t.padH).toBeLessThanOrEqual(DET_TILE_SIDE);
      expect(t.padW % 32).toBe(0);
      expect(t.padH % 32).toBe(0);
      expect(t.x + t.w).toBeLessThanOrEqual(1403);
      expect(t.y + t.h).toBeLessThanOrEqual(1984);
      for (let y = t.y; y < t.y + t.h; y++)
        for (let x = t.x; x < t.x + t.w; x++) covered[y * 1403 + x] = 1;
    }
    expect(covered.every((v) => v === 1)).toBe(true);
    // Neighbours overlap, so a line across a seam is whole in one of them.
    expect(tiles[0].x + tiles[0].w).toBeGreaterThan(tiles[1].x);
  });

  it("normalises like ImageNet in BGR order and pads with white", () => {
    // One red pixel in a 2x1 image, the other black.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255]);
    const [tile] = planTiles(2, 1);
    const t = tileTensor(rgba, 2, tile);
    const plane = tile.padW * tile.padH;
    expect(t.length).toBe(3 * plane);
    // Pixel 0 is red: blue channel (0) = (0 - .485) / .229, red channel (2) = (1 - .406) / .225.
    expect(t[0]).toBeCloseTo((0 - 0.485) / 0.229, 5);
    expect(t[2 * plane]).toBeCloseTo((1 - 0.406) / 0.225, 5);
    // Past the image: white.
    expect(t[5]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(t[plane + tile.padW + 1]).toBeCloseTo((1 - 0.456) / 0.224, 5);
  });

  it("stitches probability maps, keeping the larger value where tiles overlap", () => {
    const full = new Float32Array(6 * 2);
    const a = { x: 0, y: 0, w: 4, h: 2, padW: 32, padH: 32 };
    const b = { x: 2, y: 0, w: 4, h: 2, padW: 32, padH: 32 };
    const pa = new Float32Array(32 * 32).fill(0.4);
    const pb = new Float32Array(32 * 32).fill(0.2);
    pb[0] = 0.9;
    stitchProbability(full, 6, a, pa);
    stitchProbability(full, 6, b, pb);
    expect(Array.from(full.slice(0, 6)).map((v) => Math.round(v * 10))).toEqual([4, 4, 9, 4, 2, 2]);
  });
});

describe("rasterising for OCR", () => {
  it("is 170 dpi, shorter than 2200 px on the long side", () => {
    expect(rasterScale(595, 842)).toBeCloseTo(170 / 72, 6);
    expect(Math.round(842 * rasterScale(595, 842))).toBeLessThanOrEqual(OCR_MAX_EDGE);
    // A poster: clamped.
    expect(rasterScale(2000, 3000) * 3000).toBeCloseTo(OCR_MAX_EDGE, 6);
  });
});

describe("DB post-processing", () => {
  it("finds a text line, grown by the unclip distance", () => {
    const prob = map(300, 120, [{ x: 50, y: 50, w: 200, h: 10 }]);
    const boxes = findTextBoxes(prob, 300, 120);
    expect(boxes).toHaveLength(1);
    const [x0, y0, x1, y1] = boxBounds(boxes[0]);
    // Unclip: distance = area * 1.5 / perimeter = 200*10*1.5 / 420 = 7.14 px each side.
    expect(x0).toBeCloseTo(50 - 7.14, 0);
    expect(x1).toBeCloseTo(250 + 7.14, 0);
    expect(y0).toBeCloseTo(50 - 7.14, 0);
    expect(y1).toBeCloseTo(60 + 7.14, 0);
    expect(boxes[0].score).toBeCloseTo(0.9, 5);
    expect(boxes[0].angle).toBe(0);
  });

  it("drops blobs the network is unsure of, specks, and vertical text", () => {
    const prob = map(400, 300, [
      { x: 20, y: 20, w: 150, h: 10, p: 0.5 }, // mean probability below 0.6
      { x: 20, y: 60, w: 3, h: 3 }, // a speck
      { x: 300, y: 20, w: 10, h: 200 }, // vertical
      { x: 20, y: 120, w: 150, h: 10 }, // a good one
    ]);
    const boxes = findTextBoxes(prob, 400, 300);
    expect(boxes).toHaveLength(1);
    expect(boxBounds(boxes[0])[1]).toBeLessThan(120);
  });

  it("ignores pixels at or below the threshold", () => {
    const prob = map(100, 50, [{ x: 10, y: 10, w: 60, h: 8, p: 0.3 }]);
    expect(findTextBoxes(prob, 100, 50)).toHaveLength(0);
  });

  it("follows a line that leans a degree or two, and drops one that leans a lot", () => {
    const w = 600;
    const h = 400;
    const lean = (slope: number, top: number): Float32Array => {
      const prob = new Float32Array(w * h);
      for (let x = 20; x < 520; x++) {
        const y0 = Math.round(top + x * slope);
        for (let y = y0; y < y0 + 10; y++) prob[y * w + x] = 0.9;
      }
      return prob;
    };
    const gentle = findTextBoxes(lean(Math.tan((1.5 * Math.PI) / 180), 100), w, h);
    expect(gentle).toHaveLength(1);
    expect(gentle[0].angle).toBeCloseTo((1.5 * Math.PI) / 180, 1);
    // The box is as tall as the line is thick, not as tall as the lean.
    expect(gentle[0].h).toBeLessThan(30);
    expect(findTextBoxes(lean(Math.tan((40 * Math.PI) / 180), 20), w, h)).toHaveLength(0);
  });

  it("keeps a roughly square blob upright", () => {
    const prob = map(100, 100, [{ x: 30, y: 30, w: 14, h: 12 }]);
    const [box] = findTextBoxes(prob, 100, 100);
    expect(box.angle).toBe(0);
  });
});

describe("reading order", () => {
  const line = (cx: number, cy: number, w = 400, h = 30) => ({ cx, cy, w, h, angle: 0, score: 1 });

  it("reads one column top to bottom", () => {
    const boxes = [line(300, 300), line(300, 100), line(300, 200)];
    expect(readingOrder(boxes).map((b) => b.cy)).toEqual([100, 200, 300]);
  });

  it("reads two columns one after the other, a headline across both first", () => {
    const head = line(500, 40, 900);
    const left = [line(250, 150, 400), line(250, 200, 400), line(250, 250, 400)];
    const right = [line(750, 150, 400), line(750, 200, 400), line(750, 250, 400)];
    const out = readingOrder([right[0], left[0], head, right[1], left[1], right[2], left[2]]);
    expect(out).toEqual([head, ...left, ...right]);
  });

  it("puts a footer after both columns, and works on a crooked page", () => {
    const tilt = 0.02;
    const tilted = (cx: number, cy: number) => ({
      ...line(cx, cy + cx * Math.tan(tilt), 400),
      angle: tilt,
    });
    const left = [tilted(250, 100), tilted(250, 140)];
    const right = [tilted(750, 100), tilted(750, 140)];
    const footer = tilted(500, 400);
    const out = readingOrder([footer, right[0], left[1], right[1], left[0]]);
    expect(out).toEqual([left[0], left[1], right[0], right[1], footer]);
  });

  it("copes with no boxes and one", () => {
    expect(readingOrder([])).toEqual([]);
    expect(readingOrder([line(1, 1)])).toHaveLength(1);
  });
});
