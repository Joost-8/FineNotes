import { thumbDragPosition } from "../../src/canvas/scroll-thumb";
import { describe, expect, it } from "vitest";
import { MIN_SQUASHED_LENGTH, MIN_THUMB_LENGTH, scrollThumb } from "../../src/canvas/scroll-thumb";

describe("scrollThumb", () => {
  it("shows nothing when the content fits", () => {
    expect(scrollThumb(0, 800, 800, 780)).toBeNull();
    expect(scrollThumb(0, 800, 600, 780)).toBeNull();
    expect(scrollThumb(0, 800, 800.4, 780)).toBeNull();
  });

  it("rejects nonsense instead of drawing it", () => {
    expect(scrollThumb(Number.NaN, 800, 4000, 780)).toBeNull();
    expect(scrollThumb(0, 0, 4000, 780)).toBeNull();
    expect(scrollThumb(0, 800, 4000, 0)).toBeNull();
  });

  it("is as long as the share of the content on screen", () => {
    const thumb = scrollThumb(0, 800, 4000, 800);
    expect(thumb).toEqual({ offset: 0, length: 160 });
  });

  it("runs from the top of the track to the bottom as the content scrolls", () => {
    const track = 800;
    const top = scrollThumb(0, 800, 4000, track);
    const middle = scrollThumb(1600, 800, 4000, track);
    const bottom = scrollThumb(3200, 800, 4000, track);
    expect(top?.offset).toBe(0);
    expect(middle?.offset).toBeCloseTo((track - 160) / 2, 6);
    expect(bottom && bottom.offset + bottom.length).toBeCloseTo(track, 6);
  });

  it("never gets too short to see on a very long notebook", () => {
    const thumb = scrollThumb(0, 800, 800 * 200, 800);
    expect(thumb?.length).toBe(MIN_THUMB_LENGTH);
  });

  it("never outgrows its track", () => {
    const thumb = scrollThumb(0, 100, 101, 20);
    expect(thumb?.length).toBe(20);
  });

  it("squashes against the end the content is stretched past", () => {
    const pulledDown = scrollThumb(-60, 800, 4000, 800);
    expect(pulledDown).toEqual({ offset: 0, length: 100 });
    const pulledUp = scrollThumb(3200 + 60, 800, 4000, 800);
    expect(pulledUp?.length).toBe(100);
    expect(pulledUp && pulledUp.offset + pulledUp.length).toBeCloseTo(800, 6);
  });

  it("keeps a sliver however far it is stretched", () => {
    const thumb = scrollThumb(-5000, 800, 4000, 800);
    expect(thumb).toEqual({ offset: 0, length: MIN_SQUASHED_LENGTH });
  });
});

describe("thumb dragging", () => {
  it("maps pointer travel to the full scroll range and clamps both ends", () => {
    expect(thumbDragPosition(0, 300, 600, 6000, 600)).toBeCloseTo(3000);
    expect(thumbDragPosition(3000, -300, 600, 6000, 600)).toBeCloseTo(0);
    expect(thumbDragPosition(0, 10000, 600, 6000, 600)).toBe(5400);
    expect(thumbDragPosition(100, -10000, 600, 6000, 600)).toBe(0);
  });
  it("uses the minimum thumb size and normalizes overscroll", () => {
    expect(thumbDragPosition(-200, 50, 100, 10000, 100)).toBeCloseTo((50 * 9900) / 64);
    expect(thumbDragPosition(10000, -50, 100, 10000, 100)).toBeCloseTo(9900 - (50 * 9900) / 64);
  });
  it("does nothing for fitted content or a track with no thumb travel", () => {
    expect(thumbDragPosition(0, 50, 100, 100, 100)).toBe(0);
    expect(thumbDragPosition(10, 50, 100, 1000, 20)).toBe(10);
    expect(thumbDragPosition(10, 50, 100, 1000, 0)).toBe(10);
  });
  it.each([0, 1, 2, 3, 4])("rejects invalid input %s", (index) => {
    const values = [0, 50, 100, 1000, 100];
    values[index] = Infinity;
    expect(thumbDragPosition(...(values as [number, number, number, number, number]))).toBe(0);
  });
});
