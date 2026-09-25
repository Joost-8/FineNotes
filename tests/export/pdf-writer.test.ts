import { describe, expect, it } from "vitest";
import {
  EXPORT_MAX_EDGE,
  EXPORT_MAX_PIXELS,
  EXPORT_PIXEL_SCALE,
  POINTS_PER_PAGE_PX,
  type PdfImagePage,
  buildImagePdf,
  exportPixelScale,
  pdfDate,
  pdfString,
} from "../../src/export/pdf-writer";

/** Latin-1 view of the bytes: one char per byte, so offsets line up. */
function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** A stand-in JPEG: SOI, some bytes that look like PDF syntax, EOI. */
function fakeJpeg(fill: number): Uint8Array {
  const body = [..."endobj stream )"].map((c) => c.charCodeAt(0));
  return new Uint8Array([0xff, 0xd8, fill, ...body, 0x00, 0xff, 0xd9]);
}

function page(w: number, h: number, fill = 1): PdfImagePage {
  return {
    jpeg: fakeJpeg(fill),
    pixelWidth: w * 2,
    pixelHeight: h * 2,
    widthPt: w * POINTS_PER_PAGE_PX,
    heightPt: h * POINTS_PER_PAGE_PX,
  };
}

describe("buildImagePdf", () => {
  const pdf = buildImagePdf([page(1024, 1448, 1), page(1448, 1024, 2), page(1024, 1448, 3)], {
    title: "Biology",
    created: new Date(Date.UTC(2026, 8, 24, 13, 5, 9)),
  });
  const text = latin1(pdf);

  it("starts with a PDF header and ends with %%EOF", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("has an xref whose every offset lands on its object", () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const header = /xref\n0 (\d+)\n/.exec(text.slice(startxref));
    const size = Number(header?.[1]);
    expect(size).toBe(4 + 3 * 3);
    const rows = text
      .slice(startxref + (header?.[0].length ?? 0))
      .split("\n")
      .slice(0, size);
    expect(rows[0]).toBe("0000000000 65535 f ");
    for (let n = 1; n < size; n++) {
      // Each xref row is exactly 20 bytes including its end-of-line.
      expect(rows[n]).toHaveLength(19);
      const offset = Number(rows[n].slice(0, 10));
      expect(text.slice(offset, offset + `${n} 0 obj`.length)).toBe(`${n} 0 obj`);
    }
    expect(text).toContain(`/Size ${size} /Root 1 0 R /Info 3 0 R`);
  });

  it("lists every page in order with its own size", () => {
    expect(text).toContain("/Kids [4 0 R 7 0 R 10 0 R] /Count 3");
    const boxes = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(boxes).toHaveLength(3);
    // A4 at 1024 page px is 595.28 x 841.89 pt.
    expect(boxes[0][0]).toBeCloseTo(595.28, 1);
    expect(boxes[0][1]).toBeCloseTo(841.8, 0);
    expect(boxes[1][0]).toBeCloseTo(boxes[0][1], 1);
  });

  it("embeds each JPEG untouched, with a matching length", () => {
    const images = [
      ...text.matchAll(/\/Width (\d+) \/Height (\d+) .*?\/Length (\d+) >>\nstream\n/g),
    ];
    expect(images).toHaveLength(3);
    images.forEach((m, i) => {
      const start = (m.index ?? 0) + m[0].length;
      const length = Number(m[3]);
      expect(Array.from(pdf.slice(start, start + length))).toEqual(Array.from(fakeJpeg(i + 1)));
      expect(text.slice(start + length, start + length + 10)).toBe("\nendstream");
    });
    expect(images[0][1]).toBe("2048");
    expect(images[1][1]).toBe("2896");
  });

  it("scales the image to fill the page", () => {
    expect(text).toMatch(/stream\nq 595\.28 0 0 841\.\d+ 0 0 cm \/Im0 Do Q\nendstream/);
  });

  it("writes content-stream lengths that match", () => {
    for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = (m.index ?? 0) + m[0].length;
      expect(text.slice(start + Number(m[1]), start + Number(m[1]) + 9)).toBe("endstream");
    }
  });

  it("records title, producer and creation date", () => {
    expect(text).toContain("/Title (Biology)");
    expect(text).toContain("/Producer (FineNotes)");
    expect(text).toContain("/CreationDate (D:20260924130509Z)");
  });

  it("leaves out metadata it was not given", () => {
    const bare = latin1(buildImagePdf([page(100, 100)]));
    expect(bare).not.toContain("/Title");
    expect(bare).not.toContain("/CreationDate");
  });

  it("refuses an empty document and a page without a size", () => {
    expect(() => buildImagePdf([])).toThrow(/at least one page/);
    expect(() => buildImagePdf([page(100, 100), { ...page(100, 100), widthPt: 0 }])).toThrow(
      /Page 2/,
    );
    expect(() => buildImagePdf([{ ...page(100, 100), pixelHeight: Number.NaN }])).toThrow();
  });
});

describe("exportPixelScale", () => {
  it("rasterises an ordinary page at twice its size", () => {
    expect(exportPixelScale(1024, 1448)).toBe(EXPORT_PIXEL_SCALE);
  });

  it("stays under both caps for a huge page", () => {
    for (const [w, h] of [
      [4000, 300],
      [3000, 3000],
      [1024, 20000],
    ]) {
      const k = exportPixelScale(w, h);
      expect(Math.max(w, h) * k).toBeLessThanOrEqual(EXPORT_MAX_EDGE + 1e-6);
      expect(w * k * h * k).toBeLessThanOrEqual(EXPORT_MAX_PIXELS + 1e-3);
      expect(k).toBeGreaterThan(0);
    }
  });

  it("is 0 for a page without a size", () => {
    expect(exportPixelScale(0, 100)).toBe(0);
    expect(exportPixelScale(100, Number.NaN)).toBe(0);
    expect(exportPixelScale(Infinity, 100)).toBe(0);
  });
});

describe("pdfString", () => {
  it("escapes the three special characters of a literal string", () => {
    expect(pdfString("a(b)c\\d")).toBe("(a\\(b\\)c\\\\d)");
  });

  it("writes non-ASCII as UTF-16BE hex with a byte-order mark", () => {
    expect(pdfString("é")).toBe("<FEFF00E9>");
    // A character outside the BMP is a surrogate pair, as UTF-16 requires.
    expect(pdfString("📓")).toBe("<FEFFD83DDCD3>");
  });
});

describe("pdfDate", () => {
  it("formats in UTC with zero padding", () => {
    expect(pdfDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("D:20260102030405Z");
  });
});
