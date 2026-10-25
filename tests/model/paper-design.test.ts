/**
 * Designed paper (`src/model/paper-design.ts`, `src/model/paper-extras.ts`):
 * the designer's choices as a backdrop, the design file, the backdrop's own
 * fields on disk, and where they put things on a page.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type SyntheticBackdrop, emptyDocument } from "../../src/model/document";
import { DEFAULT_NOTEBOOK_CHOICES } from "../../src/model/new-notebook";
import {
  DESIGN_RANGES,
  DESIGN_SPACING_MM,
  PAPER_DESIGN_FORMAT,
  type PaperDesign,
  blankSummary,
  buildDesignedNotebook,
  clampDesignValue,
  defaultPaperDesign,
  designBackdrop,
  designEntry,
  designGeometry,
  marginLineSummary,
  marginsSummary,
  parsePaperDesign,
  serializePaperDesign,
} from "../../src/model/paper-design";
import {
  DEFAULT_MARGIN_LINE_COLOR,
  marginLinePlan,
  paperExtrasKey,
  readPaperExtras,
  ruledArea,
} from "../../src/model/paper-extras";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { PAGE_SIZES, parseRecent, pushRecent, sizeGeometry } from "../../src/model/templates";
import { mmToPage } from "../../src/model/units";

const A4 = { width: 1024, height: 1448 };

function full(): PaperDesign {
  return {
    ...defaultPaperDesign(),
    name: "Cream study",
    paper: "#F6EFE0",
    texture: "heavy",
    ruling: "squares",
    spacing: 5,
    ruleColor: "#D9C7A8",
    margins: { top: 20, right: 0, bottom: 0, left: 30 },
    blank: { side: "bottom", size: 50 },
    marginLine: { sides: "left", inset: 25, color: "#E8A3A3" },
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

describe("a design as a backdrop", () => {
  it("a new design is plain A4 with 8 mm lines, about Ruled Wide's own pitch", () => {
    const backdrop = designBackdrop(defaultPaperDesign());
    expect(backdrop.kind).toBe("ruled-wide");
    expect(backdrop.spacing).toBe(39.01);
    expect(backdrop.paperColor).toBeUndefined();
    expect(backdrop.texture).toBeUndefined();
    expect(designGeometry(defaultPaperDesign())).toEqual(A4);
  });

  it("each ruling draws a ruling every older FineNotes knows", () => {
    const kinds = (["none", "lines", "squares", "dots"] as const).map(
      (ruling) => designBackdrop({ ...defaultPaperDesign(), ruling }).kind,
    );
    expect(kinds).toEqual(["blank", "ruled-wide", "squared", "dotted"]);
  });

  it("stores every length in page px, to two decimals, and colours in lower case", () => {
    const backdrop = designBackdrop(full());
    expect(backdrop).toEqual({
      kind: "squared",
      spacing: round2(mmToPage(5)),
      color: "#d9c7a8",
      paperColor: "#f6efe0",
      texture: "heavy",
      margins: { top: round2(mmToPage(20)), left: round2(mmToPage(30)) },
      blankZone: { side: "bottom", size: round2(mmToPage(50)) },
      marginLines: { left: round2(mmToPage(25)), color: "#e8a3a3" },
    });
  });

  it("a paper without lines keeps no margins or blank area: they only stop a ruling", () => {
    const backdrop = designBackdrop({ ...full(), ruling: "none" });
    expect(backdrop.margins).toBeUndefined();
    expect(backdrop.blankZone).toBeUndefined();
    expect(backdrop.spacing).toBeUndefined();
    expect(backdrop.color).toBeUndefined();
    // The margin line is not a ruling: it stays.
    expect(backdrop.marginLines?.left).toBeGreaterThan(0);
  });

  it("margin lines go left, right or both at one inset", () => {
    const inset = round2(mmToPage(25));
    const at = (sides: "left" | "right" | "both"): SyntheticBackdrop["marginLines"] =>
      designBackdrop({ ...full(), marginLine: { sides, inset: 25, color: "#000000" } }).marginLines;
    expect(at("left")).toEqual({ left: inset, color: "#000000" });
    expect(at("right")).toEqual({ right: inset, color: "#000000" });
    expect(at("both")).toEqual({ left: inset, right: inset, color: "#000000" });
  });

  it("Standard is 210 x 297 mm, so the picker may call it A4", () => {
    const standard = PAGE_SIZES.find((s) => s.id === "standard");
    expect(standard?.label).toBe("A4 (Standard)");
    expect(standard?.width).toBe(Math.round(mmToPage(210)));
    expect(standard?.height).toBe(Math.round(mmToPage(297)));
    expect(PAGE_SIZES.map((s) => s.id)).toEqual(expect.arrayContaining(["a2", "a1", "a0"]));
  });

  it("the new sizes reach A0, landscape too, at the scale every page uses", () => {
    const a0 = designGeometry({ ...defaultPaperDesign(), size: "a0", landscape: true });
    expect(a0).toEqual(sizeGeometry("a0", true));
    expect(a0.width).toBe(Math.round(mmToPage(1189)));
    expect(a0.height).toBe(Math.round(mmToPage(841)));
  });

  it("its entry in My templates is the design, at its own page size", () => {
    const entry = designEntry("T/Papers/Cream study.json", full());
    expect(entry).toMatchObject({ path: "T/Papers/Cream study.json", page: 0, ...A4 });
    expect(entry.name).toBe("Cream study");
    expect(entry.design?.ruling).toBe("squares");
    expect(designEntry("x.json", { ...full(), name: "" }).name).toBe("Paper");
  });
});

describe("the design file", () => {
  it("round-trips every field", () => {
    const design = { ...full(), paper: "#f6efe0", ruleColor: "#d9c7a8" };
    design.marginLine = { sides: "both", inset: 12.5, color: "#e8a3a3" };
    const text = serializePaperDesign(design);
    expect(JSON.parse(text)).toMatchObject({ format: PAPER_DESIGN_FORMAT, version: 1 });
    expect(parsePaperDesign(text)).toEqual(design);
  });

  it("anything but a FineNotes paper is not a design", () => {
    expect(parsePaperDesign("not json")).toBeNull();
    expect(parsePaperDesign("[]")).toBeNull();
    expect(parsePaperDesign(JSON.stringify({ name: "x", ruling: "lines" }))).toBeNull();
    expect(parsePaperDesign(JSON.stringify({ format: "other" }))).toBeNull();
  });

  it("a field it cannot read takes its default, and the rest stays as made", () => {
    const parsed = parsePaperDesign(
      JSON.stringify({
        format: PAPER_DESIGN_FORMAT,
        version: 9,
        name: "  Odd  ",
        size: "a9",
        landscape: "yes",
        paper: "red",
        texture: "velvet",
        ruling: "dots",
        spacing: 900,
        ruleColor: "#ABCDEF",
        margins: { top: -4, right: 10, bottom: "x", left: 1e9 },
        blank: { side: "middle", size: 40 },
        marginLine: { sides: "left", inset: 0, color: "#123456" },
      }),
    );
    expect(parsed).toEqual({
      ...defaultPaperDesign(),
      name: "Odd",
      ruling: "dots",
      spacing: DESIGN_SPACING_MM.dots,
      ruleColor: "#abcdef",
      margins: { top: 0, right: 10, bottom: 0, left: 0 },
    });
  });

  it("a margin line with no colour gets the soft red", () => {
    const parsed = parsePaperDesign(
      JSON.stringify({ format: PAPER_DESIGN_FORMAT, marginLine: { sides: "right", inset: 20 } }),
    );
    expect(parsed?.marginLine).toEqual({
      sides: "right",
      inset: 20,
      color: DEFAULT_MARGIN_LINE_COLOR,
    });
    const blank = parsePaperDesign(
      JSON.stringify({ format: PAPER_DESIGN_FORMAT, blank: { side: "top", size: 30 } }),
    );
    expect(blank?.blank).toEqual({ side: "top", size: 30 });
  });

  it("a name is trimmed and kept short; one that is no string is empty", () => {
    const long = parsePaperDesign(
      JSON.stringify({ format: PAPER_DESIGN_FORMAT, name: "x".repeat(300) }),
    );
    expect(long?.name).toHaveLength(100);
    expect(parsePaperDesign(JSON.stringify({ format: PAPER_DESIGN_FORMAT, name: 4 }))?.name).toBe(
      "",
    );
  });
});

describe("the designer's numbers", () => {
  it("holds each length to its range and two decimals", () => {
    expect(clampDesignValue("spacing", 1)).toBe(DESIGN_RANGES.spacing.min);
    expect(clampDesignValue("spacing", 99)).toBe(DESIGN_RANGES.spacing.max);
    expect(clampDesignValue("margin", 12.3456)).toBe(12.35);
    expect(clampDesignValue("inset", Number.NaN)).toBeNull();
  });

  it("folded headings say the state in a few words", () => {
    expect(marginsSummary({ top: 0, right: 0, bottom: 0, left: 0 })).toBe("None");
    expect(marginsSummary({ top: 15, right: 15, bottom: 15, left: 15 })).toBe("15 mm");
    expect(marginsSummary({ top: 20, right: 12.5, bottom: 0, left: 30 })).toBe(
      "20 · 12.5 · 0 · 30 mm",
    );
    expect(blankSummary(null)).toBe("None");
    expect(blankSummary({ side: "bottom", size: 50 })).toBe("Bottom · 50 mm");
    expect(marginLineSummary(null)).toBe("None");
    expect(marginLineSummary({ sides: "both", inset: 25, color: "#000000" })).toBe("Both · 25 mm");
  });
});

describe("a notebook on designed paper", () => {
  it("keeps the cover chosen, at the design's size, and the paper page is the design", () => {
    const design = { ...full(), size: "a5", landscape: true };
    const doc = buildDesignedNotebook(DEFAULT_NOTEBOOK_CHOICES, "Study", undefined, design);
    expect(doc.pages).toHaveLength(2);
    const [cover, paper] = doc.pages;
    expect(cover.backdrop.kind).toBe(DEFAULT_NOTEBOOK_CHOICES.cover);
    expect(cover.geometry).toEqual(sizeGeometry("a5", true));
    expect(paper.geometry).toEqual(sizeGeometry("a5", true));
    expect(paper.backdrop).toEqual(designBackdrop(design));
  });

  it("without a cover it is one page of the design", () => {
    const doc = buildDesignedNotebook(
      { ...DEFAULT_NOTEBOOK_CHOICES, cover: "none" },
      "Study",
      undefined,
      full(),
    );
    expect(doc.pages.map((p) => p.backdrop.kind)).toEqual(["squared"]);
  });
});

describe("the backdrop's own fields on disk", () => {
  function roundTrip(backdrop: unknown): SyntheticBackdrop {
    const doc: InkDocument = emptyDocument();
    doc.pages[0].backdrop = backdrop as SyntheticBackdrop;
    return decodeDocument(encodeDocument(doc)).pages[0].backdrop as SyntheticBackdrop;
  }

  it("a designed page saves and opens as it was made", () => {
    const backdrop = designBackdrop(full());
    expect(roundTrip(backdrop)).toEqual(backdrop);
  });

  it("each malformed field is dropped on its own, and the paper keeps the rest", () => {
    const read = roundTrip({
      kind: "ruled-wide",
      texture: "silk",
      margins: { top: 40, left: -3, right: "x", bottom: Number.NaN },
      blankZone: { side: "middle", size: 100 },
      marginLines: { left: "far", color: 7 },
    });
    expect(read).toEqual({ kind: "ruled-wide", margins: { top: 40 } });
  });

  it("a blank zone needs a side and a size; margin lines keep a colour only with a line", () => {
    expect(readPaperExtras({ blankZone: { side: "top", size: 0 } })).toEqual({});
    expect(readPaperExtras({ blankZone: "top" })).toEqual({});
    expect(readPaperExtras({ marginLines: { color: "#ff0000" } })).toEqual({});
    expect(readPaperExtras({ marginLines: { right: 0, color: "#ff0000" } })).toEqual({
      marginLines: { right: 0, color: "#ff0000" },
    });
    expect(readPaperExtras({ margins: { top: 0 } })).toEqual({});
    expect(readPaperExtras({ texture: "fine" })).toEqual({ texture: "fine" });
  });

  it("two backdrops compare by their designed fields too", () => {
    expect(paperExtrasKey({ kind: "squared" })).toBe("");
    expect(paperExtrasKey({ kind: "squared", texture: "fine" })).not.toBe(
      paperExtrasKey({ kind: "squared", texture: "heavy" }),
    );
  });

  it("recent templates keep a designed paper whole, and tell it from the plain one", () => {
    const designed = designBackdrop(full());
    const plain: SyntheticBackdrop = {
      kind: designed.kind,
      spacing: designed.spacing,
      color: designed.color,
      paperColor: designed.paperColor,
    };
    const recent = pushRecent(pushRecent([], plain), designed);
    expect(recent).toHaveLength(2);
    expect(parseRecent(JSON.parse(JSON.stringify(recent)))).toEqual(recent);
  });
});

describe("where designed paper puts things", () => {
  it("a page without margins or a blank area is ruled whole", () => {
    expect(ruledArea({ kind: "ruled-wide" }, A4)).toBeNull();
  });

  it("the ruling stops at the margins, and at the blank band where that is wider", () => {
    const area = ruledArea(
      {
        kind: "squared",
        margins: { top: 40, left: 60.4, right: 10 },
        blankZone: { side: "top", size: 100 },
      },
      A4,
    );
    expect(area).toEqual({ x: 60, y: 100, w: 1014 - 60, h: 1448 - 100 });
    const bottom = ruledArea({ kind: "squared", blankZone: { side: "bottom", size: 300 } }, A4);
    expect(bottom).toEqual({ x: 0, y: 0, w: 1024, h: 1148 });
  });

  it("margins wider than the page leave no room at all, never a negative one", () => {
    const area = ruledArea({ kind: "squared", margins: { left: 800, right: 800 } }, A4);
    expect(area?.w).toBe(0);
    const tall = ruledArea({ kind: "squared", blankZone: { side: "top", size: 5000 } }, A4);
    expect(tall?.h).toBe(0);
  });

  it("margin lines sit in from their edges, and stop at a blank band top or bottom", () => {
    const plan = marginLinePlan(
      {
        kind: "blank",
        marginLines: { left: 100, right: 50 },
        blankZone: { side: "bottom", size: 200 },
      },
      A4,
    );
    expect(plan).toEqual({ xs: [100, 974], y0: 0, y1: 1248, color: DEFAULT_MARGIN_LINE_COLOR });
    const top = marginLinePlan(
      {
        kind: "blank",
        marginLines: { left: 10, color: "#123456" },
        blankZone: { side: "top", size: 90 },
      },
      A4,
    );
    expect(top).toEqual({ xs: [10], y0: 90, y1: 1448, color: "#123456" });
  });

  it("no margin line falls off the page", () => {
    expect(marginLinePlan({ kind: "blank" }, A4)).toBeNull();
    expect(marginLinePlan({ kind: "blank", marginLines: { left: 2000 } }, A4)).toBeNull();
  });
});
