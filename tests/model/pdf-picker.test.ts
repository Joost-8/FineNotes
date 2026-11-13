/**
 * `src/model/pdf-picker.ts` — the vault PDF picker: browsing folders that
 * lead to a PDF, and searching every PDF by what is typed.
 */

import { describe, expect, it } from "vitest";
import { browsePdfs, parentFolder, pickerPdf, searchPdfs } from "../../src/model/pdf-picker";

const VAULT = [
  "Courses/Y2/Automata/Lecture Slides/lecture10.pdf",
  "Courses/Y2/Automata/Lecture Slides/lecture2.pdf",
  "Courses/Y2/Automata/handout.pdf",
  "Courses/Y2/Databases/Slides lecture1.pdf",
  "Books/Networking by James F. Kurose.pdf",
  "Résumé.PDF",
  "scan.pdf",
];

describe("pickerPdf", () => {
  it("splits a path into its name and folder", () => {
    expect(pickerPdf("Books/Networking by James F. Kurose.pdf")).toEqual({
      path: "Books/Networking by James F. Kurose.pdf",
      name: "Networking by James F. Kurose",
      folder: "Books",
    });
    expect(pickerPdf("Résumé.PDF")).toEqual({ path: "Résumé.PDF", name: "Résumé", folder: "" });
  });
});

describe("parentFolder", () => {
  it("climbs one folder, and has none above the root", () => {
    expect(parentFolder("Courses/Y2")).toBe("Courses");
    expect(parentFolder("Courses")).toBe("");
    expect(parentFolder("")).toBeNull();
  });
});

describe("browsePdfs", () => {
  it("shows the root's folders with their counts, then its own PDFs, A to Z", () => {
    const root = browsePdfs(VAULT, "");
    expect(root.up).toBeNull();
    expect(root.folders).toEqual([
      { name: "Books", path: "Books", count: 1 },
      { name: "Courses", path: "Courses", count: 4 },
    ]);
    expect(root.pdfs.map((p) => p.name)).toEqual(["Résumé", "scan"]);
  });

  it("goes into a folder: the folder above, its folders, its PDFs in number order", () => {
    const automata = browsePdfs(VAULT, "Courses/Y2/Automata");
    expect(automata.up).toBe("Courses/Y2");
    expect(automata.folders).toEqual([
      { name: "Lecture Slides", path: "Courses/Y2/Automata/Lecture Slides", count: 2 },
    ]);
    expect(automata.pdfs.map((p) => p.name)).toEqual(["handout"]);
    const slides = browsePdfs(VAULT, "Courses/Y2/Automata/Lecture Slides");
    expect(slides.pdfs.map((p) => p.name)).toEqual(["lecture2", "lecture10"]);
  });

  it("does not take a folder whose name only starts the same", () => {
    const listing = browsePdfs(["Course/a.pdf", "Courses/b.pdf"], "Course");
    expect(listing.pdfs.map((p) => p.path)).toEqual(["Course/a.pdf"]);
  });

  it("shows a folder with no PDF left as empty", () => {
    expect(browsePdfs(VAULT, "Gone")).toEqual({ up: "", folders: [], pdfs: [] });
  });
});

describe("searchPdfs", () => {
  it("finds nothing for nothing typed", () => {
    expect(searchPdfs(VAULT, "  ")).toEqual([]);
  });

  it("needs every word, anywhere in the path, ignoring case and accents", () => {
    expect(searchPdfs(VAULT, "resume").map((p) => p.path)).toEqual(["Résumé.PDF"]);
    expect(searchPdfs(VAULT, "automata slides").map((p) => p.name)).toEqual([
      "lecture2",
      "lecture10",
    ]);
  });

  it("puts a name that starts with the words first, then names, then folders", () => {
    const found = searchPdfs(
      ["Slides/notes.pdf", "Old slides.pdf", "Slides week 1.pdf"],
      "slides",
    ).map((p) => p.path);
    expect(found).toEqual(["Slides week 1.pdf", "Old slides.pdf", "Slides/notes.pdf"]);
  });
});
