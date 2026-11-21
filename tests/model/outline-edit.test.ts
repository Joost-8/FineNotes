/**
 * Ask AI writing a notebook's outline: where each entry lands, levels,
 * replacing against adding, one undo step, and the outline as the AI reads it.
 */

import { describe, expect, it } from "vitest";
import { emptyDocument, type InkDocument, type Page } from "../../src/model/document";
import { SetPagesContents, contentsEntries } from "../../src/model/contents";
import {
  MAX_OUTLINE_ENTRIES,
  outlineText,
  pageRange,
  placeOutline,
} from "../../src/model/outline-edit";
import { tabOutlineEntries } from "../../src/model/pdf-outline";

function page(
  id: string,
  backdrop: Page["backdrop"] = { kind: "blank" } as Page["backdrop"],
): Page {
  return {
    id,
    kind: "ink",
    geometry: { width: 1000, height: 1400 },
    backdrop,
    strokes: [],
    images: [],
    textBoxes: [],
  };
}

function notebook(n: number): InkDocument {
  const doc = emptyDocument();
  doc.pages = Array.from({ length: n }, (_, i) => page(`p${i + 1}`));
  return doc;
}

function lines(doc: InkDocument): string[] {
  return contentsEntries(doc).map(
    (e) => `${e.index + 1}:${e.level}:${e.section ? "h" : e.chapter ? "c" : "t"}:${e.title}`,
  );
}

describe("placeOutline", () => {
  it("makes top entries titles and lower ones headings, at their levels, as one undo step", () => {
    const doc = notebook(14);
    const contents = placeOutline(
      doc,
      [
        { page: 1, title: "Lecture 1", level: 1 },
        { page: 3, title: "Cells", level: 2, y: 0.5 },
        { page: 12, title: "Lecture 4" },
        { page: 12, title: "Mitosis", level: 2, y: 0.05 },
        { page: 13, title: "Phases", level: 3, y: 0.4 },
      ],
      false,
    );
    const command = new SetPagesContents(contents, "Outline");
    command.apply(doc);
    expect(lines(doc)).toEqual([
      "1:1:t:Lecture 1",
      "3:2:h:Cells",
      "12:1:t:Lecture 4",
      "12:2:h:Mitosis",
      "13:3:h:Phases",
    ]);
    // Where the level reads as it would anyway, none is stored.
    expect(doc.pages[11].sections?.[0].level).toBeUndefined();
    expect(doc.pages[2].sections?.[0]).toMatchObject({ x: 80, y: 700, level: 2 });
    command.invert(doc);
    expect(lines(doc)).toEqual([]);
  });

  it("adds to what a page has, and replaces the whole outline when asked", () => {
    const doc = notebook(4);
    new SetPagesContents(placeOutline(doc, [{ page: 2, title: "Old" }], false), "x").apply(doc);
    doc.pages[3].chapters = [{ id: "c9", title: "Loose chapter" }];
    new SetPagesContents(
      placeOutline(doc, [{ page: 2, title: "Added", y: 0.6 }], false),
      "x",
    ).apply(doc);
    expect(lines(doc)).toEqual(["2:1:t:Old", "2:1:h:Added", "4:1:c:Loose chapter"]);

    const replace = new SetPagesContents(
      placeOutline(doc, [{ page: 1, title: "New start" }], true),
      "x",
    );
    replace.apply(doc);
    expect(lines(doc)).toEqual(["1:1:t:New start"]);
    replace.invert(doc);
    expect(lines(doc)).toEqual(["2:1:t:Old", "2:1:h:Added", "4:1:c:Loose chapter"]);
    // An empty outline, replacing, clears it.
    new SetPagesContents(placeOutline(doc, [], true), "x").apply(doc);
    expect(lines(doc)).toEqual([]);
  });

  it("passes over entries off the notebook or without a title, and caps the count", () => {
    const doc = notebook(2);
    const contents = placeOutline(
      doc,
      [
        { page: 5, title: "Nowhere" },
        { page: 1, title: "   " },
        { page: 2, title: "Kept", level: 7 },
      ],
      false,
    );
    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({ title: "Kept", titleLevel: 3 });
    const many = Array.from({ length: MAX_OUTLINE_ENTRIES + 5 }, (_, i) => ({
      page: 1,
      title: `H${i}`,
      y: 0.5,
    }));
    const capped = placeOutline(doc, many, false);
    expect(capped[0].sections).toHaveLength(MAX_OUTLINE_ENTRIES);
  });
});

describe("outlineText", () => {
  it("lists every entry with its page, level and kind", () => {
    const doc = notebook(3);
    expect(outlineText(doc)).toBe("The notebook (3 pages) has no outline yet.");
    new SetPagesContents(
      placeOutline(
        doc,
        [
          { page: 1, title: "Intro" },
          { page: 2, title: "Detail", level: 2, y: 0.5 },
        ],
        false,
      ),
      "x",
    ).apply(doc);
    doc.pages[2].chapters = [{ id: "c7", title: "Part B" }];
    expect(outlineText(doc).split("\n")).toEqual([
      "The notebook's outline (3 entries, 3 pages):",
      "- page 1, level 1, page title: “Intro”",
      "- page 2, level 2, heading 50% down: “Detail”",
      "- page 3, level 1, chapter with no page of its own, before this page: “Part B”",
    ]);
  });

  it("names the PDFs behind the pages, with their own outline or none", () => {
    const doc = emptyDocument();
    doc.pages = [0, 1, 2].map((i) => page(`p${i}`, { kind: "pdf", path: "slides.pdf", page: i }));
    doc.pages.push(page("p9", { kind: "pdf", path: "scan.pdf", page: 0 }));
    const own = tabOutlineEntries(doc, "slides.pdf", [
      { title: "Chapter 1", depth: 1, page: 0 },
      { title: "1.1", depth: 2, page: 2, y: 0.5 },
    ]);
    const text = outlineText(doc, [
      { name: "slides.pdf", pages: [1, 2, 3], entries: own },
      { name: "scan.pdf", pages: [4], entries: [] },
    ]);
    expect(text).toContain("Pages 1–3 show the PDF “slides.pdf”.");
    expect(text).toContain("  - page 1, level 1, page title: “Chapter 1”");
    expect(text).toContain("  - page 3, level 2, heading");
    expect(text).toContain("Page 4 shows the PDF “scan.pdf”.\nIt has no outline of its own");
    expect(outlineText(notebook(1))).toBe("The notebook (1 page) has no outline yet.");
  });
});

describe("pageRange", () => {
  it("joins runs", () => {
    expect(pageRange([3])).toBe("3");
    expect(pageRange([4, 1, 2, 3, 7, 7])).toBe("1–4, 7");
  });
});
