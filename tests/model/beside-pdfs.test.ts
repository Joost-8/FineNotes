/**
 * PDFs kept beside the notes as tabs (`src/model/beside-pdfs.ts`): the model,
 * its place in the file (`beside` in the head, `ImageElement.slide`,, the `pdf-tabs` label) and relinking a moved PDF.
 */

import { describe, expect, it } from "vitest";
import {
  BESIDE_PAGE_PREFIX,
  MAX_BESIDE_PAGES,
  attachPdf,
  besideByPath,
  besideDocument,
  besidePageId,
  findBeside,
  hasMarks,
  hideTab,
  isBesidePageId,
  nextTabId,
  pageCount,
  slidesAround,
  pageSizeAt,
  parseBesidePageId,
  readSizeRuns,
  renameTab,
  setTabView,
  showTab,
  sizesToRuns,
  storedMarks,
  syncMarks,
  usesPdfTabs,
} from "../../src/model/beside-pdfs";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import {
  type InkDocument,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { needsNewerReader } from "../../src/model/format-features";
import { relinkDocument } from "../../src/model/moved-files";
import { nextPageId } from "../../src/model/page-commands";
import { newNotebook, nextPageId as nextNotebookPageId } from "../../src/model/notebook";
import { DocumentEncoder, decodeDocument, encodeDocument } from "../../src/model/serialize";

const SLIDES = "Courses/Algebra/Lecture 1.pdf";

function line(id = "s1"): Stroke {
  return {
    id,
    color: "#1a1a1a",
    size: 3,
    tool: "pen",
    pts: [10.123, 10.456, 0.3, 20, 12, 0.5, 30, 15, 0.7],
  };
}

function stored(payload: string): Record<string, unknown> {
  return JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as Record<
    string,
    unknown
  >;
}

function payloadOf(json: unknown, label = "v2+pdf-tabs"): string {
  return `${label}:${deflateToBase64(JSON.stringify(json))}`;
}

/** A notebook with one tab of 3 slides (two sizes), ink on slide 1, and a page following it. */
function sample(): InkDocument {
  const doc = emptyDocument(1000);
  const tab = attachPdf(doc, SLIDES, [
    [960, 540, 2],
    [600, 800, 1],
  ]);
  const shown = besideDocument(tab);
  shown.pages[1].strokes.push(line());
  syncMarks(tab, shown);
  doc.pages[0].images.push({
    id: "i1",
    path: "Attachments/snippet.png",
    x: 1,
    y: 2,
    w: 30,
    h: 40,
    slide: { tab: tab.id, page: 1 },
  });
  return doc;
}

describe("tab page ids", () => {
  it("are built and read back, and nothing else has them", () => {
    const id = besidePageId("b2", 14);
    expect(id).toBe("~tb2~14");
    expect(isBesidePageId(id)).toBe(true);
    expect(parseBesidePageId(id)).toEqual({ tab: "b2", page: 14 });
    expect(parseBesidePageId("p3")).toBeNull();
    expect(parseBesidePageId("~t~3")).toBeNull();
    expect(parseBesidePageId("~tb1~x")).toBeNull();
    expect(parseBesidePageId("~tb~1~2")).toBeNull();
  });

  it("are never minted for a notes page", () => {
    const doc = emptyDocument();
    for (let i = 0; i < 50; i++) doc.pages.push(blankPage(nextPageId(doc)));
    expect(doc.pages.some((page) => page.id.startsWith(BESIDE_PAGE_PREFIX))).toBe(false);
    // Pages with tab-like ids among the notes do not move the counter onto one.
    doc.pages.push(blankPage(besidePageId("b1", 7)));
    expect(isBesidePageId(nextPageId(doc))).toBe(false);
    const notebook = newNotebook("Algebra");
    expect(isBesidePageId(nextNotebookPageId(notebook))).toBe(false);
  });
});

describe("sizes", () => {
  it("run-length encodes page sizes and finds each page's size", () => {
    const runs = sizesToRuns([
      { width: 960, height: 540 },
      { width: 960, height: 540 },
      { width: 600, height: 800 },
      { width: Number.NaN, height: -1 },
    ]);
    expect(runs).toEqual([
      [960, 540, 2],
      [600, 800, 1],
      [1024, 1448, 1],
    ]);
    const beside = { sizes: runs };
    expect(pageCount(beside)).toBe(4);
    expect(pageSizeAt(beside, 1)).toEqual({ width: 960, height: 540 });
    expect(pageSizeAt(beside, 2)).toEqual({ width: 600, height: 800 });
    expect(pageSizeAt(beside, 4)).toBeNull();
    expect(pageSizeAt(beside, -1)).toBeNull();
    expect(pageSizeAt(beside, 0.5)).toBeNull();
  });

  it("substitutes bad stored sizes instead of dropping runs, and caps the total", () => {
    expect(readSizeRuns("x")).toEqual([]);
    expect(readSizeRuns([[960, null, 2], "junk", [0, 540, Number.NaN], [600, 800, 2.7]])).toEqual([
      [960, 1448, 2],
      [1024, 540, 1],
      [600, 800, 2],
    ]);
    const huge = readSizeRuns([
      [960, 540, 1e12],
      [600, 800, 5],
    ]);
    expect(huge).toEqual([[960, 540, MAX_BESIDE_PAGES]]);
  });
});

describe("tabs", () => {
  it("attaches a PDF once, with fresh ids, and finds it by id or path", () => {
    const doc = emptyDocument();
    expect(nextTabId(doc)).toBe("b1");
    const a = attachPdf(doc, SLIDES, [[960, 540, 3]], "  Lecture\n one ");
    const b = attachPdf(doc, "Other.pdf", [[600, 800, 1]]);
    expect(a.id).toBe("b1");
    expect(a.label).toBe("Lecture one");
    expect(b.id).toBe("b2");
    expect(b.label).toBeUndefined();
    hideTab(doc, a.id);
    expect(attachPdf(doc, SLIDES, [[1, 1, 1]])).toBe(a);
    expect(a.hidden).toBeUndefined();
    expect(a.sizes).toEqual([[960, 540, 3]]);
    expect(doc.beside).toHaveLength(2);
    expect(findBeside(doc, "b2")).toBe(b);
    expect(besideByPath(doc, SLIDES)).toBe(a);
    expect(findBeside(doc, "b9")).toBeNull();
    expect(besideByPath(emptyDocument(), SLIDES)).toBeNull();
  });

  it("hides, shows, renames and remembers its view, saying whether anything changed", () => {
    const doc = emptyDocument();
    const tab = attachPdf(doc, SLIDES, [[960, 540, 3]]);
    expect(showTab(doc, tab.id)).toBe(false);
    expect(hideTab(doc, tab.id)).toBe(true);
    expect(hideTab(doc, tab.id)).toBe(false);
    expect(showTab(doc, tab.id)).toBe(true);
    expect(hideTab(doc, "nope")).toBe(false);
    expect(renameTab(doc, tab.id, "Slides")).toBe(true);
    expect(renameTab(doc, tab.id, "Slides")).toBe(false);
    expect(renameTab(doc, tab.id, "  ")).toBe(true);
    expect(tab.label).toBeUndefined();
    expect(renameTab(doc, "nope", "x")).toBe(false);
    const view = { page: 2, zoom: 1.5, x: 10, y: 20 };
    expect(setTabView(doc, tab.id, view)).toBe(true);
    expect(setTabView(doc, tab.id, { ...view })).toBe(false);
    expect(setTabView(doc, tab.id, { ...view, zoom: 0 })).toBe(false);
    expect(setTabView(doc, "nope", view)).toBe(false);
    expect(tab.view).toEqual(view);
  });
});

describe("besideDocument and syncMarks", () => {
  it("lays out every PDF page, sharing the very pages that hold marks", () => {
    const doc = sample();
    const tab = doc.beside![0];
    const shown = besideDocument(tab);
    expect(shown.pages.map((page) => page.id)).toEqual(["~tb1~0", "~tb1~1", "~tb1~2"]);
    expect(shown.pages[1]).toBe(tab.marks[0]);
    expect(shown.pages[2].geometry).toEqual({ width: 600, height: 800 });
    expect(shown.pages[0].backdrop).toEqual({ kind: "pdf", path: SLIDES, page: 0 });
    // An edit through the tab's document is an edit of the stored ink.
    shown.pages[1].strokes.push(line("s2"));
    expect(tab.marks[0].strokes).toHaveLength(2);
    // A page without marks is the same id every time, but a fresh page.
    expect(besideDocument(tab).pages[0].id).toBe(shown.pages[0].id);
  });

  it("takes in pages that gained marks and lets go of pages left empty", () => {
    const doc = sample();
    const tab = doc.beside![0];
    const shown = besideDocument(tab);
    expect(syncMarks(tab, shown)).toBe(false);
    shown.pages[2].strokes.push(line());
    shown.pages[1].strokes.length = 0;
    expect(storedMarks(shown)).toEqual([shown.pages[2]]);
    expect(syncMarks(tab, shown)).toBe(true);
    expect(tab.marks).toEqual([shown.pages[2]]);
    expect(tab.marks[0]).toBe(shown.pages[2]);
  });

  it("keeps marks past the PDF's last page, and lays out a tab with no sizes", () => {
    const doc = emptyDocument();
    const tab = attachPdf(doc, SLIDES, []);
    const shown = besideDocument(tab);
    expect(shown.pages).toHaveLength(1);
    shown.pages[0].strokes.push(line());
    syncMarks(tab, shown);
    tab.sizes = [[960, 540, 5]];
    const later = besideDocument(tab);
    later.pages[3].strokes.push(line());
    tab.sizes = [[960, 540, 1]];
    syncMarks(tab, later);
    expect(tab.marks.map((page) => page.id)).toEqual(["~tb1~0", "~tb1~3"]);
    const shrunk = besideDocument(tab);
    expect(shrunk.pages).toHaveLength(1);
    expect(syncMarks(tab, shrunk)).toBe(false);
    expect(tab.marks).toHaveLength(2);
  });

  it("counts any element as a mark", () => {
    const page: Page = blankPage();
    expect(hasMarks(page)).toBe(false);
    page.comments = [];
    expect(hasMarks(page)).toBe(false);
    page.textBoxes.push({ id: "t1", x: 0, y: 0, w: 100, text: "x", color: "#000", fontSize: 22 });
    expect(hasMarks(page)).toBe(true);
  });
});

describe("on disk", () => {
  it("round-trips tabs, their ink, following pages and snippets", () => {
    const doc = sample();
    const tab = doc.beside![0];
    tab.label = "Lecture";
    tab.view = { page: 1, zoom: 2, x: 3, y: 4 };
    hideTab(doc, tab.id);
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2+pdf-tabs:")).toBe(true);
    const json = stored(payload);
    const keys = Object.keys(json);
    expect(keys[keys.length - 1]).toBe("pages");
    expect(keys.indexOf("beside")).toBe(keys.length - 2);
    const storedTab = (json.beside as Array<Record<string, unknown>>)[0];
    // The tab's pages hold only the PDF page; the path is the tab's.
    const marks = storedTab.marks as Array<{
      backdrop: unknown;
      strokes: Array<{ pts: number[] }>;
    }>;
    expect(marks[0].backdrop).toEqual({ page: 1 });
    // Stroke points are quantised as on any page.
    expect(marks[0].strokes[0].pts.slice(0, 3)).toEqual([1012, 1046, 77]);

    const back = decodeDocument(payload);
    expect(back.beside).toHaveLength(1);
    const read = back.beside![0];
    expect(read).toMatchObject({
      id: "b1",
      path: SLIDES,
      label: "Lecture",
      hidden: true,
      view: { page: 1, zoom: 2, x: 3, y: 4 },
      sizes: [
        [960, 540, 2],
        [600, 800, 1],
      ],
    });
    expect(read.marks).toHaveLength(1);
    expect(read.marks[0].id).toBe("~tb1~1");
    expect(read.marks[0].backdrop).toEqual({ kind: "pdf", path: SLIDES, page: 1 });
    expect(read.marks[0].geometry).toEqual({ width: 960, height: 540 });
    expect(read.marks[0].strokes[0].pts[0]).toBeCloseTo(10.12, 5);
    expect(back.pages[0].images[0].slide).toEqual({ tab: "b1", page: 1 });
    // Written again, the same bytes.
    expect(encodeDocument(back)).toBe(payload);
  });

  it("keeps the label and bytes of a notebook without tabs", () => {
    const doc = emptyDocument(1000);
    doc.pages[0].strokes.push(line());
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2:")).toBe(true);
    expect(Object.keys(stored(payload))).not.toContain("beside");
    expect(usesPdfTabs(doc)).toBe(false);
    doc.beside = [];
    expect(encodeDocument(doc)).toBe(payload);
  });

  it("is labelled pdf-tabs by a snippet alone", () => {
    const doc = sample();
    const snippet = { ...doc, beside: undefined, pages: [blankPage()] } as InkDocument;
    snippet.pages[0].images.push({ ...doc.pages[0].images[0], slide: { tab: "b1", page: 0 } });
    expect(encodeDocument(snippet).startsWith("v2+pdf-tabs:")).toBe(true);
    // ... but read back without its tab, the snippet forgets it, and the label goes.
    const back = decodeDocument(encodeDocument(snippet));
    expect(back.pages[0].images[0].slide).toBeUndefined();
    expect(encodeDocument(back).startsWith("v2:")).toBe(true);
  });

  it("reads a beta's `follows` key, and drops it", () => {
    // A beta of PDF tabs had notes pages follow a slide; the key is gone.
    const json = {
      version: 2,
      view: { scrollY: 0, width: 1000, scale: 1 },
      pages: [{ id: "p1", follows: { tab: "b1", page: 2 } }],
    };
    const doc = decodeDocument(payloadOf(json));
    expect(doc.pages).toHaveLength(1);
    expect(Object.keys(doc.pages[0])).not.toContain("follows");
    const written = encodeDocument(doc);
    expect(written.startsWith("v2:")).toBe(true);
    expect(JSON.stringify(stored(written))).not.toContain("follows");
  });

  it("keeps slides either side of the one read ready, the next first", () => {
    expect(slidesAround(3, 10)).toEqual([4, 2, 5]);
    expect(slidesAround(0, 10)).toEqual([1, 2]);
    expect(slidesAround(9, 10)).toEqual([8]);
    expect(slidesAround(0, 1)).toEqual([]);
  });

  it("names features used only on a tab's ink", () => {
    const doc = emptyDocument();
    const tab = attachPdf(doc, SLIDES, [[960, 540, 1]]);
    const shown = besideDocument(tab);
    shown.pages[0].strokes.push({ ...line(), tilt: [40, 50, 60] });
    syncMarks(tab, shown);
    expect(encodeDocument(doc).startsWith("v2+tilt+pdf-tabs:")).toBe(true);
  });

  it("is refused by a reader that does not know it, as a newer notebook", () => {
    const payload = encodeDocument(sample());
    expect(needsNewerReader(payload)).toBe(false);
    const future = payload.replace("v2+pdf-tabs:", "v2+pdf-tabs+hologram:");
    expect(needsNewerReader(future)).toBe(true);
    expect(() => decodeDocument(future)).toThrow(/newer FineNotes/);
  });

  it("writes the tabs afresh at every save, whatever the page cache holds", () => {
    const doc = sample();
    const encoder = new DocumentEncoder();
    const first = encoder.encode(doc);
    expect(encoder.encode(doc)).toBe(first);
    renameTab(doc, "b1", "Renamed");
    const second = encoder.encode(doc);
    expect(second).not.toBe(first);
    expect(decodeDocument(second).beside![0].label).toBe("Renamed");
    // A background snapshot's head carries the tab as well.
    const snapshot = encoder.snapshot(doc);
    expect(snapshot.head).toContain("Renamed");
  });

  it("reads malformed tabs without throwing, keeping what it can", () => {
    const strokes = [{ id: "s1", color: "#000", size: 3, tool: "pen", pts: [100, 100, 128] }];
    const json = {
      version: 2,
      view: { scrollY: 0, width: 1000, scale: 1 },
      beside: [
        "junk",
        { id: "b1", path: "", sizes: [] },
        { id: "b3", path: "a.pdf", sizes: "x", view: { page: -1, zoom: 1, x: 0, y: 0 } },
        {
          id: "b3",
          path: "b.pdf",
          label: 5,
          hidden: "yes",
          sizes: [[960, 540, 2]],
          marks: [
            "junk",
            { backdrop: {}, strokes },
            { backdrop: { page: 1 }, strokes },
            { backdrop: { page: 1 }, strokes: [] },
            {
              backdrop: { page: 0, path: "elsewhere.pdf" },
              strokes,
              follows: { tab: "b3", page: 0 },
            },
          ],
        },
        { id: "bad~id", path: "c.pdf", sizes: [[1, 1, 1]] },
      ],
      pages: [
        {
          id: "p1",
          follows: { tab: "b3", page: 1.5 },
          images: [
            { id: "i1", path: "x.png", slide: { tab: "b9", page: 0 } },
            { id: "i2", path: "y.png", slide: { tab: "b4", page: 2 } },
            { id: "i3", path: "z.png", slide: "junk" },
          ],
        },
      ],
    };
    const doc = decodeDocument(payloadOf(json));
    expect(doc.beside!.map((tab) => [tab.id, tab.path])).toEqual([
      ["b3", "a.pdf"],
      ["b4", "b.pdf"],
      ["b5", "c.pdf"],
    ]);
    const [a, b] = doc.beside!;
    expect(a.sizes).toEqual([]);
    expect(a.view).toBeUndefined();
    expect(b.label).toBeUndefined();
    expect(b.hidden).toBeUndefined();
    expect(b.marks.map((page) => page.id)).toEqual(["~tb4~0", "~tb4~1"]);
    expect(b.marks[0].backdrop).toEqual({ kind: "pdf", path: "b.pdf", page: 0 });
    expect(Object.keys(b.marks[0])).not.toContain("follows");
    expect(b.marks[1].strokes).toHaveLength(1);
    expect(Object.keys(doc.pages[0])).not.toContain("follows");
    expect(doc.pages[0].images.map((image) => image.slide)).toEqual([
      undefined,
      { tab: "b4", page: 2 },
      undefined,
    ]);
  });

  it("ignores a `beside` that is not a list", () => {
    const json = { version: 2, view: {}, beside: { id: "b1" }, pages: [{ id: "p1" }] };
    expect(decodeDocument(payloadOf(json)).beside).toBeUndefined();
  });
});

describe("relinkDocument", () => {
  it("follows a moved PDF with its tab and the pages of ink on it", () => {
    const doc = sample();
    const tab = doc.beside![0];
    const moved = "Courses/Algebra 2026/Lecture 1.pdf";
    const n = relinkDocument(doc, (path) => (path === SLIDES ? moved : undefined));
    expect(n).toBe(1);
    expect(tab.path).toBe(moved);
    expect(tab.marks[0].backdrop).toEqual({ kind: "pdf", path: moved, page: 1 });
    expect(besideDocument(tab).pages[0].backdrop).toEqual({ kind: "pdf", path: moved, page: 0 });
  });

  it("moves pictures on a tab's ink, and leaves an unmoved tab alone", () => {
    const doc = sample();
    const tab = doc.beside![0];
    tab.marks[0].images.push({ id: "i1", path: "old.png", x: 0, y: 0, w: 1, h: 1 });
    const n = relinkDocument(doc, (path) => (path === "old.png" ? "new.png" : undefined));
    expect(n).toBe(1);
    expect(tab.marks[0].images[0].path).toBe("new.png");
    expect(tab.path).toBe(SLIDES);
  });
});
