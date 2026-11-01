/**
 * `src/view/selection-kind.ts`: the lasso menu by what is selected (Joost
 * on PR #59). One kind keeps its own options, handwriting is one kind
 * however many strokes, a mix gets only colour, and Turn into offers what
 * fits.
 */

import { describe, expect, it } from "vitest";
import { selectionKind, selectionMenu } from "../../src/view/selection-kind";

const ink = { shape: undefined };
const rect = { shape: "rect" };
const arrow = { shape: "arrow" };
const sel = (parts: Partial<Parameters<typeof selectionKind>[0]>) => ({
  strokes: [],
  images: [],
  textBoxes: [],
  ...parts,
});

describe("selectionKind", () => {
  it("handwriting is one kind however many strokes", () => {
    expect(selectionKind(sel({ strokes: [ink] }))).toBe("handwriting");
    expect(selectionKind(sel({ strokes: [ink, ink, ink, ink] }))).toBe("handwriting");
  });

  it("shapes and arrows are shapes", () => {
    expect(selectionKind(sel({ strokes: [rect] }))).toBe("shapes");
    expect(selectionKind(sel({ strokes: [rect, arrow] }))).toBe("shapes");
  });

  it("one kind of element each", () => {
    expect(selectionKind(sel({ images: [{}] }))).toBe("pictures");
    expect(selectionKind(sel({ textBoxes: [{}, {}] }))).toBe("text");
    expect(selectionKind(sel({ graphs: [{}] }))).toBe("graphs");
    expect(selectionKind(sel({ tables: [{}] }))).toBe("table");
  });

  it("a table with the ink in its cells is a table; with other ink, a mix", () => {
    expect(selectionKind(sel({ tables: [{}], strokes: [ink] }), true)).toBe("table");
    expect(selectionKind(sel({ tables: [{}], strokes: [ink] }))).toBe("mixed");
  });

  it("any two kinds together are a mix", () => {
    expect(selectionKind(sel({ strokes: [ink, rect] }))).toBe("mixed");
    expect(selectionKind(sel({ strokes: [ink], images: [{}] }))).toBe("mixed");
    expect(selectionKind(sel({ textBoxes: [{}], graphs: [{}] }))).toBe("mixed");
  });

  it("an empty selection is no single kind", () => {
    expect(selectionKind(sel({}))).toBe("mixed");
  });
});

describe("selectionMenu", () => {
  it("handwriting gets colour and what only handwriting becomes, never shape styles", () => {
    expect(selectionMenu("handwriting")).toEqual({
      colour: true,
      shapeStyle: false,
      handwriting: true,
      link: true,
      sticker: true,
      comment: true,
    });
  });

  it("a shape keeps its styles and is not offered handwriting's Turn into", () => {
    const menu = selectionMenu("shapes");
    expect(menu.shapeStyle).toBe(true);
    expect(menu.colour).toBe(true);
    expect(menu.handwriting).toBe(false);
  });

  it("a mix gets only colour, and little under Turn into", () => {
    expect(selectionMenu("mixed")).toEqual({
      colour: true,
      shapeStyle: false,
      handwriting: false,
      link: false,
      sticker: true,
      comment: true,
    });
  });

  it("tables, graphs, pictures and text keep their own options, with no ink settings", () => {
    for (const kind of ["table", "graphs", "pictures", "text"] as const) {
      const menu = selectionMenu(kind);
      expect([menu.colour, menu.shapeStyle, menu.handwriting, menu.link]).toEqual([
        false,
        false,
        false,
        false,
      ]);
    }
  });
});
