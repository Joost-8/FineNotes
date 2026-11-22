import { describe, expect, it } from "vitest";
import {
  browseTags,
  dropFilingTargets,
  dropTag,
  filingFor,
  matchesSmart,
  moveFilingTargets,
  nextPick,
  notesIn,
  pathIn,
  plannedMoves,
  ruleText,
  scopeOf,
  searchRows,
  showKindOf,
  shownBy,
  smartFoldersOf,
  tagCounts,
  tagCovers,
  tagFromName,
  tagKey,
  tagKeys,
  type ListedNote,
  type SmartFolder,
} from "../../src/model/note-organise";

const smart = (over: Partial<SmartFolder> = {}): SmartFolder => ({
  id: "s1",
  name: "Uni",
  tags: ["uni"],
  exclude: [],
  match: "any",
  ...over,
});

describe("tags", () => {
  it("compares without #, slashes at the ends or case", () => {
    expect(tagKey("#Uni/Algebra/")).toBe("uni/algebra");
    expect(tagKey("  ##todo ")).toBe("todo");
    expect(tagKeys(["#a", "A", "", "#", "b"])).toEqual(["a", "b"]);
  });

  it("a nested tag counts as its parent, not the other way round", () => {
    expect(tagCovers("#uni/algebra", "uni")).toBe(true);
    expect(tagCovers("#uni", "uni/algebra")).toBe(false);
    expect(tagCovers("#university", "uni")).toBe(false);
    expect(tagCovers("#uni", "")).toBe(false);
  });

  it("counts each item once per tag, parents included, A to Z", () => {
    const counts = tagCounts([
      { tags: ["#uni/algebra", "#uni/algebra"] },
      { tags: ["#Uni", "#todo"] },
      { tags: [] },
    ]);
    expect(counts).toEqual([
      { tag: "todo", count: 1 },
      { tag: "uni", count: 2 },
      { tag: "uni/algebra", count: 1 },
    ]);
  });

  it("makes a folder name a one-word tag", () => {
    expect(tagFromName(" Linear Algebra! ")).toBe("linear-algebra");
    expect(tagFromName("Uni/Year 1")).toBe("uni/year-1");
  });

  it("cycles a tapped tag on, struck through, off", () => {
    expect(nextPick("off")).toBe("on");
    expect(nextPick("on")).toBe("out");
    expect(nextPick("out")).toBe("off");
  });
});

describe("the tag browser", () => {
  const items = [
    { path: "a", tags: ["#uni", "#todo"] },
    { path: "b", tags: ["#uni/algebra"] },
    { path: "c", tags: [] },
    { path: "d", tags: ["#todo"] },
  ];

  it("shows every tagged item with nothing picked", () => {
    expect(browseTags(items, []).map((i) => i.path)).toEqual(["a", "b", "d"]);
  });

  it("narrows to items with every picked tag, and leaves out struck ones", () => {
    expect(browseTags(items, ["uni"]).map((i) => i.path)).toEqual(["a", "b"]);
    expect(browseTags(items, ["uni", "todo"]).map((i) => i.path)).toEqual(["a"]);
    expect(browseTags(items, ["uni"], ["todo"]).map((i) => i.path)).toEqual(["b"]);
  });
});

describe("smart folders", () => {
  it("match any or all of their tags, never an excluded one", () => {
    const any = smart({ tags: ["uni", "work"] });
    const all = smart({ tags: ["uni", "work"], match: "all" });
    expect(matchesSmart({ tags: ["#work"] }, any)).toBe(true);
    expect(matchesSmart({ tags: ["#work"] }, all)).toBe(false);
    expect(matchesSmart({ tags: ["#uni/x", "#work"] }, all)).toBe(true);
    expect(matchesSmart({ tags: ["#uni", "#old"] }, smart({ exclude: ["old"] }))).toBe(false);
  });

  it("with no tags match nothing, unless they ask for untagged notes", () => {
    expect(matchesSmart({ tags: [] }, smart({ tags: [] }))).toBe(false);
    expect(matchesSmart({ tags: [] }, smart({ tags: [], untagged: true }))).toBe(true);
    expect(matchesSmart({ tags: ["#a"] }, smart({ tags: [], untagged: true }))).toBe(false);
  });

  it("caption their rule", () => {
    expect(ruleText(smart({ tags: ["a", "b"] }), "No tags", "or")).toBe("#a or #b");
    expect(ruleText(smart({ tags: ["a", "b"], match: "all", exclude: ["c"] }), "", "or")).toBe(
      "#a #b -#c",
    );
    expect(ruleText(smart({ untagged: true }), "No tags", "or")).toBe("No tags");
  });

  it("read back from settings, dropping what is malformed", () => {
    expect(smartFoldersOf("x")).toEqual([]);
    const read = smartFoldersOf([
      { id: "a", name: " Uni ", tags: ["#Uni", 3], match: "all", fileTo: "/School/" },
      { id: "a", name: "Dupe", tags: [] },
      { id: "", name: "No id" },
      null,
      { id: "b", name: "Loose", tags: "uni", exclude: ["x"], untagged: true },
    ]);
    expect(read).toEqual([
      { id: "a", name: "Uni", tags: ["uni"], exclude: [], match: "all", fileTo: "School" },
      { id: "b", name: "Loose", tags: [], exclude: ["x"], match: "any", untagged: true },
    ]);
  });

  it("forget a deleted tag", () => {
    expect(dropTag([smart({ tags: ["uni", "x"], exclude: ["x"] })], "#X")[0]).toMatchObject({
      tags: ["uni"],
      exclude: [],
    });
  });
});

describe("filing by tag", () => {
  const files = smart({ fileTo: "School" });

  it("moves a note only when it comes to match", () => {
    expect(filingFor("Inbox/a.note.md", [], ["#uni"], [files])).toBe("School");
    expect(filingFor("Inbox/a.note.md", ["#uni"], ["#uni", "#x"], [files])).toBeNull();
    expect(filingFor("School/a.note.md", [], ["#uni"], [files])).toBeNull();
    expect(filingFor("a.note.md", [], ["#other"], [files])).toBeNull();
  });

  it("never moves for a smart folder that does not file", () => {
    expect(filingFor("a.note.md", [], ["#uni"], [smart()])).toBeNull();
  });

  it("takes the first filing folder that matches", () => {
    const later = smart({ id: "s2", tags: ["uni"], fileTo: "" });
    expect(filingFor("x/a.note.md", [], ["#uni"], [smart(), later, files])).toBe("");
  });

  it("plans the moves of notes already matching, skipping taken names", () => {
    const moves = plannedMoves(
      [
        { path: "a.note.md", tags: ["#uni"], textNote: true },
        { path: "x/b.note.md", tags: ["#uni"], textNote: true },
        { path: "y/b.note.md", tags: ["#uni"], textNote: true },
        { path: "School/c.note.md", tags: ["#uni"], textNote: true },
        { path: "d.notebook.md", tags: ["#uni"] },
        { path: "e.note.md", tags: ["#taken"], textNote: true },
        { path: "z/Taken.note.md", tags: ["#uni"], textNote: true },
      ],
      files,
      new Set(["School/taken.note.md"]),
    );
    expect(moves).toEqual([
      { from: "a.note.md", to: "School/a.note.md" },
      { from: "x/b.note.md", to: "School/b.note.md" },
    ]);
    expect(
      plannedMoves([{ path: "a", tags: ["#uni"], textNote: true }], smart(), new Set()),
    ).toEqual([]);
    expect(pathIn("", "x/a.md")).toBe("a.md");
  });

  it("follows a folder renamed, and stops when it is deleted", () => {
    const moved = moveFilingTargets(
      [files, smart({ fileTo: "School/Year" }), smart({ fileTo: "" }), smart()],
      "School",
      "Uni",
    );
    expect(moved.map((f) => f.fileTo)).toEqual(["Uni", "Uni/Year", "", undefined]);
    const dropped = dropFilingTargets([files, smart({ fileTo: "Other" })], "School");
    expect(dropped[0].fileTo).toBeUndefined();
    expect("fileTo" in dropped[0]).toBe(false);
    expect(dropped[1].fileTo).toBe("Other");
  });
});

describe("the note list", () => {
  const notes: ListedNote[] = [
    { path: "U/a.note.md", title: "a", edited: 1, tags: ["#uni"] },
    { path: "U/b.note.md", title: "b", edited: 3, tags: [] },
    { path: "U/Sub/c.note.md", title: "c", edited: 5, tags: ["#uni/x"] },
    { path: "d.note.md", title: "d", edited: 3, tags: ["#todo"] },
  ];

  it("lists a folder's own notes, newest first", () => {
    expect(notesIn(notes, { kind: "folder", folder: "U" }, []).map((n) => n.title)).toEqual([
      "b",
      "a",
    ]);
  });

  it("lists a tag's and a smart folder's notes from anywhere", () => {
    expect(notesIn(notes, { kind: "tag", tag: "uni" }, []).map((n) => n.title)).toEqual(["c", "a"]);
    expect(
      notesIn(notes, { kind: "smart", id: "s1" }, [smart({ tags: ["uni", "todo"] })]).map(
        (n) => n.title,
      ),
    ).toEqual(["c", "d", "a"]);
    expect(notesIn(notes, { kind: "smart", id: "gone" }, [])).toEqual([]);
  });

  it("reads a stored scope back, or nothing", () => {
    expect(scopeOf({ kind: "folder", folder: "U" })).toEqual({ kind: "folder", folder: "U" });
    expect(scopeOf({ kind: "tag", tag: "#Uni" })).toEqual({ kind: "tag", tag: "uni" });
    expect(scopeOf({ kind: "smart", id: "s" })).toEqual({ kind: "smart", id: "s" });
    expect(scopeOf({ kind: "tag" })).toBeNull();
    expect(scopeOf(null)).toBeNull();
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

describe("searching from the note list", () => {
  const items = [
    { path: "Other/Algebra.note.md", title: "Algebra" },
    { path: "Uni/Groups.note.md", title: "Groups" },
    { path: "Uni/Lecture.notebook.md", title: "Lecture" },
  ];
  const snip = (match: string) => [{ before: "a ", match, after: " b" }];

  it("shows nothing for an empty query", () => {
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
    expect(rows.map((r) => [r.title, r.pageIndex])).toEqual([
      ["Lecture", 4],
      ["Algebra", 0],
    ]);
    expect(rows[1].snippet?.match).toBe("algebra");
  });
});
