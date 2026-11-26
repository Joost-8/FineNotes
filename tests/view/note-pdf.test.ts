import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { textBlock, type TextNote } from "../../src/model/text-note";
import { exportNoteToPdf, layoutNoteForPdf } from "../../src/view/note-pdf";

const note = (text: string): TextNote => ({
  blocks: [
    textBlock("t", "title", [{ text: "Trip", marks: 0 }]),
    textBlock("b", "body", [{ text, marks: 0 }]),
    textBlock("l", "bullet", [{ text: "Boots", marks: 0 }]),
    {
      type: "ink",
      id: "i",
      height: 120,
      paper: "lined",
      strokes: [
        { id: "s", color: "#1a1a1a", size: 3, tool: "pen", pts: [10, 10, 0.5, 80, 40, 0.5] },
        {
          id: "h",
          color: "#ffd43b",
          size: 18,
          tool: "highlighter",
          pts: [10, 60, 0.5, 200, 60, 0.5],
        },
      ],
    },
    {
      type: "table",
      id: "tb",
      rows: [
        ["A", "B"],
        ["1", "2"],
      ],
    },
    { type: "image", id: "p", path: "missing.png" },
  ],
});

const sources = {
  usePressure: true,
  highlighterAlpha: 0.4,
  picture: () => null,
  encodePicture: () => Promise.resolve(null),
};

describe("exportNoteToPdf", () => {
  it("writes A4 pages with real text and vector ink", async () => {
    const pdf = await exportNoteToPdf(note("Leave early."), "Trip", sources);
    expect(pdf.pages).toBe(1);
    expect(pdf.rastered).toEqual([]);
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getTitle()).toBe("Trip");
    const page = doc.getPage(0);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  });

  it("draws a page the fonts cannot show as a picture, or fails without one", async () => {
    await expect(exportNoteToPdf(note("日本語"), "Trip", sources)).rejects.toThrow(/Page 1/);
    // The smallest JPEG pdf-lib takes: a 1×1 grey baseline image.
    const jpeg = Uint8Array.from(
      atob(
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
      ),
      (c) => c.charCodeAt(0),
    );
    const pdf = await exportNoteToPdf(note("日本語"), "Trip", {
      ...sources,
      measureFallback: (_font, text) => text.length * 10,
      rasterPage: () => Promise.resolve(jpeg),
    });
    expect(pdf.rastered).toEqual([{ page: 0, why: "text the PDF's fonts cannot show" }]);
  });

  it("writes only the pages asked for, in the note's order, laid out as the preview is", async () => {
    const long = note("Many words to fill the page. ".repeat(400));
    const layout = await layoutNoteForPdf(long, sources);
    expect(layout.pages.length).toBeGreaterThan(2);
    const progress: number[] = [];
    const pdf = await exportNoteToPdf(long, "Trip", sources, {
      pages: [2, 0, 99],
      onProgress: (done) => progress.push(done),
    });
    expect(pdf.pages).toBe(2);
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(2);
    expect(progress).toEqual([0, 1, 2]);
    await expect(exportNoteToPdf(long, "Trip", sources, { pages: [] })).rejects.toThrow(/No page/);
    await expect(exportNoteToPdf(long, "Trip", sources, { cancelled: () => true })).rejects.toThrow(
      /cancelled/,
    );
  });
});
