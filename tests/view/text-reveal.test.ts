/** `src/view/text-reveal.ts`: scrolling the box being typed in clear of the keyboard. */

import { describe, expect, it } from "vitest";
import { carriedOutOfSight, revealDelta } from "../../src/view/text-reveal";

// The page from y = 120 (room for the pill above a box) to the keyboard's top at 500.
const view = { top: 120, bottom: 500 };

describe("revealDelta", () => {
  it("leaves a box that is already in view where it is", () => {
    expect(revealDelta({ top: 200, bottom: 260 }, view, true)).toBe(0);
  });

  it("scrolls a box under the keyboard up until its bottom clears it", () => {
    expect(revealDelta({ top: 560, bottom: 620 }, view, true)).toBe(120);
    expect(revealDelta({ top: 470, bottom: 530 }, view, false)).toBe(30);
  });

  it("scrolls a box under the tool bar down until the pill fits above it", () => {
    expect(revealDelta({ top: 60, bottom: 120 }, view, true)).toBe(-60);
  });

  it("shows the end of a box taller than the view when the caret is there, else its start", () => {
    const tall = { top: 300, bottom: 900 };
    expect(revealDelta(tall, view, true)).toBe(400);
    expect(revealDelta(tall, view, false)).toBe(180);
  });

  it("asks for nothing when there is no room at all", () => {
    expect(revealDelta({ top: 600, bottom: 700 }, { top: 500, bottom: 500 }, true)).toBe(0);
    expect(revealDelta({ top: Number.NaN, bottom: 700 }, view, true)).toBe(0);
  });
});

describe("carriedOutOfSight", () => {
  const pane = { top: 100, bottom: 800, left: 0, right: 1000 };
  const seen = { x: 0, y: 300, scale: 1 };
  const below = { top: 820, bottom: 850, left: 200, right: 260 };

  it("keeps a box that still shows, however far the view moved", () => {
    const partly = { top: 790, bottom: 830, left: 200, right: 260 };
    expect(carriedOutOfSight(partly, pane, seen, { x: 0, y: 900, scale: 2 })).toBe(false);
  });

  it("lets go of a box the view scrolled or zoomed out of sight", () => {
    expect(carriedOutOfSight(below, pane, seen, { x: 0, y: 200, scale: 1 })).toBe(true);
    expect(carriedOutOfSight(below, pane, seen, { x: 40, y: 300, scale: 1 })).toBe(true);
    expect(carriedOutOfSight(below, pane, seen, { x: 0, y: 300, scale: 1.5 })).toBe(true);
  });

  it("keeps a box the pane shrank away from, the view where it was (the keyboard opening)", () => {
    const shrunk = { ...pane, bottom: 420 };
    const tapped = { top: 600, bottom: 630, left: 200, right: 260 };
    expect(carriedOutOfSight(tapped, shrunk, seen, { ...seen })).toBe(false);
    // Half a pixel of rounding is not a move.
    expect(carriedOutOfSight(tapped, shrunk, seen, { x: 0.3, y: 300.4, scale: 1 })).toBe(false);
  });

  it("judges nothing by a pane with no size", () => {
    const collapsed = { top: 100, bottom: 100, left: 0, right: 1000 };
    expect(carriedOutOfSight(below, collapsed, seen, { x: 0, y: 900, scale: 1 })).toBe(false);
  });
});
