import { describe, expect, it } from "vitest";
import type { InkDocument, Stroke } from "../../src/model/document";
import {
  AddFill,
  FILL_EDGE,
  RecolorFill,
  enclosedArea,
  fillGapPx,
  fillInsertIndex,
  fillStroke,
  isBucketFill,
  readFillGap,
  sameFill,
} from "../../src/model/fill-region";
import { RecolorStrokes } from "../../src/model/selection-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { emptyDocument } from "../../src/model/document";

const square = (x: number, y: number, s: number): number[] => [
  x,
  y,
  x + s,
  y,
  x + s,
  y + s,
  x,
  y + s,
  x,
  y,
];

const ink = (id: string): Stroke => ({
  id,
  color: "#000000",
  size: 2,
  tool: "pen",
  pts: [0, 0, 0.5, 10, 10, 0.5],
});

function docWith(strokes: Stroke[]): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].strokes = strokes;
  return doc;
}

describe("fill strokes", () => {
  it("is a closed solid polygon in the pen's colour", () => {
    const stroke = fillStroke("f1", "#AA3300", square(10, 10, 50));
    expect(stroke).toMatchObject({
      color: "#aa3300",
      fill: "#aa3300",
      shape: "polygon",
      size: FILL_EDGE,
    });
    expect(stroke.pts.length).toBe(15);
    expect(isBucketFill(stroke)).toBe(true);
    expect(isBucketFill(ink("a"))).toBe(false);
    expect(isBucketFill({ ...stroke, fill: "#aa33004d" })).toBe(false);
    expect(enclosedArea(stroke.pts)).toBe(2500);
    expect(fillStroke("f", "nonsense", square(0, 0, 1)).color).toBe("#000000");
  });

  it("goes behind the ink, larger fills under smaller ones", () => {
    const big = fillStroke("big", "#ff0000", square(0, 0, 100));
    const small = fillStroke("small", "#00ff00", square(10, 10, 10));
    const strokes = [big, small, ink("a")];
    expect(fillInsertIndex(strokes, 50 * 50)).toBe(1);
    expect(fillInsertIndex(strokes, 200 * 200)).toBe(0);
    expect(fillInsertIndex(strokes, 1)).toBe(2);
    expect(fillInsertIndex([], 1)).toBe(0);
  });

  it("finds the fill already on a region", () => {
    const fill = fillStroke("f", "#ff0000", square(10, 10, 50));
    const again = fillStroke("g", "#00ff00", square(11, 10, 50)).pts;
    expect(sameFill([ink("a"), fill], again)).toBe(fill);
    expect(sameFill([fill], fillStroke("h", "#000000", square(10, 10, 30)).pts)).toBeNull();
    expect(sameFill([fill], [])).toBeNull();
  });

  it("adds and recolours as one undoable step each", () => {
    const fill = fillStroke("f", "#ff0000", square(10, 10, 50));
    const doc = docWith([ink("a")]);
    const add = new AddFill(doc.pages[0].id, fill, 0);
    add.apply(doc);
    expect(doc.pages[0].strokes[0]).toBe(fill);
    const recolor = new RecolorFill(doc.pages[0].id, fill, "#0000FF");
    recolor.apply(doc);
    expect(fill).toMatchObject({ color: "#0000ff", fill: "#0000ff" });
    recolor.invert();
    expect(fill).toMatchObject({ color: "#ff0000", fill: "#ff0000" });
    add.invert(doc);
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual(["a"]);
  });

  it("follows the lasso's colour change inside and out", () => {
    const fill = fillStroke("f", "#ff0000", square(10, 10, 50));
    const doc = docWith([fill]);
    const command = new RecolorStrokes(doc.pages[0].id, [fill], "#00AA00");
    command.apply(doc);
    expect(fill.fill).toBe("#00aa00");
    expect(isBucketFill(fill)).toBe(true);
    command.invert(doc);
    expect(fill).toMatchObject({ color: "#ff0000", fill: "#ff0000" });
  });

  it("round-trips through the file as an ordinary filled shape", () => {
    const fill = fillStroke("f", "#123456", square(10.25, 10.5, 50));
    const back = decodeDocument(encodeDocument(docWith([fill, ink("a")])));
    const stored = back.pages[0].strokes[0];
    expect(isBucketFill(stored)).toBe(true);
    expect(stored.pts.slice(0, 2)).toEqual([10.25, 10.5]);
  });

  it("reads the gap choice", () => {
    expect(readFillGap("large")).toBe("large");
    expect(readFillGap(7)).toBe("small");
    expect(fillGapPx("exact")).toBe(0);
    expect(fillGapPx("small")).toBeLessThan(fillGapPx("large"));
  });
});
