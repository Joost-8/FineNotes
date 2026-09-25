/**
 * Page bookmarks (GoodNotes' "Add to Favourites"): the command, its undo, the
 * sidebar's filter, the file round trip, and a duplicate starting unmarked.
 */

import { describe, expect, it } from "vitest";
import { blankPage, emptyDocument, type InkDocument } from "../../src/model/document";
import {
  SetPageBookmark,
  bookmarkedPageIndexes,
  duplicatePageAfter,
} from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function threePages(): InkDocument {
  const doc = emptyDocument();
  doc.pages.push(blankPage("p2"), blankPage("p3"));
  return doc;
}

describe("SetPageBookmark", () => {
  it("bookmarks a page and undoes back to no key at all", () => {
    const doc = threePages();
    const command = new SetPageBookmark(doc.pages[1], true);
    command.apply(doc);
    expect(doc.pages[1].bookmarked).toBe(true);
    command.invert(doc);
    expect("bookmarked" in doc.pages[1]).toBe(false);
  });

  it("removes a bookmark and undoes it back", () => {
    const doc = threePages();
    doc.pages[2].bookmarked = true;
    const command = new SetPageBookmark(doc.pages[2], false);
    command.apply(doc);
    expect("bookmarked" in doc.pages[2]).toBe(false);
    command.invert(doc);
    expect(doc.pages[2].bookmarked).toBe(true);
  });

  it("does nothing to a page no longer in the document", () => {
    const doc = threePages();
    const gone = doc.pages.pop();
    if (!gone) throw new Error("expected a page");
    const command = new SetPageBookmark(gone, true);
    command.apply(doc);
    command.invert(doc);
    expect(gone.bookmarked).toBeUndefined();
  });

  it("labels itself for the undo history", () => {
    const page = blankPage("p9");
    expect(new SetPageBookmark(page, true).label).toBe("Bookmark page");
    expect(new SetPageBookmark(page, false).label).toBe("Remove bookmark");
  });
});

describe("bookmarkedPageIndexes", () => {
  it("lists bookmarked pages in page order", () => {
    const doc = threePages();
    expect(bookmarkedPageIndexes(doc)).toEqual([]);
    doc.pages[2].bookmarked = true;
    doc.pages[0].bookmarked = true;
    expect(bookmarkedPageIndexes(doc)).toEqual([0, 2]);
  });
});

describe("bookmarks on disk", () => {
  it("round-trips a bookmark and writes nothing for an unmarked page", () => {
    const doc = threePages();
    doc.pages[1].bookmarked = true;
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages.map((page) => page.bookmarked)).toEqual([undefined, true, undefined]);
    expect("bookmarked" in back.pages[0]).toBe(false);
  });

  it("reads anything but a literal true as not bookmarked", () => {
    const doc = threePages();
    (doc.pages[0] as { bookmarked?: unknown }).bookmarked = "yes";
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].bookmarked).toBeUndefined();
  });
});

describe("duplicatePageAfter", () => {
  it("does not copy the bookmark onto the copy", () => {
    const doc = threePages();
    doc.pages[0].bookmarked = true;
    const dup = duplicatePageAfter(doc, 0);
    expect(dup?.page.bookmarked).toBeUndefined();
    expect(doc.pages[0].bookmarked).toBe(true);
  });
});
