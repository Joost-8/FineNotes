import { describe, expect, it } from "vitest";
import {
  SNIPPET_FLIP_MS,
  SNIPPET_MAX_PAGE_SIDE,
  SNIPPET_MAX_SIDE,
  SNIPPET_MIN_SCALE,
  SNIPPET_PAGE_MARGIN,
  snippetBox,
  snippetCrop,
  snippetPixels,
  snippetSize,
  stepSnippetHover,
} from "../../src/model/snippet";

const SLIDE = { width: 1820, height: 1024 };
const area = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("snippetCrop", () => {
  it("draws the area as sharp as the view shows it", () => {
    const crop = snippetCrop(area(100, 200, 500, 400), SLIDE.width, SLIDE.height, 2.2);
    expect(crop).toEqual({ x: 100, y: 200, width: 400, height: 200, scale: 2.2 });
    expect(snippetPixels(crop!)).toEqual({ width: 880, height: 440 });
  });

  it("never draws under twice the page's px, however far out the view is", () => {
    const crop = snippetCrop(area(0, 0, 300, 100), SLIDE.width, SLIDE.height, 0.6);
    expect(crop?.scale).toBe(SNIPPET_MIN_SCALE);
  });

  it("takes the floor for a scale that is not a number", () => {
    expect(snippetCrop(area(0, 0, 10, 10), 100, 100, Number.NaN)?.scale).toBe(SNIPPET_MIN_SCALE);
  });

  it("caps the picture's long side", () => {
    const crop = snippetCrop(area(0, 0, 1600, 400), SLIDE.width, SLIDE.height, 4)!;
    expect(snippetPixels(crop).width).toBe(SNIPPET_MAX_SIDE);
    expect(snippetPixels(crop).height).toBe(512);
  });

  it("caps the whole slide it is painted from", () => {
    const crop = snippetCrop(area(0, 0, 100, 100), 3000, 2000, 5)!;
    expect(crop.scale).toBeCloseTo(SNIPPET_MAX_PAGE_SIDE / 3000);
  });

  it("cuts the area to the slide", () => {
    const crop = snippetCrop(area(-50, 900, 300, 1200), SLIDE.width, SLIDE.height, 2);
    expect(crop).toMatchObject({ x: 0, y: 900, width: 300, height: 124 });
  });

  it("is null for an area off the slide or thinner than a page px", () => {
    expect(snippetCrop(area(2000, 0, 2100, 100), SLIDE.width, SLIDE.height, 2)).toBeNull();
    expect(snippetCrop(area(10, 10, 10.5, 200), SLIDE.width, SLIDE.height, 2)).toBeNull();
  });

  it("draws at least a px a side", () => {
    expect(snippetPixels({ x: 0, y: 0, width: 1, height: 1, scale: 0.1 })).toEqual({
      width: 1,
      height: 1,
    });
  });
});

describe("snippetSize", () => {
  const PAGE = { width: 1000, height: 1414 };
  const USABLE = 1000 * (1 - 2 * SNIPPET_PAGE_MARGIN);

  it("keeps its share of the slide's width, of the page's width inside the margins", () => {
    // Half the slide wide: half the usable page wide, whatever the slide's px.
    const half = snippetSize({ width: 910, height: 256 }, SLIDE.width, PAGE);
    expect(half.w).toBeCloseTo(USABLE / 2);
    expect(half.h).toBeCloseTo((USABLE / 2) * (256 / 910));
    const whole = snippetSize({ width: 1820, height: 1024 }, SLIDE.width, PAGE);
    expect(whole.w).toBeCloseTo(USABLE);
    expect(whole.h).toBeCloseTo(USABLE * (1024 / 1820));
  });

  it("is the same share on a wider page", () => {
    const wide = snippetSize({ width: 455, height: 200 }, SLIDE.width, {
      width: 2000,
      height: 1414,
    });
    expect(wide.w).toBeCloseTo(2000 * (1 - 2 * SNIPPET_PAGE_MARGIN) * 0.25);
  });

  it("is never taller than the page, its shape kept", () => {
    // A tall strip of the slide: a tenth of its width, all of its height.
    const tall = snippetSize({ width: 182, height: 1024 }, SLIDE.width, {
      width: 1000,
      height: 400,
    });
    expect(tall.h).toBeCloseTo(400);
    expect(tall.w / tall.h).toBeCloseTo(182 / 1024);
  });

  it("takes the whole usable width when the slide's width is unknown", () => {
    expect(snippetSize({ width: 300, height: 150 }, 0, PAGE).w).toBeCloseTo(USABLE);
  });
});

describe("snippetBox", () => {
  const PAGE = { width: 1024, height: 1448 };

  it("centres the picture where it was dropped, at its size on the notes page", () => {
    const box = snippetBox({ width: 455, height: 256 }, SLIDE.width, { x: 500, y: 700 }, PAGE);
    const { w, h } = snippetSize({ width: 455, height: 256 }, SLIDE.width, PAGE);
    expect(box).toEqual({ x: 500 - w / 2, y: 700 - h / 2, w, h });
  });

  it("moves it in so all of it is on the page", () => {
    const box = snippetBox({ width: 455, height: 256 }, SLIDE.width, { x: 1020, y: 5 }, PAGE);
    expect(box.x + box.w).toBeCloseTo(1024);
    expect(box.y).toBe(0);
  });
});

describe("stepSnippetHover", () => {
  it("shows the notes once the drag has rested over their tab long enough", () => {
    let step = stepSnippetHover({ since: null }, true, 1000);
    expect(step).toEqual({ hover: { since: 1000 }, flip: false });
    step = stepSnippetHover(step.hover, true, 1000 + SNIPPET_FLIP_MS - 1);
    expect(step.flip).toBe(false);
    step = stepSnippetHover(step.hover, true, 1000 + SNIPPET_FLIP_MS);
    expect(step.flip).toBe(true);
  });

  it("starts the wait again when the drag leaves the tab", () => {
    let step = stepSnippetHover({ since: null }, true, 0);
    step = stepSnippetHover(step.hover, false, 200);
    expect(step).toEqual({ hover: { since: null }, flip: false });
    step = stepSnippetHover(step.hover, true, 250);
    step = stepSnippetHover(step.hover, true, 250 + SNIPPET_FLIP_MS - 10);
    expect(step.flip).toBe(false);
  });
});
