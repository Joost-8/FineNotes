/**
 * `src/model/text-highlight.ts` — a highlight snapped to a PDF's text is
 * ordinary highlighter ink in page space: one undo step, and it survives a
 * save and load as it was drawn.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import {
  HIGHLIGHT_TEXT_LABEL,
  highlightBand,
  highlightText,
  isHighlight,
  textHighlightStrokes,
} from "../../src/model/text-highlight";

const EPOCH = Date.UTC(2026, 9, 13, 9, 0, 0);

function ids(): () => string {
  let n = 0;
  return () => `s${++n}`;
}

const RECTS = [
  { x: 100.123, y: 84, w: 190, h: 20 },
  { x: 100, y: 124, w: 140.004, h: 20 },
];

describe("highlightBand", () => {
  it("runs along the middle of the line, as wide as it is tall, set in from each end", () => {
    expect(highlightBand({ x: 100, y: 84, w: 190, h: 20 })).toEqual({
      pts: [106, 94, 0.5, 284, 94, 0.5],
      size: 20,
    });
  });

  it("shrinks to a dot on text narrower than its caps", () => {
    const band = highlightBand({ x: 10, y: 0, w: 4, h: 20 });
    expect(band.pts[0]).toBe(band.pts[3]);
    expect(band.pts[0]).toBe(12);
  });

  it("rounds to hundredths of a page px", () => {
    const band = highlightBand({ x: 0.123456, y: 1.987654, w: 50.5555, h: 10.3333 });
    for (const value of [...band.pts, band.size]) {
      expect(Math.round(value * 100) / 100).toBe(value);
    }
  });
});

describe("textHighlightStrokes", () => {
  it("makes one straight highlighter stroke per line, in the given colour", () => {
    const strokes = textHighlightStrokes(RECTS, "#ffd60a", ids());
    expect(strokes).toHaveLength(2);
    expect(strokes.map((s) => s.id)).toEqual(["s1", "s2"]);
    for (const stroke of strokes) {
      expect(stroke).toMatchObject({
        color: "#ffd60a",
        tool: "highlighter",
        shape: "line",
        size: 20,
      });
      expect(stroke.pts).toHaveLength(6);
      expect(isHighlight(stroke)).toBe(true);
    }
  });

  it("drops empty rectangles", () => {
    expect(textHighlightStrokes([{ x: 0, y: 0, w: 0, h: 10 }], "#ff0", ids())).toEqual([]);
  });
});

describe("isHighlight", () => {
  it("is highlighter ink with a point, never pen ink", () => {
    const pen: Stroke = { id: "a", color: "#000", size: 2, tool: "pen", pts: [1, 1, 0.5] };
    expect(isHighlight(pen)).toBe(false);
    expect(isHighlight({ ...pen, tool: "highlighter" })).toBe(true);
    expect(isHighlight({ ...pen, tool: "highlighter", pts: [] })).toBe(false);
  });
});

describe("highlightText", () => {
  function setup(): { doc: InkDocument; history: History; strokes: Stroke[] } {
    const doc = emptyDocument();
    doc.pages[0].backdrop = { kind: "pdf", path: "Lectures/week 1.pdf", page: 2 };
    return { doc, history: new History(), strokes: textHighlightStrokes(RECTS, "#ffd60a", ids()) };
  }

  it("adds every line as one undo step, and undo takes them all", () => {
    const { doc, history, strokes } = setup();
    const before = JSON.stringify(doc);
    const command = highlightText(doc.pages[0], strokes, EPOCH);
    expect(command.label).toBe(HIGHLIGHT_TEXT_LABEL);
    history.push(doc, command);
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual(["s1", "s2"]);
    // The page's clock starts with its first ink, in the same step.
    expect(doc.pages[0].epoch).toBe(EPOCH);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
    history.redo(doc);
    expect(doc.pages[0].strokes).toHaveLength(2);
  });

  it("saves and loads as it was drawn: page space, fixed geometry", () => {
    const { doc, history, strokes } = setup();
    history.push(doc, highlightText(doc.pages[0], strokes, EPOCH));
    const loaded = decodeDocument(encodeDocument(doc));
    const page = loaded.pages[0];
    expect(page.backdrop).toEqual({ kind: "pdf", path: "Lectures/week 1.pdf", page: 2 });
    expect(page.strokes).toHaveLength(2);
    page.strokes.forEach((stroke, i) => {
      const drawn = doc.pages[0].strokes[i];
      expect(stroke).toMatchObject({
        id: drawn.id,
        color: drawn.color,
        size: drawn.size,
        tool: "highlighter",
        shape: "line",
        t0: 0,
      });
      stroke.pts.forEach((value, k) => expect(value).toBeCloseTo(drawn.pts[k], 2));
    });
    // And again: a second round trip changes nothing.
    expect(encodeDocument(decodeDocument(encodeDocument(loaded)))).toBe(encodeDocument(loaded));
  });
});
