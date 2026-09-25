/**
 * Pages running across, one per screen (a notebook's "Scroll direction"
 * setting), and pulling past the last page to add one — the pure geometry in
 * `src/canvas/page-layout.ts` and the scroller support in
 * `src/canvas/scroll-physics.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  PAGE_FLICK_SPEED,
  PAGE_GAP,
  PAGE_MARGIN_Y,
  PULL_ADD_PAGE_PX,
  boxAtPoint,
  currentPageIndexInRow,
  layoutPages,
  pageSnapIndex,
  pullAddProgress,
  rowScrollInsets,
  ROW_PAGE_EDGE_PX,
  ROW_PAGING_ZOOM,
  rowPageScrollRange,
  rowScrollXForPage,
  rowSlotGap,
  rowTurnsPages,
  toPageSpace,
} from "../../src/canvas/page-layout";
import { KineticScroller } from "../../src/canvas/scroll-physics";
import { type Page, blankPage } from "../../src/model/document";

function pages(...sizes: Array<[number, number]>): Page[] {
  return sizes.map(([width, height], i) => {
    const page = blankPage(`p${i + 1}`);
    page.geometry = { width, height };
    return page;
  });
}

const row = (): ReturnType<typeof layoutPages> =>
  layoutPages(pages([1024, 1448], [1024, 1448], [1024, 1448]), { direction: "horizontal" });

/** Run the scroller's frames until it rests; returns the frames it took. */
function settle(s: KineticScroller, t0: number, limit = 400): number {
  let t = t0;
  let frames = 0;
  while (s.step((t += 16)) && frames < limit) frames++;
  return frames;
}

describe("layoutPages, horizontal", () => {
  it("puts pages side by side with the column's gap and margins", () => {
    const layout = row();
    const [a, b, c] = layout.boxes;
    expect(layout.direction).toBe("horizontal");
    expect(b.x - (a.x + a.width)).toBe(PAGE_GAP);
    expect(c.x - (b.x + b.width)).toBe(PAGE_GAP);
    expect(a.y).toBe(PAGE_MARGIN_Y);
    expect(b.y).toBe(a.y);
    expect(layout.width).toBe(c.x + c.width + a.x);
    expect(layout.height).toBe(1448 + 2 * PAGE_MARGIN_Y);
  });

  it("fits one page and its margins to the pane, not the whole row", () => {
    const layout = row();
    const column = layoutPages(pages([1024, 1448]));
    expect(layout.fitWidth).toBe(column.width);
    expect(layout.fitWidth).toBeLessThan(layout.width);
    expect(column.fitWidth).toBe(column.width);
    expect(column.direction).toBe("vertical");
  });

  it("centres a shorter page on the tallest", () => {
    const layout = layoutPages(pages([800, 1000], [800, 600]), { direction: "horizontal" });
    expect(layout.boxes[1].y - layout.boxes[0].y).toBe(200);
  });

  it("keeps page space identical to the column's: only the page's origin moves", () => {
    const list = pages([1024, 1448], [1024, 1448]);
    const across = layoutPages(list, { direction: "horizontal" }).boxes[1];
    const down = layoutPages(list).boxes[1];
    expect(across.width).toBe(down.width);
    expect(across.height).toBe(down.height);
    const hit = boxAtPoint(
      layoutPages(list, { direction: "horizontal" }),
      across.x + 10,
      across.y + 20,
    );
    expect(hit?.index).toBe(1);
    expect(toPageSpace(across, across.x + 10, across.y + 20)).toEqual({ x: 10, y: 20 });
  });

  it("lays out an empty document without throwing", () => {
    const layout = layoutPages([], { direction: "horizontal" });
    expect(layout.boxes).toEqual([]);
    expect(layout.direction).toBe("horizontal");
  });
});

describe("the page a row is showing", () => {
  it("is the page covering most of the visible band", () => {
    const layout = row();
    const [, b] = layout.boxes;
    expect(currentPageIndexInRow(layout, b.x - 100, b.x + b.width - 100)).toBe(1);
    expect(currentPageIndexInRow(layout, -500, 200)).toBe(0);
    // Past the last page: still the last page, never back to the first.
    expect(currentPageIndexInRow(layout, layout.width + 50, layout.width + 900)).toBe(2);
    expect(currentPageIndexInRow(layoutPages([], { direction: "horizontal" }), 0, 1)).toBe(0);
  });
});

describe("centring a page in the pane", () => {
  const scale = 0.5;
  const pane = 820;

  it("puts the page's centre at the pane's centre", () => {
    const layout = row();
    const x = rowScrollXForPage(layout, 1, scale, pane);
    const box = layout.boxes[1];
    const left = box.x * scale - x;
    expect(left + (box.width * scale) / 2).toBeCloseTo(pane / 2);
  });

  it("clamps the index and copes with no pages", () => {
    const layout = row();
    expect(rowScrollXForPage(layout, 99, scale, pane)).toBe(
      rowScrollXForPage(layout, 2, scale, pane),
    );
    expect(rowScrollXForPage(layout, -3, scale, pane)).toBe(
      rowScrollXForPage(layout, 0, scale, pane),
    );
    expect(rowScrollXForPage(layoutPages([], { direction: "horizontal" }), 0, 1, pane)).toBe(0);
  });

  it("makes room before the first page and after the last so both can centre", () => {
    const layout = row();
    const { lead, trail } = rowScrollInsets(layout, scale, pane);
    expect(lead).toBeCloseTo(-rowScrollXForPage(layout, 0, scale, pane));
    const maxX = layout.width * scale - pane;
    expect(maxX + trail).toBeCloseTo(rowScrollXForPage(layout, 2, scale, pane));
    expect(rowScrollInsets(layoutPages([], { direction: "horizontal" }), 1, pane)).toEqual({
      lead: 0,
      trail: 0,
    });
  });

  it("needs no room once a page is wider than the pane", () => {
    expect(rowScrollInsets(row(), 2, 820)).toEqual({ lead: 0, trail: 0 });
  });
});

describe("pageSnapIndex", () => {
  const scale = 0.5;
  const pane = 820;
  const layout = row();
  const at = (i: number): number => rowScrollXForPage(layout, i, scale, pane);

  it("settles on the nearest page when let go slowly", () => {
    expect(pageSnapIndex(layout, at(1) - 50, 0, 1, scale, pane)).toBe(1);
    expect(pageSnapIndex(layout, at(1) + (at(2) - at(1)) * 0.6, 0, 1, scale, pane)).toBe(2);
  });

  it("turns one page on a flick, whichever way", () => {
    expect(pageSnapIndex(layout, at(1) + 10, PAGE_FLICK_SPEED, 1, scale, pane)).toBe(2);
    expect(pageSnapIndex(layout, at(1) - 10, -PAGE_FLICK_SPEED, 1, scale, pane)).toBe(0);
  });

  it("never turns more than one page in one swipe", () => {
    expect(pageSnapIndex(layout, at(2) + 500, 0, 0, scale, pane)).toBe(1);
  });

  it("stops at the first and last page", () => {
    expect(pageSnapIndex(layout, at(0), -5, 0, scale, pane)).toBe(0);
    expect(pageSnapIndex(layout, at(2), 5, 2, scale, pane)).toBe(2);
    expect(pageSnapIndex(layoutPages([], { direction: "horizontal" }), 0, 1, 0, 1, pane)).toBe(0);
  });
});

describe("pullAddProgress", () => {
  it("fills from nothing to armed over the threshold, and no further", () => {
    expect(pullAddProgress(0)).toBe(0);
    expect(pullAddProgress(-40)).toBe(0);
    expect(pullAddProgress(Number.NaN)).toBe(0);
    expect(pullAddProgress(PULL_ADD_PAGE_PX / 2)).toBeCloseTo(0.5);
    expect(pullAddProgress(PULL_ADD_PAGE_PX)).toBe(1);
    expect(pullAddProgress(PULL_ADD_PAGE_PX * 3)).toBe(1);
    expect(pullAddProgress(10, 0)).toBe(0);
  });

  it("is reachable with the rubber band on an iPad-sized pane", () => {
    // The rubber band never shows more than the pane; the threshold must sit
    // well inside what a comfortable pull shows.
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 800,
      contentHeight: 3000,
      viewportWidth: 820,
      viewportHeight: 1100,
    });
    s.setPosition(0, 1900);
    s.dragStart(400, 900, 0);
    s.dragMove(400, 600, 100);
    expect(pullAddProgress(s.overscrollEnd.y)).toBe(1);
  });
});

describe("KineticScroller for a row of pages", () => {
  it("scrolls into the lead and trail room, and stretches past it", () => {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 2000,
      contentHeight: 800,
      viewportWidth: 820,
      viewportHeight: 800,
      leadX: 100,
      trailX: 60,
    });
    expect(s.bounds.minX).toBe(-100);
    expect(s.bounds.maxX).toBe(2000 - 820 + 60);
    s.setPosition(-500, 0);
    expect(s.position.x).toBe(-100);
    s.setPosition(99999, 0);
    expect(s.position.x).toBe(s.bounds.maxX);
    s.dragStart(400, 400, 0);
    s.dragMove(100, 400, 50);
    expect(s.overscrollEnd.x).toBeGreaterThan(0);
    expect(s.overscrollEnd.y).toBe(0);
  });

  it("stretches sideways on a one-page row when asked to", () => {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 500,
      contentHeight: 800,
      viewportWidth: 820,
      viewportHeight: 800,
      alwaysBounceX: true,
    });
    s.dragStart(400, 400, 0);
    s.dragMove(200, 400, 50);
    expect(s.overscrollEnd.x).toBeGreaterThan(0);
  });

  it("snapTo glides to the target and rests exactly on it", () => {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 4000,
      contentHeight: 800,
      viewportWidth: 820,
      viewportHeight: 800,
    });
    s.snapTo(1200, 0, 0);
    expect(s.isAnimating).toBe(true);
    s.step(16);
    expect(s.position.x).toBeGreaterThan(0);
    expect(s.position.x).toBeLessThan(1200);
    const frames = settle(s, 16);
    expect(frames).toBeLessThan(120);
    expect(s.position).toEqual({ x: 1200, y: 0 });
    expect(s.isAnimating).toBe(false);
  });

  it("snapTo clamps its target, and a finger stops it", () => {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 4000,
      contentHeight: 800,
      viewportWidth: 820,
      viewportHeight: 800,
    });
    s.snapTo(99999, null, 0);
    settle(s, 0);
    expect(s.position.x).toBe(4000 - 820);
    s.snapTo(0, null, 1000);
    s.step(1016);
    s.dragStart(10, 10, 1020);
    expect(s.isAnimating).toBe(false);
    s.dragEnd(1030);
    settle(s, 1030);
    expect(s.position.x).toBeGreaterThan(0);
  });

  it("snapTo carries a release from past the end back onto the last page", () => {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 4000,
      contentHeight: 800,
      viewportWidth: 820,
      viewportHeight: 800,
    });
    s.setPosition(4000 - 820, 0);
    s.dragStart(600, 400, 0);
    s.dragMove(300, 400, 60);
    s.dragEnd(80);
    s.snapTo(2000, 0, 80);
    settle(s, 80);
    expect(s.position.x).toBe(2000);
  });

  it("snapTo with neither axis, or mid-drag, does nothing", () => {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 4000,
      contentHeight: 800,
      viewportWidth: 820,
      viewportHeight: 800,
    });
    s.snapTo(null, null, 0);
    expect(s.isAnimating).toBe(false);
    s.dragStart(10, 10, 0);
    s.snapTo(500, 0, 0);
    s.dragEnd(10);
    expect(s.position.x).toBe(0);
  });
});

// Joost, 2026-09-22: GoodNotes shows one page of a horizontal notebook at a
// time; the next slides in only during a swipe, and a zoomed-in page pans
// without sliding onto its neighbour.
describe("one page per screen", () => {
  it("spaces a row so a centred page's neighbours sit off the pane", () => {
    const row = pages([1024, 1448], [1024, 1448], [800, 1448]);
    const paneWidth = 1180;
    const scale = 0.5;
    const gap = rowSlotGap(row, paneWidth, scale);
    const layout = layoutPages(row, { direction: "horizontal", gap });
    for (let i = 0; i < row.length; i++) {
      const x = rowScrollXForPage(layout, i, scale, paneWidth);
      const [left, right] = [x / scale, (x + paneWidth) / scale];
      for (const other of layout.boxes) {
        if (other.index === i) continue;
        // Entirely outside the visible band.
        expect(other.x + other.width <= left || other.x >= right).toBe(true);
      }
    }
  });

  it("never goes below the ordinary gap, and ignores nonsense panes", () => {
    const row = pages([1024, 1448]);
    expect(rowSlotGap(row, 100, 1)).toBe(PAGE_GAP);
    expect(rowSlotGap(row, 0, 1)).toBe(PAGE_GAP);
    expect(rowSlotGap(row, 1180, 0)).toBe(PAGE_GAP);
    expect(rowSlotGap([], 1180, 0.5)).toBe(PAGE_GAP);
  });

  it("turns pages up to a little past the zoom floor, and not beyond", () => {
    expect(rowTurnsPages(0.5, 0.5)).toBe(true);
    expect(rowTurnsPages(0.5 * ROW_PAGING_ZOOM, 0.5)).toBe(true);
    expect(rowTurnsPages(0.5 * ROW_PAGING_ZOOM * 1.01, 0.5)).toBe(false);
    expect(rowTurnsPages(2, 0.5)).toBe(false);
  });

  it("holds a zoomed-in row to its page's edges, plus a little desk", () => {
    const layout = layoutPages(pages([1024, 1448], [1024, 1448]), { direction: "horizontal" });
    const scale = 2;
    const paneWidth = 1000;
    const box = layout.boxes[1];
    const range = rowPageScrollRange(layout, 1, scale, paneWidth);
    expect(range.min).toBe(box.x * scale - ROW_PAGE_EDGE_PX);
    expect(range.max).toBe((box.x + box.width) * scale - paneWidth + ROW_PAGE_EDGE_PX);
    // Out-of-range indexes clamp to a real page.
    expect(rowPageScrollRange(layout, 9, scale, paneWidth)).toEqual(range);
  });

  it("keeps a page narrower than the pane centred", () => {
    const layout = layoutPages(pages([400, 600], [400, 600]), { direction: "horizontal" });
    const range = rowPageScrollRange(layout, 0, 1, 1000);
    const centred = rowScrollXForPage(layout, 0, 1, 1000);
    expect(range).toEqual({ min: centred, max: centred });
  });

  it("answers an empty layout with a zero range", () => {
    const layout = layoutPages([], { direction: "horizontal" });
    expect(rowPageScrollRange(layout, 0, 1, 1000)).toEqual({ min: 0, max: 0 });
  });
});

describe("KineticScroller held to a range", () => {
  it("uses an explicit x range over the content's, and still stretches past it", () => {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 5000,
      contentHeight: 800,
      viewportWidth: 820,
      viewportHeight: 800,
      leadX: 300,
      rangeX: { min: 1200, max: 1900 },
    });
    expect(s.bounds.minX).toBe(1200);
    expect(s.bounds.maxX).toBe(1900);
    s.setPosition(0, 0);
    expect(s.position.x).toBe(1200);
    s.setPosition(9999, 0);
    expect(s.position.x).toBe(1900);
    s.dragStart(400, 400, 0);
    s.dragMove(100, 400, 50);
    expect(s.overscrollEnd.x).toBeGreaterThan(0);
  });

  it("ignores a range that is not finite", () => {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 2000,
      contentHeight: 800,
      viewportWidth: 820,
      viewportHeight: 800,
      rangeX: { min: Number.NaN, max: 5 },
    });
    expect(s.bounds.minX).toBe(0);
    expect(s.bounds.maxX).toBe(2000 - 820);
  });
});
