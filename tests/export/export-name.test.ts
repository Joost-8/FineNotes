import { describe, expect, it } from "vitest";
import {
  exportNamesOf,
  movePdfNames,
  pdfName,
  rememberPdfName,
  typedPdfName,
} from "../../src/export/export-name";

describe("typedPdfName", () => {
  it("drops the .pdf, slashes and edge blanks", () => {
    expect(typedPdfName("  Anna / algebra.PDF ")).toBe("Anna algebra");
    expect(typedPdfName("Lesson: 3")).toBe("Lesson 3");
    expect(typedPdfName(".pdf")).toBe("");
    expect(typedPdfName("   ")).toBe("");
  });
});

describe("pdfName", () => {
  const taken = new Set(["Anna.pdf", "Biology.pdf"]);
  it("takes the free default when nothing is typed", () => {
    expect(pdfName("", "Biology 2.pdf", taken)).toEqual({ name: "Biology 2.pdf", replaces: false });
  });
  it("uses a typed name, replacing a file of that name", () => {
    expect(pdfName("Anna", "Biology 2.pdf", taken)).toEqual({ name: "Anna.pdf", replaces: true });
    expect(pdfName("Ben.pdf", "Biology 2.pdf", taken)).toEqual({
      name: "Ben.pdf",
      replaces: false,
    });
  });
  it("matches an existing file whatever its case, and keeps that file's name", () => {
    expect(pdfName("anna", "x.pdf", taken)).toEqual({ name: "Anna.pdf", replaces: true });
  });
});

describe("rememberPdfName", () => {
  it("sets a notebook's name and drops it when emptied", () => {
    const one = rememberPdfName({}, "Tutoring/Anna.md", "Anna algebra.pdf");
    expect(one).toEqual({ "Tutoring/Anna.md": "Anna algebra" });
    expect(rememberPdfName(one, "Tutoring/Anna.md", " ")).toEqual({});
  });
});

describe("movePdfNames", () => {
  const names = { "Tutoring/Anna.md": "Anna", "Tutoring/Ben.md": "Ben", "Other.md": "O" };
  it("follows a rename of the notebook or of its folder", () => {
    expect(movePdfNames(names, "Tutoring/Anna.md", "Tutoring/Anna B.md")).toEqual({
      "Tutoring/Anna B.md": "Anna",
      "Tutoring/Ben.md": "Ben",
      "Other.md": "O",
    });
    expect(movePdfNames(names, "Tutoring", "Students")).toEqual({
      "Students/Anna.md": "Anna",
      "Students/Ben.md": "Ben",
      "Other.md": "O",
    });
  });
  it("forgets what a delete took", () => {
    expect(movePdfNames(names, "Tutoring")).toEqual({ "Other.md": "O" });
  });
});

describe("exportNamesOf", () => {
  it("keeps only names, from whatever the settings file holds", () => {
    expect(exportNamesOf(null)).toEqual({});
    expect(exportNamesOf(["a"])).toEqual({});
    expect(exportNamesOf({ "a.md": "A.pdf", "b.md": 3, "c.md": " " })).toEqual({ "a.md": "A" });
  });
});
