import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  type PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import { PdfComposer } from "../../src/export/pdf-composer";
import { blankPage } from "../../src/model/document";
import { POINTS_PER_PAGE_PX } from "../../src/export/pdf-writer";

// A transparent 1×1 PNG; no DOM needed for composition tests.
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=",
    "base64",
  ),
);
async function* overlay() {
  yield { png };
}
async function source(rotation = 0): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([600, 800]);
    page.setCropBox(20, 30, 500, 700);
    page.setRotation(degrees(rotation));
    page.drawText(`Source page ${i + 1}`, { font, x: 60, y: 600 });
  }
  const bytes = await doc.save();
  return bytes.slice().buffer as ArrayBuffer;
}
function notebookPage(index = 0) {
  return {
    ...blankPage("p1", { width: 1000, height: 1400 }),
    backdrop: { kind: "pdf" as const, path: "slides.pdf", page: index },
  };
}
function streams(doc: PDFDocument): string[] {
  return doc.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream &&
      object.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")
        ? [Buffer.from(decodePDFRawStream(object).decode()).toString("latin1")]
        : [],
    );
}

describe("PDF composition", () => {
  it("retains source text operators, selection order and annotation overlays, reading once", async () => {
    const bytes = await source();
    const before = new Uint8Array(bytes.slice(0));
    const read = vi.fn(async () => bytes);
    const composer = await PdfComposer.create("Lecture", read);
    await composer.addPdf(notebookPage(2), overlay);
    await composer.addPdf(notebookPage(0), overlay);
    await composer.addPdf(notebookPage(2), overlay);
    const result = await PDFDocument.load(await composer.save());
    expect(result.getPageCount()).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(bytes)).toEqual(before);
    expect(result.getTitle()).toBe("Lecture");
    expect(streams(result).join("\n")).toContain(
      Buffer.from("Source page 3").toString("hex").toUpperCase(),
    );
    expect(streams(result).join("\n")).toContain(" Tj");
    expect(
      result.context
        .enumerateIndirectObjects()
        .filter(
          ([, object]) =>
            object instanceof PDFRawStream &&
            object.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"),
        ),
    ).toHaveLength(2);
    const pageStreams = result.getPages().map((page) => {
      const contents = page.node.Contents() as PDFArray;
      const stream = result.context.lookup(contents.asArray()[0]) as PDFRawStream;
      return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    });
    for (const content of pageStreams) {
      expect(content.indexOf("/EmbeddedPdfPage")).toBeLessThan(content.indexOf("/Image"));
    }
  });

  it.each([0, 90, 180, 270])(
    "contains cropped pages rotated %i degrees in notebook geometry",
    async (rotation) => {
      const composer = await PdfComposer.create("Rotated", () => source(rotation));
      const page = notebookPage();
      await composer.addPdf(page, overlay);
      const doc = await PDFDocument.load(await composer.save());
      expect(doc.getPage(0).getRotation().angle).toBe(0);
      expect(doc.getPage(0).getWidth()).toBeCloseTo(1000 * POINTS_PER_PAGE_PX);
      const form = doc.context
        .enumerateIndirectObjects()
        .find(
          ([, object]) =>
            object instanceof PDFRawStream &&
            object.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"),
        )![1] as PDFRawStream;
      expect(form.dict.lookup(PDFName.of("BBox"))!.toString()).toBe("[ 20 30 520 730 ]");
    },
  );

  it("exports ordinary JPEG pages alongside preserved PDF pages, with multiply highlighting", async () => {
    const composer = await PdfComposer.create("Mixed", () => source());
    await composer.addImage({
      jpeg: new Uint8Array(readFileSync(new URL("./fixtures/white.jpg", import.meta.url))),
      pixelWidth: 8,
      pixelHeight: 8,
      widthPt: 400,
      heightPt: 600,
    });
    await composer.addPdf(notebookPage(1), async function* () {
      yield { png };
      yield { png, multiply: true };
      yield { png };
    });
    const result = await PDFDocument.load(await composer.save());
    expect(result.getPageCount()).toBe(2);
    expect(result.getPage(0).getSize()).toEqual({ width: 400, height: 600 });
    const graphics = result.getPage(1).node.Resources()!.lookup(PDFName.of("ExtGState"), PDFDict);
    expect(
      graphics
        .entries()
        .some(
          ([, value]) =>
            result.context.lookup(value, PDFDict).get(PDFName.of("BM")) === PDFName.of("Multiply"),
        ),
    ).toBe(true);
  });

  it("supports blank PDF pages without content streams", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
    const composer = await PdfComposer.create("Blank", async () => bytes);
    await composer.addPdf(notebookPage(), overlay);
    expect((await PDFDocument.load(await composer.save())).getPageCount()).toBe(1);
  });

  it("rejects missing, corrupt, encrypted and out-of-range sources instead of degrading them", async () => {
    const missing = await PdfComposer.create("Missing", () =>
      Promise.reject(new Error("Missing PDF")),
    );
    await expect(missing.addPdf(notebookPage(), overlay)).rejects.toThrow("Missing PDF");
    const corrupt = await PdfComposer.create("Bad", async () => new ArrayBuffer(2));
    await expect(corrupt.addPdf(notebookPage(), overlay)).rejects.toThrow();
    const outside = await PdfComposer.create("Outside", () => source());
    await expect(outside.addPdf(notebookPage(3), overlay)).rejects.toThrow("Missing page 4");
    const encryptedDoc = await PDFDocument.create();
    encryptedDoc.addPage();
    encryptedDoc.context.trailerInfo.Encrypt = encryptedDoc.context.register(
      encryptedDoc.context.obj({ Filter: "Standard" }),
    );
    const encrypted = (await encryptedDoc.save()).slice().buffer as ArrayBuffer;
    const composer = await PdfComposer.create("Encrypted", async () => encrypted);
    await expect(composer.addPdf(notebookPage(), overlay)).rejects.toThrow(/encrypted/);
  });
});

describe("vector overlays", () => {
  it("embeds PDF drawing/text operators above raster paper and below ink", async () => {
    const composer = await PdfComposer.create("SVG", () => source());
    await composer.addImage(
      {
        jpeg: new Uint8Array(readFileSync(new URL("./fixtures/white.jpg", import.meta.url))),
        pixelWidth: 8,
        pixelHeight: 8,
        widthPt: 400,
        heightPt: 600,
      },
      async function* () {
        yield { pdf: new Uint8Array(await source()) };
        yield { png, multiply: true };
      },
    );
    const result = await PDFDocument.load(await composer.save());
    expect(streams(result).join("\n")).toContain(" Tj");
    const contents = streams(result).find((s) => s.includes("/EmbeddedPdfPage"))!;
    expect(contents.indexOf("/Image")).toBeLessThan(contents.indexOf("/EmbeddedPdfPage"));
    expect(contents.lastIndexOf("/Image")).toBeGreaterThan(contents.indexOf("/EmbeddedPdfPage"));
  });
});

describe("shared SVG placement", () => {
  it.each([0, Math.PI / 2, -Math.PI / 3])(
    "shares vector content while independently clipping and rotating placements (%s)",
    async (rotation) => {
      const composer = await PdfComposer.create("Shared", () => source());
      const pdf = new Uint8Array(await source());
      const image = {
        id: "i",
        path: "art.svg",
        x: 20,
        y: 30,
        w: 200,
        h: 160,
        rotation,
        crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
      };
      for (let i = 0; i < 2; i++)
        await composer.addPdf(notebookPage(), async function* () {
          yield { pdf, key: image.path, image };
          yield { pdf, key: image.path, image: { ...image, id: "i2", x: 250, crop: undefined } };
        });
      const result = await PDFDocument.load(await composer.save());
      const forms = result.context
        .enumerateIndirectObjects()
        .filter(
          ([, o]) =>
            o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"),
        );
      // One original backdrop and one shared SVG form, irrespective of placement count.
      expect(forms).toHaveLength(2);
      for (const page of result.getPages()) {
        const contents = page.node.Contents() as PDFArray;
        const stream = result.context.lookup(contents.asArray()[0]) as PDFRawStream;
        const content = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
        expect(content.match(/\nW\n/g)).toHaveLength(2);
        expect(content.match(/\nDo\n/g)).toBeNull();
        expect(content.match(/ Do\n/g)).toHaveLength(3);
        if (!rotation) {
          expect(content).toContain(
            `${20 * POINTS_PER_PAGE_PX} ${(1400 - 30) * POINTS_PER_PAGE_PX} m`,
          );
          const translations = [...content.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm/g)].map(
            (match) => Number(match[1]),
          );
          expect(
            translations.some(
              (x) => Math.abs(x - (20 - (200 * 0.1) / 0.7) * POINTS_PER_PAGE_PX) < 1e-9,
            ),
          ).toBe(true);
        }
      }
      expect(streams(result).join("\n")).toContain(" Tj");
    },
  );
});
