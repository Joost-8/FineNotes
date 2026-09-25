/**
 * `src/model/erase-commands.ts` — replacing erased strokes with their pieces.
 */

import { describe, expect, it } from "vitest";
import { ReplaceStrokesOnPage } from "../../src/model/erase-commands";
import { type InkDocument, type Stroke, blankPage, emptyDocument } from "../../src/model/document";

function stroke(id: string): Stroke {
  return { id, color: "#000", size: 2, tool: "pen", pts: [0, 0, 0.5, 10, 0, 0.5] };
}

function docWith(...strokes: Stroke[]): InkDocument {
  const doc = emptyDocument();
  doc.pages = [{ ...blankPage("p1"), strokes }, blankPage("p2")];
  return doc;
}

const ids = (doc: InkDocument, page = 0): string[] => doc.pages[page].strokes.map((s) => s.id);

describe("ReplaceStrokesOnPage", () => {
  it("replaces in place, keeping z-order, and undoes exactly", () => {
    const a = stroke("a");
    const b = stroke("b");
    const c = stroke("c");
    const doc = docWith(a, b, c);
    const cmd = new ReplaceStrokesOnPage("p1", [
      { original: b, pieces: [stroke("b1"), stroke("b2")] },
      { original: c, pieces: [] },
    ]);

    cmd.apply(doc);
    expect(ids(doc)).toEqual(["a", "b1", "b2"]);
    cmd.invert(doc);
    expect(ids(doc)).toEqual(["a", "b", "c"]);
    expect(doc.pages[0].strokes[1]).toBe(b);

    // Redo.
    cmd.apply(doc);
    expect(ids(doc)).toEqual(["a", "b1", "b2"]);
  });

  it("restores a fully erased stroke at its original index", () => {
    const a = stroke("a");
    const b = stroke("b");
    const c = stroke("c");
    const doc = docWith(a, b, c);
    const cmd = new ReplaceStrokesOnPage("p1", [
      { original: a, pieces: [] },
      { original: b, pieces: [] },
    ]);
    cmd.apply(doc);
    expect(ids(doc)).toEqual(["c"]);
    cmd.invert(doc);
    expect(ids(doc)).toEqual(["a", "b", "c"]);
  });

  it("resolves by identity when ids repeat", () => {
    const first = stroke("dup");
    const second = stroke("dup");
    const doc = docWith(first, second);
    const cmd = new ReplaceStrokesOnPage("p1", [{ original: second, pieces: [stroke("x")] }]);
    cmd.apply(doc);
    expect(doc.pages[0].strokes[0]).toBe(first);
    expect(ids(doc)).toEqual(["dup", "x"]);
    cmd.invert(doc);
    expect(doc.pages[0].strokes[1]).toBe(second);
  });

  it("falls back to id when the original object is gone", () => {
    const doc = docWith(stroke("a"));
    const cmd = new ReplaceStrokesOnPage("p1", [{ original: stroke("a"), pieces: [stroke("a1")] }]);
    cmd.apply(doc);
    expect(ids(doc)).toEqual(["a1"]);
  });

  it("touches only the addressed page and ignores missing pages/strokes", () => {
    const doc = docWith(stroke("a"));
    doc.pages[1].strokes.push(stroke("a"));
    new ReplaceStrokesOnPage("p1", [{ original: stroke("a"), pieces: [] }]).apply(doc);
    expect(ids(doc, 1)).toEqual(["a"]);

    const missing = new ReplaceStrokesOnPage("nope", [{ original: stroke("a"), pieces: [] }]);
    missing.apply(doc);
    missing.invert(doc);
    const absent = new ReplaceStrokesOnPage("p2", [{ original: stroke("zzz"), pieces: [] }]);
    absent.apply(doc);
    absent.invert(doc);
    expect(ids(doc, 1)).toEqual(["a"]);
  });

  it("re-inserts the original even if its pieces were removed meanwhile", () => {
    const a = stroke("a");
    const doc = docWith(a, stroke("b"));
    const piece = stroke("a1");
    const cmd = new ReplaceStrokesOnPage("p1", [{ original: a, pieces: [piece] }]);
    cmd.apply(doc);
    doc.pages[0].strokes.splice(0, 1);
    cmd.invert(doc);
    expect(ids(doc)).toEqual(["a", "b"]);
  });
});
