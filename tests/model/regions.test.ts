/**
 * `src/model/regions.ts` — named regions (discussion #167): a part of a
 * board or page, named, that a Markdown note embeds alone. The name rules,
 * the lookup by a link's subpath, the rectangle a lasso makes, the loader's
 * normalizer, the invertible command, and the file format: a region is
 * stored, read back, moved with a growing board, left out of a duplicate
 * and of a page cut out for export, and costs older readers nothing else.
 * Every command must undo to a `JSON.stringify`-identical document
 * (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import { BOARD_BLOCK, GrowBoard, boardDrawing } from "../../src/model/board";
import {
  type InkDocument,
  type Page,
  type PageRegion,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { duplicatePageAfter } from "../../src/model/page-commands";
import {
  REGION_PAD,
  SetRegion,
  allRegions,
  findRegion,
  nextRegionId,
  normalizeRegionName,
  normalizeRegions,
  regionKey,
  regionRect,
  regionSubpathName,
  uniqueRegionName,
} from "../../src/model/regions";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

function region(id: string, name: string, x = 100, y = 200, w = 300, h = 150): PageRegion {
  return { id, name, x, y, w, h };
}

function docWith(...pages: Page[]): InkDocument {
  const doc = emptyDocument();
  doc.pages = pages;
  return doc;
}

describe("normalizeRegionName", () => {
  it("keeps a plain name, trimmed and on one line", () => {
    expect(normalizeRegionName("  Krebs\n cycle ")).toBe("Krebs cycle");
  });

  it("turns the characters that end a link into spaces", () => {
    expect(normalizeRegionName("A#B|C^D[E]F\\G")).toBe("A B C D E F G");
  });

  it("gives nothing for a name that is empty, or only such characters", () => {
    expect(normalizeRegionName("")).toBeUndefined();
    expect(normalizeRegionName(" #|[] ")).toBeUndefined();
    expect(normalizeRegionName(42)).toBeUndefined();
  });

  it("cuts a long name as a contents title is cut", () => {
    expect(normalizeRegionName("x".repeat(200))?.length).toBe(80);
  });
});

describe("regionKey", () => {
  it("ignores case and runs of spaces", () => {
    expect(regionKey("Krebs  Cycle")).toBe(regionKey("krebs cycle"));
  });
});

describe("regionSubpathName", () => {
  it.each([
    ["#Krebs cycle", "Krebs cycle"],
    ["Krebs cycle", "Krebs cycle"],
    ["#  Krebs cycle ", "Krebs cycle"],
    ["#Krebs%20cycle", "Krebs cycle"],
    ["#100%", "100%"],
  ])("reads %j as %j", (subpath, name) => {
    expect(regionSubpathName(subpath)).toBe(name);
  });

  it.each(["", "#", "  ", "#^block-id"])("asks for no region with %j", (subpath) => {
    expect(regionSubpathName(subpath)).toBeNull();
  });
});

describe("findRegion and allRegions", () => {
  const first = blankPage("a");
  first.regions = [region("rg1", "Overview")];
  const second = blankPage("b");
  const krebs = region("rg2", "Krebs cycle");
  second.regions = [krebs, region("rg3", "Glycolysis")];
  const pages = [first, second];

  it("finds a region by its name on any page, whatever its case", () => {
    expect(findRegion(pages, "krebs CYCLE")).toEqual({ index: 1, region: krebs });
    expect(findRegion(pages, "Overview")?.index).toBe(0);
  });

  it("finds nothing for a name no region has, or none at all", () => {
    expect(findRegion(pages, "Calvin cycle")).toBeNull();
    expect(findRegion(pages, "  ")).toBeNull();
  });

  it("lists every region, page by page", () => {
    expect(allRegions(pages).map((r) => r.region.id)).toEqual(["rg1", "rg2", "rg3"]);
  });
});

describe("uniqueRegionName", () => {
  const page = blankPage("a");
  page.regions = [region("rg1", "Krebs cycle"), region("rg2", "Krebs cycle 2")];

  it("keeps a free name", () => {
    expect(uniqueRegionName([page], "Glycolysis")).toBe("Glycolysis");
  });

  it("numbers a name another region has, past the numbers taken", () => {
    expect(uniqueRegionName([page], "krebs cycle")).toBe("krebs cycle 3");
  });

  it("lets a region keep its own name", () => {
    expect(uniqueRegionName([page], "Krebs cycle", "rg1")).toBe("Krebs cycle");
  });

  it("stays within the longest name", () => {
    const long = blankPage("b");
    const name = "y".repeat(80);
    long.regions = [region("rg1", name)];
    const next = uniqueRegionName([long], name);
    expect(next.length).toBeLessThanOrEqual(80);
    expect(next.endsWith(" 2")).toBe(true);
  });
});

describe("nextRegionId", () => {
  it("counts on from the highest rg<N> in the notebook", () => {
    const a = blankPage("a");
    a.regions = [region("rg4", "A"), region("odd", "B")];
    const b = blankPage("b");
    b.regions = [region("rg9", "C")];
    expect(nextRegionId(docWith(a, b))).toBe("rg10");
    expect(nextRegionId(docWith(blankPage("c")))).toBe("rg1");
  });
});

describe("regionRect", () => {
  const geometry = { width: 1000, height: 800 };

  it("pads a selection's bounds with paper", () => {
    expect(regionRect({ minX: 100, minY: 200, maxX: 300, maxY: 260 }, geometry)).toEqual({
      x: 100 - REGION_PAD,
      y: 200 - REGION_PAD,
      w: 200 + 2 * REGION_PAD,
      h: 60 + 2 * REGION_PAD,
    });
  });

  it("rounds out to whole page px, so a measured text box keeps the file tidy", () => {
    expect(
      regionRect({ minX: 100.4, minY: 200.6, maxX: 300.2, maxY: 414.378 }, geometry, 0),
    ).toEqual({ x: 100, y: 200, w: 201, h: 215 });
  });

  it("keeps the frame on the page", () => {
    expect(regionRect({ minX: 5, minY: 5, maxX: 995, maxY: 795 }, geometry)).toEqual({
      x: 0,
      y: 0,
      w: 1000,
      h: 800,
    });
  });

  it("gives nothing for bounds off the page or not finite", () => {
    expect(regionRect({ minX: 2000, minY: 0, maxX: 2100, maxY: 10 }, geometry)).toBeNull();
    expect(regionRect({ minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 }, geometry)).toBeNull();
  });
});

describe("normalizeRegions", () => {
  it("keeps good records and drops bad ones, never mending them", () => {
    const seen = new Set<string>();
    const out = normalizeRegions(
      [
        region("rg1", "  Good  one "),
        { id: "rg2", name: "No size", x: 0, y: 0, w: 0, h: 10 },
        { id: "rg3", name: "Negative", x: 0, y: 0, w: 10, h: -5 },
        { id: "rg4", name: "Not finite", x: Number.POSITIVE_INFINITY, y: 0, w: 10, h: 10 },
        { id: "rg5", name: "", x: 0, y: 0, w: 10, h: 10 },
        { id: "", name: "No id", x: 0, y: 0, w: 10, h: 10 },
        { id: "rg6", name: "Text size", x: "1", y: 0, w: 10, h: 10 },
        null,
        "rg7",
        region("rg1", "Repeated id"),
        region("rg8", "Fine"),
      ],
      seen,
    );
    expect(out).toEqual([region("rg1", "Good one"), region("rg8", "Fine")]);
    expect([...seen]).toEqual(["rg1", "rg8"]);
  });

  it("reads anything that is not a list as none", () => {
    expect(normalizeRegions({ id: "rg1" }, new Set())).toEqual([]);
    expect(normalizeRegions(undefined, new Set())).toEqual([]);
  });

  it("drops an id another page has already used", () => {
    const seen = new Set(["rg1"]);
    expect(normalizeRegions([region("rg1", "Again")], seen)).toEqual([]);
  });
});

describe("SetRegion", () => {
  it("adds a region, and undo leaves the document as it was", () => {
    const page = blankPage("a");
    const doc = docWith(page);
    const before = snapshot(doc);
    const add = new SetRegion(page, "rg1", { name: "Krebs cycle", x: 1, y: 2, w: 3, h: 4 });
    add.apply(doc);
    expect(page.regions).toEqual([region("rg1", "Krebs cycle", 1, 2, 3, 4)]);
    add.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("renames, moves and resizes in place, keeping the region's place in the list", () => {
    const page = blankPage("a");
    page.regions = [region("rg1", "A"), region("rg2", "B")];
    const doc = docWith(page);
    const before = snapshot(doc);
    const change = new SetRegion(page, "rg1", { name: "A2", x: 5, y: 6, w: 7, h: 8 });
    change.apply(doc);
    expect(page.regions).toEqual([region("rg1", "A2", 5, 6, 7, 8), region("rg2", "B")]);
    change.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("removes a region, and the last one takes the field with it", () => {
    const page = blankPage("a");
    page.regions = [region("rg1", "A")];
    const doc = docWith(page);
    const before = snapshot(doc);
    const remove = new SetRegion(page, "rg1", null);
    remove.apply(doc);
    expect("regions" in page).toBe(false);
    remove.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("treats a value with no name or no size as a removal", () => {
    const page = blankPage("a");
    page.regions = [region("rg1", "A")];
    const doc = docWith(page);
    new SetRegion(page, "rg1", { name: " # ", x: 0, y: 0, w: 1, h: 1 }).apply(doc);
    expect(page.regions).toBeUndefined();
    page.regions = [region("rg1", "A")];
    new SetRegion(page, "rg1", { name: "A", x: 0, y: 0, w: 0, h: 1 }).apply(doc);
    expect(page.regions).toBeUndefined();
  });

  it("does nothing to a page no longer in the document", () => {
    const page = blankPage("a");
    const doc = docWith(blankPage("b"));
    const command = new SetRegion(page, "rg1", { name: "A", x: 0, y: 0, w: 1, h: 1 });
    command.apply(doc);
    command.invert(doc);
    expect(page.regions).toBeUndefined();
  });

  it("names its step for the undo history", () => {
    const page = blankPage("a");
    page.regions = [region("rg1", "A")];
    expect(new SetRegion(page, "rg2", region("rg2", "B")).label).toBe("Add frame");
    expect(new SetRegion(page, "rg1", region("rg1", "C")).label).toBe("Change frame");
    expect(new SetRegion(page, "rg1", null).label).toBe("Delete frame");
    expect(new SetRegion(page, "rg1", null).pageId).toBe("a");
  });
});

describe("regions on disk", () => {
  it("are stored and read back as they were", () => {
    const page = blankPage("a");
    page.regions = [region("rg1", "Krebs cycle"), region("rg2", "Glycolysis", 400, 50, 120, 80)];
    const doc = docWith(page);
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].regions).toEqual(page.regions);
  });

  it("leave a page without any as it always was: no field", () => {
    const back = decodeDocument(encodeDocument(docWith(blankPage("a"))));
    expect("regions" in back.pages[0]).toBe(false);
    expect(encodeDocument(docWith(blankPage("a")))).not.toContain("regions");
  });

  it("keep a notebook's plain label: an older reader opens it, losing nothing else", () => {
    const page = blankPage("a");
    page.strokes.push({
      id: "s1",
      color: "#000000",
      size: 3,
      tool: "pen",
      pts: [1, 2, 0.5, 3, 4, 0.5],
    });
    page.sections = [{ id: "c1", x: 10, y: 20, title: "Heading" }];
    const plain = decodeDocument(encodeDocument(docWith(structuredClone(page))));
    page.regions = [region("rg1", "Krebs cycle")];
    const encoded = encodeDocument(docWith(page));
    // No `+feature` in the label, no `requires`: older builds decode it.
    expect(encoded.startsWith("v2:")).toBe(true);
    const back = decodeDocument(encoded);
    // Everything an older build reads is as it is without the field beside it.
    const { regions, ...rest } = back.pages[0];
    expect(regions).toHaveLength(1);
    expect(rest).toEqual(plain.pages[0]);
  });

  it("drop an id repeated on a later page, keeping the first", () => {
    const a = blankPage("a");
    a.regions = [region("rg1", "First")];
    const b = blankPage("b");
    b.regions = [region("rg1", "Second"), region("rg2", "Third")];
    const back = decodeDocument(encodeDocument(docWith(a, b)));
    expect(back.pages[0].regions?.map((r) => r.name)).toEqual(["First"]);
    expect(back.pages[1].regions?.map((r) => r.name)).toEqual(["Third"]);
  });
});

describe("regions and the page around them", () => {
  it("move with a board that grows left and up, and back on undo", () => {
    const page = blankPage("a", { width: 5 * BOARD_BLOCK, height: 5 * BOARD_BLOCK });
    page.regions = [region("rg1", "A", 300, 400)];
    const doc = docWith(page);
    doc.endless = true;
    const before = snapshot(doc);
    const grow = new GrowBoard("a", { left: 1, top: 2, right: 0, bottom: 0 });
    grow.apply(doc);
    expect(page.regions[0]).toMatchObject({ x: 300 + BOARD_BLOCK, y: 400 + 2 * BOARD_BLOCK });
    grow.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("move with a board's drawing cut out, leaving the board as it was", () => {
    const page = blankPage("a", { width: 3000, height: 3000 });
    page.regions = [region("rg1", "A", 1000, 1200)];
    const cut = boardDrawing(page, { x: 560, y: 840, width: 1120, height: 1120 });
    expect(cut.regions?.[0]).toMatchObject({ x: 440, y: 360 });
    expect(page.regions[0]).toMatchObject({ x: 1000, y: 1200 });
  });

  it("stay with the original when a page is duplicated", () => {
    const page = blankPage("a");
    page.regions = [region("rg1", "A")];
    const doc = docWith(page);
    const copy = duplicatePageAfter(doc, 0);
    expect(copy?.page.regions).toBeUndefined();
    expect(page.regions).toHaveLength(1);
  });
});
