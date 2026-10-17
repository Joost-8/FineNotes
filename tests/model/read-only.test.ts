/**
 * `src/model/read-only.ts` — a notebook's "Read-only" setting, stored as
 * `meta.readOnly` only when on. Every command undoes to a
 * `JSON.stringify`-identical document (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, emptyDocument } from "../../src/model/document";
import { SetReadOnly, isReadOnly } from "../../src/model/read-only";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

describe("isReadOnly", () => {
  it("is only true when the document says true", () => {
    expect(isReadOnly(null)).toBe(false);
    expect(isReadOnly(emptyDocument())).toBe(false);
    expect(isReadOnly({ readOnly: true })).toBe(true);
    expect(isReadOnly({ readOnly: "yes" } as unknown as InkDocument)).toBe(false);
  });
});

describe("SetReadOnly", () => {
  it("on adds the key, and undo gives back the same document", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = new SetReadOnly(true);
    command.apply(doc);
    expect(doc.readOnly).toBe(true);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("off removes the key, and undo puts it back where it was", () => {
    const doc = { ...emptyDocument(), readOnly: true as const };
    const before = snapshot(doc);
    const command = new SetReadOnly(false);
    command.apply(doc);
    expect("readOnly" in doc).toBe(false);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("survives the file, and a notebook that is not read-only saves as before", () => {
    const doc = emptyDocument();
    const plain = encodeDocument(doc);
    expect("readOnly" in decodeDocument(plain)).toBe(false);
    new SetReadOnly(true).apply(doc);
    expect(decodeDocument(encodeDocument(doc)).readOnly).toBe(true);
    new SetReadOnly(false).apply(doc);
    expect(encodeDocument(doc)).toBe(plain);
  });
});
