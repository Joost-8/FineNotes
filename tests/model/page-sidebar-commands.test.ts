/**
 * The page-sidebar operations: duplicate and move. Each is checked
 * for the page it produces and, through the command it feeds, for an exact
 * undo — the sidebar must never be a way to lose a page.
 */

import { describe, expect, it } from "vitest";
import { AddPage } from "../../src/model/commands";
import { MovePage, duplicatePageAfter } from "../../src/model/page-commands";
import { type InkDocument, type Stroke, blankPage, emptyDocument } from "../../src/model/document";

function stroke(id: string): Stroke {
  return { id, color: "#1a1a1a", size: 3, tool: "pen", pts: [1, 2, 0.5, 3, 4, 0.5] };
}

function threePages(): InkDocument {
  const doc = emptyDocument();
  doc.pages.push(blankPage("p2"), blankPage("p3"));
  doc.pages[0].strokes.push(stroke("s1"), stroke("s2"));
  doc.pages[1].strokes.push(stroke("s7"));
  doc.pages[1].backdrop = { kind: "grid", spacing: 30 };
  doc.pages[1].textBoxes.push({
    id: "t4",
    x: 10,
    y: 20,
    w: 100,
    text: "hi",
    color: "#000",
    fontSize: 16,
  });
  return doc;
}

const ids = (doc: InkDocument): string[] => doc.pages.map((page) => page.id);

describe("duplicatePageAfter", () => {
  it("copies content deeply, with fresh document-wide ids", () => {
    const doc = threePages();
    const dup = duplicatePageAfter(doc, 1);
    if (!dup) throw new Error("expected a copy");
    expect(dup.index).toBe(2);
    expect(dup.page.id).toBe("p4");
    // Above the max over *all* pages (s7), not just the copied one.
    expect(dup.page.strokes.map((s) => s.id)).toEqual(["s8"]);
    expect(dup.page.textBoxes.map((t) => t.id)).toEqual(["t5"]);
    expect(dup.page.backdrop).toEqual({ kind: "grid", spacing: 30 });

    // Deep: editing the copy leaves the original alone.
    dup.page.strokes[0].pts[0] = 999;
    dup.page.textBoxes[0].text = "changed";
    expect(doc.pages[1].strokes[0].pts[0]).toBe(1);
    expect(doc.pages[1].textBoxes[0].text).toBe("hi");
    expect(doc.pages[1].strokes[0].id).toBe("s7");
  });

  it("returns null for a page that does not exist", () => {
    expect(duplicatePageAfter(threePages(), 7)).toBeNull();
  });

  it("undoes through AddPage without touching the original", () => {
    const doc = threePages();
    const dup = duplicatePageAfter(doc, 0);
    if (!dup) throw new Error("expected a copy");
    const command = new AddPage(dup.index, dup.page);
    command.apply(doc);
    expect(ids(doc)).toEqual(["p1", "p4", "p2", "p3"]);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3"]);
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("MovePage", () => {
  it("moves a page down and back", () => {
    const doc = threePages();
    const command = new MovePage(0, 2);
    command.apply(doc);
    expect(ids(doc)).toEqual(["p2", "p3", "p1"]);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3"]);
  });

  it("moves a page up and back", () => {
    const doc = threePages();
    const command = new MovePage(2, 1);
    command.apply(doc);
    expect(ids(doc)).toEqual(["p1", "p3", "p2"]);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3"]);
  });

  it("is a no-op, both ways, for equal or out-of-range indexes", () => {
    for (const [from, to] of [
      [1, 1],
      [-1, 0],
      [0, 3],
      [5, 0],
    ]) {
      const doc = threePages();
      const command = new MovePage(from, to);
      command.apply(doc);
      expect(ids(doc)).toEqual(["p1", "p2", "p3"]);
      command.invert(doc);
      expect(ids(doc)).toEqual(["p1", "p2", "p3"]);
    }
  });

  it("restores the right page even when page ids repeat", () => {
    const doc = threePages();
    doc.pages[2].id = "p1";
    const original = doc.pages[0];
    const command = new MovePage(0, 2);
    command.apply(doc);
    command.invert(doc);
    expect(doc.pages[0]).toBe(original);
  });
});
