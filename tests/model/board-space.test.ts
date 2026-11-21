/**
 * `src/model/board-space.ts` — insert space on an endless board (discussion
 * #276): what moves, how far, closing up never over ink, and one undo that
 * restores a `JSON.stringify`-identical document (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import { BOARD_BLOCK, BOARD_MAX_BLOCKS } from "../../src/model/board";
import { BOARD_SPACE_STEP, boardSpaceStrip, planBoardSpace } from "../../src/model/board-space";
import type { InkDocument, Stroke } from "../../src/model/document";
import { History } from "../../src/model/history";
import { DEFAULT_NOTEBOOK_CHOICES, buildNewDocument } from "../../src/model/new-notebook";

const STEP = BOARD_SPACE_STEP;
const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

function stroke(id: string, x: number, y: number, extra: Partial<Stroke> = {}): Stroke {
  return {
    id,
    color: "#000",
    size: 4,
    tool: "pen",
    pts: [x, y, 0.5, x + 100, y + 20, 0.5],
    ...extra,
  };
}

/** A board with one of every kind of thing, above and below y = 1000. */
function mindMap(): InkDocument {
  const doc = buildNewDocument(
    { ...DEFAULT_NOTEBOOK_CHOICES, type: "endless", boardRuling: "dotted" },
    "Map",
  );
  const page = doc.pages[0];
  page.strokes.push(stroke("above", 100, 800), stroke("below", 100, 1200));
  page.images.push(
    { id: "pic", path: "a.png", x: 300, y: 1300, w: 100, h: 50 },
    { id: "locked", path: "b.png", x: 500, y: 1300, w: 100, h: 50, locked: true },
    { id: "note", path: "", x: 700, y: 1400, w: 240, h: 240, sticky: { color: "#fde68a" } },
  );
  page.strokes.push(stroke("noteInk", 720, 1420, { onSticky: "note" }));
  page.textBoxes.push(
    { id: "t1", x: 100, y: 1500, w: 120, text: "Hi", color: "#000", fontSize: 20 },
    {
      id: "noteText",
      x: 712,
      y: 1450,
      w: 200,
      text: "on note",
      color: "#000",
      fontSize: 16,
      onSticky: "note",
    },
  );
  page.tables = [
    {
      id: "g1",
      x: 100,
      y: 1700,
      cols: [50, 50],
      rows: [30],
      cells: [["", ""]],
      color: "#000",
      size: 1,
      textColor: "#000",
      fontSize: 16,
    },
  ];
  page.equations = [{ id: "e1", x: 100, y: 1800, w: 80, h: 30, latex: "x^2" } as never];
  page.comments = [{ id: "cm1", x: 100, y: 1900, text: "c", author: "you", created: 1 }];
  page.sections = [{ id: "c1", x: 100, y: 2000, title: "Heading" }];
  page.regions = [{ id: "r1", name: "Part", x: 100, y: 2100, w: 200, h: 100 }];
  return doc;
}

const ys = (doc: InkDocument) => {
  const page = doc.pages[0];
  return {
    above: page.strokes.find((s) => s.id === "above")?.pts[1],
    below: page.strokes.find((s) => s.id === "below")?.pts[1],
    noteInk: page.strokes.find((s) => s.id === "noteInk")?.pts[1],
    pic: page.images.find((i) => i.id === "pic")?.y,
    locked: page.images.find((i) => i.id === "locked")?.y,
    note: page.images.find((i) => i.id === "note")?.y,
    t1: page.textBoxes.find((b) => b.id === "t1")?.y,
    noteText: page.textBoxes.find((b) => b.id === "noteText")?.y,
    table: page.tables?.[0].y,
    equation: page.equations?.[0].y,
    comment: page.comments?.[0].y,
    section: page.sections?.[0].y,
    region: page.regions?.[0].y,
  };
};

describe("planBoardSpace", () => {
  it("pushes everything starting below the line down, every kind, a note with its ink and text", () => {
    const doc = mindMap();
    const before = ys(doc);
    const plan = planBoardSpace(doc.pages[0], "y", 1000, 3 * STEP + 10, STEP);
    expect(plan.amount).toBe(3 * STEP);
    // below, pic, note, t1, table, equation, comment, section, region (the locked picture stays).
    expect(plan.moved).toBe(9);
    new History().push(doc, plan.command!);
    const after = ys(doc);
    const d = 3 * STEP;
    expect(after).toEqual({
      ...before,
      below: before.below! + d,
      noteInk: before.noteInk! + d,
      pic: before.pic! + d,
      note: before.note! + d,
      t1: before.t1! + d,
      noteText: before.noteText! + d,
      table: before.table! + d,
      equation: before.equation! + d,
      comment: before.comment! + d,
      section: before.section! + d,
      region: before.region! + d,
    });
  });

  it("undoes to the identical document, and redoes", () => {
    const doc = mindMap();
    const start = snapshot(doc);
    const history = new History();
    history.push(doc, planBoardSpace(doc.pages[0], "y", 1000, 2 * STEP, STEP).command!);
    const pushed = snapshot(doc);
    history.undo(doc);
    expect(snapshot(doc)).toBe(start);
    history.redo(doc);
    expect(snapshot(doc)).toBe(pushed);
  });

  it("pushes right along x, leaving what starts left of the line", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    const plan = planBoardSpace(page, "x", 650, 2 * STEP, STEP);
    new History().push(doc, plan.command!);
    expect(page.images.find((i) => i.id === "pic")?.x).toBe(300);
    expect(page.images.find((i) => i.id === "note")?.x).toBe(700 + 2 * STEP);
    expect(page.strokes.find((s) => s.id === "noteInk")?.pts[0]).toBe(720 + 2 * STEP);
    expect(page.strokes.find((s) => s.id === "below")?.pts[0]).toBe(100);
    expect(page.strokes.find((s) => s.id === "below")?.pts[1]).toBe(1200);
  });

  it("leaves something that starts above the line where it is, however far down it reaches", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    page.strokes.push({
      id: "long",
      color: "#000",
      size: 4,
      tool: "pen",
      pts: [50, 900, 0.5, 50, 3000, 0.5],
    });
    new History().push(doc, planBoardSpace(page, "y", 1000, STEP, STEP).command!);
    expect(page.strokes.find((s) => s.id === "long")?.pts).toEqual([50, 900, 0.5, 50, 3000, 0.5]);
  });

  it("does nothing for less than a step, nothing below, or bad input", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    expect(planBoardSpace(page, "y", 1000, STEP - 1, STEP).command).toBeNull();
    expect(planBoardSpace(page, "y", 99999, 5 * STEP, STEP)).toEqual({
      command: null,
      amount: 0,
      moved: 0,
    });
    expect(planBoardSpace(page, "y", 1000, 5 * STEP, 0).command).toBeNull();
    expect(planBoardSpace(page, "y", Number.NaN, 5 * STEP, STEP).command).toBeNull();
  });

  it("closes up only the empty space just above the line, never over ink", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    // "above" reaches y = 822 (820 + half its width): 178 px empty to 1000, four whole steps.
    const plan = planBoardSpace(page, "y", 1000, -10 * STEP, STEP);
    expect(plan.amount).toBe(-4 * STEP);
    new History().push(doc, plan.command!);
    expect(page.strokes.find((s) => s.id === "below")?.pts[1]).toBe(1200 - 4 * STEP);
    expect(plan.command!.label).toBe("Remove space");
  });

  it("closes nothing where something above reaches past the line", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    page.strokes.push({
      id: "long",
      color: "#000",
      size: 4,
      tool: "pen",
      pts: [50, 900, 0.5, 50, 1100, 0.5],
    });
    expect(planBoardSpace(page, "y", 1000, -2 * STEP, STEP).command).toBeNull();
  });

  it("closes up to the board's edge when nothing is above, and never past it", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    page.strokes = page.strokes.filter((s) => s.id !== "above");
    const plan = planBoardSpace(page, "y", 1000, -100 * STEP, STEP);
    expect(plan.amount).toBe(-Math.floor(1000 / STEP) * STEP);
  });

  it("never pushes anything past the largest board", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    const max = BOARD_BLOCK * BOARD_MAX_BLOCKS;
    const plan = planBoardSpace(page, "y", 1000, max, STEP);
    expect(plan.amount).toBeGreaterThan(0);
    new History().push(doc, plan.command!);
    expect(page.regions![0].y + page.regions![0].h).toBeLessThanOrEqual(max);
    expect(planBoardSpace(page, "y", 1000, STEP, STEP).command).toBeNull();
  });

  it("never pushes anything past a notebook page's edge when given one", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    // The region reaches 2200; with the edge at 2300, two whole steps of 40 fit.
    expect(planBoardSpace(page, "y", 1000, 10 * STEP, STEP, undefined, 2300).amount).toBe(2 * STEP);
    expect(planBoardSpace(page, "y", 1000, 10 * STEP, STEP, undefined, 2210).command).toBeNull();
  });

  it("measures self-sizing text with the height it is given", () => {
    const doc = mindMap();
    const page = doc.pages[0];
    page.textBoxes = [{ id: "t", x: 100, y: 900, w: 100, text: "x", color: "#000", fontSize: 20 }];
    page.strokes = [stroke("s", 100, 1200)];
    page.images = [];
    page.tables = [];
    page.equations = [];
    page.comments = [];
    page.sections = [];
    page.regions = [];
    // Measured 50 tall, the box ends at 950: one step of 40 is empty to 1000.
    expect(planBoardSpace(page, "y", 1000, -5 * STEP, STEP, () => 50).amount).toBe(-STEP);
  });
});

describe("a straight line or arrow across the line", () => {
  function branch(): InkDocument {
    const doc = mindMap();
    const page = doc.pages[0];
    page.strokes.push({
      id: "arrow",
      color: "#000",
      size: 2,
      tool: "pen",
      shape: "arrow",
      pts: [400, 900, 0.5, 400, 1100, 0.5],
    });
    page.strokes.push({
      id: "scrawl",
      color: "#000",
      size: 2,
      tool: "pen",
      pts: [600, 900, 0.5, 600, 1100, 0.5],
    });
    return doc;
  }
  const pts = (doc: InkDocument, id: string) => doc.pages[0].strokes.find((s) => s.id === id)?.pts;

  it("stretches: its end past the line moves, the other stays; handwriting across it stays", () => {
    const doc = branch();
    const start = snapshot(doc);
    const history = new History();
    history.push(doc, planBoardSpace(doc.pages[0], "y", 1000, 2 * STEP, STEP).command!);
    expect(pts(doc, "arrow")).toEqual([400, 900, 0.5, 400, 1100 + 2 * STEP, 0.5]);
    expect(pts(doc, "scrawl")).toEqual([600, 900, 0.5, 600, 1100, 0.5]);
    history.undo(doc);
    expect(snapshot(doc)).toBe(start);
  });

  it("shrinks when space is closed up, never past its near end", () => {
    const doc = branch();
    const page = doc.pages[0];
    page.strokes = page.strokes.filter((s) => s.id !== "scrawl" && s.id !== "above");
    // Its near end at 900 (901 with its width): 99 px to the line, two steps.
    const plan = planBoardSpace(page, "y", 1000, -5 * STEP, STEP);
    expect(plan.amount).toBe(-2 * STEP);
    new History().push(doc, plan.command!);
    expect(pts(doc, "arrow")).toEqual([400, 900, 0.5, 400, 1100 - 2 * STEP, 0.5]);
  });
});

describe("boardSpaceStrip", () => {
  it("is the band opened or closed, the whole board across", () => {
    expect(boardSpaceStrip("y", 1000, 80, 5000, 6000)).toEqual({
      minX: 0,
      maxX: 5000,
      minY: 1000,
      maxY: 1080,
    });
    expect(boardSpaceStrip("y", 1000, -80, 5000, 6000)).toEqual({
      minX: 0,
      maxX: 5000,
      minY: 920,
      maxY: 1000,
    });
    expect(boardSpaceStrip("x", 300, 40, 5000, 6000)).toEqual({
      minX: 300,
      maxX: 340,
      minY: 0,
      maxY: 6000,
    });
  });
});
