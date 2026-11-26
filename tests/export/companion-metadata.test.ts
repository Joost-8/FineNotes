/**
 * A Companion PDF's Subject, read from the trailer and the Info dictionary
 * without parsing the PDF: on PDFs written by our own composer and by
 * pdf-lib, and the cases that must read as "not ours".
 */
import { readFileSync } from "node:fs";
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

  /**
   * A PDF written by hand with classic cross-reference tables: `sections`
   * are a first save and incremental updates, each object by number.
   */
  function handWritten(sections: Array<{ objects: Record<number, string>; info: number }>): string {
    let text = "%PDF-1.7\n";
    let prev: number | null = null;
    for (const { objects, info } of sections) {
      const offsets: Array<[number, number]> = [];
      for (const [num, body] of Object.entries(objects)) {
        offsets.push([Number(num), text.length]);
        text += `${num} 0 obj ${body} endobj\n`;
      }
      const xref = text.length;
      text += "xref\n";
      for (const [num, at] of offsets) {
        text += `${num} 1\n${String(at).padStart(10, "0")} 00000 n\r\n`;
      }
      text += `trailer << /Size 9 /Root 1 0 R /Info ${info} 0 R${prev === null ? "" : ` /Prev ${prev}`} >>\n`;
      text += `startxref\n${xref}\n%%EOF\n`;
      prev = xref;
    }
    return text;
  }

  it("reads a literal string, and the newest Info of an updated PDF", () => {
    const pdf = handWritten([
      {
        objects: {
          1: "<< /Type /Catalog >>",
          2: `<< /Subject (FineNotes companion bbbbbbbbbbbbbbbb ${HASH}) >>`,
        },
        info: 2,
      },
      // An incremental update: a new Info, and a trailer naming it.
      {
        objects: { 3: `<< /Title (x\\)y) /Subject (FineNotes companion ${ID} ${HASH}) >>` },
        info: 3,
      },
    ]);
    expect(readCompanionSubject(latin1(pdf))).toEqual({ id: ID, contentHash: HASH });
  });

  it("reads the newest copy of an Info object an update rewrote", () => {
    const pdf = handWritten([
      { objects: { 1: "<< >>", 2: `<< /Subject (FineNotes companion ${ID} ${HASH}) >>` }, info: 2 },
      { objects: { 2: "<< /Subject (Lecture 4) >>" }, info: 2 },
    ]);
    expect(readCompanionSubject(latin1(pdf))).toBeNull();
  });

  it("reads nothing it cannot reach through the tables", () => {
    // No cross-reference table at all: never found by searching the file.
    const bare = [
      "%PDF-1.7",
      `2 0 obj << /Subject (FineNotes companion ${ID} ${HASH}) >> endobj`,
      "trailer << /Info 2 0 R >>",
      "startxref\n9\n%%EOF",
    ].join("\n");
    expect(readCompanionSubject(latin1(bare))).toBeNull();
  });
});

describe("PDFs other tools wrote from one of ours", () => {
  const read = (name: string) =>
    readCompanionSubject(
      new Uint8Array(readFileSync(new URL(`./fixtures/companion/${name}`, import.meta.url))),
    );
  const ours = { id: "0123456789abcdef", contentHash: "fedcba9876543210" };

  it("keeps the Subject through a plain rewrite, an incremental save and linearizing", () => {
    expect(read("ours.pdf")).toEqual(ours);
    expect(read("mupdf-incremental.pdf")).toEqual(ours);
    expect(read("pypdf-rewritten.pdf")).toEqual(ours);
    expect(read("qpdf-linearized.pdf")).toEqual(ours);
  });

  it("reads one whose tables are compressed as not ours, never an older Info", () => {
    expect(read("mupdf-object-streams.pdf")).toBeNull();
    // pypdf's incremental update changed the Subject; the old one is still in the file.
    expect(read("pypdf-incremental-subject-changed.pdf")).toBeNull();
  });
});
