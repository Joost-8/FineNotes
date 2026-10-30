/**
 * `src/model/joined-pages.ts` — a notebook's "Join pages" setting, stored as
 * `meta.joined` only when on, and the `join` id ink over a join carries.
 * Every command undoes to a `JSON.stringify`-identical document
 * (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import { SetJoinedPages, joinedPagesOf } from "../../src/model/joined-pages";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

describe("joinedPagesOf", () => {
  it("is only true when the document says true", () => {
    expect(joinedPagesOf(null)).toBe(false);
    expect(joinedPagesOf(emptyDocument())).toBe(false);
    expect(joinedPagesOf({ joined: true })).toBe(true);
    expect(joinedPagesOf({ joined: "yes" } as unknown as InkDocument)).toBe(false);
  });
});

describe("SetJoinedPages", () => {
  it("on adds the key, and undo gives back the same document", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = new SetJoinedPages(true);
    command.apply(doc);
    expect(doc.joined).toBe(true);
    expect(command.label).toBe("Join pages");
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("off removes the key, and undo puts it back where it was", () => {
    const doc = { ...emptyDocument(), joined: true as const, readOnly: true as const };
    const before = snapshot(doc);
    const command = new SetJoinedPages(false);
    command.apply(doc);
    expect("joined" in doc).toBe(false);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("survives the file, and a notebook with its pages apart saves as before", () => {
    const doc = emptyDocument();
    const plain = encodeDocument(doc);
    expect("joined" in decodeDocument(plain)).toBe(false);
    new SetJoinedPages(true).apply(doc);
    expect(decodeDocument(encodeDocument(doc)).joined).toBe(true);
    new SetJoinedPages(false).apply(doc);
    expect(encodeDocument(doc)).toBe(plain);
  });
});

describe("a stroke's join id", () => {
  const stroke = (extra: Partial<Stroke>): Stroke => ({
    id: "s1",
    color: "#1a1a1a",
    size: 3,
    tool: "pen",
    pts: [10, 10, 0.5, 20, 20, 0.5],
    ...extra,
  });

  it("is kept through the file, and absent stays absent", () => {
    const doc = emptyDocument();
    doc.pages[0].strokes.push(stroke({ join: "s1" }), stroke({ id: "s2" }));
    const [joined, plain] = decodeDocument(encodeDocument(doc)).pages[0].strokes;
    expect(joined.join).toBe("s1");
    expect("join" in plain).toBe(false);
  });

  it("an empty or non-string id is not one", () => {
    const doc = emptyDocument();
    doc.pages[0].strokes.push(stroke({ join: "" }), stroke({ id: "s2", join: 7 as never }));
    for (const read of decodeDocument(encodeDocument(doc)).pages[0].strokes) {
      expect("join" in read).toBe(false);
    }
  });
});
