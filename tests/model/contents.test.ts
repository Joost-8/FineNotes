/**
 * The notebook's contents: titles on pages, their command and undo, the list
 * the sidebar shows, which entry the reader is under, and the file round trip.
 */

import { describe, expect, it } from "vitest";
import { blankPage, emptyDocument, type InkDocument } from "../../src/model/document";
import {
  MAX_PAGE_TITLE_LENGTH,
  SetPageTitle,
  contentsEntries,
  currentContentsEntry,
  normalizePageTitle,
} from "../../src/model/contents";
import { RemovePage } from "../../src/model/commands";
import { duplicatePageAfter } from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function fivePages(): InkDocument {
  const doc = emptyDocument();
  for (let i = 2; i <= 5; i++) doc.pages.push(blankPage(`p${i}`));
  return doc;
}

describe("normalizePageTitle", () => {
  it("keeps one trimmed line", () => {
    expect(normalizePageTitle("  Week 3 \n  routing\t tables ")).toBe("Week 3 routing tables");
  });

  it("reads nothing, blanks and non-strings as no title", () => {
    for (const raw of [undefined, null, "", "   \n ", 3, true, ["a"], { title: "a" }]) {
      expect(normalizePageTitle(raw)).toBeUndefined();
    }
  });

  it("cuts a long title without splitting a surrogate pair", () => {
    expect(normalizePageTitle("x".repeat(200))).toHaveLength(MAX_PAGE_TITLE_LENGTH);
    const emoji = `${"a".repeat(MAX_PAGE_TITLE_LENGTH - 1)}😀tail`;
    const cut = normalizePageTitle(emoji) ?? "";
    expect(cut).toBe("a".repeat(MAX_PAGE_TITLE_LENGTH - 1));
    expect(cut.length).toBeLessThanOrEqual(MAX_PAGE_TITLE_LENGTH);
  });
});

describe("SetPageTitle", () => {
  it("adds a title and undoes back to no key at all", () => {
    const doc = fivePages();
    const command = new SetPageTitle(doc.pages[1], "  Introduction ");
    expect(command.label).toBe("Add to contents");
    command.apply(doc);
    expect(doc.pages[1].title).toBe("Introduction");
    command.invert(doc);
    expect("title" in doc.pages[1]).toBe(false);
  });

  it("renames, and undoes to the old title", () => {
    const doc = fivePages();
    doc.pages[2].title = "Old";
    const command = new SetPageTitle(doc.pages[2], "New");
    expect(command.label).toBe("Rename in contents");
    command.apply(doc);
    expect(doc.pages[2].title).toBe("New");
    command.invert(doc);
    expect(doc.pages[2].title).toBe("Old");
  });

  it("removes with null or a blank title", () => {
    for (const title of [null, "   "]) {
      const doc = fivePages();
      doc.pages[0].title = "Cover";
      const command = new SetPageTitle(doc.pages[0], title);
      expect(command.label).toBe("Remove from contents");
      command.apply(doc);
      expect("title" in doc.pages[0]).toBe(false);
      command.invert(doc);
      expect(doc.pages[0].title).toBe("Cover");
    }
  });

  it("does nothing to a page no longer in the document", () => {
    const doc = fivePages();
    const gone = doc.pages.pop();
    if (!gone) throw new Error("expected a page");
    const command = new SetPageTitle(gone, "Lost");
    command.apply(doc);
    command.invert(doc);
    expect(gone.title).toBeUndefined();
    expect(command.pageId).toBe("p5");
  });
});

describe("contentsEntries and currentContentsEntry", () => {
  it("lists titled pages in page order, by their real index", () => {
    const doc = fivePages();
    doc.pages[3].title = "Routing";
    doc.pages[1].title = "Forwarding";
    expect(contentsEntries(doc)).toEqual([
      { index: 1, title: "Forwarding" },
      { index: 3, title: "Routing" },
    ]);
  });

  it("puts the reader under the last entry at or before the page", () => {
    const entries = [
      { index: 1, title: "A" },
      { index: 3, title: "B" },
    ];
    expect([0, 1, 2, 3, 4].map((page) => currentContentsEntry(entries, page))).toEqual([
      -1, 0, 0, 1, 1,
    ]);
    expect(currentContentsEntry([], 2)).toBe(-1);
  });

  it("follows its page when a page before it is deleted, and comes back on undo", () => {
    const doc = fivePages();
    doc.pages[3].title = "Routing";
    const remove = new RemovePage(1);
    remove.apply(doc);
    expect(contentsEntries(doc)).toEqual([{ index: 2, title: "Routing" }]);
    remove.invert(doc);
    expect(contentsEntries(doc)).toEqual([{ index: 3, title: "Routing" }]);
  });

  it("is not copied by a duplicate", () => {
    const doc = fivePages();
    doc.pages[0].title = "Intro";
    const copy = duplicatePageAfter(doc, 0);
    expect(copy?.page.title).toBeUndefined();
    expect(doc.pages[0].title).toBe("Intro");
  });
});

describe("title in the file", () => {
  it("round-trips, and writes no key for an untitled page", () => {
    const doc = fivePages();
    doc.pages[2].title = "Section two";
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[2].title).toBe("Section two");
    expect("title" in back.pages[0]).toBe(false);
  });

  it("normalises what it reads and what it writes", () => {
    const doc = fivePages();
    doc.pages[0].title = `  ${"y".repeat(120)}  `;
    doc.pages[1].title = "   ";
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].title).toBe("y".repeat(MAX_PAGE_TITLE_LENGTH));
    expect("title" in back.pages[1]).toBe(false);
  });
});
