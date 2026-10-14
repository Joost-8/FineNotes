import { describe, expect, it } from "vitest";
import {
  type Box,
  EDGE_MAX_SPEED,
  EDGE_PX,
  dropSlotAt,
  edgeScrollSpeed,
  rangeOf,
  realGap,
} from "../../src/view/page-drag-model";

/** A grid of `n` thumbnails, `cols` per row, 100 x 130 with 20 px gaps. */
function grid(n: number, cols: number): Box[] {
  return Array.from({ length: n }, (_, i) => {
    const left = 20 + (i % cols) * 120;
    const top = 10 + Math.floor(i / cols) * 150;
    return { left, top, right: left + 100, bottom: top + 130 };
  });
}

describe("dropSlotAt in a grid", () => {
  const boxes = grid(7, 3); // rows: 0 1 2 / 3 4 5 / 6

  it("drops before the thumbnail whose left half the pointer is over", () => {
    expect(dropSlotAt(boxes, 30, 50)?.gap).toBe(0);
    expect(dropSlotAt(boxes, 160, 200)?.gap).toBe(4);
    expect(dropSlotAt(boxes, 190, 200)?.gap).toBe(5);
  });

  it("drops after a row's last page past its middle", () => {
    expect(dropSlotAt(boxes, 330, 50)?.gap).toBe(3);
    // The last row: after the last page.
    expect(dropSlotAt(boxes, 400, 330)?.gap).toBe(7);
  });

  it("draws the bar halfway between two pages, or half a gap outside a row's end", () => {
    expect(dropSlotAt(boxes, 160, 200)).toEqual({ gap: 4, x1: 130, y1: 160, x2: 130, y2: 290 });
    expect(dropSlotAt(boxes, 30, 50)).toMatchObject({ gap: 0, x1: 10 });
    expect(dropSlotAt(boxes, 330, 50)).toMatchObject({ gap: 3, x1: 370 });
  });

  it("chooses the row by halfway lines, and clamps above and below", () => {
    // Rows end at 140 and start at 160: below 150 is the first row.
    expect(dropSlotAt(boxes, 30, 149)?.gap).toBe(0);
    expect(dropSlotAt(boxes, 30, 151)?.gap).toBe(3);
    expect(dropSlotAt(boxes, 30, -500)?.gap).toBe(0);
    expect(dropSlotAt(boxes, 30, 9000)?.gap).toBe(6);
  });

  it("is null without thumbnails", () => {
    expect(dropSlotAt([], 0, 0)).toBeNull();
  });
});

describe("dropSlotAt in one column", () => {
  const boxes = grid(3, 1);

  it("drops before the page whose upper half holds the pointer, with a level bar", () => {
    expect(dropSlotAt(boxes, 50, 20)).toEqual({ gap: 0, x1: 20, y1: 0, x2: 120, y2: 0 });
    expect(dropSlotAt(boxes, 50, 120)).toEqual({ gap: 1, x1: 20, y1: 150, x2: 120, y2: 150 });
    expect(dropSlotAt(boxes, 50, 400)).toEqual({ gap: 3, x1: 20, y1: 450, x2: 120, y2: 450 });
  });

  it("treats a lone page as a column, with a default space", () => {
    const one = [{ left: 0, top: 10, right: 100, bottom: 110 }];
    expect(dropSlotAt(one, 50, 100)).toEqual({ gap: 1, x1: 0, y1: 118, x2: 100, y2: 118 });
    expect(dropSlotAt(one, 50, 20)).toMatchObject({ gap: 0, y1: 2 });
  });
});

describe("realGap", () => {
  it("maps a gap among the pages shown to the whole page list", () => {
    const shown = [1, 4, 6];
    expect(realGap(shown, 0)).toBe(1);
    expect(realGap(shown, 1)).toBe(4);
    expect(realGap(shown, 2)).toBe(6);
    expect(realGap(shown, 3)).toBe(7);
    expect(realGap(shown, -2)).toBe(1);
    expect(realGap([], 3)).toBe(0);
  });
});

describe("edgeScrollSpeed", () => {
  it("is still away from the edges", () => {
    expect(edgeScrollSpeed(300, 0, 600)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom, faster deeper in", () => {
    const up = edgeScrollSpeed(EDGE_PX / 2, 0, 600);
    expect(up).toBeLessThan(0);
    expect(edgeScrollSpeed(0, 0, 600)).toBe(-EDGE_MAX_SPEED);
    expect(edgeScrollSpeed(-100, 0, 600)).toBe(-EDGE_MAX_SPEED);
    expect(Math.abs(up)).toBeLessThan(EDGE_MAX_SPEED);
    expect(edgeScrollSpeed(600 - EDGE_PX / 2, 0, 600)).toBeCloseTo(-up);
    expect(edgeScrollSpeed(900, 0, 600)).toBe(EDGE_MAX_SPEED);
  });

  it("narrows the bands on a short panel, and stops on an empty one", () => {
    expect(edgeScrollSpeed(50, 0, 90)).toBe(0);
    expect(edgeScrollSpeed(0, 0, 90)).toBe(-EDGE_MAX_SPEED);
    expect(edgeScrollSpeed(0, 0, 0)).toBe(0);
  });
});

describe("rangeOf", () => {
  it("runs from the anchor to the page clicked, either way", () => {
    expect(rangeOf(2, 5)).toEqual([2, 3, 4, 5]);
    expect(rangeOf(5, 2)).toEqual([2, 3, 4, 5]);
    expect(rangeOf(3, 3)).toEqual([3]);
  });
});
