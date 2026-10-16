import { describe, expect, it } from "vitest";
import {
  isPdf,
  pdfAppName,
  PdfImportError,
  readPdf,
  type PdfPageReading,
} from "../../src/import/pdf";
import { describeImport } from "../../src/import/import-summary";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { DEFAULT_PAGE_GEOMETRY } from "../../src/model/document";

const PDF = new TextEncoder().encode("%PDF-1.7\n%stand-in\n");
const A4 = { width: 595.28, height: 841.89 };
const K = Math.min(DEFAULT_PAGE_GEOMETRY.width, DEFAULT_PAGE_GEOMETRY.height) / A4.width;

function page(inks: PdfPageReading["inks"] = [], size = A4): PdfPageReading {
  return { ...size, inks };
}

describe("readPdf", () => {
  it("recognises a PDF by its first bytes", () => {
    expect(isPdf(PDF)).toBe(true);
    expect(isPdf(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(false);
  });

  it("makes each PDF page the paper of a page, with the PDF as the one attachment", () => {
    const result = readPdf(PDF, [page(), page([], { width: 842, height: 595 })], "Lecture");
    expect(result.source).toBe("pdf");
    expect(result.title).toBe("Lecture");
    expect(result.attachments).toEqual([
      { name: "Lecture.pdf", bytes: PDF, mime: "application/pdf" },
    ]);
    expect(result.doc.pages.map((p) => p.backdrop)).toEqual([
      { kind: "pdf", path: "Lecture.pdf", page: 0 },
      { kind: "pdf", path: "Lecture.pdf", page: 1 },
    ]);
    // Portrait and landscape keep their shape, with the notebook's short side.
    const [portrait, landscape] = result.doc.pages.map((p) => p.geometry);
    expect(portrait.width).toBe(landscape.height);
    expect(landscape.width).toBeGreaterThan(landscape.height);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/no handwriting saved as annotations/);
  });

  it("brings ink annotations over as strokes, and stops the paper drawing them", () => {
    const result = readPdf(
      PDF,
      [
        page([
          {
            kind: "ink",
            color: [255, 0, 0],
            width: 2,
            paths: [[10, 20, 30, 40, 50, 60], [Number.NaN, 1, 5, 5], []],
          },
          { kind: "ink", color: null, width: 0, paths: [[1, 1, 2, 2]] },
        ]),
        page(),
      ],
      "Notes",
    );
    const [first, second] = result.doc.pages;
    expect(first.backdrop).toEqual({ kind: "pdf", path: "Notes.pdf", page: 0, annotations: false });
    expect(second.backdrop).toEqual({ kind: "pdf", path: "Notes.pdf", page: 1 });
    expect(first.strokes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    const [red, half, plain] = first.strokes;
    expect(red).toMatchObject({ color: "#ff0000", tool: "pen" });
    expect(red.size).toBeCloseTo(2 * K, 1);
    expect(red.pts[0]).toBeCloseTo(10 * K, 1);
    expect(red.pts[1]).toBeCloseTo(20 * K, 1);
    expect(red.pts[2]).toBe(0.5);
    expect(red.pts).toHaveLength(9);
    // A point that is not a number is left out, not shifted into the next.
    expect(half.pts).toHaveLength(3);
    expect(plain.color).toBe("#000000");
    expect(plain.size).toBeCloseTo(K, 1);
    expect(result.warnings).toEqual([]);
  });

  it("turns highlights into a highlighter line through each span", () => {
    const result = readPdf(
      PDF,
      [
        page([
          {
            kind: "highlight",
            color: [0, 255, 0],
            width: 1,
            paths: [
              [100, 200, 300, 200, 100, 212, 300, 212],
              [1, 2, 3],
              [5, 5, 5, 5, 5, 5, 5, 5],
            ],
          },
          { kind: "highlight", color: null, width: 1, paths: [[0, 0, 10, 0, 0, 10, 10, 10]] },
        ]),
      ],
      "x",
    );
    const [green, yellow] = result.doc.pages[0].strokes;
    expect(green).toMatchObject({ tool: "highlighter", color: "#00ff00" });
    expect(green.size).toBeCloseTo(12 * K, 1);
    expect(green.pts[1]).toBeCloseTo(206 * K, 1);
    expect(green.pts[3]).toBeCloseTo(300 * K, 1);
    expect(yellow.color).toBe("#ffd400");
    expect(result.doc.pages[0].strokes).toHaveLength(2);
  });

  it("names the app a PDF came from, when its metadata says", () => {
    expect(pdfAppName("Noteful 1.9 (iOS)")).toBe("Noteful");
    expect(pdfAppName("GoodNotes 6 iOS Quartz PDFContext")).toBe("Goodnotes");
    expect(pdfAppName("MyScript Nebo")).toBe("Nebo");
    expect(pdfAppName("Microsoft Word")).toBeUndefined();
    const fromNoteful = readPdf(PDF, [page()], "Biology", "Noteful");
    expect(fromNoteful.app).toBe("Noteful");
    expect(describeImport(fromNoteful)).toBe("1 page · from Noteful");
    const plain = readPdf(PDF, [page()], "Slides");
    expect(plain.app).toBeUndefined();
    expect(describeImport(plain)).toBe("1 page · from a PDF");
  });

  it("refuses what is not a PDF, or has no pages", () => {
    expect(() => readPdf(new Uint8Array([1, 2, 3]), [page()], "x")).toThrow(PdfImportError);
    expect(() => readPdf(PDF, [], "x")).toThrow(PdfImportError);
  });

  it("writes a file FineNotes reads back unchanged", () => {
    const result = readPdf(
      PDF,
      [page([{ kind: "ink", color: [0, 0, 255], width: 1.5, paths: [[1, 2, 3, 4]] }])],
      "Round",
    );
    const back = parseInkFile(buildInkFile("# Round\n", result.doc)).doc;
    if (!back) throw new Error("the written file did not read back");
    expect(back.pages[0].backdrop).toEqual(result.doc.pages[0].backdrop);
    expect(back.pages[0].strokes[0].color).toBe("#0000ff");
  });
});
