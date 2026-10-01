/**
 * What a view saves with (FineNotes#1): quicker compression, and a note that
 * has not changed handed back exactly as it was read, so it is not rewritten.
 */

import { describe, expect, it } from "vitest";
import { emptyDocument } from "../../src/model/document";
import {
  DocumentEncoder,
  decodeDocument,
  encodeDocument,
  parseInkFile,
  buildInkFile,
} from "../../src/model/serialize";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";

function notebook() {
  const doc = emptyDocument(1024);
  doc.pages[0].strokes.push({
    id: "s1",
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pts: [10, 20, 0.5, 30, 40, 0.5, 50, 45, 0.5],
  } as never);
  return doc;
}

describe("DocumentEncoder", () => {
  it("writes what the plain encoder writes, decoded", () => {
    const doc = notebook();
    const payload = new DocumentEncoder().encode(doc);
    expect(decodeDocument(payload)).toEqual(decodeDocument(encodeDocument(doc)));
  });

  it("hands back the payload it read while nothing changes", () => {
    const doc = notebook();
    const onDisk = encodeDocument(doc);
    const encoder = new DocumentEncoder();
    encoder.remember(decodeDocument(onDisk), onDisk);
    expect(encoder.encode(decodeDocument(onDisk))).toBe(onDisk);
    expect(encoder.reused).toBe(true);
  });

  it("encodes afresh after a change, and then reuses that", () => {
    const onDisk = encodeDocument(notebook());
    const doc = decodeDocument(onDisk);
    const encoder = new DocumentEncoder();
    encoder.remember(doc, onDisk);
    doc.pages[0].strokes[0].pts[0] = 11;
    const changed = encoder.encode(doc);
    expect(changed).not.toBe(onDisk);
    expect(encoder.reused).toBe(false);
    expect(decodeDocument(changed).pages[0].strokes[0].pts[0]).toBe(11);
    expect(encoder.encode(doc)).toBe(changed);
    expect(encoder.reused).toBe(true);
  });

  it("does not reuse a payload that holds something else than the document", () => {
    // An older note the loader repairs: the payload on disk is not what the
    // document would be written as, so it must not be handed back.
    const doc = notebook();
    const other = notebook();
    other.pages[0].strokes = [];
    const stale = encodeDocument(other);
    const encoder = new DocumentEncoder();
    encoder.remember(doc, stale);
    const payload = encoder.encode(doc);
    expect(payload).not.toBe(stale);
    expect(decodeDocument(payload).pages[0].strokes).toHaveLength(1);
  });

  it("ignores a payload of another version or one that does not decode", () => {
    const doc = notebook();
    const encoder = new DocumentEncoder();
    encoder.remember(doc, "v1:abc");
    encoder.encode(doc);
    expect(encoder.reused).toBe(false);
    encoder.remember(doc, `${encodeDocument(doc).slice(0, 3)}@@@`);
    encoder.encode(doc);
    expect(encoder.reused).toBe(false);
  });

  it("builds a note with it, and parses back the payload it wrote", () => {
    const encoder = new DocumentEncoder();
    const doc = notebook();
    const file = buildInkFile("# Physics\n", doc, encoder);
    const parsed = parseInkFile(file);
    expect(parsed.doc).toEqual(decodeDocument(encodeDocument(doc)));
    expect(parsed.payload).toBe(encoder.encode(doc));
  });
});

describe("deflateToBase64 at the save level", () => {
  it("round-trips, and differs from the default level only in its bytes", () => {
    const text = JSON.stringify({ pts: Array.from({ length: 3000 }, (_, i) => (i * 7) % 113) });
    const quick = deflateToBase64(text, 1);
    expect(inflateFromBase64(quick)).toBe(text);
    expect(inflateFromBase64(deflateToBase64(text))).toBe(text);
  });
});
