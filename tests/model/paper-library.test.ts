/**
 * `src/model/paper-library.ts` — "My templates": where papers live, what
 * they are called, the page shape each gives, and finding a notebook's own
 * copy so a paper used twice is copied once.
 */

import { describe, expect, it } from "vitest";
import {
  existingCopy,
  isPaperSource,
  paperBackdrop,
  paperEntries,
  paperGeometry,
  paperName,
  papersFolderOf,
} from "../../src/model/paper-library";

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

  it("points a page at the notebook's copy", () => {
    expect(paperBackdrop("Notes/Images/Paper Planner.pdf", 3)).toEqual({
      kind: "pdf",
      path: "Notes/Images/Paper Planner.pdf",
      page: 3,
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
});
