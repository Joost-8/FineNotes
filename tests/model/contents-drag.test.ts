/**
 * Chapters with no page of their own, and rearranging the contents by
 * dragging (discussion #185): what moves with an entry, where it may land,
 * and that undo puts back exactly what was there.
 */

import { describe, expect, it } from "vitest";
import { RemovePage } from "../../src/model/commands";
import {
  SetChapter,
  SetPageTitle,
  SetSection,
  contentsEntries,
  currentContentsEntry,
  levelShift,
  nextSectionId,
} from "../../src/model/contents";
import {
  MoveContents,
  contentsDropGaps,
  contentsDropLevels,
  planContentsDrop,
} from "../../src/model/contents-drag";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import { duplicatePageAfter } from "../../src/model/page-commands";
import { RemovePages } from "../../src/model/page-order";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function pages(n: number): InkDocument {
  const doc = emptyDocument();
  for (let i = 2; i <= n; i++) doc.pages.push(blankPage(`p${i}`));
  return doc;
}

function title(doc: InkDocument, index: number, name: string, level?: 2 | 3): void {
  new SetPageTitle(doc.pages[index], name).apply(doc);
  if (level) doc.pages[index].titleLevel = level;
}

function chapter(doc: InkDocument, index: number, name: string): string {
  const id = nextSectionId(doc);
  new SetChapter(doc.pages[index], id, name).apply(doc);
  return id;
}

/** The contents as `title@page:level`, page counted from 1. */
function read(doc: InkDocument): string[] {
  return contentsEntries(doc).map((e) => `${e.title}@${e.index + 1}:${e.level}`);
}

function ids(doc: InkDocument): string[] {
  return doc.pages.map((page) => page.id);
}

function drop(doc: InkDocument, at: number, gap: number, level: number): MoveContents {
  const plan = planContentsDrop(doc, at, gap, level);
  if (!plan) throw new Error("no plan");
  const command = new MoveContents(plan, "Move");
  command.apply(doc);
  return command;
}

/** A, then a chapter holding B and C, then D. Each on its own page. */
function book(): InkDocument {
  const doc = pages(4);
  title(doc, 0, "A");
  chapter(doc, 1, "Ch");
  title(doc, 1, "B", 2);
  title(doc, 2, "C", 2);
  title(doc, 3, "D");
  return doc;
}

describe("chapters with no page of their own", () => {
  it("stand before their page in the contents", () => {
    const doc = pages(2);
    title(doc, 1, "B");
    chapter(doc, 1, "Ch");
    expect(read(doc)).toEqual(["Ch@2:1", "B@2:1"]);
  });

  it("add, rename and remove, each undone exactly", () => {
    const doc = pages(1);
    const page = doc.pages[0];
    const add = new SetChapter(page, "c1", "One");
    add.apply(doc);
    const rename = new SetChapter(page, "c1", "Two");
    rename.apply(doc);
    expect(page.chapters).toEqual([{ id: "c1", title: "Two" }]);
    rename.invert(doc);
    expect(page.chapters).toEqual([{ id: "c1", title: "One" }]);
    const remove = new SetChapter(page, "c1", null);
    remove.apply(doc);
    expect(page.chapters).toBeUndefined();
    remove.invert(doc);
    add.invert(doc);
    expect(page.chapters).toBeUndefined();
  });

  it("take section ids nothing else has", () => {
    const doc = pages(1);
    new SetSection(doc.pages[0], "c4", { x: 0, y: 0, title: "S" }).apply(doc);
    expect(chapter(doc, 0, "Ch")).toBe("c5");
    expect(nextSectionId(doc)).toBe("c6");
  });

  it("survive the file, level and place included", () => {
    const doc = pages(2);
    doc.pages[1].chapters = [
      { id: "c1", title: "One", level: 2 },
      { id: "c2", title: "Two", after: true },
    ];
    expect(decodeDocument(encodeDocument(doc)).pages[1].chapters).toEqual(doc.pages[1].chapters);
  });

  it("drop what cannot be read, and repeated ids", () => {
    const doc = pages(1);
    const raw = [
      { id: "c1", title: "One", level: 9 },
      { id: "c1", title: "Again" },
      { id: "c2", title: "   " },
      "nope",
    ];
    (doc.pages[0] as { chapters?: unknown }).chapters = raw;
    expect(decodeDocument(encodeDocument(doc)).pages[0].chapters).toEqual([
      { id: "c1", title: "One" },
    ]);
  });

  it("indent like any entry", () => {
    const doc = pages(2);
    title(doc, 0, "A");
    chapter(doc, 1, "Ch");
    const changes = levelShift(doc, 1, 1);
    expect(changes).toEqual([{ page: doc.pages[1], chapter: "c1", level: 2 }]);
  });

  it("are reached by reading their page, unless they stand after it", () => {
    const doc = pages(1);
    title(doc, 0, "A");
    doc.pages[0].chapters = [
      { id: "c1", title: "Before" },
      { id: "c2", title: "After", after: true },
    ];
    expect(read(doc)).toEqual(["Before@1:1", "A@1:1", "After@1:1"]);
    expect(currentContentsEntry(contentsEntries(doc), 0)).toBe(1);
  });

  it("stay behind when their page is deleted, and come back with it", () => {
    const doc = pages(3);
    chapter(doc, 1, "Ch");
    const page = doc.pages[1];
    const command = new RemovePage(1);
    command.apply(doc);
    expect(doc.pages[1].chapters).toEqual([{ id: "c1", title: "Ch" }]);
    command.invert(doc);
    expect(doc.pages[1]).toBe(page);
    expect(page.chapters).toEqual([{ id: "c1", title: "Ch" }]);
    expect(doc.pages[2].chapters).toBeUndefined();
  });

  it("stand after the last page when every page after them goes", () => {
    const doc = pages(3);
    chapter(doc, 1, "Ch");
    const command = new RemovePages([doc.pages[1], doc.pages[2]]);
    command.apply(doc);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].chapters).toEqual([{ id: "c1", title: "Ch", after: true }]);
    command.invert(doc);
    expect(doc.pages[0].chapters).toBeUndefined();
    expect(doc.pages[1].chapters).toEqual([{ id: "c1", title: "Ch" }]);
  });

  it("are not copied with a duplicated page", () => {
    const doc = pages(1);
    chapter(doc, 0, "Ch");
    expect(duplicatePageAfter(doc, 0)?.page.chapters).toBeUndefined();
  });
});

describe("dragging an entry", () => {
  it("moves a page with the untitled pages running on under it", () => {
    const doc = pages(4);
    title(doc, 0, "A");
    title(doc, 2, "C");
    drop(doc, 0, 2, 1);
    expect(ids(doc)).toEqual(["p3", "p4", doc.pages[2].id, "p2"]);
    expect(read(doc)).toEqual(["C@1:1", "A@3:1"]);
  });

  it("moves a chapter with everything inside it", () => {
    const doc = book();
    const before = ids(doc);
    // Ch (entry 1) holding B and C, to the very end.
    drop(doc, 1, 5, 1);
    expect(ids(doc)).toEqual([before[0], before[3], before[1], before[2]]);
    expect(read(doc)).toEqual(["A@1:1", "D@2:1", "Ch@3:1", "B@3:2", "C@4:2"]);
  });

  it("carries the levels inside a block along", () => {
    const doc = book();
    drop(doc, 1, 1, 2);
    expect(read(doc)).toEqual(["A@1:1", "Ch@2:2", "B@2:3", "C@3:3", "D@4:1"]);
  });

  it("moves a page out of a chapter, leaving the chapter by the next page", () => {
    const doc = book();
    const [a, b, c, d] = doc.pages;
    // B to before A.
    drop(doc, 2, 0, 1);
    expect(doc.pages).toEqual([b, a, c, d]);
    expect(read(doc)).toEqual(["B@1:1", "A@2:1", "Ch@3:1", "C@3:2", "D@4:1"]);
  });

  it("makes a page the first thing in a chapter", () => {
    const doc = book();
    const [a, b, c, d] = doc.pages;
    // D between the chapter and B: the chapter must stand before D now.
    drop(doc, 4, 2, 2);
    expect(doc.pages).toEqual([a, d, b, c]);
    expect(read(doc)).toEqual(["A@1:1", "Ch@2:1", "D@2:2", "B@3:2", "C@4:2"]);
  });

  it("moves an empty chapter alone, whatever pages follow it", () => {
    const doc = pages(4);
    title(doc, 0, "A");
    chapter(doc, 1, "Ch");
    title(doc, 3, "D");
    const before = ids(doc);
    drop(doc, 1, 0, 1);
    expect(ids(doc)).toEqual(before);
    expect(read(doc)).toEqual(["Ch@1:1", "A@1:1", "D@4:1"]);
  });

  it("can stand a chapter past the last page", () => {
    const doc = pages(2);
    title(doc, 1, "B");
    chapter(doc, 0, "Ch");
    drop(doc, 0, 2, 1);
    expect(read(doc)).toEqual(["B@2:1", "Ch@2:1"]);
    expect(doc.pages[1].chapters).toEqual([{ id: "c1", title: "Ch", after: true }]);
  });

  it("is undone exactly, and redone", () => {
    const doc = book();
    const order = doc.pages.slice();
    const before = read(doc);
    const chaptersBefore = doc.pages[1].chapters;
    const command = drop(doc, 1, 5, 1);
    const after = read(doc);
    command.invert(doc);
    expect(doc.pages).toEqual(order);
    expect(read(doc)).toEqual(before);
    expect(doc.pages[1].chapters).toBe(chaptersBefore);
    command.apply(doc);
    expect(read(doc)).toEqual(after);
  });

  it("does nothing dropped where it was at its own level", () => {
    const doc = book();
    expect(planContentsDrop(doc, 1, 1, 1)).toBeNull();
  });

  it("refuses a gap inside its own block", () => {
    const doc = book();
    expect(contentsDropGaps(doc, 1)).toEqual([0, 1, 5]);
    expect(planContentsDrop(doc, 1, 3, 1)).toBeNull();
  });

  it("cannot land between two entries of one page", () => {
    const doc = pages(3);
    title(doc, 0, "A");
    new SetSection(doc.pages[1], "c1", { x: 0, y: 10, title: "S1" }).apply(doc);
    new SetSection(doc.pages[1], "c2", { x: 0, y: 90, title: "S2" }).apply(doc);
    title(doc, 2, "C");
    // Entries: A, S1, S2, C. Before S1 is a page boundary, before S2 is not.
    expect(contentsDropGaps(doc, 3)).toEqual([0, 1, 3]);
  });

  it("only changes a heading's level, on its own page", () => {
    const doc = pages(2);
    title(doc, 0, "A");
    new SetSection(doc.pages[0], "c1", { x: 0, y: 10, title: "S" }).apply(doc);
    expect(contentsDropGaps(doc, 1)).toEqual([1]);
    expect(planContentsDrop(doc, 1, 1, 1)).toEqual({
      levels: [{ page: doc.pages[0], section: "c1", level: 1 }],
    });
  });

  it("keeps a title that shares its page with an outside entry where it is", () => {
    const doc = pages(2);
    title(doc, 0, "A", 2);
    new SetSection(doc.pages[0], "c1", { x: 0, y: 10, title: "S", level: 1 }).apply(doc);
    expect(contentsDropGaps(doc, 0)).toEqual([0]);
  });
});

describe("the levels a gap allows", () => {
  it("run from the next entry's level to one below the last", () => {
    const doc = book();
    const entries = contentsEntries(doc);
    // A lands after C (level 2), before D (level 1).
    expect(contentsDropLevels(entries, 0, 4)).toEqual({ min: 1, max: 3 });
    // A lands at the very start.
    expect(contentsDropLevels(entries, 4, 0)).toEqual({ min: 1, max: 1 });
  });

  it("will not take over the entry after the gap", () => {
    const doc = book();
    // D between the chapter and B (level 2): level 1 would take B from the chapter.
    expect(contentsDropLevels(contentsEntries(doc), 4, 2)).toEqual({ min: 2, max: 2 });
  });

  it("leave room for the deepest entry inside", () => {
    const doc = book();
    doc.pages[2].titleLevel = 3;
    // Ch holds B (2) and C (3): it can only sink by nothing.
    expect(contentsDropLevels(contentsEntries(doc), 1, 5)).toEqual({ min: 1, max: 1 });
  });

  it("are enforced on a drop", () => {
    const doc = book();
    drop(doc, 4, 0, 3);
    expect(read(doc)[0]).toBe("D@1:1");
  });
});
