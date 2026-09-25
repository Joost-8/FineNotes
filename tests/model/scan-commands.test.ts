import { describe, expect, it } from "vitest";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import {
  SCAN_MARGIN,
  buildScanInsert,
  looksLikePdf,
  pdfPageGeometry,
  scanBackdrop,
  scanFileName,
  scanImageBox,
  scanPageGeometry,
} from "../../src/model/scan-commands";

const A4 = { width: 1024, height: 1448 };

function notebook(pages = 3): InkDocument {
  const doc = emptyDocument(1024);
  doc.pages = Array.from({ length: pages }, (_, i) => blankPage(`p${i + 1}`, A4));
  const second = doc.pages[1];
  if (second) {
    second.backdrop = { kind: "ruled-wide", paperColor: "#fdf6e3" };
    second.images.push({ id: "i4", path: "old.png", x: 0, y: 0, w: 10, h: 10 });
  }
  return doc;
}

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

describe("scanFileName", () => {
  it("stamps the time, and numbers the pages of a multi-page scan", () => {
    const at = new Date(2026, 8, 22, 9, 5, 7);
    expect(scanFileName(at)).toBe("Scan 20260922-090507");
    expect(scanFileName(at, 1, 3)).toBe("Scan 20260922-090507 p2");
  });
});

describe("looksLikePdf", () => {
  const bytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

  it("reads the %PDF- header, even after leading junk", () => {
    expect(looksLikePdf(bytes("%PDF-1.7\n%âãÏÓ"), "", "")).toBe(true);
    expect(looksLikePdf(bytes("\n\n  %PDF-1.4"), "", "scan")).toBe(true);
  });

  it("falls back on the type or the name, and says no to a picture", () => {
    expect(looksLikePdf(new Uint8Array(0), "application/PDF", "")).toBe(true);
    expect(looksLikePdf(new Uint8Array(0), "", "Scanned Document.pdf")).toBe(true);
    expect(looksLikePdf(bytes("\xff\xd8\xff\xe0JFIF"), "image/jpeg", "IMG_0001.JPG")).toBe(false);
  });
});

describe("pdfPageGeometry", () => {
  it("takes the PDF page's shape at the notebook's short side", () => {
    expect(pdfPageGeometry(A4, { width: 595, height: 842 })).toEqual({ width: 1024, height: 1449 });
    expect(pdfPageGeometry({ width: 1448, height: 1024 }, { width: 842, height: 595 })).toEqual({
      width: 1449,
      height: 1024,
    });
  });

  it("falls back to the current page for a page with no size", () => {
    expect(pdfPageGeometry(A4, { width: 0, height: 792 })).toEqual(A4);
    expect(pdfPageGeometry(A4, { width: Number.NaN, height: 1 })).toEqual(A4);
  });
});

describe("scanPageGeometry", () => {
  it("keeps the current page's size, turned to the scan's orientation", () => {
    expect(scanPageGeometry(A4, { width: 1500, height: 2000 })).toEqual(A4);
    expect(scanPageGeometry(A4, { width: 2000, height: 1500 })).toEqual({
      width: 1448,
      height: 1024,
    });
    expect(scanPageGeometry({ width: 1448, height: 1024 }, { width: 900, height: 1300 })).toEqual(
      A4,
    );
    expect(scanPageGeometry(A4, { width: 800, height: 800 })).toEqual(A4);
  });

  it("returns a copy, never the page's own geometry object", () => {
    expect(scanPageGeometry(A4, { width: 1, height: 2 })).not.toBe(A4);
  });
});

describe("scanImageBox", () => {
  it("fills the page inside the margin, aspect kept, centred", () => {
    const m = 1024 * SCAN_MARGIN;
    const box = scanImageBox({ width: 1448, height: 2048 }, A4);
    expect(box.w / box.h).toBeCloseTo(1448 / 2048, 9);
    // Width-limited: exactly the margin on each side.
    expect(box.x).toBeCloseTo(m, 9);
    expect(box.x + box.w).toBeCloseTo(1024 - m, 9);
    expect(box.y).toBeGreaterThanOrEqual(m - 1e-9);
    expect(box.y + box.h).toBeLessThanOrEqual(1448 - m + 1e-9);
    expect(box.y + box.h / 2).toBeCloseTo(724, 9);
  });

  it("enlarges a small scan to the page, and survives a nonsense size", () => {
    const small = scanImageBox({ width: 100, height: 50 }, A4);
    expect(small.w).toBeCloseTo(1024 - 2 * 1024 * SCAN_MARGIN, 9);
    const odd = scanImageBox({ width: 0, height: Number.NaN }, A4);
    expect(odd.w).toBeCloseTo(odd.h, 9);
  });
});

describe("scanBackdrop", () => {
  it("is blank paper in the notebook's paper colour", () => {
    const doc = notebook();
    expect(scanBackdrop(doc, 1)).toEqual({ kind: "blank", paperColor: "#fdf6e3" });
    expect(scanBackdrop(doc, 0)).toEqual({ kind: "blank" });
  });

  it("never repeats a PDF or a cover", () => {
    const doc = notebook(2);
    doc.pages[0].backdrop = { kind: "pdf", path: "a.pdf", page: 0 };
    doc.pages[1].backdrop = { kind: "cover-plain", paperColor: "#123456" };
    expect(scanBackdrop(doc, 0)).toEqual({ kind: "blank" });
    expect(scanBackdrop(doc, 1)).toEqual({ kind: "blank" });
  });
});

describe("buildScanInsert", () => {
  const scans = [
    { path: "Scan 1.jpg", width: 1448, height: 2048 },
    { path: "Scan 2.jpg", width: 2048, height: 1448 },
    { path: "Scan 3.png", width: 1400, height: 2000 },
  ];

  it("adds each scan as a new page after the current one, in order", () => {
    const doc = notebook();
    const insert = buildScanInsert(doc, 1, scans)!;
    insert.command.apply(doc);
    expect(insert.addedPages).toBe(true);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p2", "p4", "p5", "p6", "p3"]);
    expect(insert.placed.map((p) => p.pageIndex)).toEqual([2, 3, 4]);
    for (const [n, placed] of insert.placed.entries()) {
      const page = doc.pages[placed.pageIndex];
      expect(page.id).toBe(placed.pageId);
      expect(page.images).toHaveLength(1);
      expect(page.images[0].id).toBe(placed.imageId);
      expect(page.images[0].path).toBe(scans[n].path);
      expect(page.backdrop).toEqual({ kind: "blank", paperColor: "#fdf6e3" });
    }
    // The landscape scan got a landscape page.
    expect(doc.pages[3].geometry).toEqual({ width: 1448, height: 1024 });
    expect(doc.pages[2].geometry).toEqual(A4);
  });

  it("mints image ids that are unique across the document", () => {
    const doc = notebook();
    const insert = buildScanInsert(doc, 1, scans)!;
    expect(insert.placed.map((p) => p.imageId)).toEqual(["i5", "i6", "i7"]);
  });

  it("is one undo step that restores the document exactly", () => {
    const doc = notebook();
    const before = snapshot(doc);
    const insert = buildScanInsert(doc, 1, scans)!;
    insert.command.apply(doc);
    const after = snapshot(doc);
    insert.command.invert(doc);
    expect(snapshot(doc)).toBe(before);
    insert.command.apply(doc);
    expect(snapshot(doc)).toBe(after);
    expect(insert.command.label).toBe("Scan 3 pages");
    expect(buildScanInsert(doc, 0, scans.slice(0, 1))!.command.label).toBe("Scan document");
  });

  it("never adds a page to a single-page document", () => {
    const doc = notebook(1);
    doc.single = true;
    const before = snapshot(doc);
    const insert = buildScanInsert(doc, 0, scans.slice(0, 2))!;
    insert.command.apply(doc);
    expect(insert.addedPages).toBe(false);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].images.map((i) => i.path)).toEqual(["Scan 1.jpg", "Scan 2.jpg"]);
    expect(new Set(doc.pages[0].images.map((i) => i.id)).size).toBe(2);
    expect(insert.placed.every((p) => p.pageIndex === 0 && p.pageId === "p1")).toBe(true);
    insert.command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("adds a PDF as one PDF-backed page per PDF page, shaped like each page", () => {
    const doc = notebook();
    const before = snapshot(doc);
    const pdf = {
      kind: "pdf" as const,
      path: "Scanned Document.pdf",
      pages: [
        { width: 612, height: 792 }, // Letter, portrait
        { width: 842, height: 595 }, // A4, landscape
      ],
    };
    const insert = buildScanInsert(doc, 0, [pdf])!;
    insert.command.apply(doc);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p4", "p5", "p2", "p3"]);
    expect(doc.pages[1].backdrop).toEqual({ kind: "pdf", path: "Scanned Document.pdf", page: 0 });
    expect(doc.pages[2].backdrop).toEqual({ kind: "pdf", path: "Scanned Document.pdf", page: 1 });
    expect(doc.pages[1].geometry).toEqual({ width: 1024, height: 1325 });
    expect(doc.pages[2].geometry).toEqual({ width: 1449, height: 1024 });
    expect(doc.pages[1].images).toEqual([]);
    expect(insert.placed).toEqual([
      { pageId: "p4", pageIndex: 1 },
      { pageId: "p5", pageIndex: 2 },
    ]);
    expect(insert.command.label).toBe("Scan 2 pages");
    insert.command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("keeps photo scans and PDF pages in the order they were scanned", () => {
    const doc = notebook();
    const pdf = { kind: "pdf" as const, path: "a.pdf", pages: [{ width: 612, height: 792 }] };
    const insert = buildScanInsert(doc, 2, [scans[0], pdf, scans[1]])!;
    insert.command.apply(doc);
    expect(doc.pages.slice(3).map((p) => p.backdrop.kind)).toEqual(["blank", "pdf", "blank"]);
    expect(doc.pages[3].images[0].path).toBe("Scan 1.jpg");
    expect(doc.pages[5].images[0].path).toBe("Scan 2.jpg");
    expect(insert.placed.map((p) => p.pageIndex)).toEqual([3, 4, 5]);
  });

  it("leaves a PDF out of a single page, which can take no pages", () => {
    const doc = notebook(1);
    doc.single = true;
    const pdf = { kind: "pdf" as const, path: "a.pdf", pages: [{ width: 612, height: 792 }] };
    expect(buildScanInsert(doc, 0, [pdf])).toBeNull();
    const mixed = buildScanInsert(doc, 0, [pdf, scans[0]])!;
    mixed.command.apply(doc);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].images.map((i) => i.path)).toEqual(["Scan 1.jpg"]);
  });

  it("builds nothing for no scans or a page that is not there", () => {
    const doc = notebook();
    expect(buildScanInsert(doc, 1, [])).toBeNull();
    expect(buildScanInsert(doc, 7, scans)).toBeNull();
  });

  it("does not touch the document until applied", () => {
    const doc = notebook();
    const before = snapshot(doc);
    buildScanInsert(doc, 2, scans);
    expect(snapshot(doc)).toBe(before);
  });
});
