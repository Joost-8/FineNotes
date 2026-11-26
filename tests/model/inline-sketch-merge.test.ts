import { describe, expect, it } from "vitest";
import type { InkDocument, Page, Stroke } from "../../src/model/document";
import {
  INLINE_MAX_HEIGHT,
  createInlineSketchPage,
  inlineEditDocument,
  inlineGrowHeightForPoint,
  mergeInlinePageEdits,
  trimInlinePageTop,
} from "../../src/model/inline-sketch";
import { DotClock, attachDotClock, idsIn, mintedId } from "../../src/model/dot-ids";
import { nextImageId } from "../../src/model/images";
import { DEFAULT_PAGE_HEIGHT } from "../../src/constants";

function stroke(id: string, y = 100): Stroke {
  return {
    id,
    tool: "pen",
    color: "#000000",
    size: 2,
    pts: [10, y, 0.5, 40, y + 4, 0.5],
  } as Stroke;
}

function block(id: string, strokes: Stroke[]): Page {
  const page = createInlineSketchPage(id);
  page.strokes = strokes;
  page.textBoxes = [{ id: `${id}-t1`, x: 0, y: 0, w: 10, text: "x", fontSize: 12 } as never];
  page.images = [{ id: "i1", path: "a.png", x: 0, y: 0, w: 10, h: 10 } as never];
  return page;
}

function notebook(pages: Page[]): InkDocument {
  return { version: 3, view: { scrollY: 0, width: 1024, scale: 1 }, pages };
}

describe("a block is merged field by field (#312)", () => {
  it("keeps a ticked task, a removed link and a new title made in the block", () => {
    const base = block("hw-1", [stroke("s1")]);
    base.tasks = [{ id: "k1", strokes: ["s1"], text: "buy milk" }];
    base.links = [{ id: "l1", strokes: ["s1"], target: "Other" }];
    const local = structuredClone(base);
    local.tasks = [{ id: "k1", strokes: ["s1"], text: "buy milk", done: true }];
    delete local.links;
    local.title = "Shopping";
    const latest = structuredClone(base);

    const merged = mergeInlinePageEdits(base, latest, local);
    expect(merged.tasks).toEqual([{ id: "k1", strokes: ["s1"], text: "buy milk", done: true }]);
    expect(merged.links).toBeUndefined();
    expect(merged.title).toBe("Shopping");
  });

  it("keeps what another device added meanwhile, in every list", () => {
    const base = block("hw-1", [stroke("s1")]);
    const local = structuredClone(base);
    local.strokes.push(stroke("s2"));
    const latest = structuredClone(base);
    latest.sections = [{ id: "c1", x: 0, y: 40, title: "Heading" } as never];
    latest.chapters = [{ id: "c2", title: "Part one" }];

    const merged = mergeInlinePageEdits(base, latest, local);
    expect(merged.strokes.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(merged.sections).toEqual(latest.sections);
    expect(merged.chapters).toEqual(latest.chapters);
  });

  it("takes the paper the block chose, and the disk's when it chose none", () => {
    const base = block("hw-1", []);
    const local = structuredClone(base);
    local.backdrop = { kind: "ruled-narrow" };
    const latest = structuredClone(base);
    expect(mergeInlinePageEdits(base, latest, local).backdrop).toEqual({ kind: "ruled-narrow" });
    const untouched = structuredClone(base);
    latest.backdrop = { kind: "squared" };
    expect(mergeInlinePageEdits(base, latest, untouched).backdrop).toEqual({ kind: "squared" });
  });
});

describe("trimming a block's top", () => {
  it("moves section headings and regions with the ink", () => {
    const page = block("hw-1", [stroke("s1", 300)]);
    page.textBoxes = [];
    page.images = [];
    page.geometry = { width: 1024, height: 600 };
    page.sections = [{ id: "c1", x: 0, y: 310, title: "Heading" } as never];
    page.regions = [{ id: "rg1", name: "r", x: 0, y: 320, w: 10, h: 10 } as never];
    const shift = trimInlinePageTop(page);
    expect(shift).toBeGreaterThan(0);
    expect(page.sections?.[0]?.y).toBe(310 - shift);
    expect(page.regions?.[0]?.y).toBe(320 - shift);
  });
});

describe("a block's height", () => {
  it("never grows past one page, so its canvases stay a page's size", () => {
    expect(INLINE_MAX_HEIGHT).toBe(DEFAULT_PAGE_HEIGHT);
    const page = createInlineSketchPage("hw-1");
    expect(inlineGrowHeightForPoint(page, 99999)).toBe(INLINE_MAX_HEIGHT);
  });
});

describe("ids made in a block (#312)", () => {
  const DEVICE = "abcdef12";

  it("two blocks of one notebook never share a stroke, text box or picture id", () => {
    // A single-file notebook: both blocks start from s1, t1, i1 of their own.
    const full = notebook([block("hw-a", [stroke("s1")]), block("hw-b", [stroke("s1")])]);
    const made = new Set<string>();
    for (const pageId of ["hw-a", "hw-b"]) {
      const editing = inlineEditDocument(full, pageId, DEVICE);
      expect(editing).not.toBeNull();
      const { doc, page } = editing!;
      // A new stroke, text box and picture, as the surface makes them.
      const ids = [mintedId(doc), mintedId(doc), nextImageId(doc)];
      for (const id of ids) {
        expect(id).not.toBeNull();
        expect([...idsIn(full)]).not.toContain(id);
        expect(made.has(id!)).toBe(false);
        made.add(id!);
      }
      // Saved back into the notebook before the next block opens.
      page.strokes.push(stroke(ids[0]!));
      page.textBoxes.push({ ...page.textBoxes[0]!, id: ids[1]! });
      page.images.push({ ...page.images[0]!, id: ids[2]! });
      full.pages[full.pages.findIndex((p) => p.id === pageId)] = page;
    }
  });

  it("counts on from a notebook kept as page files, on its own clock", () => {
    const full = notebook([block("hw-a", [stroke(`${DEVICE}.7`)]), block("hw-b", [])]);
    const clock = new DotClock(DEVICE);
    attachDotClock(full, clock);
    const editing = inlineEditDocument(full, "hw-b", DEVICE)!;
    expect(mintedId(editing.doc)).toBe(`${DEVICE}.8`);
  });

  it("copies the page, so the notebook read is left as it was", () => {
    const full = notebook([block("hw-a", [stroke("s1")])]);
    const editing = inlineEditDocument(full, "hw-a", DEVICE)!;
    editing.page.strokes.length = 0;
    expect(full.pages[0]!.strokes).toHaveLength(1);
    expect(inlineEditDocument(full, "hw-missing", DEVICE)).toBeNull();
  });
});
