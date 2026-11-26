/**
 * A Companion PDF's Subject, read from the trailer and the Info dictionary
 * without parsing the PDF: on PDFs written by our own composer and by
 * pdf-lib, and the cases that must read as "not ours".
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  companionPdfSubject,
  parseCompanionSubject,
  readCompanionSubject,
  stampCompanionPdfSubject,
} from "../../src/export/companion-metadata";
import { PdfComposer } from "../../src/export/pdf-composer";

const ID = "a3f9211234567890";
const HASH = "0123456789abcdef";

async function composed(subject?: string): Promise<Uint8Array> {
  const composer = await PdfComposer.create("Biology", null, subject);
  await composer.addLayered(595, 842, []);
  await composer.addLayered(595, 842, []);
  return composer.save();
}

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("the Subject", () => {
  it("names the notebook and the content", () => {
    expect(companionPdfSubject(ID, HASH)).toBe(`FineNotes companion ${ID} ${HASH}`);
    expect(companionPdfSubject(ID)).toBe(`FineNotes companion ${ID}`);
    expect(() => companionPdfSubject("nope")).toThrow();
    expect(parseCompanionSubject(`FineNotes companion ${ID} ${HASH}`)).toEqual({
      id: ID,
      contentHash: HASH,
    });
    expect(parseCompanionSubject(`FineNotes companion ${ID}`)).toEqual({
      id: ID,
      contentHash: null,
    });
    expect(parseCompanionSubject("Lecture notes")).toBeNull();
    expect(parseCompanionSubject(null)).toBeNull();
  });
});

describe("reading it without parsing the PDF", () => {
  it("reads what our own composer writes", async () => {
    const bytes = await composed(companionPdfSubject(ID, HASH));
    expect(readCompanionSubject(bytes)).toEqual({ id: ID, contentHash: HASH });
    // And pdf-lib agrees the PDF is whole and says the same.
    expect((await PDFDocument.load(bytes)).getSubject()).toBe(companionPdfSubject(ID, HASH));
  });

  it("finds none in a PDF without one", async () => {
    expect(readCompanionSubject(await composed())).toBeNull();
    expect(readCompanionSubject(new Uint8Array())).toBeNull();
    expect(readCompanionSubject(latin1("not a pdf at all"))).toBeNull();
  });

  it("reads a PDF pdf-lib stamped (the export dialog's Keep updated)", async () => {
    const plain = await (await PDFDocument.create()).save();
    const stamped = await stampCompanionPdfSubject(plain, ID, HASH);
    expect(readCompanionSubject(stamped)).toEqual({ id: ID, contentHash: HASH });
  });

  it("reads a compressed Info as no Subject: never taken for ours", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.setSubject(companionPdfSubject(ID, HASH));
    // pdf-lib's default packs the Info dictionary into a compressed object stream.
    expect(readCompanionSubject(await pdf.save())).toBeNull();
  });

  it("reads a literal string, and the newest Info of an updated PDF", () => {
    const pdf = [
      "%PDF-1.7",
      "1 0 obj << /Type /Catalog >> endobj",
      `2 0 obj << /Subject (FineNotes companion bbbbbbbbbbbbbbbb ${HASH}) >> endobj`,
      "trailer << /Root 1 0 R /Info 2 0 R >>",
      "%%EOF",
      // An incremental update: a new Info, and a trailer naming it.
      `3 0 obj << /Title (x\\)y) /Subject (FineNotes companion ${ID} ${HASH}) >> endobj`,
      "trailer << /Root 1 0 R /Info 3 0 R /Prev 0 >>",
      "%%EOF",
    ].join("\n");
    expect(readCompanionSubject(latin1(pdf))).toEqual({ id: ID, contentHash: HASH });
  });

  it("is not fooled by an object number that ends the same", () => {
    const pdf = [
      "%PDF-1.7",
      `12 0 obj << /Subject (FineNotes companion bbbbbbbbbbbbbbbb ${HASH}) >> endobj`,
      `2 0 obj << /Subject (FineNotes companion ${ID} ${HASH}) >> endobj`,
      "trailer << /Info 2 0 R >>",
    ].join("\n");
    expect(readCompanionSubject(latin1(pdf))?.id).toBe(ID);
  });
});
