/**
 * Everything outside `sticky-notes.ts` that copies, cuts or moves strokes,
 * kept from losing or misplacing a note's ink: the eraser's pieces,
 * duplicates and pastes, page copies, pages moved to another notebook,
 * Insert space and the PDF export's layers (CLAUDE.md, "Copying an element
 * through a list of picked fields drops every field added later").
 */

import { describe, expect, it } from "vitest";
import { writingLines } from "../../src/canvas/backdrop";
import { type SpaceLayout, planInsertSpace } from "../../src/canvas/insert-space";
import { annotationLayers } from "../../src/export/annotation-layers";
import { eraseCircleFromStroke, eraseRectsFromStroke } from "../../src/ink/stroke-eraser";
import {
  type ImageElement,
  type InkDocument,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { duplicateImage } from "../../src/model/images";
import { duplicatePageAfter } from "../../src/model/page-commands";
import { prepareTransfer } from "../../src/model/page-transfer";
import { copyElements } from "../../src/model/selection-commands";
import { newStickyNote } from "../../src/model/sticky-notes";

function line(id: string, x0: number, x1: number, y: number, onSticky?: string): Stroke {
  const pts: number[] = [];
  for (let x = x0; x <= x1; x += 4) pts.push(x, y, 0.5);
  return { id, color: "#1a1a1a", size: 2, tool: "pen", pts, ...(onSticky ? { onSticky } : {}) };
}

function notePage(): Page {
  const page = blankPage("p1");
  page.images.push(newStickyNote("i1", { x: 100, y: 100, w: 200, h: 200 }, "#fde68a"));
  page.strokes.push(line("s1", 120, 280, 150, "i1"), line("s2", 400, 500, 150));
  return page;
}

describe("the eraser", () => {
  it("leaves the pieces of a note's ink on the note", () => {
    let n = 0;
    const ink = line("s1", 120, 280, 150, "i1");
    const circle = eraseCircleFromStroke(ink, 200, 150, 10, () => `p${++n}`) ?? [];
    expect(circle.length).toBe(2);
    for (const piece of circle) expect(piece.onSticky).toBe("i1");
    const rects = eraseRectsFromStroke(
      ink,
      [{ minX: 190, minY: 140, maxX: 210, maxY: 160 }],
      () => `p${++n}`,
    );
    for (const piece of rects ?? []) expect(piece.onSticky).toBe("i1");
    const plain = eraseCircleFromStroke(line("s2", 0, 100, 0), 50, 0, 10, () => `p${++n}`) ?? [];
    for (const piece of plain) expect("onSticky" in piece).toBe(false);
  });
});

describe("copies", () => {
  it("duplicate and paste give a copied note's ink to the copy, and free ink copied alone", () => {
    const page = notePage();
    let seq = 0;
    const ids = {
      stroke: () => `s${++seq + 10}`,
      image: () => "i9",
      textBox: () => "t1",
      table: () => "g1",
      graph: () => "f1",
    };
    const both = copyElements(
      { strokes: page.strokes, images: page.images, textBoxes: [] },
      ids,
      24,
      24,
    );
    expect(both.images[0].id).toBe("i9");
    expect(both.images[0].sticky).toEqual({ color: "#fde68a" });
    expect(both.strokes[0].onSticky).toBe("i9");
    expect("onSticky" in both.strokes[1]).toBe(false);
    const inkOnly = copyElements(
      { strokes: [page.strokes[0]], images: [], textBoxes: [] },
      ids,
      0,
      0,
    );
    expect("onSticky" in inkOnly.strokes[0]).toBe(false);
    // The originals still belong where they did.
    expect(page.strokes[0].onSticky).toBe("i1");
  });

  it("a duplicated note is a note of the same colour, stuck on as the original", () => {
    const doc = emptyDocument();
    const original: ImageElement = {
      ...newStickyNote("i1", { x: 100, y: 100, w: 200, h: 200 }, "#bfdbfe"),
      rotation: 0.2,
    };
    doc.pages[0].images.push(original);
    const copy = duplicateImage(doc, doc.pages[0].geometry, original);
    expect(copy.sticky).toEqual({ color: "#bfdbfe" });
    expect(copy.sticky).not.toBe(original.sticky);
    expect(copy.front).toBe(true);
    expect(copy.path).toBe("");
    expect(copy.id).toBe("i2");
  });

  it("a duplicated page's note keeps its ink under its new id", () => {
    const doc = emptyDocument();
    doc.pages = [notePage()];
    const result = duplicatePageAfter(doc, 0);
    const page = result?.page;
    expect(page?.images[0].id).not.toBe("i1");
    expect(page?.strokes[0].onSticky).toBe(page?.images[0].id);
    expect(page?.strokes[1].onSticky).toBeUndefined();
  });

  it("a page moved to another notebook keeps its note's ink on the note", () => {
    const dest: InkDocument = emptyDocument();
    dest.pages[0].images.push({ id: "i1", path: "x.png", x: 0, y: 0, w: 1, h: 1 });
    const [moved] = prepareTransfer([notePage()], dest);
    expect(moved.images[0].id).toBe("i2");
    expect(moved.strokes[0].onSticky).toBe("i2");
  });
});

describe("Insert space", () => {
  const layout: SpaceLayout = {
    lines: (page) => writingLines(page.backdrop, page.geometry),
    textBoxBounds: (_page, t) => ({ minX: t.x, minY: t.y, maxX: t.x + t.w, maxY: t.y + 24 }),
  };

  it("moves a note's ink with the note, wherever on the note the ink sits", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    page.backdrop = { kind: "ruled-wide" };
    // The note starts around line 9 (rule at 400); its ink sits lower, on line 11.
    page.images.push(newStickyNote("i1", { x: 100, y: 365, w: 200, h: 200 }, "#fde68a"));
    page.strokes.push(line("s1", 120, 280, 478, "i1"), line("s2", 400, 500, 478));
    for (const at of [10, 0]) {
      const noteY = page.images[0].y;
      const inkY = page.strokes[0].pts[1];
      planInsertSpace(doc, 0, { block: 0, line: at }, 1, layout).command?.apply(doc);
      expect(page.strokes[0].pts[1] - inkY).toBe(page.images[0].y - noteY);
    }
    // Plain ink on line 11 moved both times; the note and its ink moved once, with line 0.
    expect(page.strokes[1].pts[1]).toBe(558);
    expect(page.strokes[0].pts[1]).toBe(518);
  });
});

describe("the PDF export's layers", () => {
  it("puts a note's ink in the notes' layer, and only page ink in the ink layers", () => {
    const layers = [...annotationLayers(notePage())];
    expect(layers[0].page.images.map((i) => i.id)).toEqual(["i1"]);
    expect(layers[0].page.strokes.map((s) => s.id)).toEqual(["s1"]);
    const ink = layers.slice(1).flatMap((l) => l.page.strokes.map((s) => s.id));
    expect(ink).toEqual(["s2"]);
  });

  it("leaves ink whose note is not on the page in the ink layers", () => {
    const page = notePage();
    page.images = [];
    const layers = [...annotationLayers(page)];
    expect(layers.flatMap((l) => l.page.strokes.map((s) => s.id))).toEqual(["s1", "s2"]);
  });
});
