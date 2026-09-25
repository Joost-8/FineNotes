/**
 * `src/model/scroll-direction.ts` — a notebook's "Scroll direction", stored
 * as `meta.scroll` only when horizontal. Every command undoes to a
 * `JSON.stringify`-identical document (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, emptyDocument } from "../../src/model/document";
import { SetScrollDirection, scrollDirectionOf } from "../../src/model/scroll-direction";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

describe("scrollDirectionOf", () => {
  it("is vertical unless the document says horizontal", () => {
    expect(scrollDirectionOf(null)).toBe("vertical");
    expect(scrollDirectionOf(emptyDocument())).toBe("vertical");
    expect(scrollDirectionOf({ scroll: "horizontal" })).toBe("horizontal");
    expect(scrollDirectionOf({ scroll: "sideways" } as unknown as InkDocument)).toBe("vertical");
  });
});

describe("SetScrollDirection", () => {
  it("horizontal adds the key and undo removes it", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = new SetScrollDirection("horizontal");
    command.apply(doc);
    expect(doc.scroll).toBe("horizontal");
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
    expect("scroll" in doc).toBe(false);
  });

  it("vertical deletes the key, and undo puts it back where it was", () => {
    const doc = emptyDocument();
    doc.scroll = "horizontal";
    // A key after `scroll`: re-adding `scroll` would append it.
    doc.recordings = [{ id: "r1", path: "a.m4a", start: 1, duration: 2 }];
    const before = snapshot(doc);
    const command = new SetScrollDirection("vertical");
    command.apply(doc);
    expect("scroll" in doc).toBe(false);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("setting what is already there changes nothing, and undoes to nothing", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = new SetScrollDirection("vertical");
    command.apply(doc);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });
});

describe("meta.scroll on disk", () => {
  it("round-trips horizontal and stores nothing for vertical", () => {
    const doc = emptyDocument();
    expect("scroll" in decodeDocument(encodeDocument(doc))).toBe(false);
    doc.scroll = "horizontal";
    expect(decodeDocument(encodeDocument(doc)).scroll).toBe("horizontal");
  });

  it("reads anything else as vertical", () => {
    const doc = emptyDocument();
    (doc as unknown as Record<string, unknown>).scroll = "diagonal";
    expect("scroll" in decodeDocument(encodeDocument(doc))).toBe(false);
  });
});
