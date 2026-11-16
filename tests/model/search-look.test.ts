/**
 * `src/model/search-look.ts` — whether a notebook shows its search results
 * in the sidebar or a window (discussion #112), kept with the notebook.
 */

import { describe, expect, it } from "vitest";
import { emptyDocument } from "../../src/model/document";
import { otherLook, searchLookOf, writeSearchLook } from "../../src/model/search-look";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

describe("search look", () => {
  it("is the sidebar until a notebook chooses the window", () => {
    expect(searchLookOf(emptyDocument())).toBe("sidebar");
    expect(searchLookOf(null)).toBe("sidebar");
    expect(searchLookOf({ searchLook: "window" })).toBe("window");
  });

  it("switches to the other look", () => {
    expect(otherLook("sidebar")).toBe("window");
    expect(otherLook("window")).toBe("sidebar");
  });

  it("is saved with the notebook, and the sidebar saves as before", () => {
    const doc = emptyDocument();
    const plain = encodeDocument(doc);
    expect(writeSearchLook(doc, "window")).toBe(true);
    expect(writeSearchLook(doc, "window")).toBe(false);
    expect(decodeDocument(encodeDocument(doc)).searchLook).toBe("window");
    expect(writeSearchLook(doc, "sidebar")).toBe(true);
    expect("searchLook" in doc).toBe(false);
    expect(encodeDocument(doc)).toBe(plain);
  });

  it("reads anything else as the sidebar", () => {
    const doc = emptyDocument();
    (doc as unknown as Record<string, unknown>).searchLook = "sideways";
    expect("searchLook" in decodeDocument(encodeDocument(doc))).toBe(false);
  });
});
