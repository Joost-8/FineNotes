/**
 * `src/model/format-painter.ts` — what the format painter carries, how it
 * lands on ink and shapes, and one undo step per sweep.
 */

import { describe, expect, it } from "vitest";
import {
  PaintStyle,
  dominantInkStyle,
  inkStyleOf,
  paintInkStyle,
} from "../../src/model/format-painter";
import { type InkDocument, type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { fillOf } from "../../src/model/shape-style";

function stroke(id: string, extra: Partial<Stroke> = {}): Stroke {
  return {
    id,
    color: "#000000",
    size: 2,
    tool: "pen",
    pts: [1.5, 2.25, 0.5, 10.75, 20.5, 0.6, 30, 5, 0.4],
    ...extra,
  };
}

const rect = (id: string, extra: Partial<Stroke> = {}): Stroke =>
  stroke(id, {
    shape: "rect",
    pts: [0, 0, 0.5, 50, 0, 0.5, 50, 30, 0.5, 0, 30, 0.5, 0, 0, 0.5],
    ...extra,
  });

const snap = (doc: InkDocument): string => JSON.stringify(doc);

function docWith(...pages: Stroke[][]): InkDocument {
  const doc = emptyDocument();
  doc.pages = pages.map((strokes, i) => ({ ...blankPage(`p${i + 1}`), strokes }));
  return doc;
}

describe("inkStyleOf", () => {
  it("carries a handwriting stroke's colour, width, pen and nib, not its points", () => {
    const style = inkStyleOf(stroke("a", { color: "#ff0000", size: 4, nib: 30, t0: 5 }));
    expect(style).toEqual({ color: "#ff0000", size: 4, tool: "pen", nib: 30 });
  });

  it("carries a shape's line style, and fill and corners where its kind has them", () => {
    expect(inkStyleOf(rect("r", { dash: "dot", fill: "#ff00004d", radius: 14 })).shape).toEqual({
      dash: "dot",
      fill: "#ff00004d",
      radius: 14,
    });
    // A plain rect says so: painting it makes the target solid, unfilled, square.
    expect(inkStyleOf(rect("r")).shape).toEqual({ dash: null, fill: null, radius: null });
    // A line has no inside and no corners; its heads are never carried.
    const line = stroke("l", { shape: "line", heads: { end: "filled" }, dash: "dash" });
    expect(inkStyleOf(line).shape).toEqual({ dash: "dash" });
  });
});

describe("dominantInkStyle", () => {
  it("takes the look most strokes share, the first on a tie", () => {
    const red = (id: string): Stroke => stroke(id, { color: "#ff0000" });
    expect(dominantInkStyle([stroke("a"), red("b"), red("c")])?.color).toBe("#ff0000");
    expect(dominantInkStyle([stroke("a"), red("b")])?.color).toBe("#000000");
    expect(dominantInkStyle([])).toBeNull();
  });
});

describe("paintInkStyle", () => {
  it("lays colour, width and pen on handwriting and leaves its points alone", () => {
    const target = stroke("t", { nib: 45, t0: 9 });
    const pts = target.pts;
    const changed = paintInkStyle(target, { color: "#00ff00", size: 20, tool: "highlighter" });
    expect(changed).toBe(true);
    expect(target).toMatchObject({ color: "#00ff00", size: 20, tool: "highlighter", t0: 9 });
    expect(target.nib).toBeUndefined();
    expect(target.pts).toBe(pts);
  });

  it("says when nothing changed", () => {
    const target = stroke("t");
    expect(paintInkStyle(target, inkStyleOf(stroke("s")))).toBe(false);
  });

  it("gives a shape the source shape's line, fill and corners where it takes them", () => {
    const source = rect("s", { color: "#ff0000", dash: "dash", fill: "#ff0000", radius: 14 });
    const circle = stroke("c", { shape: "circle" });
    paintInkStyle(circle, inkStyleOf(source));
    // A circle fills, but has no corners.
    expect(circle).toMatchObject({ color: "#ff0000", dash: "dash", fill: "#ff0000" });
    expect(circle.radius).toBeUndefined();
    const line = stroke("l", { shape: "line" });
    paintInkStyle(line, inkStyleOf(source));
    expect(line.fill).toBeUndefined();
    expect(line.dash).toBe("dash");
  });

  it("clears a fill and a dash when the source shape has none", () => {
    const target = rect("t", { fill: "#123456", dash: "dot", radius: 14 });
    paintInkStyle(target, inkStyleOf(rect("s", { color: "#ff0000" })));
    expect(target.fill).toBeUndefined();
    expect(target.dash).toBeUndefined();
    expect(target.radius).toBeUndefined();
  });

  it("keeps an arrow an arrow", () => {
    const arrow = stroke("a", { shape: "arrow" });
    const pts = arrow.pts;
    paintInkStyle(arrow, inkStyleOf(stroke("l", { shape: "line", heads: { start: "open" } })));
    expect(arrow.shape).toBe("arrow");
    expect(arrow.heads).toBeUndefined();
    expect(arrow.pts).toBe(pts);
  });

  it("from handwriting, a shape keeps its line style, and a fill of its own colour follows", () => {
    const tinted = rect("t", { color: "#0000ff", dash: "dot", fill: fillOf("#0000ff", "soft") });
    paintInkStyle(tinted, { color: "#ff0000", size: 3, tool: "pen" });
    expect(tinted.dash).toBe("dot");
    expect(tinted.fill).toBe(fillOf("#ff0000", "soft"));
    const solid = rect("u", { color: "#0000ff", fill: "#0000ff" });
    paintInkStyle(solid, { color: "#ff0000", size: 3, tool: "pen" });
    expect(solid.fill).toBe("#ff0000");
    // A fill of another colour is the user's own choice: it stays.
    const other = rect("v", { color: "#0000ff", fill: "#00ff00" });
    paintInkStyle(other, { color: "#ff0000", size: 3, tool: "pen", nib: 30 });
    expect(other.fill).toBe("#00ff00");
    // A shape is drawn at one width: no nib.
    expect(other.nib).toBeUndefined();
  });
});

describe("PaintStyle", () => {
  it("is one undo step that restores every painted stroke exactly, and redoes", () => {
    const a = stroke("a", { nib: 20 });
    const b = rect("b", { fill: "#123456", radius: 14 });
    const c = stroke("c");
    const doc = docWith([a, b], [c]);
    const before = snap(doc);
    const source = rect("s", { color: "#ff0000", size: 5, dash: "dash" });
    const command = new PaintStyle(inkStyleOf(source));
    // Live, as the sweep reaches them.
    expect(command.paint(doc, "p1", a)).toBe(true);
    expect(command.paint(doc, "p1", a)).toBe(false);
    expect(command.paint(doc, "p1", b)).toBe(true);
    expect(command.paint(doc, "p2", c)).toBe(true);
    expect(command.pageIds).toEqual(["p1", "p2"]);
    expect(command.pageId).toBeUndefined();
    const painted = snap(doc);
    // The lift: take the live paint back and push it as one step.
    command.invert(doc);
    expect(snap(doc)).toBe(before);
    const history = new History();
    history.push(doc, command);
    expect(snap(doc)).toBe(painted);
    history.undo(doc);
    expect(snap(doc)).toBe(before);
    history.redo(doc);
    expect(snap(doc)).toBe(painted);
    expect(history.canUndo()).toBe(true);
    history.undo(doc);
    expect(history.canUndo()).toBe(false);
  });

  it("keeps nothing for a stroke already in the style, or not on the page named", () => {
    const a = stroke("a");
    const doc = docWith([a]);
    const command = new PaintStyle(inkStyleOf(stroke("s")));
    expect(command.paint(doc, "p1", a)).toBe(false);
    expect(command.paint(doc, "p1", stroke("stray"))).toBe(false);
    expect(command.changed).toBe(false);
    expect(command.pageId).toBeUndefined();
  });

  it("names its one page, and skips a stroke removed before a redo", () => {
    const a = stroke("a");
    const b = stroke("b");
    const doc = docWith([a, b]);
    const command = new PaintStyle({ color: "#ff0000", size: 3, tool: "pen" });
    command.paint(doc, "p1", a);
    command.paint(doc, "p1", b);
    expect(command.pageId).toBe("p1");
    expect(command.strokes).toEqual([a, b]);
    command.invert(doc);
    doc.pages[0].strokes = [b];
    command.apply(doc);
    expect(a.color).toBe("#000000");
    expect(b.color).toBe("#ff0000");
  });

  it("paints a highlighter look that survives a save", () => {
    const a = stroke("a");
    const doc = docWith([a]);
    const command = new PaintStyle({ color: "#ffd400", size: 18, tool: "highlighter" });
    command.paint(doc, "p1", a);
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].strokes[0]).toMatchObject({
      color: "#ffd400",
      size: 18,
      tool: "highlighter",
    });
  });
});
