/**
 * Handwritten links (`src/model/links.ts`, FineNotes#20): their command,
 * reassigning strokes, targets, loading and saving, and how erasing and
 * duplicating treat them.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import {
  SetLink,
  externalUrl,
  isExternalTarget,
  linkStrokes,
  linkTargets,
  linksOf,
  nextLinkId,
  normalizeLinkTarget,
  normalizeLinks,
} from "../../src/model/links";
import { ReplaceStrokesOnPage } from "../../src/model/erase-commands";
import { duplicatePageAfter } from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const stroke = (id: string, x = 10): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen",
  pts: [x, 10, 0.5, x + 20, 10, 0.5],
});

function doc(): InkDocument {
  const d = emptyDocument();
  d.pages[0].strokes = [stroke("s1"), stroke("s2", 40), stroke("s3", 80)];
  d.pages.push(blankPage("p2"));
  d.pages[1].strokes = [stroke("s4")];
  return d;
}

const apply = (d: InkDocument, commands: { apply(d: InkDocument): void }[]) => {
  for (const c of commands) c.apply(d);
};

describe("targets", () => {
  it("are one trimmed line, without a wikilink's brackets or alias", () => {
    expect(normalizeLinkTarget("  Signals#FIR  filters ")).toBe("Signals#FIR filters");
    expect(normalizeLinkTarget("[[Signals#FIR|the FIR part]]")).toBe("Signals#FIR");
    expect(normalizeLinkTarget("")).toBeUndefined();
    expect(normalizeLinkTarget("   ")).toBeUndefined();
    expect(normalizeLinkTarget(5)).toBeUndefined();
    expect(normalizeLinkTarget("x".repeat(2001))).toBeUndefined();
  });

  it("tell a web address from a note", () => {
    expect(isExternalTarget("https://en.wikipedia.org/wiki/FIR")).toBe(true);
    expect(isExternalTarget("mailto:a@b.c")).toBe(true);
    expect(isExternalTarget("www.styluslabs.com")).toBe(true);
    expect(isExternalTarget("Signals#FIR")).toBe(false);
    expect(isExternalTarget("Physics.notebook#page=3")).toBe(false);
    expect(externalUrl("www.styluslabs.com")).toBe("https://www.styluslabs.com");
    expect(externalUrl("https://x.org")).toBe("https://x.org");
  });
});

describe("SetLink and linkStrokes", () => {
  it("links strokes, and undo takes the link away exactly", () => {
    const d = doc();
    const before = JSON.stringify(d);
    const commands = linkStrokes(d, d.pages[0], ["s1", "s2"], "Signals#FIR");
    apply(d, commands);
    expect(d.pages[0].links).toEqual([{ id: "l1", strokes: ["s1", "s2"], target: "Signals#FIR" }]);
    expect(commands[0].pageId).toBe("p1");
    for (const c of [...commands].reverse()) c.invert(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("a stroke moves to the new link, and a link left with nothing goes", () => {
    const d = doc();
    apply(d, linkStrokes(d, d.pages[0], ["s1", "s2"], "A"));
    apply(d, linkStrokes(d, d.pages[0], ["s3"], "B"));
    apply(d, linkStrokes(d, d.pages[0], ["s2", "s3"], "C"));
    expect(d.pages[0].links).toEqual([
      { id: "l1", strokes: ["s1"], target: "A" },
      { id: "l3", strokes: ["s2", "s3"], target: "C" },
    ]);
  });

  it("unlinks with no target", () => {
    const d = doc();
    apply(d, linkStrokes(d, d.pages[0], ["s1", "s2"], "A"));
    const remove = linkStrokes(d, d.pages[0], ["s1", "s2"], null);
    expect(remove.map((c) => c.label)).toEqual(["Remove link"]);
    apply(d, remove);
    expect("links" in d.pages[0]).toBe(false);
  });

  it("makes nothing for no strokes or a blank target", () => {
    const d = doc();
    expect(linkStrokes(d, d.pages[0], [], "A")).toEqual([]);
    expect(linkStrokes(d, d.pages[0], ["s1"], "  ")).toEqual([]);
  });

  it("SetLink keeps a link's place when it changes, and ignores a page that has gone", () => {
    const d = doc();
    apply(d, linkStrokes(d, d.pages[0], ["s1"], "A"));
    apply(d, linkStrokes(d, d.pages[0], ["s2"], "B"));
    new SetLink(d.pages[0], "l1", { strokes: ["s1"], target: "A2" }).apply(d);
    expect(d.pages[0].links?.map((l) => l.target)).toEqual(["A2", "B"]);
    const gone = d.pages.pop()!;
    const set = new SetLink(gone, "l9", { strokes: ["s4"], target: "x" });
    set.apply(d);
    set.invert(d);
    expect(gone.links).toBeUndefined();
  });

  it("finds the links holding strokes, the next id, and every target once", () => {
    const d = doc();
    apply(d, linkStrokes(d, d.pages[0], ["s1"], "A"));
    apply(d, linkStrokes(d, d.pages[1], ["s4"], "A"));
    apply(d, linkStrokes(d, d.pages[0], ["s3"], "https://x.org"));
    expect(linksOf(d.pages[0], ["s3", "s2"]).map((l) => l.id)).toEqual(["l3"]);
    expect(nextLinkId(d)).toBe("l4");
    expect(linkTargets(d)).toEqual(["A", "https://x.org"]);
  });
});

describe("loading, saving, erasing and duplicating", () => {
  it("survive a save and a load", () => {
    const d = doc();
    apply(d, linkStrokes(d, d.pages[0], ["s1", "s2"], "Signals#FIR"));
    const back = decodeDocument(encodeDocument(d));
    expect(back.pages[0].links).toEqual(d.pages[0].links);
    expect("links" in back.pages[1]).toBe(false);
  });

  it("keep only sound links, with strokes still on the page, each stroke and id once", () => {
    const seen = new Set<string>(["l9"]);
    const strokes = new Set(["s1", "s2", "s3"]);
    const raw = [
      { id: "l1", strokes: ["s1", "gone", "s1"], target: "A" },
      { id: "l2", strokes: ["s1", "s2"], target: "B" }, // s1 is l1's
      { id: "l3", strokes: ["gone"], target: "C" },
      { id: "l9", strokes: ["s3"], target: "seen" },
      { id: "l4", strokes: ["s3"], target: "" },
      { id: "l5", strokes: "s3", target: "x" },
      { id: 7, strokes: ["s3"], target: "x" },
      null,
    ];
    expect(normalizeLinks(raw, strokes, seen)).toEqual([
      { id: "l1", strokes: ["s1"], target: "A" },
      { id: "l2", strokes: ["s2"], target: "B" },
    ]);
    expect(normalizeLinks({}, strokes, seen)).toEqual([]);
  });

  it("a link id that repeats on a later page is dropped", () => {
    const d = doc();
    d.pages[0].links = [{ id: "l1", strokes: ["s1"], target: "A" }];
    d.pages[1].links = [{ id: "l1", strokes: ["s4"], target: "B" }];
    const back = decodeDocument(encodeDocument(d));
    expect(back.pages[0].links).toHaveLength(1);
    expect("links" in back.pages[1]).toBe(false);
  });

  it("erasing part of a linked stroke keeps its pieces linked; erasing it all drops it", () => {
    const d = doc();
    apply(d, linkStrokes(d, d.pages[0], ["s1", "s2"], "A"));
    const before = JSON.stringify(d);
    const [s1, s2] = d.pages[0].strokes;
    const cut = new ReplaceStrokesOnPage("p1", [
      { original: s1, pieces: [stroke("s7"), stroke("s8")] },
      { original: s2, pieces: [] },
    ]);
    cut.apply(d);
    expect(d.pages[0].links).toEqual([{ id: "l1", strokes: ["s7", "s8"], target: "A" }]);
    cut.invert(d);
    expect(JSON.stringify(d)).toBe(before);
    const all = new ReplaceStrokesOnPage("p1", [
      { original: s1, pieces: [] },
      { original: s2, pieces: [] },
    ]);
    all.apply(d);
    expect("links" in d.pages[0]).toBe(false);
    all.invert(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("a duplicated page starts without links", () => {
    const d = doc();
    apply(d, linkStrokes(d, d.pages[0], ["s1"], "A"));
    expect(duplicatePageAfter(d, 0)?.page.links).toBeUndefined();
  });
});
