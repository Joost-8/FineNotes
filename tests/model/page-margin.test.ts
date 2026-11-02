import { describe, expect, it } from "vitest";
import { emptyDocument, pdfFrameOf, type InkDocument, type Page } from "../../src/model/document";
import {
  SetPageMargin,
  keepContent,
  marginFloor,
  marginFor,
  marginOf,
  marginPercentOf,
  marginSideOf,
  unmarginedGeometry,
  withoutFrame,
} from "../../src/model/page-margin";
import { History } from "../../src/model/history";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { planPdfRaster } from "../../src/canvas/pdf-raster";
import { pdfToPage } from "../../src/canvas/pdf-text";

function pdfDoc(pages = 1): { doc: InkDocument; page: Page } {
  const doc = emptyDocument();
  doc.pages = [];
  for (let i = 0; i < pages; i++) {
    const page = { ...emptyDocument().pages[0], id: `p${i}` };
    page.geometry = { width: 1000, height: 1400 };
    page.backdrop = { kind: "pdf", path: "Slides.pdf", page: i };
    page.strokes = [];
    page.images = [];
    page.textBoxes = [];
    doc.pages.push(page);
  }
  const page = doc.pages[0];
  page.strokes.push({ id: "s1", color: "#000", size: 4, tool: "pen", pts: [100, 200, 0.5] });
  page.textBoxes.push({ id: "t1", x: 50, y: 60, w: 200, h: 40, text: "Note" } as never);
  page.comments = [{ id: "c1", x: 300, y: 400, text: "?", author: "you", created: 1 }];
  return { doc, page };
}

describe("SetPageMargin", () => {
  it("widens a page on the right and keeps the PDF and ink where they were", () => {
    const { doc, page } = pdfDoc();
    new SetPageMargin([{ page, margin: { left: 0, right: 330 } }]).apply(doc);
    expect(page.geometry).toEqual({ width: 1330, height: 1400 });
    expect(page.backdrop.frame).toEqual({ x: 0, y: 0, width: 1000, height: 1400 });
    expect(page.strokes[0].pts[0]).toBe(100);
    expect(marginOf(page)).toEqual({ left: 0, right: 330 });
  });

  it("moves everything right with a margin on the left, and undo puts it back", () => {
    const { doc, page } = pdfDoc();
    const history = new History();
    history.push(doc, new SetPageMargin([{ page, margin: { left: 400, right: 0 } }]));
    expect(page.backdrop.frame?.x).toBe(400);
    expect(page.strokes[0].pts[0]).toBe(500);
    expect(page.textBoxes[0].x).toBe(450);
    expect(page.comments?.[0].x).toBe(700);
    history.undo(doc);
    expect(page.geometry.width).toBe(1000);
    expect(page.backdrop.frame).toBeUndefined();
    expect(page.strokes[0].pts[0]).toBe(100);
    expect(page.textBoxes[0].x).toBe(50);
    expect(page.comments?.[0].x).toBe(300);
    history.redo(doc);
    expect(page.strokes[0].pts[0]).toBe(500);
  });

  it("changes a margin from one side to the other, moving the ink only by the left's change", () => {
    const { doc, page } = pdfDoc();
    new SetPageMargin([{ page, margin: { left: 300, right: 0 } }]).apply(doc);
    new SetPageMargin([{ page, margin: { left: 0, right: 300 } }]).apply(doc);
    expect(page.backdrop.frame?.x).toBe(0);
    expect(page.geometry.width).toBe(1300);
    expect(page.strokes[0].pts[0]).toBe(100);
  });

  it("removes the frame when the margin goes back to none", () => {
    const { doc, page } = pdfDoc();
    new SetPageMargin([{ page, margin: { left: 200, right: 200 } }]).apply(doc);
    new SetPageMargin([{ page, margin: { left: 0, right: 0 } }]).apply(doc);
    expect(page.backdrop.frame).toBeUndefined();
    expect(page.geometry.width).toBe(1000);
    expect(encodeDocument(doc).startsWith("v2:")).toBe(true);
  });

  it("never makes a margin narrower than the ink in it", () => {
    const { doc, page } = pdfDoc();
    new SetPageMargin([{ page, margin: { left: 0, right: 400 } }]).apply(doc);
    page.strokes.push({ id: "s2", color: "#000", size: 4, tool: "pen", pts: [1250, 500, 0.5] });
    expect(marginFloor(page)).toEqual({ left: 0, right: 252 });
    const command = new SetPageMargin([{ page, margin: { left: 0, right: 0 } }]);
    command.apply(doc);
    expect(marginOf(page)).toEqual({ left: 0, right: 252 });
    expect(keepContent(page, { left: 0, right: 100 })).toEqual({ left: 0, right: 252 });
  });

  it("does nothing, and keeps no step, when the margin asked for is the one there", () => {
    const { doc, page } = pdfDoc();
    const command = new SetPageMargin([{ page, margin: { left: 0, right: 0 } }]);
    command.apply(doc);
    expect(command.changedAny).toBe(false);
  });

  it("gives every page its margin in one undo step", () => {
    const { doc } = pdfDoc(3);
    const history = new History();
    const targets = doc.pages.map((page) => ({ page, margin: marginFor(page, "right", 33) }));
    history.push(doc, new SetPageMargin(targets));
    expect(doc.pages.map((p) => p.geometry.width)).toEqual([1330, 1330, 1330]);
    history.undo(doc);
    expect(doc.pages.map((p) => p.geometry.width)).toEqual([1000, 1000, 1000]);
  });

  it("frames a paper page too, so its ruling stays its size", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    page.backdrop = { kind: "ruled-wide" };
    const width = page.geometry.width;
    new SetPageMargin([{ page, margin: { left: 0, right: 100 } }]).apply(doc);
    expect(page.backdrop).toMatchObject({ kind: "ruled-wide", frame: { x: 0, width } });
  });
});

describe("margin helpers", () => {
  it("names the sides and the share of a margin", () => {
    const { doc, page } = pdfDoc();
    expect(marginSideOf(marginOf(page))).toBe("none");
    new SetPageMargin([{ page, margin: marginFor(page, "both", 25) }]).apply(doc);
    expect(marginSideOf(marginOf(page))).toBe("both");
    expect(marginPercentOf(page)).toBe(25);
    // The share is of the frame, not of the wider page.
    expect(marginFor(page, "left", 50)).toEqual({ left: 500, right: 0 });
  });

  it("gives a new page the page's first size and an unframed backdrop", () => {
    const { doc, page } = pdfDoc();
    new SetPageMargin([{ page, margin: { left: 0, right: 300 } }]).apply(doc);
    expect(unmarginedGeometry(page)).toEqual({ width: 1000, height: 1400 });
    expect(withoutFrame(page.backdrop).frame).toBeUndefined();
  });
});

describe("a margin on disk", () => {
  it("round-trips, labelled so older builds open it read-only", () => {
    const { doc, page } = pdfDoc();
    new SetPageMargin([{ page, margin: { left: 300, right: 0 } }]).apply(doc);
    const text = encodeDocument(doc);
    expect(text.startsWith("v2+side-space:")).toBe(true);
    const read = decodeDocument(text).pages[0];
    expect(read.backdrop.frame).toEqual({ x: 300, y: 0, width: 1000, height: 1400 });
    expect(read.geometry.width).toBe(1300);
  });

  it("drops a frame that is not usable when reading", () => {
    const { doc, page } = pdfDoc();
    page.backdrop = {
      kind: "pdf",
      path: "Slides.pdf",
      page: 0,
      frame: { x: 0, y: 0, width: -5, height: 10 },
    };
    expect(decodeDocument(encodeDocument(doc)).pages[0].backdrop.frame).toBeUndefined();
  });
});

describe("a PDF fitted into its frame", () => {
  const source = { width: 500, height: 700 };

  it("is drawn at the frame, not centred on the wider page", () => {
    const geometry = { width: 2000, height: 1400 };
    const frame = { x: 1000, y: 0, width: 1000, height: 1400 };
    const plan = planPdfRaster(source, 1, { geometry, frame });
    expect(plan.sourceScale).toBeCloseTo(2);
    expect(plan.transform[4]).toBeCloseTo(1000);
    expect(plan.transform[5]).toBeCloseTo(0);
    const centred = planPdfRaster(source, 1, { geometry });
    expect(centred.transform[4]).toBeCloseTo(500);
  });

  it("puts its text where it is drawn", () => {
    const m = pdfToPage([1, 0, 0, 1, 0, 0], source, { x: 1000, y: 0, width: 1000, height: 1400 });
    expect(m[4]).toBeCloseTo(1000);
    expect(m[0]).toBeCloseTo(2);
  });

  it("is the whole page when there is no frame", () => {
    expect(
      pdfFrameOf({ kind: "pdf", path: "a.pdf", page: 0 }, { width: 800, height: 600 }),
    ).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});
