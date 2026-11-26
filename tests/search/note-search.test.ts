import { describe, expect, it } from "vitest";
import { textBlock, type InkBlock, type TextNote } from "../../src/model/text-note";
import { type LibraryHit, searchLibrary } from "../../src/search/library-search";
import { currentFirst, noteHits, notePageText } from "../../src/search/note-search";

const line = (id: string, text: string): ReturnType<typeof textBlock> =>
  textBlock(id, "body", [{ text, marks: 0 }]);

const section = (id: string, reading?: string): InkBlock => ({
  type: "ink",
  id,
  height: 200,
  strokes: [],
  ...(reading ? { reading: { text: reading, of: "h" } } : {}),
});

const note: TextNote = {
  blocks: [
    textBlock("t", "title", [{ text: "Algebra", marks: 0 }]),
    line("a", "Groups and rings"),
    section("x", "Karatsuba multiplication\nfast"),
    line("b", ""),
    section("y"),
    line("c", "More about groups"),
  ],
};

describe("a text note as search sees it", () => {
  it("is one page: its typed lines, then each section's reading as a guess", () => {
    const page = notePageText(note);
    expect(page.pageIndex).toBe(0);
    expect(page.sources).toEqual([
      { kind: "text", text: "Algebra\nGroups and rings\nMore about groups" },
      { kind: "handwriting", text: "Karatsuba multiplication\nfast", guess: true },
    ]);
  });

  it("is found by Home's search, handwriting a letter off included", () => {
    const books = [{ path: "A.note.md", pages: [notePageText(note)] }];
    expect(searchLibrary(books, "rings")).toHaveLength(1);
    const near = searchLibrary(books, "karatsuha");
    expect(near).toHaveLength(1);
    expect(near[0].near).toBe(true);
    expect(searchLibrary(books, "nothing")).toEqual([]);
  });
});

describe("where a note holds the query", () => {
  it("lists every typed match in order, and the sections that hold it", () => {
    const hits = noteHits(note, "groups");
    expect(hits.text).toEqual([
      { block: 1, start: 0, end: 6 },
      { block: 5, start: 11, end: 17 },
    ]);
    expect(hits.ink).toEqual([]);
    expect(noteHits(note, "karatsuha fast").ink).toEqual([2]);
    expect(noteHits(note, "karatsuba groups").ink).toEqual([]);
    expect(noteHits(note, "  ")).toEqual({ text: [], ink: [] });
  });

  it("marks a phrase as one where the note holds it", () => {
    expect(noteHits(note, "groups and").text).toEqual([{ block: 1, start: 0, end: 10 }]);
  });
});

describe("the note in use first", () => {
  it("puts its hits before the rest, keeping each group's order", () => {
    const hit = (path: string, pageIndex: number): LibraryHit => ({
      path,
      pageIndex,
      phrase: false,
      near: false,
      count: 1,
      snippets: [],
    });
    const hits = [hit("a", 0), hit("b", 0), hit("a", 1), hit("c", 0)];
    expect(currentFirst(hits, "b").map((h) => h.path)).toEqual(["b", "a", "a", "c"]);
    expect(currentFirst(hits, null)).toEqual(hits);
  });
});
