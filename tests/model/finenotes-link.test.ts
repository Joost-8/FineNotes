import { describe, expect, it } from "vitest";
import { parseFinenotesLink, pdfByName, pdfCandidates } from "../../src/model/finenotes-link";

describe("parseFinenotesLink", () => {
  it("reads a new notebook, with and without a name and folder", () => {
    expect(parseFinenotesLink({ do: "new" })).toEqual({ do: "new", name: "", last: false });
    expect(parseFinenotesLink({ do: "NEW", name: " Physics ", folder: "/School/Y2/" })).toEqual({
      do: "new",
      name: "Physics",
      folder: "School/Y2",
      last: false,
    });
  });

  it("skips the window with last, given bare or as true", () => {
    // Obsidian hands a bare `&last` over as "true".
    expect(parseFinenotesLink({ do: "new", last: "true" })).toMatchObject({ last: true });
    expect(parseFinenotesLink({ do: "new", last: "1" })).toMatchObject({ last: true });
    expect(parseFinenotesLink({ do: "new", last: "false" })).toMatchObject({ last: false });
  });

  it("reads a PDF path as a shortcut writes it", () => {
    expect(parseFinenotesLink({ do: "pdf", file: "Inbox/Lecture 7.pdf" })).toEqual({
      do: "pdf",
      file: "Inbox/Lecture 7.pdf",
    });
    expect(parseFinenotesLink({ do: "pdf", file: " /Inbox//Lecture.pdf " })).toEqual({
      do: "pdf",
      file: "Inbox/Lecture.pdf",
    });
    expect(parseFinenotesLink({ do: "pdf", file: "Inbox\\Lecture.pdf" })).toEqual({
      do: "pdf",
      file: "Inbox/Lecture.pdf",
    });
  });

  it("says what it could not read", () => {
    expect(parseFinenotesLink({})).toEqual({ do: "unknown", what: "nothing" });
    expect(parseFinenotesLink({ do: "pdf" })).toEqual({
      do: "unknown",
      what: "pdf without a file",
    });
    expect(parseFinenotesLink({ do: "dance" })).toEqual({ do: "unknown", what: "dance" });
  });
});

describe("pdfCandidates", () => {
  it("adds .pdf only when it is missing", () => {
    expect(pdfCandidates("Inbox/a.pdf")).toEqual(["Inbox/a.pdf"]);
    expect(pdfCandidates("Inbox/a.PDF")).toEqual(["Inbox/a.PDF"]);
    expect(pdfCandidates("Inbox/a")).toEqual(["Inbox/a", "Inbox/a.pdf"]);
  });
});

describe("pdfByName", () => {
  const pdfs = [
    { path: "Old/Lecture.pdf", name: "Lecture.pdf", mtime: 1 },
    { path: "Inbox/Lecture.pdf", name: "Lecture.pdf", mtime: 5 },
    { path: "Inbox/Other.pdf", name: "Other.pdf", mtime: 9 },
  ];

  it("takes the newest PDF of that name", () => {
    expect(pdfByName("Lecture.pdf", pdfs)).toBe("Inbox/Lecture.pdf");
    expect(pdfByName("lecture", pdfs)).toBe("Inbox/Lecture.pdf");
  });

  it("matches a path with a folder exactly, never by name", () => {
    expect(pdfByName("Elsewhere/Lecture.pdf", pdfs)).toBeNull();
  });

  it("finds nothing for a name nobody has", () => {
    expect(pdfByName("Missing.pdf", pdfs)).toBeNull();
  });
});
