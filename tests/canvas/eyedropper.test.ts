/**
 * The eyedropper's pure decisions (`src/canvas/eyedropper.ts`): the square
 * of device px it averages, the averaging itself, and when a tap picks an
 * element's stored colour rather than the pixels under it.
 */

import { describe, expect, it } from "vitest";
import {
  EYEDROP_RADIUS_PX,
  EYEDROP_THEME,
  averagePixels,
  eyedropColor,
  eyedropSquare,
  textBoxColor,
} from "../../src/canvas/eyedropper";
import { nightColor } from "../../src/canvas/night";

/** RGBA pixels from `[r, g, b, a]` quadruples. */
const px = (...pixels: number[][]): Uint8ClampedArray => new Uint8ClampedArray(pixels.flat());

describe("the averaged square", () => {
  it("is centred on the tapped device pixel, 5 px a side by default", () => {
    expect(EYEDROP_RADIUS_PX).toBe(2);
    expect(eyedropSquare(10, 20)).toEqual({ x: 8, y: 18, size: 5 });
    // A point inside a pixel belongs to that pixel.
    expect(eyedropSquare(10.9, 20.2)).toEqual({ x: 8, y: 18, size: 5 });
    expect(eyedropSquare(0, 0, 1)).toEqual({ x: -1, y: -1, size: 3 });
    expect(eyedropSquare(4, 4, 0)).toEqual({ x: 4, y: 4, size: 1 });
    expect(eyedropSquare(4, 4, -3)).toEqual({ x: 4, y: 4, size: 1 });
    expect(eyedropSquare(4, 4, 1.7)).toEqual({ x: 3, y: 3, size: 3 });
  });
});

describe("averaging pixels", () => {
  it("gives one pixel's own colour", () => {
    expect(averagePixels(px([255, 0, 0, 255]))).toBe("#ff0000");
  });

  it("averages several, rounding each channel", () => {
    expect(averagePixels(px([0, 0, 0, 255], [255, 255, 255, 255]))).toBe("#808080");
    expect(averagePixels(px([10, 20, 30, 255], [20, 40, 61, 255]))).toBe("#0f1e2e");
  });

  it("weighs each pixel by its alpha, and skips transparent ones", () => {
    expect(averagePixels(px([255, 0, 0, 255], [0, 0, 255, 0]))).toBe("#ff0000");
    expect(averagePixels(px([255, 0, 0, 192], [0, 0, 255, 64]))).toBe("#bf0040");
  });

  it("has nothing to say about nothing", () => {
    expect(averagePixels([])).toBeNull();
    expect(averagePixels(px([1, 2, 3, 0], [4, 5, 6, 0]))).toBeNull();
  });

  it("ignores a partial pixel at the end of a ragged array", () => {
    expect(averagePixels([0, 255, 0, 255, 255, 0])).toBe("#00ff00");
  });

  it("evens out a dithered square: a 5 x 5 checkerboard is its mean", () => {
    const pixels: number[][] = [];
    for (let i = 0; i < 25; i++) pixels.push(i % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    // 13 white, 12 black.
    expect(averagePixels(px(...pixels))).toBe("#858585");
  });
});

describe("element colour or pixel", () => {
  it("prefers the element's stored colour", () => {
    expect(eyedropColor("#E03131", "#123456")).toEqual({ color: "#e03131", source: "element" });
    expect(eyedropColor("#abc", null)).toEqual({ color: "#aabbcc", source: "element" });
  });

  it("falls back to the pixels off any element, or when the element's colour is unreadable", () => {
    expect(eyedropColor(null, "#123456")).toEqual({ color: "#123456", source: "pixel" });
    expect(eyedropColor(undefined, "#123456")).toEqual({ color: "#123456", source: "pixel" });
    expect(eyedropColor("var(--text-normal)", "#123456")).toEqual({
      color: "#123456",
      source: "pixel",
    });
  });

  it("picks nothing when there is neither", () => {
    expect(eyedropColor(null, null)).toBeNull();
    expect(eyedropColor("nonsense", "also nonsense")).toBeNull();
  });

  it("takes a text box's text colour, or its fill when it holds no text", () => {
    expect(textBoxColor({ text: "Hi", color: "#1971c2", fill: "#fff3bf" })).toBe("#1971c2");
    expect(textBoxColor({ text: "  \n", color: "#1971c2", fill: "#fff3bf" })).toBe("#fff3bf");
    expect(textBoxColor({ text: "", color: "#1971c2" })).toBeNull();
  });
});

describe("dark pages", () => {
  it("samples pixels on the day's paper", () => {
    expect(EYEDROP_THEME).toBe("light");
  });

  it("returns an element's stored colour, never what a night page shows", () => {
    for (const stored of ["#1a1a1a", "#e03131", "#1971c2", "#ffffff"]) {
      const shown = nightColor(stored);
      expect(shown).not.toBe(stored);
      expect(eyedropColor(stored, shown)?.color).toBe(stored);
    }
  });
});
