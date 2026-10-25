/**
 * `src/view/ink-surface.ts` on an endless board (FineNotes#46): the growth
 * after an edit (`growBoard`), the layout it asks for (`layoutStale`), and
 * gesture thresholds at the writing size and zoomed in 5x. Built from the
 * class's prototype with only the state the code reads, as in
 * `ink-surface.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import { BOARD_BLOCK, BOARD_START_BLOCKS } from "../../src/model/board";
import type { InkDocument, Stroke } from "../../src/model/document";
import { History } from "../../src/model/history";
import { DEFAULT_NOTEBOOK_CHOICES, buildNewDocument } from "../../src/model/new-notebook";
import { AddStrokeToPage } from "../../src/model/page-commands";
import { WRITING_SCALE } from "../../src/model/units";
import { layoutBoard } from "../../src/canvas/page-layout";

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
