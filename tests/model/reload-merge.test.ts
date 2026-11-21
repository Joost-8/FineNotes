/**
 * An open notebook whose file changed on disk (FineNotes#273): the reader
 * lost ink written since the last save whenever the file was read again,
 * and undo could not bring it back. A read of the view's own text is now
 * skipped, and a change from elsewhere is merged with the view's unsaved
 * ink by id.
 */

import { describe, expect, it } from "vitest";
import { blankPage, emptyDocument } from "../../src/model/document";
import type { InkDocument, Stroke } from "../../src/model/document";
import { OwnTexts, mergeReload } from "../../src/model/reload-merge";

function stroke(id: string, color = "#1a1a1a"): Stroke {
  return { id, tool: "pen", color, size: 3, pts: [10, 20, 0.5, 30, 40, 0.5] } as Stroke;
}

/** A notebook of pages, each a list of stroke ids. */
function notebook(...pages: [string, string[]][]): InkDocument {
  const doc = emptyDocument(1024);
  doc.pages = pages.map(([id, strokes]) => {
    const page = blankPage(id);
    page.strokes = strokes.map((s) => stroke(s));
    return page;
  });
  return doc;
}

/** The three sides as separate objects, as each is decoded from its own text. */
function copy(doc: InkDocument): InkDocument {
  return structuredClone(doc);
}

function strokesOf(doc: InkDocument): [string, string[]][] {
  return doc.pages.map((page) => [page.id, page.strokes.map((s) => s.id)]);
}

describe("mergeReload", () => {
  it("keeps every stroke written here when nothing changed over there", () => {
    const base = notebook(["p1", ["s1"]]);
    const local = notebook(["p1", ["s1", "s2", "s3"]]);
    const { doc, carried } = mergeReload(base, local, copy(base));
    expect(strokesOf(doc)).toEqual([["p1", ["s1", "s2", "s3"]]]);
    expect(carried).toBe(2);
  });

  it("takes the file as it is when nothing is unsaved here", () => {
    const base = notebook(["p1", ["s1"]]);
    const remote = notebook(["p1", ["s1", "r1"]], ["p2", ["r2"]]);
    expect(strokesOf(mergeReload(base, copy(base), remote).doc)).toEqual([
      ["p1", ["s1", "r1"]],
      ["p2", ["r2"]],
    ]);
  });

  it("keeps ink written on both sides of the same page", () => {
    const base = notebook(["p1", ["s1"]]);
    const local = notebook(["p1", ["s1", "s2"]]);
    const remote = notebook(["p1", ["s1", "r1"]]);
    const { doc, carried } = mergeReload(base, local, remote);
    expect(strokesOf(doc)).toEqual([["p1", ["s1", "s2", "r1"]]]);
    expect(carried).toBe(1);
  });

  it("keeps a page added here, after the page it follows here", () => {
    const base = notebook(["p1", ["s1"]], ["p2", []]);
    const local = notebook(["p1", ["s1"]], ["p9", ["s2"]], ["p2", []]);
    const remote = notebook(["p1", ["s1"]], ["p2", ["r1"]], ["p3", []]);
    const { doc, carried } = mergeReload(base, local, remote);
    expect(doc.pages.map((page) => page.id)).toEqual(["p1", "p9", "p2", "p3"]);
    expect(strokesOf(doc)[2]).toEqual(["p2", ["r1"]]);
    expect(carried).toBe(1);
  });

  it("removes what this device erased, and keeps what the file lacks", () => {
    const base = notebook(["p1", ["s1", "s2", "s3"]]);
    const local = notebook(["p1", ["s2", "s3", "s4"]]);
    const remote = notebook(["p1", ["s1", "s2"]]);
    expect(strokesOf(mergeReload(base, local, remote).doc)).toEqual([["p1", ["s2", "s3", "s4"]]]);
  });

  it("keeps ink this device saved when an older copy of the file comes in", () => {
    // Saved here: s1-s3 on p1, and p2. The copy from elsewhere predates both
    // s3 and p2, and p1 has nothing unsaved: before, p1 was taken whole from it.
    const base = notebook(["p1", ["s1", "s2", "s3"]], ["p2", ["s4"]]);
    const remote = notebook(["p1", ["s1", "s2"]]);
    const { doc, carried } = mergeReload(base, copy(base), remote);
    expect(strokesOf(doc)).toEqual([
      ["p1", ["s1", "s2", "s3"]],
      ["p2", ["s4"]],
    ]);
    expect(carried).toBe(2);
  });

  it("keeps pictures saved here on a page the file stores without any", () => {
    const base = notebook(["p1", []]);
    (base.pages[0] as unknown as { images: unknown[] }).images = [
      { id: "i1", path: "a.png", x: 0, y: 0, w: 10, h: 10 },
    ];
    const remote = notebook(["p1", ["r1"]]);
    delete (remote.pages[0] as unknown as { images?: unknown[] }).images;
    const { doc } = mergeReload(base, copy(base), remote);
    expect(
      (doc.pages[0] as unknown as { images: { id: string }[] }).images.map((i) => i.id),
    ).toEqual(["i1"]);
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual(["r1"]);
  });

  it("keeps both strokes when two devices gave new ink the same id", () => {
    // Each counted on from s1, so both called their new stroke s2.
    const base = notebook(["p1", ["s1"]]);
    const local = notebook(["p1", ["s1", "s2"]]);
    const remote = notebook(["p1", ["s1", "s2"]]);
    remote.pages[0].strokes[1].color = "#0000ff";
    const { doc } = mergeReload(base, local, remote);
    expect(doc.pages[0].strokes.map((s) => [s.id, s.color])).toEqual([
      ["s1", "#1a1a1a"],
      ["s2", "#1a1a1a"],
      ["s3", "#0000ff"],
    ]);
  });

  it("does not double ink that both sides added the same", () => {
    const base = notebook(["p1", ["s1"]]);
    const local = notebook(["p1", ["s1", "s2"]]);
    const { doc } = mergeReload(base, local, copy(local));
    expect(strokesOf(doc)).toEqual([["p1", ["s1", "s2"]]]);
  });

  it("keeps a stroke erased over there but changed here", () => {
    const base = notebook(["p1", ["s1", "s2"]]);
    const local = notebook(["p1", ["s1", "s2"]]);
    local.pages[0].strokes[0].color = "#ff0000";
    const remote = notebook(["p1", ["s2", "r1"]]);
    const { doc } = mergeReload(base, local, remote);
    expect(strokesOf(doc)).toEqual([["p1", ["s1", "s2", "r1"]]]);
    expect(doc.pages[0].strokes[0].color).toBe("#ff0000");
  });

  it("keeps a page deleted here when it was written on over there", () => {
    const base = notebook(["p1", []], ["p2", ["s1"]]);
    const local = notebook(["p1", ["s2"]]);
    const remote = notebook(["p1", []], ["p2", ["s1", "r1"]]);
    expect(strokesOf(mergeReload(base, local, remote).doc)).toEqual([
      ["p1", ["s2"]],
      ["p2", ["s1", "r1"]],
    ]);
  });

  it("matches repeated ids by their order", () => {
    const base = notebook(["p1", ["s1", "s1"]]);
    const local = notebook(["p1", ["s1", "s1", "s1"]]);
    const remote = notebook(["p1", ["s1", "s1", "r1"]]);
    const { doc } = mergeReload(base, local, remote);
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual(["s1", "s1", "s1", "r1"]);
  });

  it("takes a change made on one side to anything that is not ink", () => {
    const base = notebook(["p1", []]);
    const local = copy(base);
    local.view.scrollY = 500;
    const remote = copy(base);
    remote.pages[0].title = "Chapter 1";
    const { doc } = mergeReload(base, local, remote);
    expect(doc.view.scrollY).toBe(500);
    expect(doc.pages[0].title).toBe("Chapter 1");
  });

  it("leaves the three notebooks as they were", () => {
    const base = notebook(["p1", ["s1"]]);
    const local = notebook(["p1", ["s1", "s2"]]);
    const remote = notebook(["p1", ["s1", "r1"]]);
    const before = JSON.stringify([base, local, remote]);
    mergeReload(base, local, remote);
    expect(JSON.stringify([base, local, remote])).toBe(before);
  });
});

describe("OwnTexts", () => {
  it("remembers the last three texts", () => {
    const own = new OwnTexts();
    for (const text of ["a", "b", "c", "d"]) own.note(text);
    expect(["a", "b", "c", "d"].map((text) => own.has(text))).toEqual([false, true, true, true]);
  });

  it("keeps a text noted again as the newest", () => {
    const own = new OwnTexts();
    for (const text of ["a", "b", "c", "a", "d"]) own.note(text);
    expect(own.has("a")).toBe(true);
    expect(own.has("b")).toBe(false);
  });

  it("forgets everything for another file", () => {
    const own = new OwnTexts();
    own.note("a");
    own.forget();
    expect(own.has("a")).toBe(false);
  });
});
