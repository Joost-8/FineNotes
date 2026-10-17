/**
 * `src/model/text-style.ts` — text sizes to one decimal, and the size
 * slider's logarithmic scale between the smallest and largest size.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  SIZE_SLIDER_STEPS,
  TEXT_SIZES,
  roundTextSize,
  sizeAtSlider,
  sliderAtSize,
} from "../../src/model/text-style";

describe("roundTextSize", () => {
  it("keeps one decimal, inside the sizes the loader keeps", () => {
    expect(roundTextSize(23.456789)).toBe(23.5);
    expect(roundTextSize(18.04)).toBe(18);
    expect(roundTextSize(3)).toBe(MIN_TEXT_SIZE);
    expect(roundTextSize(9000)).toBe(MAX_TEXT_SIZE);
  });
});

describe("the size slider", () => {
  it("runs from the smallest size to the largest", () => {
    expect(sizeAtSlider(0)).toBe(MIN_TEXT_SIZE);
    expect(sizeAtSlider(SIZE_SLIDER_STEPS)).toBe(MAX_TEXT_SIZE);
    expect(sizeAtSlider(-5)).toBe(MIN_TEXT_SIZE);
    expect(sizeAtSlider(SIZE_SLIDER_STEPS * 2)).toBe(MAX_TEXT_SIZE);
  });

  it("gives every size one decimal, and grows with the slider", () => {
    let last = 0;
    for (let t = 0; t <= SIZE_SLIDER_STEPS; t++) {
      const size = sizeAtSlider(t);
      expect(size).toBe(Math.round(size * 10) / 10);
      expect(size).toBeGreaterThanOrEqual(last);
      last = size;
    }
  });

  it("gives the small sizes room: the menu's sizes up to 48 take over a third of it", () => {
    expect(sliderAtSize(48)).toBeGreaterThan(SIZE_SLIDER_STEPS / 3);
  });

  it("puts the thumb back on the size it shows", () => {
    for (const size of [...TEXT_SIZES, 13.7, 99.9, 250.3]) {
      expect(Math.abs(sizeAtSlider(sliderAtSize(size)) - size)).toBeLessThanOrEqual(size * 0.004);
    }
  });
});
