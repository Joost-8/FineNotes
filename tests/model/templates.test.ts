/**
 * The template catalogue and the page-template commands behind the "Add Page"
 * popover and the template picker.
 */

import { describe, expect, it } from "vitest";
import { AddPage } from "../../src/model/commands";
import {
  COVER_RULINGS,
  RULINGS,
  blankPage,
  emptyDocument,
  isCoverRuling,
} from "../../src/model/document";
import { SetPageTemplate, insertIndexFor, pageFromTemplate } from "../../src/model/page-commands";
import {
  COVER_COLORS,
  COVER_TEMPLATES,
  MAX_RECENT,
  coverBackdrop,
  coverColorOf,
  paperTemplateFor,
  PAGE_SIZES,
  PAPER_COLORS,
  TEMPLATE_SECTIONS,
  paperColorOf,
  paperLabel,
  parseRecent,
  popoverTemplates,
  pushRecent,
  sizeGeometry,
  sizeOf,
  templateBackdrop,
  templateName,
} from "../../src/model/templates";

describe("the catalogue", () => {
  it("offers every paper ruling except the two legacy aliases, once each", () => {
    const offered = TEMPLATE_SECTIONS.flatMap((s) => s.templates.map((t) => t.ruling));
    expect(new Set(offered).size).toBe(offered.length);
    expect([...offered].sort()).toEqual(
      RULINGS.filter((r) => r !== "lined" && r !== "grid" && !isCoverRuling(r)).sort(),
    );
  });

  it("offers every cover design in the cover list and never as paper", () => {
    expect(COVER_TEMPLATES.map((t) => t.ruling).sort()).toEqual([...COVER_RULINGS].sort());
  });

  it("names every ruling, aliases included", () => {
    for (const ruling of RULINGS) expect(templateName(ruling)).not.toBe("Paper");
    expect(templateName("lined")).toBe(templateName("ruled-wide"));
  });
});

describe("paper colours", () => {
  it("white paper stores no colour at all, so old documents read unchanged", () => {
    expect(templateBackdrop("dotted", "white")).toEqual({ kind: "dotted" });
  });

  it("dark paper carries a rule colour that reads on it", () => {
    const dark = templateBackdrop("ruled-wide", "dark");
    expect(dark.paperColor).toBe(PAPER_COLORS[2].paper);
    expect(dark.color).toBeDefined();
  });

  it("round-trips through paperColorOf", () => {
    for (const color of PAPER_COLORS) {
      expect(paperColorOf(templateBackdrop("squared", color.id))).toBe(color.id);
    }
    expect(paperColorOf({ kind: "pdf", path: "a.pdf", page: 0 })).toBe("white");
    expect(paperColorOf({ kind: "blank", paperColor: "#123456" })).toBe("white");
    expect(paperLabel(templateBackdrop("blank", "yellow"))).toBe("Yellow Paper");
  });
});

describe("page sizes", () => {
  it("Standard is the geometry every existing page already has", () => {
    expect(sizeGeometry("standard", false)).toEqual(blankPage().geometry);
  });

  it("landscape swaps the sides, and sizeOf reads both back", () => {
    for (const size of PAGE_SIZES) {
      const portrait = sizeGeometry(size.id, false);
      const landscape = sizeGeometry(size.id, true);
      expect(landscape).toEqual({ width: portrait.height, height: portrait.width });
      expect(sizeOf(portrait)).toEqual({ sizeId: size.id, landscape: false });
      expect(sizeOf(landscape)).toEqual({ sizeId: size.id, landscape: true });
    }
  });

  it("an unknown size id falls back to Standard, and an odd geometry reads as null", () => {
    expect(sizeGeometry("nope", false)).toEqual(sizeGeometry("standard", false));
    expect(sizeOf({ width: 1000, height: 1000 })).toBeNull();
  });

  it("keeps the physical scale: A5 is half of A4 by area", () => {
    const a5 = sizeGeometry("a5", false);
    expect(a5.height).toBeCloseTo(sizeGeometry("standard", false).width, -1);
  });
});

describe("recent templates", () => {
  it("moves a reused template to the front without duplicating it", () => {
    let recent = pushRecent([], { kind: "dotted" });
    recent = pushRecent(recent, { kind: "cornell" });
    recent = pushRecent(recent, { kind: "dotted" });
    expect(recent.map((r) => r.kind)).toEqual(["dotted", "cornell"]);
  });

  it("the same ruling on another paper colour is a different template", () => {
    const recent = pushRecent([{ kind: "dotted" }], templateBackdrop("dotted", "dark"));
    expect(recent).toHaveLength(2);
  });

  it("is capped", () => {
    let recent: ReturnType<typeof pushRecent> = [];
    for (const ruling of RULINGS) recent = pushRecent(recent, { kind: ruling });
    expect(recent).toHaveLength(MAX_RECENT);
  });

  it("drops anything malformed from storage instead of repairing it", () => {
    expect(parseRecent("nope")).toEqual([]);
    expect(
      parseRecent([
        { kind: "dotted", paperColor: "#fbf8ed" },
        { kind: "toString" },
        null,
        { kind: "squared", spacing: -3, color: 7 },
      ]),
    ).toEqual([{ kind: "dotted", paperColor: "#fbf8ed" }, { kind: "squared" }]);
  });

  it("the popover leads with the current template and skips its duplicate", () => {
    const cards = popoverTemplates({ kind: "cornell" }, [{ kind: "cornell" }, { kind: "todos" }]);
    expect(cards.map((c) => c.label)).toEqual(["Current template", "Todos"]);
  });

  it("a PDF page's current template is plain paper", () => {
    const cards = popoverTemplates({ kind: "pdf", path: "x.pdf", page: 2 }, []);
    expect(cards[0].backdrop).toEqual({ kind: "blank" });
  });
});

describe("cover colours and covers next to paper", () => {
  it("offers about eight distinct cover colours, all as hex", () => {
    expect(COVER_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(COVER_COLORS.map((c) => c.id)).size).toBe(COVER_COLORS.length);
    for (const c of COVER_COLORS) expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("builds a cover backdrop and reads its colour back", () => {
    for (const c of COVER_COLORS) {
      const backdrop = coverBackdrop("cover-band", c.id);
      expect(backdrop).toEqual({ kind: "cover-band", paperColor: c.color });
      expect(coverColorOf(backdrop)).toBe(c.id);
    }
    expect(coverBackdrop("cover-plain", "nope").paperColor).toBe(COVER_COLORS[0].color);
    expect(coverColorOf({ kind: "cover-plain", paperColor: "#123456" })).toBeNull();
    expect(coverColorOf({ kind: "pdf", path: "a.pdf", page: 0 })).toBeNull();
  });

  it("paperTemplateFor skips a cover for the nearest paper, preferring the next page", () => {
    const cover = { ...blankPage("p1"), backdrop: coverBackdrop("cover-label", "navy") };
    const dotted = { ...blankPage("p2"), backdrop: { kind: "dotted" as const } };
    const squared = { ...blankPage("p3"), backdrop: { kind: "squared" as const } };
    expect(paperTemplateFor([cover, dotted], 0)).toEqual({ kind: "dotted" });
    expect(paperTemplateFor([squared, cover, dotted], 1)).toEqual({ kind: "dotted" });
    expect(paperTemplateFor([squared, cover], 1)).toEqual({ kind: "squared" });
    expect(paperTemplateFor([dotted, squared], 1)).toEqual({ kind: "squared" });
    expect(paperTemplateFor([cover], 0)).toEqual({ kind: "blank" });
    expect(paperTemplateFor([cover, dotted], 99)).toEqual({ kind: "dotted" });
  });

  it("a cover is never remembered or offered as a recent template", () => {
    const recent = pushRecent([{ kind: "dotted" }], coverBackdrop("cover-plain", "navy"));
    expect(recent).toEqual([{ kind: "dotted" }]);
    expect(
      parseRecent([{ kind: "cover-label", paperColor: "#1f3a5f" }, { kind: "todos" }]),
    ).toEqual([{ kind: "todos" }]);
    const cards = popoverTemplates(coverBackdrop("cover-linen", "sage"), []);
    expect(cards[0].backdrop).toEqual({ kind: "blank" });
  });
});

describe("insertIndexFor", () => {
  it("places before, after and at the end", () => {
    expect(insertIndexFor("before", 2, 5)).toBe(2);
    expect(insertIndexFor("after", 2, 5)).toBe(3);
    expect(insertIndexFor("last", 2, 5)).toBe(5);
  });

  it("clamps a stale reference page", () => {
    expect(insertIndexFor("after", 99, 3)).toBe(3);
    expect(insertIndexFor("before", -4, 3)).toBe(0);
  });
});

describe("pageFromTemplate", () => {
  it("builds an empty page with a fresh id, and undoes through AddPage", () => {
    const doc = emptyDocument();
    const geometry = sizeGeometry("a5", true);
    const insert = pageFromTemplate(doc, 0, { kind: "todos" }, geometry);
    expect(insert.page).toMatchObject({ id: "p2", backdrop: { kind: "todos" }, geometry });
    const command = new AddPage(insert.index, insert.page);
    command.apply(doc);
    expect(doc.pages.map((p) => p.id)).toEqual(["p2", "p1"]);
    command.invert(doc);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1"]);
  });

  it("does not share the caller's backdrop or geometry objects", () => {
    const backdrop = { kind: "dotted" as const };
    const geometry = sizeGeometry("standard", false);
    const { page } = pageFromTemplate(emptyDocument(), 1, backdrop, geometry);
    expect(page.backdrop).not.toBe(backdrop);
    expect(page.geometry).not.toBe(geometry);
  });
});

describe("SetPageTemplate", () => {
  it("changes paper and size in one step and restores both", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    page.strokes.push({ id: "s1", color: "#000", size: 3, tool: "pen", pts: [900, 1400, 0.5] });
    const before = { backdrop: page.backdrop, geometry: page.geometry };
    const command = new SetPageTemplate(page, { kind: "squared" }, sizeGeometry("a5", false));
    command.apply(doc);
    expect(page.backdrop).toEqual({ kind: "squared" });
    expect(page.geometry).toEqual(sizeGeometry("a5", false));
    // Ink outside the smaller page is kept, not moved or dropped.
    expect(page.strokes[0].pts).toEqual([900, 1400, 0.5]);
    command.invert(doc);
    expect(page.backdrop).toEqual(before.backdrop);
    expect(page.geometry).toEqual(before.geometry);
  });

  it("leaves the size alone when none is given", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const geometry = page.geometry;
    new SetPageTemplate(page, { kind: "music" }).apply(doc);
    expect(page.geometry).toBe(geometry);
  });

  it("is a no-op for a page no longer in the document", () => {
    const doc = emptyDocument();
    const stray = blankPage("p9");
    const command = new SetPageTemplate(stray, { kind: "music" });
    command.apply(doc);
    command.invert(doc);
    expect(stray.backdrop).toEqual({ kind: "blank" });
  });
});
