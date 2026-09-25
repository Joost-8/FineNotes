import { describe, expect, it } from "vitest";
import {
  type RgbaImage,
  createRgba,
  downscaleRgba,
  flattenOnWhite,
  lumaOf,
  resizeRgba,
  rotatePoint90,
  rotateRgba90,
} from "../../src/canvas/scan-raster";

/** A raster whose pixel (x, y) is (x, y, x + y, 255), for tracking where pixels go. */
function coordinates(width: number, height: number): RgbaImage {
  const img = createRgba(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      img.data.set([x, y, x + y, 255], (y * width + x) * 4);
    }
  }
  return img;
}

function pixel(img: RgbaImage, x: number, y: number): number[] {
  const p = (y * img.width + x) * 4;
  return Array.from(img.data.slice(p, p + 4));
}

describe("createRgba", () => {
  it("is transparent black, at least 1 × 1, of whole pixels", () => {
    expect(createRgba(3, 2).data).toEqual(new Uint8ClampedArray(24));
    const tiny = createRgba(0, -4);
    expect([tiny.width, tiny.height, tiny.data.length]).toEqual([1, 1, 4]);
    expect(createRgba(2.4, 3.6).width).toBe(2);
  });
});

describe("resizeRgba (area average)", () => {
  it("averages each 2 × 2 block when halving", () => {
    const img = createRgba(4, 2);
    // Left block: 0, 100, 200, 100 → 100. Right block all 40 → 40.
    const values = [0, 100, 40, 40, 200, 100, 40, 40];
    values.forEach((v, i) => img.data.set([v, v, v, 255], i * 4));
    const out = resizeRgba(img, 2, 1);
    expect(pixel(out, 0, 0)).toEqual([100, 100, 100, 255]);
    expect(pixel(out, 1, 0)).toEqual([40, 40, 40, 255]);
  });

  it("weights partial pixels at a fractional ratio (3 → 2)", () => {
    const img = createRgba(3, 1);
    [0, 90, 180].forEach((v, i) => img.data.set([v, 0, 0, 255], i * 4));
    const out = resizeRgba(img, 2, 1);
    // Output 0 covers source [0, 1.5): (0·1 + 90·0.5) / 1.5 = 30.
    // Output 1 covers [1.5, 3): (90·0.5 + 180·1) / 1.5 = 150.
    expect(pixel(out, 0, 0)[0]).toBe(30);
    expect(pixel(out, 1, 0)[0]).toBe(150);
  });

  it("keeps a flat colour flat at any ratio, and a gradient's mean", () => {
    const flat = createRgba(97, 61);
    for (let p = 0; p < flat.data.length; p += 4) flat.data.set([12, 200, 77, 255], p);
    const out = resizeRgba(flat, 23, 17);
    for (let p = 0; p < out.data.length; p += 4) {
      expect(Array.from(out.data.slice(p, p + 4))).toEqual([12, 200, 77, 255]);
    }
    const ramp = coordinates(200, 1);
    const shrunk = resizeRgba(ramp, 1, 1);
    // The mean of 0..199 is 99.5; either neighbour is a correct rounding.
    expect(Math.abs(pixel(shrunk, 0, 0)[0] - 99.5)).toBeLessThanOrEqual(0.5);
  });

  it("can also enlarge (each output pixel then reads one or two source pixels)", () => {
    const img = createRgba(2, 1);
    img.data.set([0, 0, 0, 255, 200, 200, 200, 255]);
    const out = resizeRgba(img, 4, 1);
    expect([0, 1, 2, 3].map((x) => pixel(out, x, 0)[0])).toEqual([0, 0, 200, 200]);
  });
});

describe("downscaleRgba", () => {
  it("returns the same raster when it already fits", () => {
    const img = createRgba(100, 50);
    expect(downscaleRgba(img, 100)).toBe(img);
    expect(downscaleRgba(img, 400)).toBe(img);
  });

  it("fits the long side, keeping the aspect", () => {
    const out = downscaleRgba(createRgba(4032, 3024), 256);
    expect([out.width, out.height]).toEqual([256, 192]);
    const tall = downscaleRgba(createRgba(300, 1200), 600);
    expect([tall.width, tall.height]).toEqual([150, 600]);
  });
});

describe("rotateRgba90", () => {
  it("turns w × h into h × w and moves every pixel where rotatePoint90 says", () => {
    const img = coordinates(5, 3);
    for (const clockwise of [true, false]) {
      const out = rotateRgba90(img, clockwise);
      expect([out.width, out.height]).toEqual([3, 5]);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 5; x++) {
          // Map the pixel's centre, then floor to the pixel it lands in.
          const to = rotatePoint90({ x: x + 0.5, y: y + 0.5 }, 5, 3, clockwise);
          expect(pixel(out, Math.floor(to.x), Math.floor(to.y))).toEqual(pixel(img, x, y));
        }
      }
    }
  });

  it("is undone by the opposite turn, and four turns are the identity", () => {
    const img = coordinates(7, 4);
    expect(rotateRgba90(rotateRgba90(img, true), false).data).toEqual(img.data);
    let four = img;
    for (let i = 0; i < 4; i++) four = rotateRgba90(four);
    expect(four.data).toEqual(img.data);
  });

  it("maps the corners of the photo onto the corners of the turned photo", () => {
    // Clockwise, the top-left corner becomes the top-right.
    expect(rotatePoint90({ x: 0, y: 0 }, 400, 300)).toEqual({ x: 300, y: 0 });
    expect(rotatePoint90({ x: 400, y: 300 }, 400, 300)).toEqual({ x: 0, y: 400 });
    expect(rotatePoint90({ x: 0, y: 0 }, 400, 300, false)).toEqual({ x: 0, y: 400 });
  });
});

describe("flattenOnWhite", () => {
  it("composites over white and leaves every pixel opaque", () => {
    const img = createRgba(3, 1);
    img.data.set([0, 0, 0, 0, 0, 0, 0, 255, 100, 200, 0, 128]);
    flattenOnWhite(img);
    expect(pixel(img, 0, 0)).toEqual([255, 255, 255, 255]); // transparent → white
    expect(pixel(img, 1, 0)).toEqual([0, 0, 0, 255]); // opaque untouched
    // Half-covered: halfway between the colour and white.
    expect(pixel(img, 2, 0)).toEqual([177, 227, 127, 255]);
  });
});

describe("lumaOf", () => {
  it("uses Rec. 601 weights, with white and black exact", () => {
    const img = createRgba(4, 1);
    img.data.set([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    expect(Array.from(lumaOf(img))).toEqual([255, 0, 76, 149]);
  });
});
