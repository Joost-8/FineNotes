import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  companionPdfIdentity,
  companionPdfSubject,
  stampCompanionPdfSubject,
} from "../../src/export/companion-metadata";

const ID = "a3f9211234567890";

describe("companion PDF Subject metadata", () => {
  it("formats and validates Subject strings", () => {
    expect(companionPdfSubject(ID)).toBe(`FineNotes companion ${ID}`);
    expect(() => companionPdfSubject("not-valid")).toThrow("Invalid companion identity");
  });

  it("stamps and reads back the companion identity without altering pages", async () => {
    const blank = await PDFDocument.create();
    blank.addPage([400, 600]);
    const raw = await blank.save();
    const rawBuf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    expect(await companionPdfIdentity(rawBuf)).toBeNull();

    const stamped = await stampCompanionPdfSubject(rawBuf, ID);
    const stampedBuf = stamped.buffer.slice(
      stamped.byteOffset,
      stamped.byteOffset + stamped.byteLength,
    ) as ArrayBuffer;
    expect(await companionPdfIdentity(stampedBuf)).toBe(ID);

    const parsed = await PDFDocument.load(stampedBuf);
    expect(parsed.getPageCount()).toBe(1);
  });

  it("returns null for non-PDF bytes or unrelated Subject headers", async () => {
    const garbage = new TextEncoder().encode("not a pdf").buffer;
    expect(await companionPdfIdentity(garbage)).toBeNull();

    const doc = await PDFDocument.create();
    doc.setSubject("Physics Homework");
    const bytes = await doc.save();
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    expect(await companionPdfIdentity(buf)).toBeNull();
  });
});
