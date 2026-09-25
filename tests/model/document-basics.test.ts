/**
 * The small helpers in `document.ts` that the rest of the plugin leans on:
 * creating an empty note, counting strokes and boxing a stroke's points.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAPER_WIDTH, SCHEMA_VERSION } from "../../src/constants";
import {
  type InkDocument,
  type Stroke,
  POINT_STRIDE,
  blankPage,
  emptyDocument,
  firstPage,
  strokeBounds,
  strokeCount,
} from "../../src/model/document";

function ink(pts: number[]): Stroke {
  return { id: "s1", color: "#000000", size: 3, tool: "pen", pts };
}

describe("emptyDocument", () => {
  it("is one blank page at the default paper size, at the current schema version", () => {
    expect(emptyDocument()).toEqual({
      version: SCHEMA_VERSION,
      view: { scrollY: 0, width: DEFAULT_PAPER_WIDTH, scale: 1 },
      pages: [
        {
          id: "p1",
          kind: "ink",
          geometry: { width: DEFAULT_PAPER_WIDTH, height: DEFAULT_PAGE_HEIGHT },
          backdrop: { kind: "blank" },
          strokes: [],
          images: [],
          textBoxes: [],
        },
      ],
    });
  });

  it("uses the given width for both the view and the page, keeping the page height", () => {
    const doc = emptyDocument(640);
    expect(doc.view.width).toBe(640);
    expect(doc.pages[0].geometry).toEqual({ width: 640, height: DEFAULT_PAGE_HEIGHT });
  });

  it("keeps the view's keys in their stored order (the encoder writes the view as it is)", () => {
    expect(Object.keys(emptyDocument().view)).toEqual(["scrollY", "width", "scale"]);
  });

  it("hands out a fresh document every time", () => {
    const a = emptyDocument();
    const b = emptyDocument();
    a.pages[0].strokes.push(ink([1, 2, 0.5]));
    a.view.scrollY = 50;
    expect(b.pages[0].strokes).toEqual([]);
    expect(b.view.scrollY).toBe(0);
    expect(a.pages[0].geometry).not.toBe(b.pages[0].geometry);
  });
});

describe("strokeCount", () => {
  it("adds up the strokes on every page", () => {
    const doc = emptyDocument();
    doc.pages[0].strokes.push(ink([0, 0, 1]));
    const second = blankPage("p2");
    second.strokes.push(ink([1, 1, 1]), ink([2, 2, 1]));
    doc.pages.push(second, blankPage("p3"));
    expect(strokeCount(doc)).toBe(3);
  });

  it("is 0 for a document without pages", () => {
    const doc: InkDocument = { ...emptyDocument(), pages: [] };
    expect(strokeCount(doc)).toBe(0);
  });
});

describe("strokeBounds", () => {
  it("is the tight box around every point, ignoring pressure", () => {
    expect(strokeBounds(ink([10, 20, 0.5, 30, 5, 99, 15, 40, 0]))).toEqual({
      minX: 10,
      minY: 5,
      maxX: 30,
      maxY: 40,
    });
  });

  it("is a zero-size box for a single point", () => {
    expect(strokeBounds(ink([7, 8, 1]))).toEqual({ minX: 7, minY: 8, maxX: 7, maxY: 8 });
  });

  it("is null without a whole point", () => {
    expect(strokeBounds(ink([]))).toBeNull();
    expect(strokeBounds(ink([1]))).toBeNull();
    expect(strokeBounds(ink([1, 2]))).toBeNull();
  });

  it("reads a trailing partial point's x, but no y it does not have", () => {
    expect(strokeBounds(ink([0, 0, 1, 50]))).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 0 });
    expect(strokeBounds(ink([0, 0, 1, 50, 60]))).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 60 });
  });

  it("skips NaN coordinates rather than spreading them", () => {
    expect(strokeBounds(ink([NaN, 5, 1, 10, NaN, 1, 20, 30, 1]))).toEqual({
      minX: 10,
      minY: 5,
      maxX: 20,
      maxY: 30,
    });
    expect(strokeBounds(ink([NaN, NaN, 1]))).toEqual({
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    });
  });

  it("handles negative coordinates", () => {
    expect(strokeBounds(ink([-5, -10, 1, -1, -2, 1]))).toEqual({
      minX: -5,
      minY: -10,
      maxX: -1,
      maxY: -2,
    });
  });
});

describe("points and pages", () => {
  it("stores three numbers per point: x, y and pressure", () => {
    expect(POINT_STRIDE).toBe(3);
  });

  it("firstPage returns page one, adding a blank one to a document without pages", () => {
    const doc = emptyDocument();
    expect(firstPage(doc)).toBe(doc.pages[0]);
    const bare: InkDocument = { ...emptyDocument(), pages: [] };
    const page = firstPage(bare);
    expect(bare.pages).toEqual([page]);
    expect(page.id).toBe("p1");
  });
});
