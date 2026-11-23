import { describe, expect, it } from "vitest";
import { TRANSLATE_MIN, translatePlace, translateSize } from "../../src/translate/window-place";

const VIEW = { w: 1200, h: 900 };

describe("translate window size", () => {
  it("grows with the text", () => {
    const word = translateSize(12, VIEW);
    const sentence = translateSize(200, VIEW);
    const page = translateSize(2000, VIEW);
    expect(word.w).toBeLessThan(sentence.w);
    expect(sentence.w).toBeLessThan(page.w);
    expect(word.h).toBeLessThan(page.h);
  });

  it("fits a small view, never below its minimum", () => {
    const small = translateSize(2000, { w: 360, h: 300 });
    expect(small.w).toBe(360 - 16);
    expect(small.h).toBe(300 - 16);
    const tiny = translateSize(2000, { w: 100, h: 100 });
    expect(tiny).toEqual(TRANSLATE_MIN);
  });
});

describe("translate window place", () => {
  it("opens under the selection, centred on it", () => {
    const p = translatePlace(20, VIEW, { x: 600, y: 200, top: 150 });
    expect(p.y).toBe(212);
    expect(p.x + p.w / 2).toBe(600);
  });

  it("opens above the selection when there is no room below", () => {
    const p = translatePlace(20, VIEW, { x: 600, y: 800, top: 760 });
    expect(p.y + p.h).toBe(760 - 12);
  });

  it("stays inside the view when there is room on neither side", () => {
    const p = translatePlace(2000, { w: 600, h: 520 }, { x: 590, y: 260, top: 240 });
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + p.w).toBeLessThanOrEqual(600 - 8);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y + p.h).toBeLessThanOrEqual(520 - 8);
  });

  it("is centred without a selection", () => {
    const p = translatePlace(0, VIEW, null);
    expect(p.x + p.w / 2).toBe(600);
    expect(p.y).toBeLessThan((VIEW.h - p.h) / 2);
  });
});
