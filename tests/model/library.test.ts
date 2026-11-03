/**
 * `src/model/library.ts` — what the notebook library lists and how it
 * arranges it: reading an entry from a note, browsing folders, sorting,
 * searching and the "edited" captions.
 */

import { describe, expect, it } from "vitest";
import { blankPage, emptyDocument } from "../../src/model/document";
import {
  type LibraryEntry,
  browse,
  continueEntries,
  crumbs,
  entryFromText,
  folderOf,
  hoistSingles,
  placeholderEntry,
  readProgress,
  searchEntries,
  sortEntries,
  whenText,
} from "../../src/model/library";
import { buildInkFile } from "../../src/model/serialize";
import { coverBackdrop } from "../../src/model/templates";

const entry = (path: string, edited: number, pages = 1): LibraryEntry => ({
  ...placeholderEntry(path, edited),
  pages,
});

describe("entryFromText", () => {
  it("counts pages without the cover and takes the cover's colour", () => {
    const doc = emptyDocument();
    const cover = blankPage("c1");
    cover.backdrop = coverBackdrop("cover-plain", "navy");
    doc.pages.unshift(cover, blankPage("p2"));
    const text = buildInkFile("", doc);
    const read = entryFromText("Uni/Algebra.notebook.md", 5, text);
    expect(read.pages).toBe(2);
    expect(read.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(read.title).toBe("Algebra");
    expect(read.folder).toBe("Uni");
    expect(read.edited).toBe(5);
  });

  it("flags a notebook with a PDF page", () => {
    const doc = emptyDocument();
    doc.pages[0].backdrop = { kind: "pdf", path: "a.pdf", page: 1 } as never;
    expect(entryFromText("x.notebook.md", 1, buildInkFile("", doc)).hasPdf).toBe(true);
  });

  it("keeps the placeholder for a note with no readable block", () => {
    const read = entryFromText("Notes/Plain.notebook.md", 9, "just text");
    expect(read).toEqual(placeholderEntry("Notes/Plain.notebook.md", 9));
    expect(read.pages).toBe(0);
  });
});

describe("browse", () => {
  const all = [
    entry("Root.notebook.md", 1),
    entry("Uni/A.notebook.md", 2),
    entry("Uni/Year 1/B.notebook.md", 3),
    entry("Uni/Year 2/C.notebook.md", 4),
    entry("Personal/D.notebook.md", 5),
  ];

  it("lists the folders and notebooks directly in the root", () => {
    const root = browse(all, "");
    expect(root.notebooks.map((n) => n.title)).toEqual(["Root"]);
    expect(root.folders).toEqual([
      { name: "Personal", path: "Personal", count: 1 },
      { name: "Uni", path: "Uni", count: 3 },
    ]);
  });

  it("counts everything below a folder, and lists its own notebooks", () => {
    const uni = browse(all, "Uni");
    expect(uni.notebooks.map((n) => n.title)).toEqual(["A"]);
    expect(uni.folders.map((f) => [f.path, f.count])).toEqual([
      ["Uni/Year 1", 1],
      ["Uni/Year 2", 1],
    ]);
  });

  it("does not take a folder whose name starts the same for a child", () => {
    const list = [entry("Uni2/X.notebook.md", 1)];
    expect(browse(list, "Uni").notebooks).toEqual([]);
    expect(browse(list, "Uni").folders).toEqual([]);
  });
});

describe("crumbs and folderOf", () => {
  it("walks a folder path outermost first", () => {
    expect(crumbs("A/B/C").map((c) => c.path)).toEqual(["A", "A/B", "A/B/C"]);
    expect(crumbs("")).toEqual([]);
  });
  it("names the folder of a path", () => {
    expect(folderOf("a/b/c.md")).toBe("a/b");
    expect(folderOf("c.md")).toBe("");
  });
});

describe("sortEntries", () => {
  const list = [
    entry("b.notebook.md", 5, 3),
    entry("a10.notebook.md", 9, 9),
    entry("a9.notebook.md", 9, 1),
  ];
  it("puts the newest first and breaks ties by name, numbers in order", () => {
    expect(sortEntries(list, "edited").map((e) => e.title)).toEqual(["a9", "a10", "b"]);
  });
  it("sorts by name and by pages", () => {
    expect(sortEntries(list, "name").map((e) => e.title)).toEqual(["a9", "a10", "b"]);
    expect(sortEntries(list, "pages").map((e) => e.title)).toEqual(["a10", "b", "a9"]);
  });
  it("leaves its input alone", () => {
    const copy = [...list];
    sortEntries(list, "name");
    expect(list).toEqual(copy);
  });

  it("sorts by creation, and turns any order around", () => {
    const made = [
      { ...entry("old.notebook.md", 9), created: 1 },
      { ...entry("new.notebook.md", 2), created: 5 },
    ];
    expect(sortEntries(made, "created").map((e) => e.title)).toEqual(["new", "old"]);
    expect(sortEntries(made, "created", true).map((e) => e.title)).toEqual(["old", "new"]);
    expect(sortEntries(made, "name", true).map((e) => e.title)).toEqual(["old", "new"]);
  });
});

describe("searchEntries", () => {
  const list = [entry("Uni/Linear Algebra.notebook.md", 1), entry("Personal/Ideas.notebook.md", 2)];
  it("needs every word, in the title or the folder, any case", () => {
    expect(searchEntries(list, "linear uni").map((e) => e.title)).toEqual(["Linear Algebra"]);
    expect(searchEntries(list, "PERSONAL").map((e) => e.title)).toEqual(["Ideas"]);
    expect(searchEntries(list, "linear ideas")).toEqual([]);
  });
  it("returns everything for an empty query", () => {
    expect(searchEntries(list, "  ")).toHaveLength(2);
  });
});

describe("continueEntries", () => {
  it("takes the most recently edited", () => {
    const list = [
      entry("a.notebook.md", 1),
      entry("b.notebook.md", 3),
      entry("c.notebook.md", 2),
      entry("d.notebook.md", 0),
    ];
    expect(continueEntries(list, 2).map((e) => e.title)).toEqual(["b", "c"]);
  });
});

describe("whenText", () => {
  // Wednesday 2026-11-04, 15:00 local.
  const now = new Date(2026, 10, 4, 15, 0, 0).getTime();
  const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m, d, h).getTime();
  it("speaks in minutes and hours today", () => {
    expect(whenText(now - 20_000, now)).toBe("Just now");
    expect(whenText(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(whenText(at(2026, 10, 4, 12), now)).toBe("3 h ago");
  });
  it("says Yesterday, then the weekday for the week, then the date", () => {
    expect(whenText(at(2026, 10, 3, 23), now)).toBe("Yesterday");
    expect(whenText(at(2026, 10, 1, 9), now)).toBe("Sun");
    expect(whenText(at(2026, 9, 30, 9), now)).toBe("Fri");
    expect(whenText(at(2026, 9, 25, 9), now)).toBe("Oct 25");
    expect(whenText(at(2025, 11, 24, 9), now)).toBe("Dec 24, 2025");
  });
});

describe("readProgress", () => {
  const book = { ...placeholderEntry("a.notebook.md", 1), pages: 10, covered: true };
  it("counts pages without the cover", () => {
    expect(readProgress(book, 5)).toEqual({ page: 5, of: 10, ratio: 0.5 });
    expect(readProgress({ ...book, covered: false }, 4)).toEqual({ page: 5, of: 10, ratio: 0.5 });
  });
  it("has nothing for a notebook never read, left on its cover, or with no pages", () => {
    expect(readProgress(book, undefined)).toBeNull();
    expect(readProgress(book, 0)).toBeNull();
    expect(readProgress({ ...book, pages: 0 }, 3)).toBeNull();
  });
  it("stops at the last page when pages were deleted since", () => {
    expect(readProgress(book, 99)).toEqual({ page: 10, of: 10, ratio: 1 });
  });
});

describe("continueEntries with reading", () => {
  it("puts a notebook read after another was edited first", () => {
    const list = [entry("a.notebook.md", 100), entry("b.notebook.md", 50)];
    const readAt = (path: string): number => (path === "b.notebook.md" ? 200 : 0);
    expect(continueEntries(list, 2, readAt).map((e) => e.title)).toEqual(["b", "a"]);
  });
});

describe("hoistSingles", () => {
  it("files a notebook that is alone in its folder one level up, as far as it stays alone", () => {
    const list = [
      entry("Algebra/Algebra.notebook.md", 1),
      entry("Uni/Year 1/Probability/Probability.notebook.md", 2),
      entry("Uni/Year 1/Other.notebook.md", 3),
      entry("Uni/Year 2/A.notebook.md", 4),
      entry("Uni/Year 2/B.notebook.md", 5),
    ];
    const out = hoistSingles(list);
    expect(out.map((e) => e.folder)).toEqual([
      "",
      "Uni/Year 1",
      "Uni/Year 1",
      "Uni/Year 2",
      "Uni/Year 2",
    ]);
    expect(out.map((e) => e.path)).toEqual(list.map((e) => e.path));
  });

  it("leaves a folder of several alone, and the root's notebooks", () => {
    const list = [
      entry("Root.notebook.md", 1),
      entry("F/A.notebook.md", 2),
      entry("F/B.notebook.md", 3),
    ];
    expect(hoistSingles(list).map((e) => e.folder)).toEqual(["", "F", "F"]);
  });

  it("collapses a lone notebook inside a folder of folders up to the root", () => {
    expect(hoistSingles([entry("A/B/C.notebook.md", 1)])[0].folder).toBe("");
  });
});
