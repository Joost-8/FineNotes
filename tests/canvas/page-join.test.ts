/**
 * `src/canvas/page-join.ts` — ink over the join of joined pages: which
 * pages a stroke reaches, and the same points in each page's own space.
 */

import { describe, expect, it } from "vitest";
import {
  inkReach,
  inkReachesPage,
  joinLines,
  joinedSides,
  movePagePts,
  pagesReached,
} from "../../src/canvas/page-join";
import { layoutPages } from "../../src/canvas/page-layout";
import { type Page, blankPage } from "../../src/model/document";

function pages(...sizes: Array<[number, number]>): Page[] {
  return sizes.map(([width, height], i) => {
    const page = blankPage(`p${i + 1}`);
    page.geometry = { width, height };
    return page;
  });
}

const down = layoutPages(pages([1000, 1400], [1000, 1400], [1000, 1400]), { joined: true });
const across = layoutPages(pages([1000, 1400], [1000, 1400], [1000, 1400]), {
  joined: true,
  direction: "horizontal",
});

describe("inkReach", () => {
  it("is the nib and a little more, plus an arrowhead's reach", () => {
    expect(inkReach(4)).toBe(6);
    expect(inkReach(4, 30)).toBe(36);
    expect(inkReach(Number.NaN)).toBe(3);
    expect(inkReach(-2, Number.NaN)).toBe(3);
  });
});

describe("pagesReached, pages down", () => {
  it("a stroke inside its page reaches no other", () => {
    expect(pagesReached(down, 1, [100, 100, 0.5, 900, 1300, 0.5], 5)).toEqual([]);
  });

  it("a stroke over the bottom edge reaches the page below", () => {
    expect(pagesReached(down, 0, [500, 1300, 0.5, 520, 1450, 0.5], 5)).toEqual([1]);
  });

  it("over the top edge, the page above", () => {
    expect(pagesReached(down, 1, [500, 40, 0.5, 520, -30, 0.5], 5)).toEqual([0]);
  });

  it("ink ending just short of the join reaches over it by its width", () => {
    expect(pagesReached(down, 0, [500, 1300, 0.5, 500, 1397, 0.5], 5)).toEqual([1]);
    expect(pagesReached(down, 0, [500, 1300, 0.5, 500, 1390, 0.5], 5)).toEqual([]);
  });

  it("a long line from the first page to the third reaches both others", () => {
    expect(pagesReached(down, 0, [500, 1000, 0.5, 500, 3500, 0.5], 5)).toEqual([1, 2]);
  });

  it("a segment that passes over a page with no point on it still reaches it", () => {
    // Two points, one on page 1 and one on page 3: the straight line between crosses page 2.
    expect(inkReachesPage([10, 10, 0.5, 10, 3000, 0.5], down.boxes[0], down.boxes[1], 2)).toBe(
      true,
    );
  });

  it("a diagonal past a page's corner, out on the desk, reaches nothing", () => {
    const box = down.boxes[0];
    // From the right of page 1 to below-right: on the desk beside the stack.
    const pts = [box.width + 50, 1300, 0.5, box.width + 300, 1600, 0.5];
    expect(pagesReached(down, 0, pts, 5)).toEqual([]);
  });

  it("a single dot on the join counts on both sides", () => {
    expect(pagesReached(down, 0, [500, 1400, 0.5], 3)).toEqual([1]);
  });

  it("skips non-finite points and a ragged tail", () => {
    expect(pagesReached(down, 0, [500, Number.NaN, 0.5, 500, 1450, 0.5, 7], 2)).toEqual([1]);
    expect(pagesReached(down, 9, [500, 1450, 0.5], 2)).toEqual([]);
  });
});

describe("pagesReached, pages across", () => {
  it("over the right edge, the page to the right", () => {
    expect(pagesReached(across, 1, [950, 700, 0.5, 1060, 720, 0.5], 4)).toEqual([2]);
    expect(pagesReached(across, 1, [50, 700, 0.5, -60, 720, 0.5], 4)).toEqual([0]);
  });
});

describe("movePagePts", () => {
  it("names the same layout spot in the other page's space, pressure kept", () => {
    const [a, b] = down.boxes;
    const moved = movePagePts([500, 1450, 0.7, 10, 1300, 0.2], a, b);
    expect(moved).toEqual([500, 50, 0.7, 10, -100, 0.2]);
    expect(movePagePts(moved, b, a)).toEqual([500, 1450, 0.7, 10, 1300, 0.2]);
  });

  it("across, and between pages of different widths centred on each other", () => {
    const [a, b] = across.boxes;
    expect(movePagePts([1010, 5, 0.5], a, b)).toEqual([10, 5, 0.5]);
    const mixed = layoutPages(pages([1000, 1400], [800, 1400]), { joined: true });
    const [wide, narrow] = mixed.boxes;
    expect(movePagePts([500, 1410, 0.5], wide, narrow)).toEqual([400, 10, 0.5]);
  });

  it("leaves the input alone and a ragged tail as it was", () => {
    const pts = [1, 2, 0.5, 9];
    expect(movePagePts(pts, down.boxes[0], down.boxes[1])).toEqual([1, -1398, 0.5, 9]);
    expect(pts).toEqual([1, 2, 0.5, 9]);
  });
});

describe("joinedSides", () => {
  it("pages down: the top of every page but the first, the bottom of every page but the last", () => {
    expect(joinedSides(down, 0)).toEqual({ top: false, bottom: true, left: false, right: false });
    expect(joinedSides(down, 1)).toEqual({ top: true, bottom: true, left: false, right: false });
    expect(joinedSides(down, 2)).toEqual({ top: true, bottom: false, left: false, right: false });
  });

  it("pages across: left and right", () => {
    expect(joinedSides(across, 0)).toEqual({ top: false, bottom: false, left: false, right: true });
    expect(joinedSides(across, 2)).toEqual({ top: false, bottom: false, left: true, right: false });
  });

  it("none for pages apart, a lone page, or a page that is not there", () => {
    const apart = layoutPages(pages([1000, 1400], [1000, 1400]));
    const none = { top: false, bottom: false, left: false, right: false };
    expect(joinedSides(apart, 0)).toEqual(none);
    expect(joinedSides(layoutPages(pages([1000, 1400]), { joined: true }), 0)).toEqual(none);
    expect(joinedSides(down, 5)).toEqual(none);
    expect(joinedSides(down, -1)).toEqual(none);
  });
});

describe("joinLines", () => {
  it("one per join, across the wider page, at the lower page's top", () => {
    const mixed = layoutPages(pages([1000, 1400], [800, 1400]), { joined: true });
    const [a, b] = mixed.boxes;
    expect(joinLines(mixed)).toEqual([
      { index: 1, across: true, at: b.y, from: a.x, to: a.x + 1000 },
    ]);
    expect(joinLines(down).map((line) => line.at)).toEqual([down.boxes[1].y, down.boxes[2].y]);
  });

  it("pages across: upright lines at each left edge", () => {
    const lines = joinLines(across);
    expect(lines.map((line) => [line.index, line.across, line.at])).toEqual([
      [1, false, across.boxes[1].x],
      [2, false, across.boxes[2].x],
    ]);
    expect(lines[0].to - lines[0].from).toBe(1400);
  });

  it("none for pages apart", () => {
    expect(joinLines(layoutPages(pages([1000, 1400], [1000, 1400])))).toEqual([]);
  });
});
