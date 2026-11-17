import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { PdfComposer } from "../../src/export/pdf-composer";
import { POINTS_PER_PAGE_PX } from "../../src/export/pdf-writer";
import { vectorInk } from "../../src/export/vector-ink";
import { blankPage, type Stroke } from "../../src/model/document";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=",
    "base64",
  ),
);
const jpeg = Uint8Array.from(readFileSync(new URL("./fixtures/white.jpg", import.meta.url)));
const options = { usePressure: false, highlighterAlpha: 0.3, shade: "day" as const };

/** The page's content streams, decoded, in order. */
function contents(doc: PDFDocument, index = 0): string[] {
  const value = doc.getPage(index).node.Contents();
  const refs = value instanceof PDFRawStream ? [value] : (value as PDFArray).asArray();
  return refs.map((ref) => {
    const stream = ref instanceof PDFRawStream ? ref : (doc.context.lookup(ref) as PDFRawStream);
    return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  });
}

async function source(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText("Source page 1", { font, x: 60, y: 600 });
  return (await doc.save()).slice().buffer as ArrayBuffer;
}

describe("PDF composition with vector ink", () => {
  it("lays a page bottom up: the paper picture, the ink in vectors, then what lies over it", async () => {
    const ink = vectorInk(
      [
        { id: "p", tool: "pen", color: "#000000", size: 3, pts: [10, 20, 0.5, 60, 20, 0.5] },
        {
          id: "h",
          tool: "highlighter",
          color: "#ffff00",
          size: 12,
          pts: [10, 40, 0.5, 60, 40, 0.5],
        },
      ] as Stroke[],
      options,
    );
    const composer = await PdfComposer.create("Vector");
    await composer.addLayered(1000 * POINTS_PER_PAGE_PX, 1400 * POINTS_PER_PAGE_PX, [
      { jpeg },
      { ink },
      { png },
    ]);
    const doc = await PDFDocument.load(await composer.save());
    const text = contents(doc);
    expect(text).toHaveLength(3);
    // The paper: a JPEG filling the page.
    expect(text[0]).toMatch(/^q\n[\d.]+ 0 0 [\d.]+ 0 0 cm\n\/FnIm\d+ Do\nQ$/);
    // The ink, in page px with y down, its highlighter in a multiplied state of its own.
    const s = POINTS_PER_PAGE_PX;
    expect(text[1]).toContain(`${s} 0 0 ${-s} 0 ${1400 * s} cm`);
    expect(text[1]).toContain("10 20 m\n35 20 l\n60 20 l\nS");
    const gs = /\/(FnGs\d+) gs/.exec(text[1])?.[1];
    expect(gs).toBeDefined();
    const state = doc
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of("ExtGState"), PDFDict)
      .lookup(PDFName.of(gs!), PDFDict);
    expect(state.get(PDFName.of("BM"))).toBe(PDFName.of("Multiply"));
    expect(state.get(PDFName.of("ca"))?.toString()).toBe("0.3");
    // What lies over the ink: a PNG, last.
    expect(text[2]).toMatch(/\/FnIm\d+ Do/);
  });

  it("puts a highlighter's several runs in a transparency group of its own", async () => {
    const ink = vectorInk(
      [
        {
          id: "h",
          tool: "highlighter",
          color: "#ffff00",
          size: 10,
          pts: [10, 10, 0.5, 40, 10, 0.5, 70, 10, 0.5, 100, 10, 0.5, 130, 10, 0.5],
          tilt: [90, 60, 35, 25, 15],
        },
      ] as Stroke[],
      options,
    );
    expect(ink.groups.size).toBe(1);
    const composer = await PdfComposer.create("Group");
    await composer.addLayered(100, 100, [{ ink }]);
    const doc = await PDFDocument.load(await composer.save());
    const name = /\/(FnInk\d+) Do/.exec(contents(doc)[0])?.[1];
    expect(name).toBeDefined();
    const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    const form = doc.context.lookup(xobjects.get(PDFName.of(name!))) as PDFRawStream;
    const group = form.dict.lookup(PDFName.of("Group"), PDFDict);
    expect(group.get(PDFName.of("S"))).toBe(PDFName.of("Transparency"));
    expect(Buffer.from(decodePDFRawStream(form).decode()).toString("latin1")).toMatch(/^S$/m);
  });

  it("skips an empty ink layer", async () => {
    const composer = await PdfComposer.create("Empty");
    await composer.addLayered(100, 100, [{ jpeg }, { ink: vectorInk([], options) }]);
    const doc = await PDFDocument.load(await composer.save());
    expect(contents(doc)).toHaveLength(1);
  });

  it("puts the ink after a PDF page's own content, and a raster over the ink after it", async () => {
    const composer = await PdfComposer.create("Annotated", () => source());
    const ink = vectorInk(
      [
        { id: "p", tool: "pen", color: "#ff0000", size: 2, pts: [5, 5, 0.5, 9, 9, 0.5] },
      ] as Stroke[],
      options,
    );
    const page = {
      ...blankPage("p1", { width: 1000, height: 1400 }),
      backdrop: { kind: "pdf" as const, path: "slides.pdf", page: 0 },
    };
    await composer.addPdf(page, async function* () {
      yield { ink };
      yield { png, multiply: true };
    });
    const doc = await PDFDocument.load(await composer.save());
    const text = contents(doc);
    const inkAt = text.findIndex((t) => t.includes("1 0 0 RG"));
    const pngAt = text.findIndex((t) => /\/FnIm\d+ Do/.test(t));
    expect(inkAt).toBeGreaterThan(0);
    expect(pngAt).toBeGreaterThan(inkAt);
    expect(text[pngAt]).toMatch(/\/FnGs\d+ gs/);
  });

  it("refuses a PDF page without a way to read its source, and a layered page without a size", async () => {
    const composer = await PdfComposer.create("No reader");
    const page = {
      ...blankPage("p1"),
      backdrop: { kind: "pdf" as const, path: "slides.pdf", page: 0 },
    };
    await expect(composer.addPdf(page, async function* () {})).rejects.toThrow("PDF source reader");
    await expect(composer.addLayered(0, 10, [])).rejects.toThrow("no size");
  });
});
