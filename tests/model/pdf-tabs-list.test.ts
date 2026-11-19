/**
 * The PDF tab strip's model (`src/model/pdf-tabs-list.ts`) and the bar's
 * limits on a PDF's tab (`hiddenOnPdfTab`, `isPdfTabTool`).
 */

import { describe, expect, it } from "vitest";
import { attachPdf, hideTab, renameTab } from "../../src/model/beside-pdfs";
import { emptyDocument } from "../../src/model/document";
import {
  LAST_TABS_MAX,
  NOTES_TAB,
  flagToStore,
  folderOf,
  forgetTab,
  matchesQuery,
  parseLastTabs,
  pdfBaseName,
  plusList,
  rememberTab,
  renameInLastTabs,
  showsStrip,
  storedFlag,
  stripTabs,
  tabAfterClosing,
  tabLabel,
} from "../../src/model/pdf-tabs-list";
import { hiddenOnPdfTab, isPdfTabTool } from "../../src/view/toolbar-layout";

const SIZES: Array<[number, number, number]> = [[800, 450, 3]];

function notebook() {
  const doc = emptyDocument();
  attachPdf(doc, "Algo/W3 Hashing.pdf", SIZES);
  attachPdf(doc, "Algo/Exercises 3.pdf", SIZES);
  attachPdf(doc, "Algo/old/W1 Intro.pdf", SIZES, "Intro");
  return doc;
}

describe("names", () => {
  it("takes the file's name without folder and .pdf", () => {
    expect(pdfBaseName("Algo/W3 Hashing.pdf")).toBe("W3 Hashing");
    expect(pdfBaseName("Top.PDF")).toBe("Top");
    expect(folderOf("Algo/W3.pdf")).toBe("Algo");
    expect(folderOf("W3.pdf")).toBe("");
  });

  it("prefers a given label", () => {
    const doc = notebook();
    expect(stripTabs(doc).map(tabLabel)).toEqual(["W3 Hashing", "Exercises 3", "Intro"]);
    renameTab(doc, "b1", "Hashing");
    expect(tabLabel(doc.beside![0])).toBe("Hashing");
    renameTab(doc, "b1", "  ");
    expect(tabLabel(doc.beside![0])).toBe("W3 Hashing");
  });
});

describe("the strip", () => {
  it("shows only when a PDF is attached, and leaves closed tabs out", () => {
    expect(showsStrip(emptyDocument())).toBe(false);
    const doc = notebook();
    hideTab(doc, "b2");
    expect(showsStrip(doc)).toBe(true);
    expect(stripTabs(doc).map((b) => b.id)).toEqual(["b1", "b3"]);
    hideTab(doc, "b1");
    hideTab(doc, "b3");
    expect(stripTabs(doc)).toEqual([]);
    expect(showsStrip(doc)).toBe(true);
  });

  it("moves to the tab before a closed one, else after, else the notes", () => {
    const doc = notebook();
    expect(tabAfterClosing(doc, "b2")).toBe("b1");
    expect(tabAfterClosing(doc, "b1")).toBe("b2");
    hideTab(doc, "b2");
    hideTab(doc, "b3");
    expect(tabAfterClosing(doc, "b1")).toBe(NOTES_TAB);
    expect(tabAfterClosing(doc, "nope")).toBe(NOTES_TAB);
  });
});

describe("the + list", () => {
  const vault = [
    { path: "Algo/W8 Shortest paths.pdf", mtime: 30 },
    { path: "Algo/W7 Graphs.pdf", mtime: 20 },
    { path: "Algo/W3 Hashing.pdf", mtime: 50 },
    { path: "Algo/old/W2.pdf", mtime: 99 },
    { path: "Other/W9.pdf", mtime: 99 },
    { path: "Algo/notes.md", mtime: 99 },
  ];

  it("lists attached PDFs newest attached first, marking open and missing ones", () => {
    const doc = notebook();
    hideTab(doc, "b2");
    const list = plusList(
      doc,
      "Algo/Algo.notebook.md",
      vault,
      "",
      (p) => p !== "Algo/old/W1 Intro.pdf",
    );
    expect(list.attached.map((r) => [r.id, r.open, r.missing])).toEqual([
      ["b3", true, true],
      ["b2", false, false],
      ["b1", true, false],
    ]);
    expect(list.attachedTotal).toBe(3);
  });

  it("offers the notebook's own folder's PDFs not yet attached, newest first", () => {
    const list = plusList(notebook(), "Algo/Algo.notebook.md", vault, "", () => true);
    expect(list.inFolder.map((p) => p.path)).toEqual([
      "Algo/W8 Shortest paths.pdf",
      "Algo/W7 Graphs.pdf",
    ]);
  });

  it("searches both lists by every word, ignoring case and accents", () => {
    const list = plusList(notebook(), "Algo/Algo.notebook.md", vault, "graphs w7", () => true);
    expect(list.attached).toEqual([]);
    expect(list.inFolder.map((p) => p.path)).toEqual(["Algo/W7 Graphs.pdf"]);
    expect(matchesQuery("Übung Café", "cafe ubung")).toBe(true);
    expect(matchesQuery("anything", "  ")).toBe(true);
    expect(matchesQuery("Hashing", "hash x")).toBe(false);
    const byLabel = plusList(notebook(), "Algo/A.notebook.md", vault, "intro", () => true);
    expect(byLabel.attached.map((r) => r.id)).toEqual(["b3"]);
  });

  it("takes a notebook at the vault's root to the root's PDFs", () => {
    const list = plusList(
      emptyDocument(),
      "A.notebook.md",
      [{ path: "x.pdf", mtime: 1 }, ...vault],
      "",
      () => true,
    );
    expect(list.inFolder.map((p) => p.path)).toEqual(["x.pdf"]);
  });
});

describe("the tab each notebook was left on", () => {
  it("reads only string entries, and never the notes", () => {
    expect(parseLastTabs(null)).toEqual({});
    expect(parseLastTabs([1])).toEqual({});
    expect(parseLastTabs({ a: "b1", b: 3, c: NOTES_TAB, d: "" })).toEqual({ a: "b1" });
  });

  it("remembers, forgets and follows a rename", () => {
    let map = rememberTab({}, "A.md", "b2");
    expect(map).toEqual({ "A.md": "b2" });
    expect(rememberTab(map, "A.md", "b2")).toBe(map);
    map = rememberTab(map, "A.md", NOTES_TAB);
    expect(map).toEqual({});
    map = renameInLastTabs({ "A.md": "b1" }, "A.md", "B.md");
    expect(map).toEqual({ "B.md": "b1" });
    expect(forgetTab(map, "C.md")).toBe(map);
  });

  it("keeps at most LAST_TABS_MAX notebooks, dropping the oldest", () => {
    let map = {};
    for (let i = 0; i < LAST_TABS_MAX + 5; i++) map = rememberTab(map, `n${i}`, "b1");
    const keys = Object.keys(map);
    expect(keys).toHaveLength(LAST_TABS_MAX);
    expect(keys[0]).toBe("n5");
  });
});

describe("the bar on a PDF's tab", () => {
  it("keeps writing, highlighting, rubbing out, the lasso and moving about", () => {
    for (const tool of ["pen", "highlighter", "eraser", "select", "laser", "pan", "zoom"])
      expect(isPdfTabTool(tool)).toBe(true);
    for (const tool of ["text", "shape", "fill", "tape"]) expect(isPdfTabTool(tool)).toBe(false);
  });

  it("hides what adds anything but ink, and page actions", () => {
    for (const id of ["text", "shape", "image", "pdf", "sticky", "addPage", "share"] as const)
      expect(hiddenOnPdfTab(id)).toBe(true);
    for (const id of ["pen", "eraser", "select", "undo", "redo", "more", "thumbnails"] as const)
      expect(hiddenOnPdfTab(id)).toBe(false);
    expect(hiddenOnPdfTab("pen:highlighter")).toBe(false);
  });
});

describe("storedFlag", () => {
  it("reads only what flagToStore wrote for yes as yes", () => {
    expect(storedFlag(flagToStore(true))).toBe(true);
    expect(storedFlag(flagToStore(false))).toBe(false);
    for (const raw of [null, undefined, "", "true", 1, true, "yes"])
      expect(storedFlag(raw)).toBe(false);
  });
});
