/**
 * `src/model/paper-library.ts` — "My templates": where papers live, what
 * they are called, the page shape each gives, and finding a notebook's own
 * copy so a paper used twice is copied once.
 */

import { describe, expect, it } from "vitest";
import {
  existingCopy,
  isTemplatePaper,
  paperFileKind,
  isPaperSource,
  paperBackdrop,
  paperEntries,
  paperGeometry,
  paperName,
  papersFolderOf,
} from "../../src/model/paper-library";
import type { PdfBackdrop } from "../../src/model/document";

describe("the paper library", () => {
  it("lives in Papers inside the templates folder", () => {
    expect(papersFolderOf("FineNotes templates")).toBe("FineNotes templates/Papers");
    expect(papersFolderOf("/Templates/")).toBe("Templates/Papers");
    expect(papersFolderOf("")).toBe("Papers");
  });

  it("takes PDFs and pictures", () => {
    for (const ext of ["pdf", "PDF", "png", "jpg", "jpeg", "webp"])
      expect(isPaperSource(ext)).toBe(true);
    for (const ext of ["svg", "zip", "md", "gif", ""]) expect(isPaperSource(ext)).toBe(false);
  });

  it("names a paper after its file, tidied", () => {
    expect(paperName("Templates/Papers/Weekly planner.pdf")).toBe("Weekly planner");
    expect(paperName("Cornell: notes?.png")).toBe("Cornell notes");
    expect(paperName(".pdf")).toBe("Paper");
  });

  it("makes every page of a PDF a paper, numbered when there are several", () => {
    const sizes = [
      { width: 595, height: 842 },
      { width: 842, height: 595 },
      { width: 0, height: 10 },
    ];
    const entries = paperEntries("P/Planner.pdf", sizes);
    expect(entries.map((e) => [e.page, e.name])).toEqual([
      [0, "Planner · 1"],
      [1, "Planner · 2"],
    ]);
    expect(paperEntries("P/Dots.pdf", [{ width: 1, height: 1 }])[0].name).toBe("Dots");
  });

  it("gives a page the notebook's width and the paper's shape", () => {
    expect(paperGeometry({ width: 595, height: 842 }, 1000)).toEqual({ width: 1000, height: 1415 });
    expect(paperGeometry({ width: 842, height: 595 }, 1000)).toEqual({ width: 1000, height: 707 });
  });

  it("points a page at the notebook's copy, marked as a template's", () => {
    expect(paperBackdrop("Notes/Images/Paper Planner.pdf", 3)).toEqual({
      kind: "pdf",
      path: "Notes/Images/Paper Planner.pdf",
      page: 3,
      template: true,
    });
  });

  describe("which PDF pages are template paper", () => {
    const pdf = (path: string, template?: true): PdfBackdrop =>
      template ? { kind: "pdf", path, page: 0, template } : { kind: "pdf", path, page: 0 };
    const library = new Set(["Weekly planner", "Cornell"]);

    it("a page marked as made from My templates is, whatever its name and the library", () => {
      expect(isTemplatePaper(pdf("N/Images/Lecture 4.pdf", true), new Set())).toBe(true);
    });

    it("an unmarked copy (a notebook made before the mark) is, while its template is listed", () => {
      expect(isTemplatePaper(pdf("N/Images/Paper Weekly planner.pdf"), library)).toBe(true);
      expect(isTemplatePaper(pdf("N/Paper Cornell 2.pdf"), library)).toBe(true);
      expect(isTemplatePaper(pdf("Paper Cornell.PDF"), library)).toBe(true);
    });

    it("an unmarked copy whose template is gone from My templates is not", () => {
      expect(isTemplatePaper(pdf("N/Images/Paper Weekly planner.pdf"), new Set())).toBe(false);
    });

    it("an imported PDF that only looks like a copy is not", () => {
      expect(isTemplatePaper(pdf("Exams/Paper 2.pdf"), library)).toBe(false);
      expect(isTemplatePaper(pdf("N/Paper Weekly.pdf"), library)).toBe(false);
      expect(isTemplatePaper(pdf("N/Paper Cornell notes.pdf"), library)).toBe(false);
      expect(isTemplatePaper(pdf("N/Cornell.pdf"), library)).toBe(false);
      expect(isTemplatePaper(pdf("N/Lecture 4.pdf"), library)).toBe(false);
    });
  });

  it("finds a copy already made, by name and size", () => {
    const shown = [
      { path: "N/Images/Paper Planner 2026-10-17.pdf", size: 900 },
      { path: "N/Images/Lecture 4.pdf", size: 1200 },
    ];
    expect(existingCopy(shown, "Planner", 900)).toBe("N/Images/Paper Planner 2026-10-17.pdf");
    // Another file that happens to share the name is not the same paper.
    expect(existingCopy(shown, "Planner", 901)).toBeNull();
    expect(existingCopy(shown, "Lecture 4", 1200)).toBeNull();
  });

  it("tells a file's kind by its bytes, refusing anything but PDF and pictures", () => {
    const bytes = (...b: number[]) => new Uint8Array(b);
    const text = (t: string) => new TextEncoder().encode(t);
    expect(paperFileKind(text("%PDF-1.7"))).toBe("pdf");
    expect(paperFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe("png");
    expect(paperFileKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    const riff = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0];
    expect(paperFileKind(bytes(...riff, 0x57, 0x45, 0x42, 0x50))).toBe("webp");
    expect(paperFileKind(bytes(...riff, 0x41, 0x56, 0x49, 0x20))).toBeNull();
    expect(paperFileKind(text("<svg xmlns="))).toBeNull();
    expect(paperFileKind(bytes(0x50, 0x4b, 3, 4))).toBeNull();
    expect(paperFileKind(text("<html><script>"))).toBeNull();
    expect(paperFileKind(bytes())).toBeNull();
  });
});
