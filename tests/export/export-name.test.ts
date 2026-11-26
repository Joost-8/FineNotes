import { describe, expect, it } from "vitest";
import {
  exportNamesOf,
  movePdfNames,
  ownPdfName,
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
  const taken = new Set(["Anna algebra.pdf", "Lecture 3.pdf", "Lecture 3.notebook.md"]);
  it("takes the free default when nothing is typed", () => {
    expect(pdfName("", "Lecture 3 1.pdf", taken)).toEqual({
      name: "Lecture 3 1.pdf",
      replaces: false,
    });
  });
  it("uses a typed name that is free", () => {
    expect(pdfName("Ben.pdf", "x.pdf", taken)).toEqual({ name: "Ben.pdf", replaces: false });
  });
  it("replaces the file this notebook's export wrote, whatever its case", () => {
    expect(pdfName("anna algebra", "x.pdf", taken, "Anna algebra.pdf")).toEqual({
      name: "Anna algebra.pdf",
      replaces: true,
    });
  });
  it("never replaces a file it did not write: the PDF under the notebook, another export", () => {
    // The notebook is drawn on Lecture 3.pdf; typing its own name must not overwrite it.
    expect(pdfName("Lecture 3", "x.pdf", taken)).toEqual({
      name: "Lecture 3 1.pdf",
      replaces: false,
    });
    expect(pdfName("Lecture 3", "x.pdf", taken, "Anna algebra.pdf")).toEqual({
      name: "Lecture 3 1.pdf",
      replaces: false,
    });
  });
});

describe("ownPdfName", () => {
  it("is the written file's name when it lies in the export folder", () => {
    const entry = { name: "Anna", file: "Tutoring/Anna.pdf" };
    expect(ownPdfName(entry, "Tutoring")).toBe("Anna.pdf");
    expect(ownPdfName(entry, "Exports")).toBeUndefined();
    expect(ownPdfName({ name: "A", file: "A.pdf" }, "")).toBe("A.pdf");
    expect(ownPdfName({ name: "A" }, "")).toBeUndefined();
    expect(ownPdfName(undefined, "")).toBeUndefined();
  });
});

describe("rememberPdfName", () => {
  it("sets a notebook's name and file, and drops them when emptied", () => {
    const one = rememberPdfName(
      {},
      "Tutoring/Anna.md",
      "Anna algebra.pdf",
      "Tutoring/Anna algebra.pdf",
    );
    expect(one).toEqual({
      "Tutoring/Anna.md": { name: "Anna algebra", file: "Tutoring/Anna algebra.pdf" },
    });
    expect(rememberPdfName(one, "Tutoring/Anna.md", " ", "Tutoring/Anna 1.pdf")).toEqual({});
  });
});

describe("movePdfNames", () => {
  const names = {
    "Tutoring/Anna.md": { name: "Anna", file: "Tutoring/Anna.pdf" },
    "Tutoring/Ben.md": { name: "Ben", file: "Shared/Ben.pdf" },
    "Other.md": { name: "O" },
  };
  it("follows a rename of the notebook, its folder, or the written file", () => {
    expect(movePdfNames(names, "Tutoring", "Students")).toEqual({
      "Students/Anna.md": { name: "Anna", file: "Students/Anna.pdf" },
      "Students/Ben.md": { name: "Ben", file: "Shared/Ben.pdf" },
      "Other.md": { name: "O" },
    });
    expect(movePdfNames(names, "Shared/Ben.pdf", "Shared/Ben old.pdf")["Tutoring/Ben.md"]).toEqual({
      name: "Ben",
      file: "Shared/Ben old.pdf",
    });
  });
  it("forgets a deleted notebook, and a deleted file's link but not its name", () => {
    expect(movePdfNames(names, "Tutoring")).toEqual({ "Other.md": { name: "O" } });
    expect(movePdfNames(names, "Shared/Ben.pdf")["Tutoring/Ben.md"]).toEqual({ name: "Ben" });
  });
});

describe("exportNamesOf", () => {
  it("keeps only well-formed entries, from whatever the settings file holds", () => {
    expect(exportNamesOf(null)).toEqual({});
    expect(exportNamesOf(["a"])).toEqual({});
    expect(
      exportNamesOf({
        "a.md": { name: "A.pdf", file: "A.pdf" },
        "b.md": "B",
        "c.md": { name: " " },
        "d.md": { name: "D", file: 3 },
      }),
    ).toEqual({ "a.md": { name: "A", file: "A.pdf" }, "d.md": { name: "D" } });
  });
});
