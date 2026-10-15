/** `src/view/text-reveal.ts`: scrolling the box being typed in clear of the keyboard. */

import { describe, expect, it } from "vitest";
import { revealDelta } from "../../src/view/text-reveal";

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
