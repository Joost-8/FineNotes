import { describe, expect, it } from "vitest";
import {
  SCAN_FILTERS,
  adaptiveThreshold,
  applyLevels,
  applyScanFilter,
  histogramPercentile,
  isScanFilter,
  lumaHistogram,
  planLevels,
  toGreyscale,
} from "../../src/canvas/scan-filters";
import { type RgbaImage, createRgba, lumaOf } from "../../src/canvas/scan-raster";
import { rng } from "./scan-synth";

/**
 * A synthetic scanned page: paper of colour `paper` scaled by `light(x, y)`
 * (for shadows and falloff), with strokes of writing — horizontal bars
 * `thickness` px tall — at `ink` times the local paper brightness.
 */
function page(
  width: number,
  height: number,
  options: {
    paper?: [number, number, number];
    light?: (x: number, y: number) => number;
    ink?: number;
    thickness?: number;
    noise?: number;
  } = {},
): { img: RgbaImage; isInk: (x: number, y: number) => boolean } {
  const paper = options.paper ?? [214, 206, 188];
  const light = options.light ?? (() => 1);
  const ink = options.ink ?? 0.45;
  const thickness = options.thickness ?? 4;
  const random = rng(5);
  const noise = options.noise ?? 3;
  const isInk = (x: number, y: number): boolean =>
    x > width * 0.08 && x < width * 0.92 && y % 40 >= 20 && y % 40 < 20 + thickness && x % 60 < 48;
  const img = createRgba(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = light(x, y) * (isInk(x, y) ? ink : 1);
      for (let c = 0; c < 3; c++) {
        img.data[(y * width + x) * 4 + c] = paper[c] * k + (random() - 0.5) * 2 * noise;
      }
      img.data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { img, isInk };
}

/**
 * Fraction of paper pixels that came out black and of ink pixels that came
 * out white, and how many pixels are neither black nor white.
 */
function bwErrors(
  img: RgbaImage,
  isInk: (x: number, y: number) => boolean,
): { paperBlack: number; inkWhite: number; grey: number } {
  let grey = 0;
  let paper = 0;
  let paperBlack = 0;
  let ink = 0;
  let inkWhite = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const v = img.data[(y * img.width + x) * 4];
      if (v !== 0 && v !== 255) grey++;
      if (isInk(x, y)) {
        ink++;
        if (v === 255) inkWhite++;
      } else {
        paper++;
        if (v === 0) paperBlack++;
      }
    }
  }
  return { paperBlack: paperBlack / paper, inkWhite: inkWhite / ink, grey };
}

describe("the filter list", () => {
  it("offers Colour, Greyscale and Black & white, and recognises them", () => {
    expect(SCAN_FILTERS.map((f) => f.label)).toEqual(["Colour", "Greyscale", "Black & white"]);
    expect(isScanFilter("bw")).toBe(true);
    expect(isScanFilter("sepia")).toBe(false);
    expect(isScanFilter(undefined)).toBe(false);
  });
});

describe("histograms", () => {
  it("counts luma and reads percentiles", () => {
    const img = createRgba(10, 1);
    for (let i = 0; i < 10; i++) img.data.set([i * 20, i * 20, i * 20, 255], i * 4);
    const hist = lumaHistogram(img);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(10);
    expect(histogramPercentile(hist, 10, 0.5)).toBe(80);
    expect(histogramPercentile(hist, 10, 0)).toBe(0);
    expect(histogramPercentile(hist, 10, 1)).toBe(180);
    expect(histogramPercentile(new Uint32Array(256), 0, 0.5)).toBe(255);
  });
});

describe("levels (Colour)", () => {
  it("turns yellowish paper white, and deepens the ink", () => {
    const { img, isInk } = page(300, 200);
    const levels = planLevels(img)!;
    expect(levels).not.toBeNull();
    applyLevels(img, levels);
    let paperSum = [0, 0, 0];
    let paperCount = 0;
    let inkMax = 0;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 300; x++) {
        const p = (y * 300 + x) * 4;
        if (isInk(x, y)) {
          inkMax = Math.max(
            inkMax,
            lumaOf({ width: 1, height: 1, data: img.data.slice(p, p + 4) })[0],
          );
        } else {
          paperSum = paperSum.map((s, c) => s + img.data[p + c]);
          paperCount++;
        }
      }
    }
    const mean = paperSum.map((s) => s / paperCount);
    // White and neutral: no channel of the paper below 250.
    for (const c of mean) expect(c).toBeGreaterThan(250);
    // The ink was 45 % of the paper (~90); stretched, it lands well darker.
    expect(inkMax).toBeLessThan(80);
  });

  it("leaves a flat picture alone rather than amplify its noise", () => {
    const img = createRgba(20, 20);
    for (let p = 0; p < img.data.length; p += 4) img.data.set([120, 121, 119, 255], p);
    expect(planLevels(img)).toBeNull();
    const before = img.data.slice();
    applyScanFilter(img, "colour");
    expect(img.data).toEqual(before);
  });

  it("keeps alpha", () => {
    const { img } = page(60, 60);
    applyScanFilter(img, "colour");
    for (let p = 3; p < img.data.length; p += 4) expect(img.data[p]).toBe(255);
  });
});

describe("greyscale", () => {
  it("sets every channel to the pixel's luma", () => {
    const img = createRgba(2, 1);
    img.data.set([255, 0, 0, 255, 10, 200, 30, 255]);
    const luma = Array.from(lumaOf(img));
    toGreyscale(img);
    expect(Array.from(img.data)).toEqual([
      luma[0],
      luma[0],
      luma[0],
      255,
      luma[1],
      luma[1],
      luma[1],
      255,
    ]);
  });

  it("then whitens the paper like Colour does", () => {
    const { img } = page(200, 120);
    applyScanFilter(img, "greyscale");
    const p = (10 * 200 + 5) * 4; // a paper pixel in the left margin
    expect(img.data[p]).toBe(img.data[p + 1]);
    expect(img.data[p]).toBeGreaterThan(245);
  });
});

describe("black & white (adaptive threshold)", () => {
  it("separates writing from evenly lit paper", () => {
    const { img, isInk } = page(400, 300);
    applyScanFilter(img, "bw");
    const errors = bwErrors(img, isInk);
    expect(errors.grey).toBe(0);
    expect(errors.paperBlack).toBeLessThan(0.002);
    expect(errors.inkWhite).toBeLessThan(0.02);
  });

  it("keeps a shadowed half of the page white, where one global threshold blackens it", () => {
    // Paper lit at 100 % on the left, falling to 45 % across a soft shadow.
    const light = (x: number): number => 1 - 0.55 * Math.min(1, Math.max(0, (x - 250) / 250));
    const { img, isInk } = page(800, 400, { light });
    // The point of the test: a global threshold at the mean luma fails here.
    const luma = lumaOf(img);
    const mean = luma.reduce((a, b) => a + b, 0) / luma.length;
    let shadowPaper = 0;
    let shadowPaperBlack = 0;
    for (let y = 0; y < 400; y++) {
      for (let x = 600; x < 800; x++) {
        if (isInk(x, y)) continue;
        shadowPaper++;
        if (luma[y * 800 + x] < mean) shadowPaperBlack++;
      }
    }
    expect(shadowPaperBlack / shadowPaper).toBeGreaterThan(0.9);

    adaptiveThreshold(img);
    const errors = bwErrors(img, isInk);
    expect(errors.paperBlack).toBeLessThan(0.005);
    expect(errors.inkWhite).toBeLessThan(0.03);
  });

  it("does not hollow out a thick marker stroke", () => {
    const { img, isInk } = page(600, 400, { thickness: 14, ink: 0.3 });
    adaptiveThreshold(img);
    expect(bwErrors(img, isInk).inkWhite).toBeLessThan(0.03);
  });
});
