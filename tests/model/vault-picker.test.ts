/**
 * `src/model/vault-picker.ts` — the vault file pickers: browsing folders that
 * lead to a file, and searching every file by what is typed.
 */

import { describe, expect, it } from "vitest";
import { browseFiles, parentFolder, pickerFile, searchFiles } from "../../src/model/vault-picker";

const VAULT = [
  "Courses/Y2/Automata/Lecture Slides/lecture10.pdf",
  "Courses/Y2/Automata/Lecture Slides/lecture2.pdf",
  "Courses/Y2/Automata/handout.pdf",
  "Courses/Y2/Databases/Slides lecture1.pdf",
  "Books/Networking by James F. Kurose.pdf",
  "Résumé.PDF",
  "scan.pdf",
];

describe("pickerFile", () => {
  it("splits a path into its name and folder", () => {
    expect(pickerFile("Books/Networking by James F. Kurose.pdf")).toEqual({
      path: "Books/Networking by James F. Kurose.pdf",
      name: "Networking by James F. Kurose",
      ext: "pdf",
      folder: "Books",
    });
    expect(pickerFile("Résumé.PDF")).toEqual({
      path: "Résumé.PDF",
      name: "Résumé",
      ext: "pdf",
      folder: "",
    });
    // A dot that starts the name is not an extension.
    expect(pickerFile(".hidden")).toMatchObject({ name: ".hidden", ext: "" });
  });
});

describe("parentFolder", () => {
  it("climbs one folder, and has none above the root", () => {
    expect(parentFolder("Courses/Y2")).toBe("Courses");
    expect(parentFolder("Courses")).toBe("");
    expect(parentFolder("")).toBeNull();
  });
});

describe("browseFiles", () => {
  it("shows the root's folders with their counts, then its own PDFs, A to Z", () => {
    const root = browseFiles(VAULT, "");
    expect(root.up).toBeNull();
    expect(root.folders).toEqual([
      { name: "Books", path: "Books", count: 1 },
      { name: "Courses", path: "Courses", count: 4 },
    ]);
    expect(root.files.map((p) => p.name)).toEqual(["Résumé", "scan"]);
  });

  it("goes into a folder: the folder above, its folders, its PDFs in number order", () => {
    const automata = browseFiles(VAULT, "Courses/Y2/Automata");
    expect(automata.up).toBe("Courses/Y2");
    expect(automata.folders).toEqual([
      { name: "Lecture Slides", path: "Courses/Y2/Automata/Lecture Slides", count: 2 },
    ]);
    expect(automata.files.map((p) => p.name)).toEqual(["handout"]);
    const slides = browseFiles(VAULT, "Courses/Y2/Automata/Lecture Slides");
    expect(slides.files.map((p) => p.name)).toEqual(["lecture2", "lecture10"]);
  });

  it("does not take a folder whose name only starts the same", () => {
    const listing = browseFiles(["Course/a.pdf", "Courses/b.pdf"], "Course");
    expect(listing.files.map((p) => p.path)).toEqual(["Course/a.pdf"]);
  });

  it("keeps pictures of one name apart by their extension", () => {
    const listing = browseFiles(
      ["Photos/scan.png", "Photos/scan.jpg", "Photos/board.heic"],
      "Photos",
    );
    expect(listing.files.map((f) => `${f.name}.${f.ext}`)).toEqual([
      "board.heic",
      "scan.jpg",
      "scan.png",
    ]);
  });

  it("shows a folder with no PDF left as empty", () => {
    expect(browseFiles(VAULT, "Gone")).toEqual({ up: "", folders: [], files: [] });
  });
});

describe("searchFiles", () => {
  it("finds nothing for nothing typed", () => {
    expect(searchFiles(VAULT, "  ")).toEqual([]);
  });

  it("needs every word, anywhere in the path, ignoring case and accents", () => {
    expect(searchFiles(VAULT, "resume").map((p) => p.path)).toEqual(["Résumé.PDF"]);
    expect(searchFiles(VAULT, "automata slides").map((p) => p.name)).toEqual([
      "lecture2",
      "lecture10",
    ]);
  });

  it("puts a name that starts with the words first, then names, then folders", () => {
    const found = searchFiles(
      ["Slides/notes.pdf", "Old slides.pdf", "Slides week 1.pdf"],
      "slides",
    ).map((p) => p.path);
    expect(found).toEqual(["Slides week 1.pdf", "Old slides.pdf", "Slides/notes.pdf"]);
  });
});
