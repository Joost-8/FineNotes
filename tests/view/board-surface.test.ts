/**
 * `src/view/ink-surface.ts` on an endless board (FineNotes#46): the growth
 * after an edit (`growBoard`), the layout it asks for (`layoutStale`), and
 * gesture thresholds at the writing size and zoomed in 5x. Built from the
 * class's prototype with only the state the code reads, as in
 * `ink-surface.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import { BOARD_BLOCK, BOARD_START_BLOCKS, newBoardPage } from "../../src/model/board";
import type { InkDocument, Stroke } from "../../src/model/document";
import { History } from "../../src/model/history";
import { DEFAULT_NOTEBOOK_CHOICES, buildNewDocument } from "../../src/model/new-notebook";
import { AddStrokeToPage } from "../../src/model/page-commands";
import { WRITING_SCALE } from "../../src/model/units";
import { layoutBoard, layoutBoards } from "../../src/canvas/page-layout";

vi.mock("obsidian", () => ({
  Notice: class {},
  Platform: {},
  setIcon: () => {},
}));

const { InkSurface } = await import("../../src/view/ink-surface");

type State = Record<string, unknown>;

function run<T = unknown>(surface: State, method: string, ...args: unknown[]): T {
  const fn = (InkSurface.prototype as unknown as Record<string, (...a: unknown[]) => T>)[method];
  return fn.apply(surface, args);
}

function get<T = unknown>(surface: State, getter: string): T {
  const d = Object.getOwnPropertyDescriptor(InkSurface.prototype, getter);
  return d?.get?.call(surface) as T;
}

const SIDE = BOARD_BLOCK * BOARD_START_BLOCKS;

/** A board surface at the writing size, its view in the page's middle. */
function boardSurface(): { surface: State; doc: InkDocument; history: History } {
  const doc = buildNewDocument({ ...DEFAULT_NOTEBOOK_CHOICES, type: "endless" }, "Map");
  const history = new History();
  const surface = Object.assign(Object.create(InkSurface.prototype) as object, {
    doc,
    history,
    board: true,
    boardDrawn: null,
    boardHold: null,
    boardShift: { x: 0, y: 0 },
    boardChecked: new WeakSet(),
    boardRef: null,
    boardSpots: new WeakMap(),
    pageIndex: 0,
    baseScale: WRITING_SCALE,
    userZoom: 1,
    cssW: 1024,
    cssH: 768,
    offsetX: -(SIDE / 2) * WRITING_SCALE,
    viewport: { scrollY: SIDE / 2, scale: WRITING_SCALE, width: SIDE },
    pageLayout: layoutBoard(doc.pages[0]),
    ensurePaperSize: vi.fn(),
  }) as State;
  return { surface, doc, history };
}

function stroke(id: string, x: number, y: number): Stroke {
  return { id, color: "#000", size: 4, tool: "pen", pts: [x, y, 0.5, x + 10, y + 10, 0.5] };
}

describe("growBoard", () => {
  it("grows nothing for ink in the middle, and keeps the drawing and its floor", () => {
    const { surface, doc, history } = boardSurface();
    history.push(doc, new AddStrokeToPage("p1", stroke("s1", SIDE / 2, SIDE / 2)));
    run(surface, "growBoard");
    expect(doc.pages[0].geometry).toEqual({ width: SIDE, height: SIDE });
    expect(surface.boardDrawn).toEqual({
      minX: SIDE / 2 - 2,
      minY: SIDE / 2 - 2,
      maxX: SIDE / 2 + 12,
      maxY: SIDE / 2 + 12,
    });
    expect(surface.minZoom).toBe(1);
  });

  it("grows left under ink near the left edge, in the same undo step, and notes the shift", () => {
    const { surface, doc, history } = boardSurface();
    const add = new AddStrokeToPage("p1", stroke("s1", 100, SIDE / 2));
    history.push(doc, add);
    run(surface, "growBoard");
    expect(doc.pages[0].geometry.width).toBe(SIDE + BOARD_BLOCK);
    expect(doc.pages[0].strokes[0].pts[0]).toBe(100 + BOARD_BLOCK);
    expect(surface.boardShift).toEqual({ x: BOARD_BLOCK, y: 0 });
    expect(history.isLatest(add)).toBe(true);
    // The layout no longer matches the page: the surface lays it out again.
    expect(run(surface, "layoutStale")).toBe(true);
    history.undo(doc);
    expect(doc.pages[0].geometry.width).toBe(SIDE);
    expect(surface.boardShift).toEqual({ x: 0, y: 0 });
  });

  it("never grows again for a step it looked at, nor after an undo", () => {
    const { surface, doc, history } = boardSurface();
    history.push(doc, new AddStrokeToPage("p1", stroke("s1", SIDE / 2, SIDE / 2)));
    run(surface, "growBoard");
    history.push(doc, new AddStrokeToPage("p1", stroke("s2", 50, SIDE / 2)));
    run(surface, "growBoard");
    const grown = JSON.stringify(doc);
    run(surface, "growBoard");
    expect(JSON.stringify(doc)).toBe(grown);
    history.undo(doc);
    run(surface, "growBoard");
    expect(doc.pages[0].geometry.width).toBe(SIDE);
  });

  it("measures a screen at the zoom now: at 5x it reaches a fifth as far", () => {
    const near = SIDE - 400;
    const atFit = boardSurface();
    atFit.history.push(atFit.doc, new AddStrokeToPage("p1", stroke("s1", near, SIDE / 2)));
    run(atFit.surface, "growBoard");
    expect(atFit.doc.pages[0].geometry.width).toBe(SIDE + BOARD_BLOCK);

    const zoomed = boardSurface();
    zoomed.surface.userZoom = 5;
    zoomed.history.push(zoomed.doc, new AddStrokeToPage("p1", stroke("s1", near, SIDE / 2)));
    run(zoomed.surface, "growBoard");
    // 1024 screen px at 5x the writing size is about 264 page px: 400 is further.
    expect(zoomed.doc.pages[0].geometry.width).toBe(SIDE);
  });

  it("holds the view open when an erase made the drawing smaller", () => {
    const { surface, doc, history } = boardSurface();
    history.push(doc, new AddStrokeToPage("p1", stroke("s1", SIDE / 2, SIDE / 2)));
    run(surface, "growBoard");
    expect(surface.boardHold).toBeNull();
    history.undo(doc);
    run(surface, "growBoard");
    expect(surface.boardHold).not.toBeNull();
    run(surface, "releaseBoardHold");
    expect(surface.boardHold).toBeNull();
  });

  it("does nothing on a notebook", () => {
    const { surface, doc, history } = boardSurface();
    surface.board = false;
    history.push(doc, new AddStrokeToPage("p1", stroke("s1", 10, 10)));
    run(surface, "growBoard");
    expect(doc.pages[0].geometry.width).toBe(SIDE);
  });
});

describe("gesture thresholds on a board", () => {
  it("are screen lengths from the writing size: the same page length at 100%, a fifth at 5x", () => {
    const { surface } = boardSurface();
    expect(run(surface, "atFitZoom", 10)).toBe(10);
    expect(get(surface, "scale")).toBeCloseTo(WRITING_SCALE);
    surface.userZoom = 5;
    expect(run(surface, "atFitZoom", 10)).toBe(2);
  });
});

describe("a file of several boards (discussion #160)", () => {
  function threeBoards(): { surface: State; doc: InkDocument } {
    const { surface, doc } = boardSurface();
    for (const id of ["p2", "p3"]) doc.pages.push({ ...structuredClone(doc.pages[0]), id });
    return { surface, doc };
  }

  it("shows the board it was on through a reorder, by identity", () => {
    const { surface, doc } = threeBoards();
    surface.boardRef = doc.pages[1];
    doc.pages.reverse();
    expect(run(surface, "shownBoard")).toEqual({ page: doc.pages[1], index: 1 });
    doc.pages.push(doc.pages.shift()!);
    expect(run<{ index: number }>(surface, "shownBoard").index).toBe(0);
  });

  it("finds it by id after a reload, and shows a neighbour when it was deleted", () => {
    const { surface, doc } = threeBoards();
    surface.boardRef = { ...doc.pages[2] };
    expect(run<{ index: number }>(surface, "shownBoard").index).toBe(2);
    surface.boardRef = doc.pages[2];
    surface.pageIndex = 2;
    doc.pages.splice(2, 1);
    expect(run(surface, "shownBoard")).toEqual({ page: doc.pages[1], index: 1 });
  });

  it("moves the view with a growth of the board shown, and the spot of another", () => {
    const { surface, doc } = threeBoards();
    surface.boardRef = doc.pages[0];
    const spots = surface.boardSpots as WeakMap<object, unknown>;
    spots.set(doc.pages[2], { x: 10, y: 20, zoom: 2 });
    run(surface, "boardMoved", doc.pages[0], BOARD_BLOCK, 0);
    expect(surface.boardShift).toEqual({ x: BOARD_BLOCK, y: 0 });
    run(surface, "boardMoved", doc.pages[2], 0, -BOARD_BLOCK);
    expect(spots.get(doc.pages[2])).toEqual({ x: 10, y: 20 - BOARD_BLOCK, zoom: 2 });
    expect(surface.boardShift).toEqual({ x: BOARD_BLOCK, y: 0 });
  });

  it("lists the other boards' spots by id, not the one shown", () => {
    const { surface, doc } = threeBoards();
    surface.boardRef = doc.pages[1];
    const spots = surface.boardSpots as WeakMap<object, unknown>;
    spots.set(doc.pages[0], { x: 1, y: 2, zoom: 1 });
    spots.set(doc.pages[1], { x: 3, y: 4, zoom: 1 });
    expect([...run<Map<string, unknown>>(surface, "otherBoardSpots")]).toEqual([
      ["p1", { x: 1, y: 2, zoom: 1 }],
    ]);
    run(surface, "restoreBoardSpots", new Map([["p3", { x: 5, y: 6, zoom: 3 }]]));
    expect(spots.get(doc.pages[2])).toEqual({ x: 5, y: 6, zoom: 3 });
  });

  it("lays the layout out again when boards were reordered", () => {
    const { surface, doc } = threeBoards();
    surface.pageLayout = layoutBoards(doc.pages, 0);
    expect(run(surface, "layoutStale")).toBe(false);
    doc.pages.reverse();
    expect(run(surface, "layoutStale")).toBe(true);
  });
});

describe("a board among a notebook's pages (discussion #160)", () => {
  function notebook(): { surface: State; doc: InkDocument } {
    const { surface } = boardSurface();
    const doc = buildNewDocument(DEFAULT_NOTEBOOK_CHOICES, "Physics");
    doc.pages.splice(1, 0, newBoardPage("p9", doc.pages[0], true));
    Object.assign(surface, { doc, board: false });
    return { surface, doc };
  }

  it("shows the board when the board wanted is one of the notebook's boards", () => {
    const { surface, doc } = notebook();
    expect(run(surface, "showsBoardPage")).toBe(false);
    surface.boardRef = doc.pages[1];
    expect(run(surface, "showsBoardPage")).toBe(true);
    // By id after a reload, and no longer once it is deleted.
    surface.boardRef = { ...doc.pages[1] };
    expect(run(surface, "showsBoardPage")).toBe(true);
    doc.pages.splice(1, 1);
    expect(run(surface, "showsBoardPage")).toBe(false);
  });

  it("never for an ordinary page, nor in a board file", () => {
    const { surface, doc } = notebook();
    surface.boardRef = doc.pages[0];
    expect(run(surface, "showsBoardPage")).toBe(false);
    const { surface: file, doc: boards } = boardSurface();
    file.boardRef = boards.pages[0];
    expect(run(file, "showsBoardPage")).toBe(false);
  });
});

describe("paging past a board among the pages (discussion #160)", () => {
  it("steps over boards in a notebook, and from board to board in a board file", () => {
    const { surface } = boardSurface();
    const doc = buildNewDocument(DEFAULT_NOTEBOOK_CHOICES, "Physics");
    doc.pages.splice(1);
    doc.pages.push({ ...structuredClone(doc.pages[0]), id: "p8", board: true });
    doc.pages.push({ ...structuredClone(doc.pages[0]), id: "p9" });
    Object.assign(surface, { doc, pageIndex: 0 });
    expect(run(surface, "pageStep", 1)).toBe(2);
    surface.pageIndex = 2;
    expect(run(surface, "pageStep", -1)).toBe(0);
    expect(run(surface, "pageStep", 1)).toBe(2);
    const { surface: file } = boardSurface();
    Object.assign(file, { pageIndex: 0 });
    expect(run(file, "pageStep", 1)).toBe(1);
  });
});
