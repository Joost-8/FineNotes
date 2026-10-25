/**
 * `src/model/board.ts` — Endless boards (FineNotes#46): the growth rule, the
 * grow-and-shift command, its place in the undo history, and the file
 * format. Every command must undo to a `JSON.stringify`-identical document
 * (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import {
  BOARD_BLOCK,
  BOARD_MAX_BLOCKS,
  BOARD_START_BLOCKS,
  GrowBoard,
  boardGrowth,
  boardStartGeometry,
  drawnBounds,
  isBoard,
  isNoGrowth,
} from "../../src/model/board";
import { type InkDocument, type Page, type Stroke } from "../../src/model/document";
import { AttachedStep, History } from "../../src/model/history";
import {
  DEFAULT_NOTEBOOK_CHOICES,
  buildNewDocument,
  defaultTitle,
  notebookPaths,
  parseNotebookChoices,
} from "../../src/model/new-notebook";
import { AddStrokeToPage } from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

const board = (ruling: "blank" | "dotted" | "squared" | "ruled-wide" = "dotted"): InkDocument =>
  buildNewDocument({ ...DEFAULT_NOTEBOOK_CHOICES, type: "endless", ruling }, "Mind map");

function stroke(id: string, pts: number[], size = 4): Stroke {
  return { id, color: "#000000", size, tool: "pen", pts };
}

/** A board with one of every kind of element, at known places. */
function fullBoard(): InkDocument {
  const doc = board();
  const page = doc.pages[0];
  page.strokes.push(stroke("s1", [100, 200, 0.5, 300, 400, 0.5]));
  page.images.push({ id: "i1", path: "a.png", x: 500, y: 600, w: 100, h: 50 });
  page.textBoxes.push({
    id: "t1",
    x: 700,
    y: 800,
    w: 120,
    text: "Hi",
    color: "#000",
    fontSize: 20,
  });
  page.tables = [
    {
      id: "g1",
      x: 900,
      y: 1000,
      cols: [50, 50],
      rows: [30],
      cells: [["", ""]],
      color: "#000",
      size: 1,
      textColor: "#000",
      fontSize: 16,
    },
  ];
  page.comments = [{ id: "cm1", x: 1100, y: 1200, text: "note", author: "you", created: 1 }];
  page.sections = [{ id: "c1", x: 1300, y: 1400, title: "Heading" }];
  return doc;
}

describe("a new board", () => {
  it("is one large page of white paper, flagged endless and single", () => {
    const doc = board("squared");
    expect(doc.pages).toHaveLength(1);
    const side = BOARD_BLOCK * BOARD_START_BLOCKS;
    expect(doc.pages[0].geometry).toEqual({ width: side, height: side });
    expect(boardStartGeometry()).toEqual({ width: side, height: side });
    expect(doc.pages[0].backdrop).toEqual({ kind: "squared" });
    expect(doc.endless).toBe(true);
    expect(doc.single).toBe(true);
    expect(isBoard(doc)).toBe(true);
  });

  it("offers blank, dotted and squared only: any other paper reads as blank", () => {
    expect(board("blank").pages[0].backdrop).toEqual({ kind: "blank" });
    expect(board("dotted").pages[0].backdrop).toEqual({ kind: "dotted" });
    expect(board("ruled-wide").pages[0].backdrop).toEqual({ kind: "blank" });
  });

  it("is white whatever paper colour was last picked, and has no cover", () => {
    const doc = buildNewDocument(
      { ...DEFAULT_NOTEBOOK_CHOICES, type: "endless", paper: "yellow", ruling: "dotted" },
      "x",
    );
    expect(doc.pages[0].backdrop.kind).toBe("dotted");
    expect("paperColor" in doc.pages[0].backdrop).toBe(false);
    expect(doc.pages[0].textBoxes).toHaveLength(0);
  });

  it("is a notebook file, named after the board when untitled", () => {
    expect(notebookPaths("", "", "endless", false, new Set()).fileName).toBe(
      "Untitled board.notebook.md",
    );
    expect(defaultTitle("endless")).toBe("Untitled board");
    expect(isBoard(buildNewDocument(DEFAULT_NOTEBOOK_CHOICES, "x"))).toBe(false);
  });

  it("is remembered as the choice for next time", () => {
    expect(parseNotebookChoices({ type: "endless" }).type).toBe("endless");
    expect(parseNotebookChoices({ type: "single" }).type).toBe("notebook");
  });
});

describe("drawnBounds", () => {
  it("is null on an empty page", () => {
    expect(drawnBounds(board().pages[0])).toBeNull();
  });

  it("covers ink by its width, pictures turned, text, tables, graphs and comments", () => {
    const doc = fullBoard();
    const page = doc.pages[0];
    page.graphs = [
      {
        id: "gr1",
        x: 1500,
        y: 1600,
        w: 200,
        h: 100,
        spec: { expressions: [], xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
        colors: [],
      },
    ];
    // Ink from (100, 200) with a 4 px nib: 2 px past the centreline.
    const b = drawnBounds(page);
    expect(b).toEqual({ minX: 98, minY: 198, maxX: 1700, maxY: 1700 });
  });

  it("takes a picture's turned rectangle, and a self-sizing text box's one line", () => {
    const page: Page = board().pages[0];
    page.images.push({ id: "i", path: "a.png", x: 0, y: 0, w: 200, h: 100, rotation: Math.PI / 2 });
    const b = drawnBounds(page);
    // Turned a quarter, 200 x 100 about (100, 50) covers 100 x 200.
    expect(b?.minX).toBeCloseTo(50);
    expect(b?.maxX).toBeCloseTo(150);
    expect(b?.minY).toBeCloseTo(-50);
    expect(b?.maxY).toBeCloseTo(150);
    page.images = [];
    page.textBoxes.push({ id: "t", x: 10, y: 10, w: 50, text: "", color: "#000", fontSize: 20 });
    expect(drawnBounds(page)).toEqual({ minX: 10, minY: 10, maxX: 60, maxY: 35 });
  });

  it("skips coordinates that are not numbers, and a ragged tail", () => {
    const page = board().pages[0];
    page.strokes.push(stroke("s", [Number.NaN, 5, 0.5, 10, 20, 0.5, 99], 0));
    expect(drawnBounds(page)).toEqual({ minX: 10, minY: 20, maxX: 10, maxY: 20 });
  });
});

describe("boardGrowth", () => {
  const geometry = { width: 5600, height: 5600 };
  const reach = { x: 1300, y: 1000 };
  const middle = { minX: 2500, minY: 2500, maxX: 3100, maxY: 3100 };

  it("grows nothing while the drawing is more than a screen from every edge", () => {
    expect(isNoGrowth(boardGrowth(geometry, middle, reach))).toBe(true);
    expect(isNoGrowth(boardGrowth(geometry, null, reach))).toBe(true);
  });

  it("adds one block on a side the drawing came within a screen of", () => {
    expect(boardGrowth(geometry, { ...middle, maxX: 5600 - 1299 }, reach)).toEqual({
      left: 0,
      top: 0,
      right: 1,
      bottom: 0,
    });
    expect(boardGrowth(geometry, { ...middle, minX: 1299, minY: 999 }, reach)).toEqual({
      left: 1,
      top: 1,
      right: 0,
      bottom: 0,
    });
    // Exactly a screen away is far enough.
    expect(isNoGrowth(boardGrowth(geometry, { ...middle, minX: 1300 }, reach))).toBe(true);
  });

  it("adds one block at a time, however wide the screen", () => {
    const far = { x: 20000, y: 20000 };
    expect(boardGrowth(geometry, middle, far)).toEqual({ left: 1, top: 1, right: 1, bottom: 1 });
  });

  it("adds as many blocks as hold ink already past an edge", () => {
    const past = { ...middle, maxX: 5600 + BOARD_BLOCK * 2 + 1, minY: -10 };
    expect(boardGrowth(geometry, past, reach)).toEqual({ left: 0, top: 1, right: 3, bottom: 0 });
  });

  it("stops at the largest board, the far side giving way first", () => {
    const max = BOARD_BLOCK * BOARD_MAX_BLOCKS;
    const full = { width: max, height: max };
    const edges = { minX: 0, minY: 0, maxX: max, maxY: max };
    expect(isNoGrowth(boardGrowth(full, edges, reach))).toBe(true);
    const nearly = { width: max - BOARD_BLOCK, height: max - BOARD_BLOCK };
    expect(
      boardGrowth(nearly, { minX: 0, minY: 0, maxX: nearly.width, maxY: nearly.height }, reach),
    ).toEqual({
      left: 1,
      top: 1,
      right: 0,
      bottom: 0,
    });
  });

  it("reads a reach that is no length as none", () => {
    const edge = { ...middle, maxX: 5600 };
    expect(isNoGrowth(boardGrowth(geometry, edge, { x: Number.NaN, y: -5 }))).toBe(true);
  });
});

describe("GrowBoard", () => {
  it("grows right and down without moving anything", () => {
    const doc = fullBoard();
    const before = snapshot(doc);
    const shifts: Array<[number, number]> = [];
    const grow = new GrowBoard("p1", { left: 0, top: 0, right: 1, bottom: 2 }, (x, y) =>
      shifts.push([x, y]),
    );
    expect(grow.shift).toEqual({ x: 0, y: 0 });
    grow.apply(doc);
    const side = BOARD_BLOCK * BOARD_START_BLOCKS;
    expect(doc.pages[0].geometry).toEqual({
      width: side + BOARD_BLOCK,
      height: side + 2 * BOARD_BLOCK,
    });
    expect(doc.pages[0].strokes[0].pts).toEqual([100, 200, 0.5, 300, 400, 0.5]);
    expect(shifts).toEqual([]);
    grow.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("grows left and up by moving every element, comment and heading, and says so", () => {
    const doc = fullBoard();
    const before = snapshot(doc);
    const shifts: Array<[number, number]> = [];
    const grow = new GrowBoard("p1", { left: 1, top: 2, right: 0, bottom: 0 }, (x, y) =>
      shifts.push([x, y]),
    );
    grow.apply(doc);
    const dx = BOARD_BLOCK;
    const dy = 2 * BOARD_BLOCK;
    const page = doc.pages[0];
    expect(page.strokes[0].pts).toEqual([100 + dx, 200 + dy, 0.5, 300 + dx, 400 + dy, 0.5]);
    expect([page.images[0].x, page.images[0].y]).toEqual([500 + dx, 600 + dy]);
    expect([page.textBoxes[0].x, page.textBoxes[0].y]).toEqual([700 + dx, 800 + dy]);
    expect([page.tables?.[0].x, page.tables?.[0].y]).toEqual([900 + dx, 1000 + dy]);
    expect([page.comments?.[0].x, page.comments?.[0].y]).toEqual([1100 + dx, 1200 + dy]);
    expect([page.sections?.[0].x, page.sections?.[0].y]).toEqual([1300 + dx, 1400 + dy]);
    expect(shifts).toEqual([[dx, dy]]);
    grow.invert(doc);
    expect(snapshot(doc)).toBe(before);
    expect(shifts).toEqual([
      [dx, dy],
      [-dx, -dy],
    ]);
  });

  it("redoes to the same document, and undoes again", () => {
    const doc = fullBoard();
    const before = snapshot(doc);
    const grow = new GrowBoard("p1", { left: 1, top: 1, right: 1, bottom: 1 });
    grow.apply(doc);
    const grown = snapshot(doc);
    grow.invert(doc);
    grow.apply(doc);
    expect(snapshot(doc)).toBe(grown);
    grow.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("does nothing for a page that is not there, and undoes nothing", () => {
    const doc = board();
    const before = snapshot(doc);
    const grow = new GrowBoard("nope", { left: 1, top: 1, right: 0, bottom: 0 });
    grow.apply(doc);
    grow.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });
});

describe("History.attach: the growth joins the edit that set it off", () => {
  it("one undo takes back the stroke and the growth; redo brings both", () => {
    const doc = board();
    const history = new History();
    const before = snapshot(doc);
    const add = new AddStrokeToPage("p1", stroke("s1", [10, 10, 0.5]));
    history.push(doc, add);
    const grow = new GrowBoard("p1", { left: 1, top: 0, right: 0, bottom: 0 });
    expect(history.attach(doc, grow)).toBe(true);
    expect(history.latest).toBeInstanceOf(AttachedStep);
    expect(history.latest?.label).toBe(add.label);
    expect(history.latest?.pageId).toBe("p1");
    expect(doc.pages[0].strokes[0].pts[0]).toBe(10 + BOARD_BLOCK);
    const after = snapshot(doc);
    history.undo(doc);
    expect(snapshot(doc)).toBe(before);
    history.redo(doc);
    expect(snapshot(doc)).toBe(after);
  });

  it("still knows the edit as the newest, and withdraws it with its growth", () => {
    const doc = board();
    const history = new History();
    const before = snapshot(doc);
    const add = new AddStrokeToPage("p1", stroke("s1", [10, 10, 0.5]));
    history.push(doc, add);
    history.attach(doc, new GrowBoard("p1", { left: 0, top: 1, right: 0, bottom: 0 }));
    expect(history.isLatest(add)).toBe(true);
    expect(history.withdraw(doc, add)).toBe(true);
    expect(snapshot(doc)).toBe(before);
    expect(history.canUndo()).toBe(false);
  });

  it("withdraws a tail whose last step grew the board", () => {
    const doc = board();
    const history = new History();
    const before = snapshot(doc);
    const a = new AddStrokeToPage("p1", stroke("a", [10, 10, 0.5]));
    const b = new AddStrokeToPage("p1", stroke("b", [20, 20, 0.5]));
    history.push(doc, a);
    history.push(doc, b);
    history.attach(doc, new GrowBoard("p1", { left: 1, top: 1, right: 0, bottom: 0 }));
    expect(history.withdrawTail(doc, [a, b])).toBe(true);
    expect(snapshot(doc)).toBe(before);
  });

  it("attaches nothing with no step, or with steps to redo", () => {
    const doc = board();
    const history = new History();
    const grow = new GrowBoard("p1", { left: 1, top: 0, right: 0, bottom: 0 });
    expect(history.attach(doc, grow)).toBe(false);
    expect(history.latest).toBeNull();
    history.push(doc, new AddStrokeToPage("p1", stroke("a", [10, 10, 0.5])));
    history.push(doc, new AddStrokeToPage("p1", stroke("b", [20, 20, 0.5])));
    history.undo(doc);
    const before = snapshot(doc);
    expect(history.attach(doc, grow)).toBe(false);
    expect(snapshot(doc)).toBe(before);
  });
});

describe("a board in the file", () => {
  it("saves and loads as a board", () => {
    const doc = fullBoard();
    const loaded = decodeDocument(encodeDocument(doc));
    expect(loaded.endless).toBe(true);
    expect(loaded.single).toBe(true);
    expect(loaded.pages[0].geometry).toEqual(doc.pages[0].geometry);
    expect(encodeDocument(loaded)).toBe(encodeDocument(doc));
  });

  it("opens as a single page in a build that knows no boards", () => {
    // Such a build reads `single` and the page's size, and skips `endless`.
    const loaded = decodeDocument(encodeDocument(board()));
    expect(loaded.single).toBe(true);
    expect(loaded.pages[0].geometry.width).toBe(BOARD_BLOCK * BOARD_START_BLOCKS);
  });

  it("is a notebook again once a page was added to it", () => {
    const doc = board();
    doc.pages.push({ ...doc.pages[0], id: "p2", strokes: [], images: [], textBoxes: [] });
    const loaded = decodeDocument(encodeDocument(doc));
    expect(loaded.endless).toBeUndefined();
    expect(loaded.pages).toHaveLength(2);
  });

  it("is not written for a notebook, so its bytes stay as they were", () => {
    const doc = buildNewDocument(DEFAULT_NOTEBOOK_CHOICES, "x");
    expect("endless" in decodeDocument(encodeDocument(doc))).toBe(false);
  });
});
