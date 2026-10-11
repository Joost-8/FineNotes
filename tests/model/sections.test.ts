/**
 * Sections: headings inside a page, listed in the contents under it
 * (`src/model/contents.ts`, FineNotes#20).
 */

import { describe, expect, it } from "vitest";
import { blankPage, emptyDocument, type InkDocument } from "../../src/model/document";
import {
  SetSection,
  contentsEntries,
  contentsTree,
  currentContentsEntry,
  nextSectionId,
  normalizeSections,
} from "../../src/model/contents";
import { duplicatePageAfter } from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function threePages(): InkDocument {
  const doc = emptyDocument();
  doc.pages.push(blankPage("p2"), blankPage("p3"));
  return doc;
}

const at = (y: number, title: string, x = 60) => ({ x, y, title });

describe("the contents with sections", () => {
  it("lists each page's title, then its sections top to bottom", () => {
    const doc = threePages();
    doc.pages[1].title = "Week 2";
    new SetSection(doc.pages[1], "c1", at(600, "Sampling")).apply(doc);
    new SetSection(doc.pages[1], "c2", at(200, "Fourier")).apply(doc);
    new SetSection(doc.pages[2], "c3", at(100, "Filters")).apply(doc);
    expect(contentsEntries(doc).map((e) => [e.index, e.title, e.section?.y])).toEqual([
      [1, "Week 2", undefined],
      [1, "Fourier", 200],
      [1, "Sampling", 600],
      [2, "Filters", 100],
    ]);
  });

  it("knows which section the reader is under, by page and height", () => {
    const doc = threePages();
    doc.pages[1].title = "Week 2";
    new SetSection(doc.pages[1], "c1", at(200, "Fourier")).apply(doc);
    new SetSection(doc.pages[1], "c2", at(600, "Sampling")).apply(doc);
    const entries = contentsEntries(doc);
    expect(currentContentsEntry(entries, 0)).toBe(-1);
    expect(currentContentsEntry(entries, 1, 0)).toBe(0); // the page's title
    expect(currentContentsEntry(entries, 1, 300)).toBe(1);
    expect(currentContentsEntry(entries, 1, 700)).toBe(2);
    expect(currentContentsEntry(entries, 1)).toBe(2); // no height: all reached
    expect(currentContentsEntry(entries, 2, 0)).toBe(2);
  });
});

describe("SetSection", () => {
  it("adds, renames, moves and removes, each undone exactly", () => {
    const doc = threePages();
    const page = doc.pages[0];
    const add = new SetSection(page, "c1", at(200, "Fourier"));
    expect(add.label).toBe("Add to contents");
    expect(add.pageId).toBe("p1");
    add.apply(doc);
    expect(page.sections).toEqual([{ id: "c1", x: 60, y: 200, title: "Fourier" }]);
    const before = JSON.stringify(doc);
    const rename = new SetSection(page, "c1", at(240, "  Fourier   series "));
    expect(rename.label).toBe("Change contents");
    rename.apply(doc);
    expect(page.sections).toEqual([{ id: "c1", x: 60, y: 240, title: "Fourier series" }]);
    rename.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
    const remove = new SetSection(page, "c1", null);
    expect(remove.label).toBe("Remove from contents");
    remove.apply(doc);
    expect("sections" in page).toBe(false);
    remove.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
    add.invert(doc);
    expect("sections" in page).toBe(false);
  });

  it("takes a blank title or a point that is not a number as a removal", () => {
    const doc = threePages();
    const page = doc.pages[0];
    new SetSection(page, "c1", at(200, "Fourier")).apply(doc);
    new SetSection(page, "c1", at(200, "   ")).apply(doc);
    expect(page.sections).toBeUndefined();
    new SetSection(page, "c2", at(Number.NaN, "x")).apply(doc);
    expect(page.sections).toBeUndefined();
  });

  it("does nothing to a page that is no longer in the notebook", () => {
    const doc = threePages();
    const gone = doc.pages.pop()!;
    const set = new SetSection(gone, "c1", at(10, "x"));
    set.apply(doc);
    expect(gone.sections).toBeUndefined();
    set.invert(doc);
    expect(gone.sections).toBeUndefined();
  });
});

describe("section ids and loading", () => {
  it("counts on from the highest id in the notebook", () => {
    const doc = threePages();
    expect(nextSectionId(doc)).toBe("c1");
    new SetSection(doc.pages[2], "c7", at(10, "x")).apply(doc);
    new SetSection(doc.pages[0], "odd", at(10, "y")).apply(doc);
    expect(nextSectionId(doc)).toBe("c8");
  });

  it("keeps only sound sections, once per id in the notebook, top to bottom", () => {
    const seen = new Set<string>(["c9"]);
    const raw = [
      { id: "c2", x: 5, y: 300, title: "B" },
      { id: "c1", x: 5, y: 100, title: " A " },
      { id: "c9", x: 5, y: 1, title: "seen on another page" },
      { id: "c3", x: 5, y: 1, title: "" },
      { id: "c4", x: "5", y: 1, title: "x" },
      { id: "c5", x: 5, y: Infinity, title: "x" },
      { id: "", x: 5, y: 1, title: "x" },
      null,
      "c6",
    ];
    expect(normalizeSections(raw, seen)).toEqual([
      { id: "c1", x: 5, y: 100, title: "A" },
      { id: "c2", x: 5, y: 300, title: "B" },
    ]);
    expect(normalizeSections("nope", seen)).toEqual([]);
  });

  it("survives a save and a load, and a file without any loads without them", () => {
    const doc = threePages();
    new SetSection(doc.pages[1], "c1", at(200, "Fourier")).apply(doc);
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[1].sections).toEqual([{ id: "c1", x: 60, y: 200, title: "Fourier" }]);
    expect("sections" in back.pages[0]).toBe(false);
  });

  it("drops a section id that repeats on a later page", () => {
    const doc = threePages();
    doc.pages[0].sections = [{ id: "c1", x: 1, y: 1, title: "first" }];
    doc.pages[2].sections = [{ id: "c1", x: 1, y: 1, title: "again" }];
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].sections?.[0].title).toBe("first");
    expect("sections" in back.pages[2]).toBe(false);
  });

  it("a duplicated page starts without the original's sections", () => {
    const doc = threePages();
    new SetSection(doc.pages[0], "c1", at(200, "Fourier")).apply(doc);
    const copy = duplicatePageAfter(doc, 0);
    expect(copy?.page.sections).toBeUndefined();
    expect(doc.pages[0].sections).toHaveLength(1);
  });
});

describe("contentsTree", () => {
  it("puts sections under the last page title before them, until the next one", () => {
    const doc = threePages();
    new SetSection(doc.pages[0], "c0", at(100, "Preface")).apply(doc);
    doc.pages[1].title = "Week 2";
    new SetSection(doc.pages[1], "c1", at(200, "Fourier")).apply(doc);
    new SetSection(doc.pages[2], "c2", at(100, "Sampling")).apply(doc);
    doc.pages.push(blankPage("p4"));
    doc.pages[3].title = "Week 3";
    const tree = contentsTree(contentsEntries(doc));
    expect(
      tree.map((n) => [n.entry.title, n.at, n.children.map((c) => [c.entry.title, c.at])]),
    ).toEqual([
      ["Preface", 0, []],
      [
        "Week 2",
        1,
        [
          ["Fourier", 2],
          ["Sampling", 3],
        ],
      ],
      ["Week 3", 4, []],
    ]);
  });

  it("is empty for no entries", () => {
    expect(contentsTree([])).toEqual([]);
  });
});
