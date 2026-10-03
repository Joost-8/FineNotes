import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRef, PDFString, StandardFonts } from "pdf-lib";
import { removeUnusedPdfObjects } from "../../src/export/pdf-resources";

describe("PDF resource cleanup", () => {
  it("retains reachable content, fonts, metadata, arrays and cycles; removes detached streams", async () => {
    const document = await PDFDocument.create();
    document.setTitle("Keep metadata");
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage().drawText("Keep text", { font });
    await document.flush();
    const context = document.context;
    const orphan = context.register(context.stream(new Uint8Array(1024 * 1024)));
    const shared = context.register(context.obj({ Name: PDFString.of("shared") }));
    const array = context.register(context.obj([shared, shared, PDFRef.of(99999)]));
    const cyclic = context.obj({ Next: array });
    const cycle = context.register(cyclic);
    cyclic.set(PDFName.of("Self"), cycle);
    document.catalog.set(PDFName.of("Test"), context.obj([array, cycle]));
    const before = context.enumerateIndirectObjects().length;
    removeUnusedPdfObjects(document);
    expect(context.lookup(orphan)).toBeUndefined();
    expect(context.lookup(shared)).toBeDefined();
    expect(context.lookup(array)).toBeDefined();
    expect(context.lookup(cycle)).toBeDefined();
    expect(context.enumerateIndirectObjects().length).toBe(before - 1);
    removeUnusedPdfObjects(document);
    const loaded = await PDFDocument.load(await document.save());
    expect(loaded.getTitle()).toBe("Keep metadata");
    expect(loaded.getPageCount()).toBe(1);
  });
});
