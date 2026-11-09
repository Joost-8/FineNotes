/**
 * A PDF's outline as the notebook's contents (discussion #185): which page
 * each entry lands on, title or heading, its level, and Undo.
 */

import { describe, expect, it } from "vitest";
import { emptyDocument, type InkDocument, type Page } from "../../src/model/document";
import { SetPagesContents, contentsEntries, contentsTree } from "../../src/model/contents";
import { MAX_OUTLINE_ITEMS, addedEntries, outlineContents } from "../../src/model/pdf-outline";

function pdfPage(id: string, page: number, path = "book.pdf"): Page {
  return {
    id,
    kind: "ink",
    geometry: { width: 1000, height: 1400 },
    backdrop: { kind: "pdf", path, page },
    strokes: [],
    images: [],
    textBoxes: [],
  };
}

function book(n: number): InkDocument {
  const doc = emptyDocument();
  doc.pages = Array.from({ length: n }, (_, i) => pdfPage(`p${i + 1}`, i));
  return doc;
}

function apply(doc: InkDocument, items: Parameters<typeof outlineContents>[2]): void {
  new SetPagesContents(outlineContents(doc, "book.pdf", items), "Contents").apply(doc);
}

describe("outlineContents", () => {
  it("makes top-of-page entries titles and lower ones headings, with levels", () => {
    const doc = book(6);
    apply(doc, [
      { title: "1 Getting started", depth: 1, page: 0 },
      { title: "2 Variables", depth: 1, page: 2, y: 0.05 },
      { title: "2.1 Names", depth: 2, page: 2, x: 0.1, y: 0.5 },
      { title: "2.2 Strings", depth: 2, page: 4, y: 0 },
      { title: "Escapes", depth: 3, page: 4, y: 0.6 },
      { title: "Deeper still", depth: 5, page: 5, y: 0.4 },
    ]);
    expect(doc.pages[0].title).toBe("1 Getting started");
    expect(doc.pages[2].title).toBe("2 Variables");
    expect(doc.pages[2].sections).toEqual([{ id: "c1", x: 100, y: 700, title: "2.1 Names" }]);
    expect(doc.pages[4].titleLevel).toBe(2);
    // One below its title by default: no level stored.
    expect(doc.pages[4].sections?.[0].level).toBeUndefined();
    // On a page without a title a heading is a chapter by default, so level 3 is stored.
    expect(doc.pages[5].sections?.[0].level).toBe(3);
    const tree = contentsTree(contentsEntries(doc));
    expect(tree.map((n) => n.entry.title)).toEqual(["1 Getting started", "2 Variables"]);
    expect(tree[1].children.map((n) => n.entry.title)).toEqual(["2.1 Names", "2.2 Strings"]);
  });

  it("puts a second entry at the top of a page under the first, as a heading", () => {
    const doc = book(1);
    apply(doc, [
      { title: "Chapter 2", depth: 1, page: 0 },
      { title: "2.1", depth: 2, page: 0, y: 0.02 },
    ]);
    expect(doc.pages[0].title).toBe("Chapter 2");
    expect(doc.pages[0].sections?.map((s) => s.title)).toEqual(["2.1"]);
  });

  it("matches pages by their PDF page, not their position, and skips the rest", () => {
    const doc = emptyDocument();
    doc.pages.push(pdfPage("p2", 3), pdfPage("p3", 0, "other.pdf"), pdfPage("p4", 0));
    apply(doc, [
      { title: "Front", depth: 1, page: 0 },
      { title: "Missing", depth: 1, page: 1 },
      { title: "Four", depth: 1, page: 3 },
    ]);
    expect(doc.pages.map((p) => p.title)).toEqual([undefined, "Four", undefined, "Front"]);
  });

  it("only touches the pages given", () => {
    const doc = book(3);
    const contents = outlineContents(
      doc,
      "book.pdf",
      [
        { title: "A", depth: 1, page: 0 },
        { title: "C", depth: 1, page: 2 },
      ],
      [doc.pages[2]],
    );
    expect(contents.map((c) => c.page.id)).toEqual(["p3"]);
  });

  it("keeps a page's own title and headings, adding after them", () => {
    const doc = book(1);
    doc.pages[0].title = "My title";
    doc.pages[0].sections = [{ id: "c4", x: 0, y: 900, title: "Mine" }];
    const contents = outlineContents(doc, "book.pdf", [{ title: "From PDF", depth: 1, page: 0 }]);
    expect(addedEntries(contents)).toBe(1);
    new SetPagesContents(contents, "Contents").apply(doc);
    expect(doc.pages[0].title).toBe("My title");
    // A fresh id after the notebook's highest, placed by its height.
    expect(doc.pages[0].sections?.map((s) => [s.id, s.title])).toEqual([
      ["c5", "From PDF"],
      ["c4", "Mine"],
    ]);
  });

  it("places headings inside a PDF frame on a widened page", () => {
    const doc = book(1);
    doc.pages[0].geometry = { width: 1600, height: 1400 };
    doc.pages[0].backdrop = {
      kind: "pdf",
      path: "book.pdf",
      page: 0,
      frame: { x: 0, y: 100, width: 1000, height: 1200 },
    };
    doc.pages[0].title = "T";
    apply(doc, [{ title: "Half", depth: 2, page: 0, x: 0.5, y: 0.5 }]);
    expect(doc.pages[0].sections?.[0]).toMatchObject({ x: 500, y: 700 });
  });

  it("skips blank titles, clamps odd positions, and caps a huge outline", () => {
    const doc = book(1);
    const contents = outlineContents(doc, "book.pdf", [
      { title: "   ", depth: 1, page: 0 },
      { title: "Odd", depth: 0, page: 0, x: -3, y: Number.NaN },
    ]);
    expect(contents[0].title).toBe("Odd");
    expect(contents[0].titleLevel).toBe(1);
    const many = Array.from({ length: MAX_OUTLINE_ITEMS + 50 }, (_, i) => ({
      title: `Entry ${i}`,
      depth: 1,
      page: 0,
      y: 0.5,
    }));
    expect(addedEntries(outlineContents(book(1), "book.pdf", many))).toBe(MAX_OUTLINE_ITEMS);
  });

  it("is undone in one step", () => {
    const doc = book(3);
    const before = structuredClone(doc.pages);
    const command = new SetPagesContents(
      outlineContents(doc, "book.pdf", [
        { title: "A", depth: 1, page: 0 },
        { title: "B", depth: 2, page: 1, y: 0.4 },
      ]),
      "Contents",
    );
    command.apply(doc);
    expect(contentsEntries(doc)).toHaveLength(2);
    command.invert(doc);
    expect(doc.pages).toEqual(before);
  });

  it("returns nothing for a notebook without that PDF", () => {
    expect(outlineContents(book(2), "else.pdf", [{ title: "A", depth: 1, page: 0 }])).toEqual([]);
  });
});
