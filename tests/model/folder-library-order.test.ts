import { describe, expect, it } from "vitest";
import {
  columnsFor,
  compareNames,
  compareTreeEntries,
  descendingFor,
  directionRows,
  noteTitle,
  sortFolders,
  sortNotes,
} from "../../src/model/folder-library-order";

const note = (basename: string, ctime: number, mtime: number) => ({
  basename,
  stat: { ctime, mtime },
});

describe("columnsFor", () => {
  it("fits cards of at least 190 px with a 16 px gap, and at least one column", () => {
    expect(columnsFor(0)).toBe(1);
    expect(columnsFor(100)).toBe(1);
    expect(columnsFor(190)).toBe(1);
    // Two cards and a gap: 190 + 16 + 190 = 396.
    expect(columnsFor(395)).toBe(1);
    expect(columnsFor(396)).toBe(2);
    expect(columnsFor(880)).toBe(4);
    expect(columnsFor(1200)).toBe(5);
  });
});

describe("noteTitle", () => {
  it("drops .notebook and .page, in any case, but not a name that is only that", () => {
    expect(noteTitle("Physics.notebook")).toBe("Physics");
    expect(noteTitle("Sketch.PAGE")).toBe("Sketch");
    expect(noteTitle("Plain note")).toBe("Plain note");
    expect(noteTitle("Physics.notebook.old")).toBe("Physics.notebook.old");
    expect(noteTitle(".notebook")).toBe(
      ".notebook".replace(/\.(notebook|page)$/i, "") || ".notebook",
    );
  });
});

describe("sorting notes", () => {
  const notes = [note("b", 2, 30), note("a", 3, 10), note("c", 1, 20)];

  it("sorts by creation, newest first or oldest first", () => {
    expect(sortNotes(notes, "created", true).map((n) => n.basename)).toEqual(["a", "b", "c"]);
    expect(sortNotes(notes, "created", false).map((n) => n.basename)).toEqual(["c", "b", "a"]);
  });

  it("sorts by the last edit", () => {
    expect(sortNotes(notes, "modified", true).map((n) => n.basename)).toEqual(["b", "c", "a"]);
    expect(sortNotes(notes, "modified", false).map((n) => n.basename)).toEqual(["a", "c", "b"]);
  });

  it("sorts by name as people read it: numbers by value, case ignored, suffix left out", () => {
    const named = [
      note("Week 10.notebook", 0, 0),
      note("week 2", 0, 0),
      note("Week 1.page", 0, 0),
      note("Álgebra", 0, 0),
    ];
    expect(sortNotes(named, "name", false).map((n) => n.basename)).toEqual([
      "Álgebra",
      "Week 1.page",
      "week 2",
      "Week 10.notebook",
    ]);
    expect(sortNotes(named, "name", true).map((n) => n.basename)).toEqual([
      "Week 10.notebook",
      "week 2",
      "Week 1.page",
      "Álgebra",
    ]);
  });

  it("does not change the list it was given", () => {
    const copy = [...notes];
    sortNotes(notes, "name", false);
    expect(notes).toEqual(copy);
  });
});

describe("folders and the tree", () => {
  it("sorts folders by name", () => {
    expect(
      sortFolders([{ name: "b" }, { name: "A" }, { name: "a10" }, { name: "a2" }]).map(
        (f) => f.name,
      ),
    ).toEqual(["A", "a2", "a10", "b"]);
  });

  it("puts folders before files in the tree", () => {
    const entries = [
      { name: "b.md", isFolder: false },
      { name: "z", isFolder: true },
      { name: "a.md", isFolder: false },
      { name: "m", isFolder: true },
    ];
    expect([...entries].sort(compareTreeEntries).map((e) => e.name)).toEqual([
      "m",
      "z",
      "a.md",
      "b.md",
    ]);
    expect(compareNames("a", "B")).toBeLessThan(0);
  });
});

describe("the sort menu", () => {
  it("starts each sort in its natural direction", () => {
    expect(descendingFor("created")).toBe(true);
    expect(descendingFor("modified")).toBe(true);
    expect(descendingFor("name")).toBe(false);
  });

  it("offers newest/oldest first for dates and A to Z/Z to A for names", () => {
    expect(directionRows("created")).toEqual({ first: true, second: false });
    expect(directionRows("modified")).toEqual({ first: true, second: false });
    expect(directionRows("name")).toEqual({ first: false, second: true });
  });
});
