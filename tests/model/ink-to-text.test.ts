/**
 * Turn into › Text (`src/model/ink-to-text.ts`, FineNotes#42): the box that
 * replaces lassoed ink, and the command whose undo brings the ink back.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import {
  MAX_INK_TEXT_SIZE,
  TurnInkIntoText,
  inkTextBox,
  inkTextLines,
  sharedInkColor,
} from "../../src/model/ink-to-text";
import { History } from "../../src/model/history";
import { MIN_TEXT_BOX_WIDTH, MIN_TEXT_SIZE } from "../../src/model/text-style";

function stroke(id: string, color = "#1e3a8a"): Stroke {
  return { id, color, size: 2, tool: "pen", pts: [0, 0, 0.5, 10, 0, 0.5] };
}

function notebook(): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].strokes = ["s1", "s2", "s3", "s4"].map((id) => stroke(id));
  return doc;
}

const style = { color: "#000000", fontSize: 22 };
const bounds = { minX: 100, minY: 200, maxX: 300, maxY: 240 };

describe("inkTextLines", () => {
  it("trims each line and drops the blank ones", () => {
    expect(inkTextLines("  Buy   milk \n\n eggs\r\n  ")).toEqual(["Buy milk", "eggs"]);
    expect(inkTextLines(" \n ")).toEqual([]);
  });
});

describe("inkTextBox", () => {
  it("puts one line where the ink began, as tall as the writing, fitting its text", () => {
    const box = inkTextBox({ id: "t1", bounds, text: " hello ", style, pageWidth: 800 });
    expect(box).toEqual({
      id: "t1",
      x: 100,
      y: 200,
      w: 200,
      fit: true,
      text: "hello",
      color: "#000000",
      // One line, 40 px of writing: an em of 40.
      fontSize: 40,
    });
  });

  it("sizes the font by the written lines the line finder saw, not the bounds", () => {
    // A tall selection (a drawing beside the words) whose writing is 36 px a line.
    const tall = { ...bounds, maxY: 600 };
    const one = inkTextBox({
      id: "t1",
      bounds: tall,
      text: "hello",
      style,
      written: { count: 1, height: 36 },
      pageWidth: 800,
    });
    expect(one).toMatchObject({ fontSize: 36, fit: true });
    // Two written lines keep the ink's width, though the text is one line.
    const two = inkTextBox({
      id: "t1",
      bounds: tall,
      text: "hello world",
      style,
      written: { count: 2, height: 30 },
      pageWidth: 800,
    });
    expect(two?.fit).toBeUndefined();
    expect(two?.fontSize).toBe(30);
    // No lines found: the bounds again.
    const none = inkTextBox({
      id: "t1",
      bounds,
      text: "hi",
      style,
      written: { count: 0, height: 0 },
      pageWidth: 800,
    });
    expect(none?.fontSize).toBe(40);
  });

  it("shares the ink's height among the text's lines and the spacing between them", () => {
    const tall = { ...bounds, maxY: 290 };
    const box = inkTextBox({ id: "t1", bounds: tall, text: "one\ntwo", style, pageWidth: 800 });
    expect(box?.fit).toBeUndefined();
    expect(box?.w).toBe(200);
    expect(box?.text).toBe("one\ntwo");
    // 90 px = 2 em + 0.25 em between.
    expect(box?.fontSize).toBe(40);
  });

  it("never starts bigger than the size list's top: bigger ink is a drawing", () => {
    const huge = { ...bounds, maxY: 1200 };
    const box = inkTextBox({ id: "t1", bounds: huge, text: "x", style, pageWidth: 800 });
    expect(box?.fontSize).toBe(MAX_INK_TEXT_SIZE);
  });

  it("takes the ink's colour and the rest of the Text tool's style", () => {
    const tall = { ...bounds, maxY: 300 };
    const box = inkTextBox({
      id: "t1",
      bounds: tall,
      text: "hi\nyou",
      style: { ...style, lineHeight: 1.5, bold: true },
      inkColor: "#dc2626",
      pageWidth: 800,
    });
    // 100 px = 2 em + 0.5 em between.
    expect(box).toMatchObject({ color: "#dc2626", fontSize: 40, lineHeight: 1.5, bold: true });
  });

  it("stays on the page and never below the smallest size or width a box keeps", () => {
    const dot = { minX: 790, minY: -5, maxX: 795, maxY: -3 };
    const box = inkTextBox({ id: "t1", bounds: dot, text: "x", style, pageWidth: 800 });
    expect(box).toMatchObject({ x: 800 - MIN_TEXT_BOX_WIDTH, y: 0, w: MIN_TEXT_BOX_WIDTH });
    expect(box?.fontSize).toBe(MIN_TEXT_SIZE);
  });

  it("makes no box of blank text", () => {
    expect(inkTextBox({ id: "t1", bounds, text: "  \n", style, pageWidth: 800 })).toBeNull();
  });
});

describe("sharedInkColor", () => {
  it("is the colour every stroke has, else null", () => {
    expect(sharedInkColor([stroke("a"), stroke("b")])).toBe("#1e3a8a");
    expect(sharedInkColor([stroke("a"), stroke("b", "#ff0000")])).toBeNull();
    expect(sharedInkColor([])).toBeNull();
  });
});

describe("TurnInkIntoText", () => {
  function setUp() {
    const doc = notebook();
    const page = doc.pages[0];
    const chosen = [page.strokes[1], page.strokes[3]];
    const box = inkTextBox({ id: "t1", bounds, text: "hi", style, pageWidth: 800 })!;
    return { doc, page, chosen, box };
  }

  it("replaces the ink with the box, and undo and redo round-trip exactly", () => {
    const { doc, page, chosen, box } = setUp();
    const before = JSON.stringify(doc);
    const history = new History();
    const command = new TurnInkIntoText(page, chosen, box);
    history.push(doc, command);
    expect(command.applied).toBe(true);
    expect(command.pageId).toBe(page.id);
    expect(page.strokes.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(page.textBoxes).toEqual([box]);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
    // The same stroke objects come back, not copies.
    expect(page.strokes[1]).toBe(chosen[0]);
    history.redo(doc);
    expect(page.strokes.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(page.textBoxes[0]).toBe(box);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("restores exactly its own strokes when another stroke repeats an id", () => {
    const { doc, page, chosen, box } = setUp();
    // A merged note can repeat an id: the twin must stay put.
    const twin = stroke("s2");
    page.strokes.push(twin);
    const command = new TurnInkIntoText(page, chosen, box);
    command.apply(doc);
    expect(page.strokes).toContain(twin);
    expect(page.strokes).not.toContain(chosen[0]);
    command.invert(doc);
    expect(page.strokes.filter((s) => s.id === "s2")).toEqual([chosen[0], twin]);
    expect(page.strokes.indexOf(chosen[0])).toBe(1);
  });

  it("takes away only its own box on undo, though another has the same id", () => {
    const { doc, page, chosen, box } = setUp();
    const other = { ...box };
    page.textBoxes.push(other);
    const command = new TurnInkIntoText(page, chosen, box);
    command.apply(doc);
    command.invert(doc);
    expect(page.textBoxes).toEqual([other]);
    expect(page.textBoxes[0]).toBe(other);
  });

  it("changes nothing when the ink is gone, or its page is", () => {
    const { doc, page, chosen, box } = setUp();
    page.strokes = page.strokes.filter((s) => !chosen.includes(s));
    const gone = new TurnInkIntoText(page, chosen, box);
    gone.apply(doc);
    expect(gone.applied).toBe(false);
    expect(page.textBoxes).toEqual([]);
    gone.invert(doc);
    expect(page.textBoxes).toEqual([]);

    const fresh = setUp();
    const away = new TurnInkIntoText(fresh.page, fresh.chosen, fresh.box);
    fresh.doc.pages = [];
    away.apply(fresh.doc);
    expect(away.applied).toBe(false);
    expect(fresh.page.strokes).toHaveLength(4);
  });
});
