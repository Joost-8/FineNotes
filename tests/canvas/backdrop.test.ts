/**
 * `src/canvas/backdrop.ts` — the ruling table and spacing resolution
 * (contracts/api.md §1 "Ruling specifications" and §4).
 *
 * Every pitch asserted here is read straight out of the contract's table, so
 * this file doubles as a check that code and contract still agree. Drawing is
 * captured with a recording stub (`./fake-canvas`) rather than a real canvas:
 * the thing worth asserting is "rules every 28px", not a bitmap.
 */

import { describe, expect, it } from "vitest";
import {
  DARK_PAPER,
  DEFAULT_SPACING,
  LIGHT_PAPER,
  PAPER_PRESETS,
  RULINGS,
  SyntheticBackdropRenderer,
  drawMissingSource,
  drawSynthetic,
  drawSyntheticRules,
  fillPaper,
  paperTheme,
  resolveSpacing,
} from "../../src/canvas/backdrop";
import type { PageGeometry, Ruling, SyntheticBackdrop } from "../../src/model/document";
import { RULINGS as MODEL_RULINGS } from "../../src/model/document";
import {
  type Op,
  asCanvasContext,
  fakeContext,
  horizontalYs,
  pitches,
  segments,
  verticalXs,
} from "./fake-canvas";
import { COVER_RULINGS } from "../../src/model/document";
import { coverLayout, coverPalette } from "../../src/model/cover";
import { COVER_COLORS } from "../../src/model/templates";

const A4: PageGeometry = { width: 1024, height: 1448 };

function draw(backdrop: SyntheticBackdrop, geometry: PageGeometry = A4) {
  const ctx = fakeContext();
  drawSynthetic(asCanvasContext(ctx), backdrop, geometry, LIGHT_PAPER);
  return ctx;
}

describe("paper themes", () => {
  it("the default paper is white regardless of the Obsidian theme", () => {
    // CLAUDE.md: once the page stopped following the theme, every
    // theme-derived default became a potential invisible-ink bug. The page is
    // paper, and paper is white unless the notebook says otherwise.
    expect(LIGHT_PAPER.paper).toBe("#ffffff");
    expect(paperTheme(false)).toBe(LIGHT_PAPER);
    expect(paperTheme(true)).toBe(DARK_PAPER);
  });

  it("the dark override is a real dark paper, not an inverted white one", () => {
    expect(DARK_PAPER.paper).not.toBe(LIGHT_PAPER.paper);
    expect(DARK_PAPER.rule).not.toBe(LIGHT_PAPER.rule);
  });

  it("exposes the three paper-colour presets the contract names", () => {
    expect(PAPER_PRESETS).toEqual({ white: "#ffffff", cream: "#fbf8ed", yellow: "#fdf6d8" });
  });
});

describe("fillPaper", () => {
  it("fills exactly the page geometry, from the origin", () => {
    const ctx = fakeContext();
    fillPaper(asCanvasContext(ctx), A4, LIGHT_PAPER);
    expect(ctx.ops).toContainEqual({
      op: "fillRect",
      x: 0,
      y: 0,
      w: 1024,
      h: 1448,
      fillStyle: "#ffffff",
    });
  });

  it("a document's paperColor wins over the theme", () => {
    const ctx = fakeContext();
    fillPaper(asCanvasContext(ctx), A4, LIGHT_PAPER, PAPER_PRESETS.yellow);
    expect(ctx.ops[1]).toMatchObject({ op: "fillRect", fillStyle: "#fdf6d8" });
  });

  it("balances save/restore so it cannot leak state into the ink pass", () => {
    const ctx = fakeContext();
    fillPaper(asCanvasContext(ctx), A4, DARK_PAPER);
    expect(ctx.depth).toBe(0);
  });
});

describe("resolveSpacing", () => {
  it("defaults per ruling, exactly as the contract's table says", () => {
    expect(resolveSpacing(undefined, "ruled-narrow")).toBe(28);
    expect(resolveSpacing(undefined, "ruled-wide")).toBe(40);
    expect(resolveSpacing(undefined, "lined")).toBe(40);
    expect(resolveSpacing(undefined, "squared")).toBe(28);
    expect(resolveSpacing(undefined, "grid")).toBe(28);
    expect(resolveSpacing(undefined, "dotted")).toBe(40);
    expect(resolveSpacing(undefined, "cornell")).toBe(40);
    expect(resolveSpacing(undefined, "legal")).toBe(40);
    expect(resolveSpacing(undefined, "single-column")).toBe(40);
    expect(resolveSpacing(undefined, "three-column")).toBe(40);
  });

  it("falls back to DEFAULT_SPACING for a ruling it does not know", () => {
    expect(resolveSpacing(undefined, "planner" as Ruling)).toBe(DEFAULT_SPACING);
    expect(resolveSpacing(undefined)).toBe(DEFAULT_SPACING);
  });

  it("honours a document-supplied spacing", () => {
    expect(resolveSpacing(60, "ruled-wide")).toBe(60);
    expect(resolveSpacing(12.5, "squared")).toBe(12.5);
  });

  it("clamps a spacing a corrupt document could use to hang the paint loop", () => {
    // Anything at or below the floor becomes the floor; nothing loops forever.
    expect(resolveSpacing(0, "ruled-wide")).toBe(4);
    expect(resolveSpacing(-100, "ruled-wide")).toBe(4);
    expect(resolveSpacing(1e-9, "ruled-wide")).toBe(4);
  });

  it("treats a non-number or non-finite spacing as absent", () => {
    expect(resolveSpacing(NaN, "ruled-narrow")).toBe(28);
    expect(resolveSpacing(Infinity, "ruled-narrow")).toBe(28);
    expect(resolveSpacing("40" as unknown as number, "ruled-narrow")).toBe(28);
  });

  it("a tiny spacing draws a bounded number of rules and returns", () => {
    const ctx = draw({ kind: "ruled-wide", spacing: 0.0001 }, { width: 200, height: 400 });
    const ys = horizontalYs(ctx.ops);
    expect(ys.length).toBe(Math.ceil(400 / 4) - 1);
  });
});

describe("the ruling table covers the seventeen papers, four covers and two aliases", () => {
  it("has an entry for every Ruling the model allows", () => {
    expect(Object.keys(RULINGS).sort()).toEqual([...MODEL_RULINGS].sort());
    expect(MODEL_RULINGS).toHaveLength(23);
  });

  it("the aliases draw the same thing as what they alias", () => {
    expect(RULINGS.lined.spacing).toBe(RULINGS["ruled-wide"].spacing);
    expect(RULINGS.lined.draw).toBe(RULINGS["ruled-wide"].draw);
    expect(RULINGS.grid.spacing).toBe(RULINGS.squared.spacing);
    expect(RULINGS.grid.draw).toBe(RULINGS.squared.draw);
  });
});

describe("each ruling draws what contracts/api.md §1 specifies", () => {
  it("blank draws nothing on top of the paper", () => {
    const ctx = draw({ kind: "blank" });
    expect(horizontalYs(ctx.ops)).toEqual([]);
    expect(verticalXs(ctx.ops)).toEqual([]);
    expect(ctx.ops.filter((o) => o.op === "arc")).toEqual([]);
    // The paper itself is still painted.
    expect(ctx.ops.some((o) => o.op === "fillRect")).toBe(true);
  });

  it("dotted: dots on a 40px square lattice", () => {
    const ctx = draw({ kind: "dotted" }, { width: 200, height: 160 });
    const dots = ctx.ops.filter((o) => o.op === "arc") as Array<{
      x: number;
      y: number;
      r: number;
    }>;
    // 4 columns (40..160 < 200) x 3 rows (40..120 < 160).
    expect(dots).toHaveLength(12);
    expect([...new Set(dots.map((d) => d.r))]).toEqual([1.5]);
    expect([...new Set(dots.map((d) => d.x))]).toEqual([40, 80, 120, 160]);
    expect([...new Set(dots.map((d) => d.y))]).toEqual([40, 80, 120]);
    // Dots paint themselves; the caller must not also stroke the path.
    expect(ctx.ops.some((o) => o.op === "fill")).toBe(true);
    expect(ctx.ops.some((o) => o.op === "stroke")).toBe(false);
  });

  it("ruled-narrow: horizontal rules every 28px, full width", () => {
    const ctx = draw({ kind: "ruled-narrow" });
    expect(pitches(horizontalYs(ctx.ops))).toEqual([28]);
    expect(verticalXs(ctx.ops)).toEqual([]);
  });

  it("ruled-wide and its alias: horizontal rules every 40px", () => {
    expect(pitches(horizontalYs(draw({ kind: "ruled-wide" }).ops))).toEqual([40]);
    expect(pitches(horizontalYs(draw({ kind: "lined" }).ops))).toEqual([40]);
    expect(verticalXs(draw({ kind: "ruled-wide" }).ops)).toEqual([]);
  });

  it("squared and its alias: a square grid at 28px, 1px wide", () => {
    for (const kind of ["squared", "grid"] as const) {
      const ctx = draw({ kind });
      expect(pitches(horizontalYs(ctx.ops))).toEqual([28]);
      expect(pitches(verticalXs(ctx.ops))).toEqual([28]);
      expect(ctx.lineWidth).toBe(1);
    }
  });

  it("cornell: ruled-wide, a cue line at 25% width, a summary line 20% up", () => {
    const ctx = draw({ kind: "cornell" });
    const summaryY = Math.round(1448 * 0.8) + 0.5;
    const cueX = Math.round(1024 * 0.25) + 0.5;
    expect(horizontalYs(ctx.ops)).toContain(summaryY);
    expect(verticalXs(ctx.ops)).toEqual([cueX]);
    // The rules under it are still ruled-wide pitch.
    const rules = horizontalYs(ctx.ops).filter((y) => y !== summaryY);
    expect(pitches(rules)).toEqual([40]);
    // The cue line stops at the summary line rather than running to the foot.
    const cue = ctx.ops.findIndex((o) => o.op === "moveTo" && o.x === cueX && o.y === 0);
    expect(ctx.ops[cue + 1]).toEqual({ op: "lineTo", x: cueX, y: summaryY });
  });

  it("legal: ruled-wide, plus a double margin rule near the left edge", () => {
    const ctx = draw({ kind: "legal" });
    const xs = verticalXs(ctx.ops);
    expect(xs).toHaveLength(2);
    expect(xs[1] - xs[0]).toBe(6);
    expect(xs[0]).toBeLessThan(1024 * 0.15);
    expect(pitches(horizontalYs(ctx.ops))).toEqual([40]);
  });

  it("single-column: one inset column, ruled inside, with a rule on each side", () => {
    const ctx = draw({ kind: "single-column" });
    const inset = 1024 * 0.18;
    const xs = verticalXs(ctx.ops);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(Math.round(inset) + 0.5);
    expect(xs[1]).toBeCloseTo(Math.round(1024 - inset) + 0.5);
    // Rules run only inside the column.
    const rules = ctx.ops.filter((o) => o.op === "moveTo" && o.x === inset);
    expect(rules.length).toBeGreaterThan(0);
  });

  it("three-column: three equal ruled columns separated by two vertical rules", () => {
    const ctx = draw({ kind: "three-column" }, { width: 900, height: 400 });
    const xs = verticalXs(ctx.ops);
    expect(xs).toEqual([300.5, 600.5]);
    // Each column is ruled over its own span, so every y appears three times.
    const ys = horizontalYs(ctx.ops);
    const counts = new Map<number, number>();
    for (const y of ys) counts.set(y, (counts.get(y) ?? 0) + 1);
    expect([...new Set(counts.values())]).toEqual([3]);
  });

  it("never draws a rule at y=0 or past the bottom edge", () => {
    for (const kind of MODEL_RULINGS) {
      const ctx = draw({ kind }, { width: 300, height: 300 });
      for (const y of horizontalYs(ctx.ops)) {
        expect(y, kind).toBeGreaterThan(0);
        expect(y, kind).toBeLessThan(301);
      }
    }
  });

  it("scales its rules to the page it is given, not to a fixed page size", () => {
    const small = draw({ kind: "ruled-wide" }, { width: 200, height: 200 });
    const large = draw({ kind: "ruled-wide" }, { width: 200, height: 800 });
    expect(horizontalYs(large.ops).length).toBeGreaterThan(horizontalYs(small.ops).length);
    expect(pitches(horizontalYs(large.ops))).toEqual([40]);
  });

  it("a page smaller than one rule pitch draws no rules at all", () => {
    expect(horizontalYs(draw({ kind: "ruled-wide" }, { width: 30, height: 30 }).ops)).toEqual([]);
  });
});

describe("drawSyntheticRules", () => {
  it("uses the document's rule colour when it has one, else the theme's", () => {
    const withColour = fakeContext();
    drawSyntheticRules(
      asCanvasContext(withColour),
      { kind: "lined", color: "#ff0000" },
      A4,
      LIGHT_PAPER,
    );
    expect(withColour.strokeStyle).toBe("#ff0000");

    const withoutColour = fakeContext();
    drawSyntheticRules(asCanvasContext(withoutColour), { kind: "lined" }, A4, LIGHT_PAPER);
    expect(withoutColour.strokeStyle).toBe(LIGHT_PAPER.rule);
  });

  it("issues one beginPath/stroke pair for the whole page", () => {
    // A ruled A4 page carries ~35 rules and this runs on every scroll frame.
    const ctx = fakeContext();
    drawSyntheticRules(asCanvasContext(ctx), { kind: "squared" }, A4, LIGHT_PAPER);
    expect(ctx.ops.filter((o) => o.op === "beginPath")).toHaveLength(1);
    expect(ctx.ops.filter((o) => o.op === "stroke")).toHaveLength(1);
  });

  it("leaves the context balanced", () => {
    const ctx = fakeContext();
    drawSyntheticRules(asCanvasContext(ctx), { kind: "cornell" }, A4, LIGHT_PAPER);
    expect(ctx.depth).toBe(0);
  });

  it("does not paint the paper — that is fillPaper's job", () => {
    const ctx = fakeContext();
    drawSyntheticRules(asCanvasContext(ctx), { kind: "lined" }, A4, LIGHT_PAPER);
    expect(ctx.ops.some((o) => o.op === "fillRect")).toBe(false);
  });

  it("an unknown ruling from a newer document falls back to plain rules, not an error", () => {
    const ctx = fakeContext();
    drawSyntheticRules(
      asCanvasContext(ctx),
      { kind: "planner" as Ruling },
      { width: 200, height: 400 },
      LIGHT_PAPER,
    );
    expect(pitches(horizontalYs(ctx.ops))).toEqual([DEFAULT_SPACING]);
  });
});

describe("drawSynthetic", () => {
  it("paints the paper first, then the rules on top", () => {
    const ctx = draw({ kind: "lined" });
    const paperAt = ctx.ops.findIndex((o) => o.op === "fillRect");
    const firstRuleAt = ctx.ops.findIndex((o) => o.op === "lineTo");
    expect(paperAt).toBeGreaterThanOrEqual(0);
    expect(firstRuleAt).toBeGreaterThan(paperAt);
  });

  it("paper colour and rule colour are independent axes, as GoodNotes has them", () => {
    const ctx = fakeContext();
    drawSynthetic(
      asCanvasContext(ctx),
      { kind: "squared", paperColor: PAPER_PRESETS.cream, color: "#123456" },
      A4,
      LIGHT_PAPER,
    );
    expect(ctx.ops.find((o) => o.op === "fillRect")).toMatchObject({ fillStyle: "#fbf8ed" });
    expect(ctx.strokeStyle).toBe("#123456");
  });
});

describe("drawMissingSource", () => {
  it("draws a page with a marker and keeps the page a page", () => {
    const ctx = fakeContext();
    drawMissingSource(asCanvasContext(ctx), A4, LIGHT_PAPER, "PDF backdrop unavailable — a.pdf");
    expect(ctx.ops.some((o) => o.op === "fillRect")).toBe(true);
    expect(ctx.ops).toContainEqual(
      expect.objectContaining({ op: "fillText", text: "PDF backdrop unavailable — a.pdf" }),
    );
    expect(ctx.depth).toBe(0);
  });

  it("clips the label so a long vault path cannot run off the page", () => {
    const ctx = fakeContext();
    drawMissingSource(asCanvasContext(ctx), A4, LIGHT_PAPER, "x".repeat(400));
    const clipAt = ctx.ops.findIndex((o) => o.op === "clip");
    const textAt = ctx.ops.findIndex((o) => o.op === "fillText");
    expect(clipAt).toBeGreaterThanOrEqual(0);
    expect(textAt).toBeGreaterThan(clipAt);
  });

  it("keeps the marker box inside a narrow page", () => {
    const ctx = fakeContext();
    drawMissingSource(asCanvasContext(ctx), { width: 300, height: 400 }, LIGHT_PAPER, "missing");
    const box = ctx.ops.find((o) => o.op === "strokeRect") as { x: number; w: number };
    expect(box.x + box.w).toBeLessThanOrEqual(300);
  });

  it("resets the dash pattern it set, so the ink pass is not dashed", () => {
    const ctx = fakeContext();
    drawMissingSource(asCanvasContext(ctx), A4, LIGHT_PAPER, "missing");
    const dashes = ctx.ops.filter((o) => o.op === "setLineDash") as Array<{ segments: number[] }>;
    expect(dashes.at(-1)?.segments).toEqual([]);
  });

  it("names a real font family — a canvas font string cannot resolve var(--…)", () => {
    // CLAUDE.md: `ctx.font` is a CSS shorthand *string*; a custom property in
    // it is silently invalid and the text renders in the default font.
    const ctx = fakeContext();
    drawMissingSource(asCanvasContext(ctx), A4, LIGHT_PAPER, "missing");
    expect(ctx.font).not.toContain("var(");
    expect(ctx.font).toMatch(/\d+px .+/);
  });
});

describe("SyntheticBackdropRenderer", () => {
  it("draws synthetic paper directly", async () => {
    const ctx = fakeContext();
    const renderer = new SyntheticBackdropRenderer();
    await renderer.draw(asCanvasContext(ctx), { kind: "ruled-narrow" }, A4);
    expect(pitches(horizontalYs(ctx.ops))).toEqual([28]);
  });

  it("degrades a PDF backdrop to the missing-source placeholder, naming the path", () => {
    // contracts/api.md §4: never drop annotations because a backdrop failed.
    const ctx = fakeContext();
    const renderer = new SyntheticBackdropRenderer();
    return renderer
      .draw(asCanvasContext(ctx), { kind: "pdf", path: "Slides/week1.pdf", page: 2 }, A4)
      .then(() => {
        const label = ctx.ops.find((o) => o.op === "fillText") as { text: string };
        expect(label.text).toContain("Slides/week1.pdf");
        // The paper is still painted, so ink drawn after this is visible.
        expect(ctx.ops.some((o) => o.op === "fillRect")).toBe(true);
      });
  });

  it("returns a promise, so the caller can await a future async renderer", () => {
    const ctx = fakeContext();
    expect(
      new SyntheticBackdropRenderer().draw(asCanvasContext(ctx), { kind: "blank" }, A4),
    ).toBeInstanceOf(Promise);
  });

  it("setTheme switches the paper for subsequent draws", async () => {
    const renderer = new SyntheticBackdropRenderer();
    const light = fakeContext();
    await renderer.draw(asCanvasContext(light), { kind: "blank" }, A4);
    expect(light.ops.find((o) => o.op === "fillRect")).toMatchObject({
      fillStyle: LIGHT_PAPER.paper,
    });

    renderer.setTheme(DARK_PAPER);
    const dark = fakeContext();
    await renderer.draw(asCanvasContext(dark), { kind: "blank" }, A4);
    expect(dark.ops.find((o) => o.op === "fillRect")).toMatchObject({
      fillStyle: DARK_PAPER.paper,
    });
  });

  it("a document paperColor still wins over an explicit dark theme", () => {
    const ctx = fakeContext();
    const renderer = new SyntheticBackdropRenderer(DARK_PAPER);
    return renderer
      .draw(asCanvasContext(ctx), { kind: "blank", paperColor: PAPER_PRESETS.cream }, A4)
      .then(() => {
        expect(ctx.ops.find((o) => o.op === "fillRect")).toMatchObject({ fillStyle: "#fbf8ed" });
      });
  });
});

describe("planner and music templates", () => {
  const texts = (kind: Ruling) =>
    draw({ kind }).ops.flatMap((o) => (o.op === "fillText" ? [o.text] : []));

  it("todos: one checkbox per ruled row below the header", () => {
    const ops = draw({ kind: "todos" }).ops;
    const boxes = ops.filter((o) => o.op === "rect").length;
    const rows = horizontalYs(ops).length;
    // Every rule but the header's closes a row with a checkbox.
    expect(boxes).toBe(rows - 1);
    expect(boxes).toBeGreaterThan(20);
  });

  it("weekly-planner: seven labelled days", () => {
    expect(texts("weekly-planner")).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
  });

  it("monthly-planner: a seven-column grid under a weekday header", () => {
    const ctx = draw({ kind: "monthly-planner" });
    expect(texts("monthly-planner")).toHaveLength(7);
    expect(new Set(verticalXs(ctx.ops)).size).toBe(8);
    // Title rule, header rule, and six week rows.
    expect(new Set(horizontalYs(ctx.ops)).size).toBe(8);
  });

  it("music: staves of five lines, 12px apart", () => {
    const ys = horizontalYs(draw({ kind: "music" }).ops);
    expect(ys.length % 5).toBe(0);
    expect(ys.length / 5).toBeGreaterThan(5);
    expect(ys[1] - ys[0]).toBe(12);
  });

  it("guitar-tab: staves of six lines, each marked TAB", () => {
    const ctx = draw({ kind: "guitar-tab" });
    const staffCount = horizontalYs(ctx.ops).length / 6;
    expect(Number.isInteger(staffCount)).toBe(true);
    expect(texts("guitar-tab")).toHaveLength(staffCount * 3);
  });

  it("accounting: five ledger columns", () => {
    expect(new Set(verticalXs(draw({ kind: "accounting" }).ops)).size).toBe(6);
  });

  it("title-date: Title and Date labels over their writing rules, then ruled-wide", () => {
    const ctx = draw({ kind: "title-date" });
    expect(texts("title-date")).toEqual(["Title", "Date"]);
    const labels = ctx.ops.filter((o) => o.op === "fillText") as Array<{ x: number; y: number }>;
    // Date sits right of Title, on the same line.
    expect(labels[1].x).toBeGreaterThan(1024 / 2);
    expect(labels[1].y).toBe(labels[0].y);
    const rules = segments(ctx.ops).filter((s) => s.y0 === s.y1);
    const writing = rules.filter((s) => s.y0 === Math.round(80) + 0.5);
    expect(writing).toHaveLength(2);
    const [title, date] = [...writing].sort((a, b) => a.x0 - b.x0);
    // Each rule starts after its label, and the date field is the narrower.
    expect(title.x0).toBeGreaterThan(labels[0].x);
    expect(date.x0).toBeGreaterThan(labels[1].x);
    expect(date.x1 - date.x0).toBeLessThan(title.x1 - title.x0);
    expect(title.x1).toBeLessThan(date.x0);
    // A rule under the header, then the body at the ruled-wide pitch.
    const body = horizontalYs(ctx.ops)
      .filter((y) => y > 80.5)
      .sort((a, b) => a - b);
    expect(pitches(body)).toEqual([40]);
    // The header rule is drawn heavier than the body's.
    expect(ctx.lineWidth).toBe(2);
  });

  it("every template stays inside the page at any paper size", () => {
    const sizes: PageGeometry[] = [
      { width: 1024, height: 1448 },
      { width: 1448, height: 1024 },
      { width: 300, height: 420 },
    ];
    for (const kind of MODEL_RULINGS) {
      for (const g of sizes) {
        const ctx = draw({ kind }, g);
        for (const op of ctx.ops) {
          if (op.op !== "moveTo" && op.op !== "lineTo") continue;
          expect(op.x, kind).toBeGreaterThanOrEqual(0);
          expect(op.x, kind).toBeLessThanOrEqual(g.width + 1);
          expect(op.y, kind).toBeGreaterThanOrEqual(0);
          expect(op.y, kind).toBeLessThanOrEqual(g.height + 1);
        }
        expect(ctx.depth, kind).toBe(0);
      }
    }
  });
});

describe("covers", () => {
  const navy = COVER_COLORS[0].color;
  const strokes = (ops: readonly Op[]) =>
    ops.flatMap((o) => (o.op === "stroke" ? [o.strokeStyle] : []));
  const fullWidthRules = (ops: readonly Op[], width: number) =>
    segments(ops).filter((s) => s.y0 === s.y1 && s.x0 <= 1 && s.x1 >= width - 1);

  it("fill the page with the cover colour, as any paper colour is filled", () => {
    for (const kind of COVER_RULINGS) {
      const ctx = draw({ kind, paperColor: navy });
      expect(
        ctx.ops.find((o) => o.op === "fillRect"),
        kind,
      ).toMatchObject({
        x: 0,
        y: 0,
        w: 1024,
        h: 1448,
        fillStyle: navy,
      });
    }
  });

  it("draw no ruling and no printed labels: a cover is not paper", () => {
    for (const kind of COVER_RULINGS) {
      for (const { color } of COVER_COLORS) {
        const ctx = draw({ kind, paperColor: color });
        expect(
          ctx.ops.some((o) => o.op === "fillText"),
          kind,
        ).toBe(false);
        // Nothing is stroked in the paper theme's rule colour.
        expect(strokes(ctx.ops), kind).not.toContain(LIGHT_PAPER.rule);
        if (kind !== "cover-linen") expect(fullWidthRules(ctx.ops, 1024), kind).toEqual([]);
        expect(ctx.depth, kind).toBe(0);
      }
    }
  });

  it("paint every colour from the cover's own palette", () => {
    for (const kind of COVER_RULINGS) {
      const palette = coverPalette(navy);
      const allowed = new Set(Object.values(palette));
      for (const style of strokes(draw({ kind, paperColor: navy }).ops)) {
        expect(allowed.has(style), `${kind}: ${style}`).toBe(true);
      }
    }
  });

  it("darken toward the edges with a radial vignette from clear to the shade", () => {
    for (const kind of COVER_RULINGS) {
      const ctx = draw({ kind, paperColor: navy });
      const gradient = ctx.ops.find((o) => o.op === "gradient") as {
        kind: string;
        stops: Array<{ at: number; color: string }>;
      };
      expect(gradient.kind, kind).toBe("radial");
      expect(gradient.stops[0].color).toMatch(/, 0\)$/);
      expect(gradient.stops.at(-1)?.color).toMatch(/, 0\.32\)$/);
    }
  });

  it("plain: an inset hairline edge and nothing else", () => {
    const ctx = draw({ kind: "cover-plain", paperColor: navy });
    const rects = ctx.ops.filter((o) => o.op === "rect") as Array<{ x: number; w: number }>;
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBeGreaterThan(0);
    expect(rects[0].x + rects[0].w).toBeLessThan(1024);
    expect(ctx.ops.some((o) => o.op === "arcTo")).toBe(false);
  });

  it("label: a lighter rounded plate in the upper middle, about 60% wide", () => {
    const ctx = draw({ kind: "cover-label", paperColor: navy });
    const plate = coverLayout("cover-label", A4).plate;
    expect(plate).not.toBeNull();
    if (!plate) return;
    expect(plate.w / 1024).toBeCloseTo(0.6);
    expect(plate.y + plate.h / 2).toBeLessThan(1448 / 2);
    const start = ctx.ops.find((o) => o.op === "moveTo" && o.y === plate.y);
    expect(start).toBeDefined();
    expect(ctx.ops.filter((o) => o.op === "arcTo").length).toBe(8);
    expect(ctx.ops).toContainEqual({ op: "fill", fillStyle: coverPalette(navy).label });
  });

  it("band: a darker spine down the left edge with a dashed stitch, dash reset after", () => {
    const ctx = draw({ kind: "cover-band", paperColor: navy });
    const { band } = coverLayout("cover-band", A4);
    expect(band).toBeGreaterThan(0);
    expect(ctx.ops).toContainEqual({
      op: "fillRect",
      x: 0,
      y: 0,
      w: band,
      h: 1448,
      fillStyle: coverPalette(navy).band,
    });
    const dashes = ctx.ops.filter((o) => o.op === "setLineDash") as Array<{ segments: number[] }>;
    expect(dashes[0].segments.length).toBe(2);
    expect(dashes.at(-1)?.segments).toEqual([]);
    const stitch = verticalXs(ctx.ops).filter((x) => x < band);
    expect(stitch).toHaveLength(1);
  });

  it("linen: fine low-contrast threads both ways, identical on every repaint", () => {
    const a = draw({ kind: "cover-linen", paperColor: navy });
    const b = draw({ kind: "cover-linen", paperColor: navy });
    expect(a.ops).toEqual(b.ops);
    expect(verticalXs(a.ops).length).toBeGreaterThan(100);
    expect(horizontalYs(a.ops).length).toBeGreaterThan(100);
    const palette = coverPalette(navy);
    expect(strokes(a.ops)).toEqual([palette.threadLight, palette.threadDark]);
  });

  it("linen threads spread out in a small preview instead of merging into a tint", () => {
    const page = fakeContext();
    drawSynthetic(
      asCanvasContext(page),
      { kind: "cover-linen", paperColor: navy },
      A4,
      LIGHT_PAPER,
    );
    const preview = fakeContext();
    drawSynthetic(
      asCanvasContext(preview),
      { kind: "cover-linen", paperColor: navy },
      A4,
      LIGHT_PAPER,
      8,
    );
    expect(verticalXs(preview.ops).length).toBeLessThan(verticalXs(page.ops).length / 3);
  });

  it("a cover without a readable colour still paints, on the theme's paper", () => {
    for (const kind of COVER_RULINGS) {
      const ctx = draw({ kind });
      expect(ctx.ops.find((o) => o.op === "fillRect")).toMatchObject({ fillStyle: "#ffffff" });
      expect(ctx.depth).toBe(0);
    }
  });
});
