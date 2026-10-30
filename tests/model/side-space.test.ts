import { describe, expect, it } from "vitest";
import { emptyDocument, pdfFrameOf, type InkDocument, type Page } from "../../src/model/document";
import {
  AddPageSpace,
  sidePaperWidth,
  sideSpaceWidth,
  unwidenedGeometry,
  withoutFrame,
} from "../../src/model/side-space";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { planPdfRaster } from "../../src/canvas/pdf-raster";
import { pdfToPage } from "../../src/canvas/pdf-text";

function pdfDoc(): { doc: InkDocument; page: Page } {
  const doc = emptyDocument();
  const page = doc.pages[0];
  page.geometry = { width: 1000, height: 1400 };
  page.backdrop = { kind: "pdf", path: "Slides.pdf", page: 0 };
  page.strokes.push({ id: "s1", color: "#000", size: 3, tool: "pen", pts: [100, 200, 0.5] });
  page.textBoxes.push({ id: "t1", x: 50, y: 60, w: 200, h: 40, text: "Note" } as never);
  page.comments = [{ id: "c1", x: 300, y: 400, text: "?", author: "you", created: 1 }];
  return { doc, page };
}

describe("AddPageSpace", () => {
  it("adds a strip of the chosen paper on the right and keeps the PDF and ink where they were", () => {
    const { doc, page } = pdfDoc();
    new AddPageSpace(page, "right", { kind: "ruled-wide" }).apply(doc);
    expect(page.geometry).toEqual({ width: 2000, height: 1400 });
    expect(page.backdrop).toMatchObject({ frame: { x: 0, y: 0, width: 1000, height: 1400 } });
    expect(page.sidePapers).toEqual([{ x: 1000, width: 1000, backdrop: { kind: "ruled-wide" } }]);
    expect(page.strokes[0].pts).toEqual([100, 200, 0.5]);
    expect(page.textBoxes[0].x).toBe(50);
  });

  it("adds a strip on the left and moves the PDF and everything on the page with it", () => {
    const { doc, page } = pdfDoc();
    new AddPageSpace(page, "left", { kind: "squared" }).apply(doc);
    expect(page.geometry.width).toBe(2000);
    expect(page.backdrop).toMatchObject({ frame: { x: 1000, y: 0, width: 1000, height: 1400 } });
    expect(page.sidePapers).toEqual([{ x: 0, width: 1000, backdrop: { kind: "squared" } }]);
    expect(page.strokes[0].pts).toEqual([1100, 200, 0.5]);
    expect(page.textBoxes[0].x).toBe(1050);
    expect(page.comments?.[0].x).toBe(1300);
  });

  it("takes the width it is given, and moves earlier strips with a new one on the left", () => {
    const { doc, page } = pdfDoc();
    new AddPageSpace(page, "right", { kind: "blank" }, 600).apply(doc);
    new AddPageSpace(page, "left", { kind: "dotted" }, 400).apply(doc);
    expect(page.geometry.width).toBe(2000);
    expect(page.sidePapers).toEqual([
      { x: 0, width: 400, backdrop: { kind: "dotted" } },
      { x: 1400, width: 600, backdrop: { kind: "blank" } },
    ]);
    expect(page.backdrop).toMatchObject({ frame: { x: 400, width: 1000 } });
    // Keep-the-size adds the page's own width, whatever was added beside it.
    expect(sideSpaceWidth(page)).toBe(1000);
  });

  it("sizes a strip of another paper size at the page's height", () => {
    const { page } = pdfDoc();
    expect(sidePaperWidth(page, { width: 500, height: 700 })).toBe(1000);
    expect(sidePaperWidth(page, { width: 1400, height: 1000 })).toBe(1960);
  });

  it("undoes in one step: only that strip goes", () => {
    const { doc, page } = pdfDoc();
    new AddPageSpace(page, "right", { kind: "blank" }).apply(doc);
    const before = structuredClone(page);
    const command = new AddPageSpace(page, "left", { kind: "squared" });
    command.apply(doc);
    command.invert(doc);
    expect(page).toEqual(before);
  });

  it("widens a paper page, its own paper kept in a frame", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const width = page.geometry.width;
    new AddPageSpace(page, "right", { kind: "squared" }).apply(doc);
    expect(page.geometry.width).toBe(width * 2);
    expect(page.backdrop.frame).toEqual({ x: 0, y: 0, width, height: page.geometry.height });
  });

  it("gives a new page beside a widened one the first size, unframed", () => {
    const { doc, page } = pdfDoc();
    new AddPageSpace(page, "left", { kind: "blank" }).apply(doc);
    expect(unwidenedGeometry(page)).toEqual({ width: 1000, height: 1400 });
    expect(withoutFrame(page.backdrop)).toEqual({ kind: "pdf", path: "Slides.pdf", page: 0 });
  });

  it("keeps the frame and the side papers through a save", () => {
    const { doc, page } = pdfDoc();
    new AddPageSpace(page, "left", { kind: "ruled-narrow", paperColor: "yellow" }).apply(doc);
    const read = decodeDocument(encodeDocument(doc)).pages[0];
    expect(read.backdrop).toMatchObject({ frame: { x: 1000, y: 0, width: 1000, height: 1400 } });
    expect(read.sidePapers).toEqual([
      { x: 0, width: 1000, backdrop: { kind: "ruled-narrow", paperColor: "yellow" } },
    ]);
  });

  it("labels a widened notebook, so older builds open it read-only", () => {
    const { doc, page } = pdfDoc();
    expect(encodeDocument(doc).startsWith("v2:")).toBe(true);
    new AddPageSpace(page, "right", { kind: "blank" }).apply(doc);
    expect(encodeDocument(doc).startsWith("v2+side-space:")).toBe(true);
  });

  it("drops a frame or a side paper that is not usable when reading", () => {
    const { doc, page } = pdfDoc();
    page.backdrop = {
      kind: "pdf",
      path: "Slides.pdf",
      page: 0,
      frame: { x: 0, y: 0, width: -5, height: 10 },
    };
    page.sidePapers = [
      { x: 0, width: 0, backdrop: { kind: "blank" } },
      { x: 10, width: 50, backdrop: { kind: "pdf", path: "a.pdf", page: 0 } as never },
    ];
    const read = decodeDocument(encodeDocument(doc)).pages[0];
    expect(read.backdrop.frame).toBeUndefined();
    expect(read.sidePapers).toBeUndefined();
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
    // Without a frame, the same page centres it.
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
