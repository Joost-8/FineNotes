/**
 * Moving around an endless board (FineNotes#46): its layout, the scroll
 * range a screen past the drawing, the zoom floor that fits the drawing,
 * and the scroller's free axes. Checked at the writing size, at 10% and at
 * 800%, the zoom range's two ends.
 */

import { describe, expect, it } from "vitest";
import { blankPage } from "../../src/model/document";
import { WRITING_SCALE, zoomPercent } from "../../src/model/units";
import {
  boardCentre,
  boardScrollRange,
  boardScrollToCentre,
  BOARD_PARKED_Y,
  PAGE_GAP,
  boxAtPoint,
  layoutBoard,
  layoutBoards,
  layoutNotebook,
  layoutPages,
  columnScrollRangeX,
  currentPageIndex,
  currentPageIndexInRow,
  pageSnapIndex,
  rowScrollInsets,
  shownBoxes,
  visibleBoxes,
} from "../../src/canvas/page-layout";
import { KineticScroller } from "../../src/canvas/scroll-physics";
import { joinLines, joinedSides } from "../../src/canvas/page-join";
import { MAX_SCALE, MIN_SCALE, boardFitZoom } from "../../src/canvas/zoom";

const geometry = { width: 5600, height: 5600 };
const pane = { w: 1024, h: 1300 };

describe("the writing size", () => {
  it("is what the readout calls 100%; the zoom range is 10% to 800%", () => {
    expect(zoomPercent(WRITING_SCALE)).toBe(100);
    expect(zoomPercent(WRITING_SCALE * MIN_SCALE)).toBe(10);
    expect(zoomPercent(WRITING_SCALE * MAX_SCALE)).toBe(800);
  });
});

describe("layoutBoard", () => {
  it("is the one page at the origin, layout px as page px", () => {
    const layout = layoutBoard(blankPage("p1", geometry));
    expect(layout.boxes).toEqual([{ index: 0, id: "p1", x: 0, y: 0, width: 5600, height: 5600 }]);
    expect(layout.width).toBe(5600);
    expect(layout.height).toBe(5600);
  });
});

describe("boardScrollRange", () => {
  const drawn = { minX: 2000, minY: 2500, maxX: 3000, maxY: 2700 };

  it("reaches a screen of empty paper past the drawing, at writing size", () => {
    const s = WRITING_SCALE;
    const r = boardScrollRange(geometry, drawn, s, pane.w, pane.h);
    // The view's left edge runs from a screen left of the drawing to its right edge.
    expect(r.minX).toBeCloseTo((2000 - pane.w / s) * s);
    expect(r.maxX).toBeCloseTo(3000 * s);
    expect(r.minY).toBeCloseTo((2500 - pane.h / s) * s);
    expect(r.maxY).toBeCloseTo(2700 * s);
  });

  it("is a screen around the page's middle with nothing drawn", () => {
    const s = WRITING_SCALE;
    const r = boardScrollRange(geometry, null, s, pane.w, pane.h);
    expect(boardCentre(geometry, null)).toEqual({ x: 2800, y: 2800 });
    expect(r.minX).toBeCloseTo(2800 * s - pane.w);
    expect(r.maxX).toBeCloseTo(2800 * s);
  });

  it("never leaves the paper, at 800%", () => {
    const s = WRITING_SCALE * MAX_SCALE;
    const nearEdge = { minX: 10, minY: 10, maxX: 5590, maxY: 5590 };
    const r = boardScrollRange(geometry, nearEdge, s, pane.w, pane.h);
    expect(r.minX).toBe(0);
    expect(r.minY).toBe(0);
    expect(r.maxX).toBeCloseTo((5600 - pane.w / s) * s);
    expect(r.maxY).toBeCloseTo((5600 - pane.h / s) * s);
  });

  it("centres a page smaller than the pane, at 10%", () => {
    const s = WRITING_SCALE * MIN_SCALE;
    const r = boardScrollRange(geometry, drawn, s, pane.w, pane.h);
    // 5600 page px at 10% is about 434 screen px: centred, nowhere to go.
    expect(r.minX).toBe(r.maxX);
    expect(r.minX).toBeCloseTo((5600 * s - pane.w) / 2);
    expect(r.minY).toBeCloseTo((5600 * s - pane.h) / 2);
  });

  it("falls back to the whole paper when the drawing is off it, and to scale 1 for none", () => {
    const off = { minX: 9000, minY: 9000, maxX: 9500, maxY: 9500 };
    const r = boardScrollRange(geometry, off, 1, pane.w, pane.h);
    expect(r).toEqual({ minX: 0, maxX: 5600 - pane.w, minY: 0, maxY: 5600 - pane.h });
    expect(boardScrollRange(geometry, drawn, 0, pane.w, pane.h)).toEqual(
      boardScrollRange(geometry, drawn, 1, pane.w, pane.h),
    );
  });
});

describe("boardScrollToCentre", () => {
  it("puts the page point in the middle of the pane", () => {
    const at = boardCentre(geometry, { minX: 1000, minY: 2000, maxX: 2000, maxY: 3000 });
    expect(at).toEqual({ x: 1500, y: 2500 });
    const p = boardScrollToCentre(at, 2, pane.w, pane.h);
    expect(p).toEqual({ x: 3000 - 512, y: 5000 - 650 });
  });
});

describe("boardFitZoom", () => {
  it("stays at the writing size for a small drawing, or none", () => {
    expect(boardFitZoom(null, WRITING_SCALE, pane.w, pane.h)).toBe(1);
    const small = { minX: 0, minY: 0, maxX: 300, maxY: 200 };
    expect(boardFitZoom(small, WRITING_SCALE, pane.w, pane.h)).toBe(1);
  });

  it("zooms out until the whole drawing fits, its margin kept", () => {
    const wide = { minX: 0, minY: 0, maxX: 4000, maxY: 500 };
    const z = boardFitZoom(wide, WRITING_SCALE, pane.w, pane.h);
    expect(4000 * WRITING_SCALE * z).toBeCloseTo(pane.w - 64);
    const tall = { minX: 0, minY: 0, maxX: 10, maxY: 6000 };
    const zt = boardFitZoom(tall, WRITING_SCALE, pane.w, pane.h);
    expect(6000 * WRITING_SCALE * zt).toBeCloseTo(pane.h - 64);
  });

  it("goes no further out than 10%, and fits a single point at the writing size", () => {
    const huge = { minX: 0, minY: 0, maxX: 60000, maxY: 60000 };
    expect(boardFitZoom(huge, WRITING_SCALE, pane.w, pane.h)).toBe(MIN_SCALE);
    const dot = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
    expect(boardFitZoom(dot, WRITING_SCALE, pane.w, pane.h)).toBe(1);
    expect(boardFitZoom(huge, 0, pane.w, pane.h)).toBe(1);
    expect(boardFitZoom(huge, WRITING_SCALE, 0, pane.h)).toBe(1);
    expect(boardFitZoom(huge, WRITING_SCALE, pane.w, 0)).toBe(1);
  });
});

describe("KineticScroller on a board", () => {
  const extent = {
    contentWidth: 4340,
    contentHeight: 4340,
    viewportWidth: pane.w,
    viewportHeight: pane.h,
    alwaysBounceX: true,
    rangeX: { min: 500, max: 2300 },
    rangeY: { min: 400, max: 2100 },
  };

  it("holds both axes to their ranges", () => {
    const s = new KineticScroller();
    s.setExtent(extent);
    expect(s.bounds).toEqual({ minX: 500, maxX: 2300, minY: 400, maxY: 2100 });
    s.setPosition(0, 0);
    expect(s.position).toEqual({ x: 500, y: 400 });
    s.setPosition(9999, 9999);
    expect(s.position).toEqual({ x: 2300, y: 2100 });
  });

  it("keeps the keyboard's room below the range", () => {
    const s = new KineticScroller();
    s.setExtent({ ...extent, trailY: 300 });
    expect(s.bounds.maxY).toBe(2400);
  });

  it("with free axes, a nearly straight drag still moves both ways", () => {
    const locked = new KineticScroller();
    locked.setExtent(extent);
    locked.setPosition(1000, 1000);
    locked.dragStart(500, 500, 0);
    locked.dragMove(400, 497, 16);
    locked.dragMove(300, 494, 32);
    expect(locked.axisLock).toBe("x");
    expect(locked.position.y).toBe(1000);

    const free = new KineticScroller();
    free.setExtent({ ...extent, freeAxes: true });
    free.setPosition(1000, 1000);
    free.dragStart(500, 500, 0);
    free.dragMove(400, 497, 16);
    free.dragMove(300, 494, 32);
    expect(free.axisLock).toBe("free");
    expect(free.position).toEqual({ x: 1200, y: 1006 });
  });

  it("flings and comes to rest inside the range", () => {
    const s = new KineticScroller();
    s.setExtent({ ...extent, freeAxes: true });
    s.setPosition(1000, 1000);
    s.dragStart(500, 500, 0);
    for (let i = 1; i <= 6; i++) s.dragMove(500 - i * 40, 500 - i * 40, i * 16);
    s.dragEnd(96);
    let t = 96;
    while (s.step((t += 16)) && t < 20000);
    expect(s.position.x).toBeLessThanOrEqual(2300);
    expect(s.position.y).toBeLessThanOrEqual(2100);
    expect(s.position.x).toBeGreaterThan(1240);
    expect(s.position.y).toBeGreaterThan(1240);
  });
});

describe("layoutBoards (discussion #160)", () => {
  const pages = [
    blankPage("p1", geometry),
    blankPage("p2", { width: 6720, height: 4480 }),
    blankPage("p3", geometry),
  ];

  it("shows the current board at the origin and is that board's size", () => {
    const layout = layoutBoards(pages, 1);
    expect(layout.boxes[1]).toEqual({ index: 1, id: "p2", x: 0, y: 0, width: 6720, height: 4480 });
    expect(layout.width).toBe(6720);
    expect(layout.height).toBe(4480);
  });

  it("keeps every board's box at its own index, the others parked out of reach", () => {
    const layout = layoutBoards(pages, 1);
    expect(layout.boxes.map((box) => box.index)).toEqual([0, 1, 2]);
    expect(layout.boxes.map((box) => box.id)).toEqual(["p1", "p2", "p3"]);
    expect(layout.boxes[0].y).toBe(BOARD_PARKED_Y);
    expect(layout.boxes[2].y).toBe(BOARD_PARKED_Y + 5600 + PAGE_GAP);
    // Nothing on or around the board being shown reaches a parked one.
    expect(visibleBoxes(layout, -100_000, 100_000).map((box) => box.id)).toEqual(["p2"]);
    expect(boxAtPoint(layout, 10, 10)?.id).toBe("p2");
  });

  it("clamps the current board into the file, and is layoutBoard for one", () => {
    expect(layoutBoards(pages, 9).boxes[2].y).toBe(0);
    expect(layoutBoards(pages, -1).boxes[0].y).toBe(0);
    expect(layoutBoards([pages[0]], 0)).toEqual(layoutBoard(pages[0]));
  });
});

describe("layoutNotebook: boards among a notebook's pages (discussion #160)", () => {
  const page = (id: string): ReturnType<typeof blankPage> =>
    blankPage(id, { width: 800, height: 1100 });
  const board = (id: string): ReturnType<typeof blankPage> => ({
    ...blankPage(id, geometry),
    board: true,
  });
  const pages = [page("p1"), board("p2"), page("p3"), board("p4")];

  it("is layoutPages when there is no board", () => {
    const plain = [page("p1"), page("p2")];
    expect(layoutNotebook(plain)).toEqual(layoutPages(plain));
  });

  it("lays the pages out as if the boards were not there, the boards parked at their indexes", () => {
    const layout = layoutNotebook(pages);
    const column = layoutPages([pages[0], pages[2]]);
    expect(layout.boxes.map((box) => box.index)).toEqual([0, 1, 2, 3]);
    expect(layout.boxes[2]).toEqual({ ...column.boxes[1], index: 2 });
    expect(layout.boxes[1].parked).toBe(true);
    expect(layout.boxes[3].parked).toBe(true);
    expect(layout.height).toBe(column.height);
    expect(shownBoxes(layout).map((box) => box.id)).toEqual(["p1", "p3"]);
  });

  it("keeps the boards out of every measure of the layout", () => {
    const layout = layoutNotebook(pages);
    const column = layoutPages([pages[0], pages[2]]);
    expect(columnScrollRangeX(layout, 1, 900)).toEqual(columnScrollRangeX(column, 1, 900));
    expect(currentPageIndex(layout, 0, 100_000_000)).toBe(0);
    expect(currentPageIndex(layout, column.boxes[1].y, column.boxes[1].y + 900)).toBe(2);
  });

  it("steps a row's swipe over a board, and measures the row without it", () => {
    const row = layoutNotebook(pages, { direction: "horizontal" });
    const plain = layoutPages([pages[0], pages[2]], { direction: "horizontal" });
    expect(pageSnapIndex(row, 0, 1, 0, 1, 900)).toBe(2);
    expect(pageSnapIndex(row, 0, -1, 2, 1, 900)).toBe(0);
    expect(rowScrollInsets(row, 1, 900)).toEqual(rowScrollInsets(plain, 1, 900));
    expect(currentPageIndexInRow(row, 0, 100_000)).toBe(0);
  });

  it("joins only the pages shown", () => {
    const joined = layoutNotebook(pages, { joined: true });
    expect(joinLines(joined).map((line) => line.index)).toEqual([2]);
    expect(joinedSides(joined, 2)).toMatchObject({ top: true, bottom: false });
    expect(joinedSides(joined, 1)).toMatchObject({ top: false, bottom: false });
  });

  it("is the first board alone for a notebook of boards only", () => {
    const only = [board("p1"), board("p2")];
    expect(layoutNotebook(only)).toEqual(layoutBoards(only, 0));
  });
});
