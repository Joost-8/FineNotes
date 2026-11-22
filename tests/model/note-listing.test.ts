import { describe, expect, it } from "vitest";
import {
  type Findable,
  bodySnippet,
  folderOf,
  foundSections,
  leadOf,
  markSpans,
  notesIn,
  searchRows,
  shortWhen,
  showKindOf,
  shownBy,
} from "../../src/model/note-listing";

describe("the folder's notes", () => {
  const notes = [
    { path: "U/a.note.md", title: "a", edited: 1 },
    { path: "U/b.note.md", title: "b", edited: 3 },
    { path: "U/Sub/c.note.md", title: "c", edited: 5 },
    { path: "d.note.md", title: "d", edited: 3 },
  ];

  it("lists a folder's own notes, newest first", () => {
    expect(notesIn(notes, "U").map((n) => n.title)).toEqual(["b", "a"]);
    expect(notesIn(notes, "").map((n) => n.title)).toEqual(["d"]);
    expect(folderOf("x.md")).toBe("");
  });
});

describe("search", () => {
  const items: Findable[] = [
    { path: "Other/Algebra.note.md", title: "Algebra", edited: 1, lead: "Groups and rings" },
    { path: "Uni/Groups.note.md", title: "Groups", edited: 2 },
    { path: "Uni/Lecture.notebook.md", title: "Lecture", edited: 3, notebook: true },
    { path: "Uni/Linear algebra.notebook.md", title: "Linear algebra", edited: 4, notebook: true },
  ];
  const snip = (match: string) => [{ before: "a ", match, after: " b" }];

  it("finds nothing for an empty query", () => {
    expect(searchRows(items, [], "  ", "Uni")).toEqual([]);
  });

  it("lists title matches, then text matches, each once, the note's folder first", () => {
    const rows = searchRows(
      items,
      [
        { path: "Other/Algebra.note.md", pageIndex: 0, snippets: snip("algebra") },
        { path: "Uni/Lecture.notebook.md", pageIndex: 4, snippets: snip("algebra") },
        { path: "Uni/Lecture.notebook.md", pageIndex: 6, snippets: snip("algebra") },
        { path: "Gone.note.md", pageIndex: 0, snippets: [] },
      ],
      "alge",
      "Uni",
    );
    expect(rows.map((r) => [r.title, r.pageIndex, r.byTitle])).toEqual([
      ["Linear algebra", 0, true],
      ["Lecture", 4, false],
      ["Algebra", 0, true],
    ]);
    expect(rows[2].snippet?.match).toBe("algebra");
    // Found by its title alone: its first line stands in.
    expect(rows[0].snippet).toBeUndefined();
  });

  it("gives a row found by title alone its first line", () => {
    const [row] = searchRows(items, [], "algebra", "Other");
    expect(row.snippet).toEqual({ before: "Groups and rings", match: "", after: "" });
  });

  it("puts title matches on top, the rest under Notes and Notebooks", () => {
    const rows = searchRows(
      items,
      [
        { path: "Uni/Groups.note.md", pageIndex: 0, snippets: snip("algebra") },
        { path: "Uni/Lecture.notebook.md", pageIndex: 1, snippets: snip("algebra") },
      ],
      "algebra",
      "",
    );
    const sections = foundSections(rows);
    expect(sections.top.map((r) => r.title)).toEqual(["Algebra", "Linear algebra"]);
    expect(sections.notes.map((r) => r.title)).toEqual(["Groups"]);
    expect(sections.notebooks.map((r) => r.title)).toEqual(["Lecture"]);
    expect(sections.total).toBe(4);
    expect(foundSections(rows, 1).top).toHaveLength(1);
    expect(foundSections(rows, 1).notebooks.map((r) => r.title)).toEqual([
      "Linear algebra",
      "Lecture",
    ]);
  });

  it("leaves the title out of a found line", () => {
    const s = (before: string, match: string, after = "") => ({ before, match, after });
    expect(bodySnippet(s("", "Exam", " plan Week 1"), "Exam plan")).toBeNull();
    expect(bodySnippet(s("Exam plan Week 1: ", "algebra"), "Exam plan")).toEqual(
      s("Week 1: ", "algebra"),
    );
    expect(bodySnippet(s("…under addition, ", "algebra"), "Groups")).toEqual(
      s("…under addition, ", "algebra"),
    );
    expect(bodySnippet(s("x ", "y"), "")).toEqual(s("x ", "y"));
    // In the searchRows pipeline: a title hit falls back to the note's first line.
    const [row] = searchRows(
      [{ path: "a.note.md", title: "Exam plan", edited: 0, lead: "Week 1" }],
      [{ path: "a.note.md", pageIndex: 0, snippets: [s("", "Exam", " plan Week 1")] }],
      "exam",
      "",
    );
    expect(row.snippet).toEqual(s("Week 1", "", ""));
  });

  it("marks every word of the query in a text, any case", () => {
    expect(markSpans("Linear Algebra and algebra", "algebra")).toEqual([
      { text: "Linear ", hit: false },
      { text: "Algebra", hit: true },
      { text: " and ", hit: false },
      { text: "algebra", hit: true },
    ]);
    expect(markSpans("abc", "")).toEqual([{ text: "abc", hit: false }]);
    expect(markSpans("", "x")).toEqual([]);
  });

  it("leads with the lines after the title", () => {
    expect(leadOf("Title\n\nFirst line\nSecond", "Title")).toBe("First line Second");
    expect(leadOf("No title here", "Title")).toBe("No title here");
  });

  it("writes today as a time, other days as a short date", () => {
    const now = new Date(2026, 10, 22, 15, 0).getTime();
    expect(shortWhen(new Date(2026, 10, 22, 9, 5).getTime(), now, "nl")).toBe("09:05");
    expect(shortWhen(new Date(2026, 10, 20, 9, 5).getTime(), now, "nl")).toBe("20-11-26");
    expect(shortWhen(new Date(2026, 10, 20).getTime(), now, "not a locale!")).toBe("11/20/26");
  });
});

describe("Home's Show filter", () => {
  it("reads the old Notebooks only switch", () => {
    expect(showKindOf("1")).toBe("notebooks");
    expect(showKindOf("0")).toBe("all");
    expect(showKindOf(null)).toBe("all");
    expect(showKindOf("notes")).toBe("notes");
    expect(showKindOf("notebooks")).toBe("notebooks");
  });

  it("keeps notebooks, text notes, or everything", () => {
    const book = { kind: "notebook" };
    const note = { kind: "note", textNote: true };
    const md = { kind: "note" };
    expect([book, note, md].map((e) => shownBy(e, "all"))).toEqual([true, true, true]);
    expect([book, note, md].map((e) => shownBy(e, "notebooks"))).toEqual([true, false, false]);
    expect([book, note, md].map((e) => shownBy(e, "notes"))).toEqual([false, true, false]);
  });
});
