/**
 * Contents levels (discussion #185): chapters that hold sections across
 * pages, indent and outdent with undo, the file round trip, and that a
 * notebook without levels reads exactly as before.
 */

import { describe, expect, it } from "vitest";
import { blankPage, emptyDocument, type InkDocument } from "../../src/model/document";
import {
  SetContentsLevels,
  SetPageTitle,
  SetPagesContents,
  SetSection,
  clearedContents,
  contentsAncestors,
  contentsEntries,
  contentsTree,
  levelShift,
  type ContentsNode,
} from "../../src/model/contents";
import { duplicatePageAfter } from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function pages(n: number): InkDocument {
  const doc = emptyDocument();
  for (let i = 2; i <= n; i++) doc.pages.push(blankPage(`p${i}`));
  return doc;
}

/** The tree as nested titles, for reading at a glance. */
function shape(nodes: ContentsNode[]): unknown[] {
  return nodes.map((node) =>
    node.children.length > 0 ? [node.entry.title, shape(node.children)] : node.entry.title,
  );
}

function roundTrip(doc: InkDocument): InkDocument {
  return decodeDocument(encodeDocument(doc));
}

describe("contentsTree", () => {
  it("reads a notebook without levels as before: a title holds only its own page's headings", () => {
    const doc = pages(3);
    doc.pages[0].title = "Intro";
    doc.pages[0].sections = [{ id: "c1", x: 0, y: 200, title: "Why" }];
    doc.pages[1].sections = [{ id: "c2", x: 0, y: 100, title: "Loose heading" }];
    doc.pages[2].title = "Methods";
    expect(shape(contentsTree(contentsEntries(doc)))).toEqual([
      ["Intro", ["Why"]],
      "Loose heading",
      "Methods",
    ]);
  });

  it("nests chapters across pages by level, never reordering", () => {
    const doc = pages(5);
    doc.pages[0].title = "1 Getting started";
    doc.pages[1].title = "2 Variables";
    doc.pages[2].title = "2.1 Names";
    doc.pages[2].titleLevel = 2;
    doc.pages[3].title = "2.2 Strings";
    doc.pages[3].titleLevel = 2;
    doc.pages[3].sections = [{ id: "c1", x: 0, y: 300, title: "Escapes" }];
    doc.pages[4].title = "3 Control flow";
    const entries = contentsEntries(doc);
    expect(entries.map((e) => e.level)).toEqual([1, 1, 2, 2, 3, 1]);
    expect(shape(contentsTree(entries))).toEqual([
      "1 Getting started",
      ["2 Variables", ["2.1 Names", ["2.2 Strings", ["Escapes"]]]],
      "3 Control flow",
    ]);
    expect(contentsAncestors(entries)).toEqual([[], [], [1], [1], [1, 3], []]);
  });

  it("puts an entry deeper than its parent directly under it", () => {
    const doc = pages(2);
    doc.pages[0].title = "A";
    doc.pages[1].title = "Deep";
    doc.pages[1].titleLevel = 3;
    expect(shape(contentsTree(contentsEntries(doc)))).toEqual([["A", ["Deep"]]]);
  });
});

describe("levelShift and SetContentsLevels", () => {
  function chapters(): InkDocument {
    const doc = pages(4);
    doc.pages[0].title = "One";
    doc.pages[1].title = "Two";
    doc.pages[1].sections = [{ id: "c1", x: 0, y: 100, title: "Two a" }];
    doc.pages[2].title = "Three";
    doc.pages[3].title = "Four";
    return doc;
  }

  it("cannot indent the first entry, nor outdent a chapter", () => {
    const doc = chapters();
    expect(levelShift(doc, 0, 1)).toBeNull();
    expect(levelShift(doc, 1, -1)).toBeNull();
    expect(levelShift(doc, 99, 1)).toBeNull();
  });

  it("indents a chapter with its headings, as one undo step", () => {
    const doc = chapters();
    const changes = levelShift(doc, 1, 1);
    expect(changes?.map((c) => c.level)).toEqual([2, 3]);
    const command = new SetContentsLevels(changes ?? [], "Indent");
    command.apply(doc);
    expect(shape(contentsTree(contentsEntries(doc)))).toEqual([
      ["One", [["Two", ["Two a"]]]],
      "Three",
      "Four",
    ]);
    // The heading follows its title by default, so nothing extra is stored.
    expect(doc.pages[1].titleLevel).toBe(2);
    expect(doc.pages[1].sections?.[0].level).toBeUndefined();
    command.invert(doc);
    expect(doc.pages[1].titleLevel).toBeUndefined();
    expect(contentsEntries(doc).map((e) => e.level)).toEqual([1, 1, 2, 1, 1]);
  });

  it("stops at three levels", () => {
    const doc = chapters();
    new SetContentsLevels(levelShift(doc, 1, 1) ?? [], "Indent").apply(doc);
    // "Two a" is at 3: "Two" cannot go deeper with it.
    expect(levelShift(doc, 1, 1)).toBeNull();
    new SetContentsLevels(levelShift(doc, 3, 1) ?? [], "Indent").apply(doc);
    new SetContentsLevels(levelShift(doc, 3, 1) ?? [], "Indent").apply(doc);
    expect(doc.pages[2].titleLevel).toBe(3);
    expect(levelShift(doc, 3, 1)).toBeNull();
  });

  it("outdents a heading out from under its title, storing the level", () => {
    const doc = chapters();
    new SetContentsLevels(levelShift(doc, 2, -1) ?? [], "Outdent").apply(doc);
    expect(doc.pages[1].sections?.[0].level).toBe(1);
    expect(shape(contentsTree(contentsEntries(doc)))).toEqual([
      "One",
      "Two",
      "Two a",
      "Three",
      "Four",
    ]);
  });

  it("keeps a heading where it showed when only its page's title moves", () => {
    const doc = chapters();
    // Take "Two a" out to level 1, then indent "Two" alone: "Two a" stays at 1.
    new SetContentsLevels(levelShift(doc, 2, -1) ?? [], "Outdent").apply(doc);
    new SetContentsLevels(levelShift(doc, 1, 1) ?? [], "Indent").apply(doc);
    expect(contentsEntries(doc).map((e) => e.level)).toEqual([1, 2, 1, 1, 1]);
  });

  it("drops a title's level with the title, and brings both back on undo", () => {
    const doc = chapters();
    doc.pages[2].titleLevel = 2;
    const remove = new SetPageTitle(doc.pages[2], null);
    remove.apply(doc);
    expect(doc.pages[2].titleLevel).toBeUndefined();
    remove.invert(doc);
    expect(doc.pages[2].titleLevel).toBe(2);
  });

  it("keeps a heading's level when it is renamed or moved", () => {
    const doc = chapters();
    doc.pages[1].sections = [{ id: "c1", x: 0, y: 100, title: "Two a", level: 1 }];
    new SetSection(doc.pages[1], "c1", { x: 0, y: 140, title: "Renamed" }).apply(doc);
    expect(doc.pages[1].sections?.[0]).toEqual({
      id: "c1",
      x: 0,
      y: 140,
      title: "Renamed",
      level: 1,
    });
  });

  it("does not copy a level onto a duplicated page", () => {
    const doc = chapters();
    doc.pages[1].titleLevel = 2;
    const copy = duplicatePageAfter(doc, 1);
    expect(copy?.page.title).toBeUndefined();
    expect(copy?.page.titleLevel).toBeUndefined();
  });
});

describe("levels in the file", () => {
  it("round-trips title and heading levels", () => {
    const doc = pages(2);
    doc.pages[1].title = "Section";
    doc.pages[1].titleLevel = 2;
    doc.pages[1].sections = [{ id: "c1", x: 10, y: 20, title: "Out", level: 1 }];
    const back = roundTrip(doc);
    expect(back.pages[1].titleLevel).toBe(2);
    expect(back.pages[1].sections).toEqual([{ id: "c1", x: 10, y: 20, title: "Out", level: 1 }]);
  });

  it("drops levels that mean nothing: on no title, a chapter's 1, or out of range", () => {
    const doc = pages(3);
    doc.pages[0].titleLevel = 2;
    doc.pages[1].title = "A";
    doc.pages[1].titleLevel = 1;
    doc.pages[2].title = "B";
    (doc.pages[2] as { titleLevel?: unknown }).titleLevel = 7;
    doc.pages[2].sections = [{ id: "c1", x: 0, y: 0, title: "S", level: 9 as 1 }];
    const back = roundTrip(doc);
    expect(back.pages.map((p) => p.titleLevel)).toEqual([undefined, undefined, undefined]);
    expect(back.pages[2].sections?.[0].level).toBeUndefined();
  });
});

describe("SetPagesContents", () => {
  it("sets several pages' contents in one step and puts them back", () => {
    const doc = pages(2);
    doc.pages[0].title = "Mine";
    const before = structuredClone(doc.pages);
    const command = new SetPagesContents(
      [
        { page: doc.pages[0], title: "Mine", sections: [{ id: "c1", x: 0, y: 50, title: "PDF" }] },
        { page: doc.pages[1], title: "Chapter 2", titleLevel: 2 },
      ],
      "Contents from the PDF",
    );
    command.apply(doc);
    expect(contentsEntries(doc).map((e) => e.title)).toEqual(["Mine", "PDF", "Chapter 2"]);
    expect(doc.pages[1].titleLevel).toBe(2);
    command.invert(doc);
    expect(doc.pages).toEqual(before);
  });

  it("clears pages with contents, leaving the rest alone", () => {
    const doc = pages(3);
    doc.pages[0].title = "A";
    doc.pages[0].titleLevel = 2;
    doc.pages[2].sections = [{ id: "c1", x: 0, y: 0, title: "S" }];
    const cleared = clearedContents(doc.pages);
    expect(cleared.map((c) => c.page.id)).toEqual(["p1", "p3"]);
    new SetPagesContents(cleared, "Remove").apply(doc);
    expect(contentsEntries(doc)).toEqual([]);
    expect(doc.pages[0].titleLevel).toBeUndefined();
  });
});
