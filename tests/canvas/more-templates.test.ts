/**
 * The papers and covers added on 2026-10-06 (`src/canvas/backdrop.ts`,
 * `src/canvas/cover-patterns.ts`). The table-wide properties (inside the
 * page at every size, balanced context, palette-only strokes) are asserted
 * for every ruling in `backdrop.test.ts`; this file pins what each new
 * design draws.
 */

import { describe, expect, it } from "vitest";
import { LIGHT_PAPER, drawSynthetic, isometricPoints } from "../../src/canvas/backdrop";
import { cellHash, clipPolygon } from "../../src/canvas/cover-patterns";
import { coverHasPlate, coverLayout, coverPalette, isDarkColor } from "../../src/model/cover";
import {
  COVER_RULINGS,
  type CoverRuling,
  type PageGeometry,
  type Ruling,
  type SyntheticBackdrop,
} from "../../src/model/document";
import { COVER_COLORS, COVER_SECTIONS, COVER_TEMPLATES } from "../../src/model/templates";
import {
  type Op,
  asCanvasContext,
  fakeContext,
  horizontalYs,
  pitches,
  segments,
  verticalXs,
} from "./fake-canvas";

const A4: PageGeometry = { width: 1024, height: 1448 };
const LANDSCAPE: PageGeometry = { width: 1448, height: 1024 };

function draw(backdrop: SyntheticBackdrop, geometry: PageGeometry = A4, weight = 1) {
  const ctx = fakeContext();
  drawSynthetic(asCanvasContext(ctx), backdrop, geometry, LIGHT_PAPER, weight);
  return ctx;
}

const texts = (kind: Ruling, g: PageGeometry = A4): string[] =>
  draw({ kind }, g).ops.flatMap((o) => (o.op === "fillText" ? [o.text] : []));

const rects = (ops: readonly Op[]) =>
  ops.filter((o) => o.op === "rect") as Array<{ x: number; y: number; w: number; h: number }>;

describe("writing papers", () => {
  it("two-column: one divider down the middle, each half ruled on its own", () => {
    const ctx = draw({ kind: "two-column" });
    expect(verticalXs(ctx.ops)).toEqual([512.5]);
    const counts = new Map<number, number>();
    for (const y of horizontalYs(ctx.ops)) counts.set(y, (counts.get(y) ?? 0) + 1);
    expect([...new Set(counts.values())]).toEqual([2]);
  });

  it("wide margins: a blank column 30% wide, on the left or the right", () => {
    for (const [kind, edge] of [
      ["margin-left", 0.3],
      ["margin-right", 0.7],
    ] as const) {
      const ctx = draw({ kind });
      const x = Math.round(1024 * edge) + 0.5;
      expect(verticalXs(ctx.ops), kind).toEqual([x]);
      const rules = segments(ctx.ops).filter((s) => s.y0 === s.y1);
      expect(rules.length, kind).toBeGreaterThan(20);
      for (const r of rules) {
        // Every rule lies on the ruled side of the margin.
        if (kind === "margin-left") expect(r.x0).toBeGreaterThanOrEqual(x - 1);
        else expect(r.x1).toBeLessThanOrEqual(x + 1);
      }
    }
  });

  it("handwriting: solid top and baseline, a dashed waist between, dash reset after", () => {
    const ctx = draw({ kind: "handwriting" });
    const strokes = ctx.ops.filter((o) => o.op === "stroke");
    expect(strokes).toHaveLength(2);
    const dashes = ctx.ops.filter((o) => o.op === "setLineDash") as Array<{ segments: number[] }>;
    expect(dashes[0].segments).toHaveLength(2);
    expect(dashes.at(-1)?.segments).toEqual([]);
    const ys = horizontalYs(ctx.ops);
    // Solid lines come in pairs two pitches apart, then one waist per pair.
    const groups = ys.length / 3;
    expect(Number.isInteger(groups)).toBe(true);
    expect(groups).toBeGreaterThan(10);
    expect(ys[1] - ys[0]).toBe(44);
    expect(ys[groups * 2] - ys[0]).toBe(22);
  });

  it("storyboard: two columns of 16:9 frames, each with two caption rules", () => {
    const ctx = draw({ kind: "storyboard" });
    const frames = rects(ctx.ops);
    expect(frames.length % 2).toBe(0);
    expect(frames.length).toBeGreaterThanOrEqual(6);
    for (const f of frames) expect(f.w / f.h).toBeCloseTo(16 / 9, 1);
    expect(horizontalYs(ctx.ops)).toHaveLength(frames.length * 2);
  });

  it("storyboard: a page too short for one row draws no frames", () => {
    expect(rects(draw({ kind: "storyboard" }, { width: 1024, height: 200 }).ops)).toEqual([]);
  });

  it("meeting notes: labelled header, notes, and checkbox rows for action items", () => {
    expect(texts("meeting-notes")).toEqual([
      "Meeting",
      "Date",
      "Attendees",
      "Notes",
      "Action items",
    ]);
    const ctx = draw({ kind: "meeting-notes" });
    const boxes = rects(ctx.ops);
    expect(boxes.length).toBeGreaterThan(5);
    // Every box sits in the bottom third, under "Action items".
    for (const b of boxes) expect(b.y).toBeGreaterThan(1448 * 0.7);
  });
});

describe("grids", () => {
  it("graph: a fine grid with every fifth line drawn heavier, in a second pass", () => {
    const ctx = draw({ kind: "graph" });
    const strokes = ctx.ops.filter((o) => o.op === "stroke");
    expect(strokes).toHaveLength(2);
    const second = ctx.ops.indexOf(strokes[0]);
    const major = verticalXs(ctx.ops.slice(second));
    expect(pitches(major)).toEqual([120]);
    expect(ctx.lineWidth).toBe(2);
  });

  it("isometric: vertical lines plus two families at ±30°, all inside the page", () => {
    const ctx = draw({ kind: "isometric" });
    const segs = segments(ctx.ops);
    const slopes = new Set(
      segs
        .filter((s) => s.x0 !== s.x1)
        .map((s) => Math.round((Math.atan2(s.y1 - s.y0, s.x1 - s.x0) * 180) / Math.PI)),
    );
    expect([...slopes].sort((a, b) => a - b)).toEqual([-30, 30]);
    expect(verticalXs(ctx.ops).length).toBeGreaterThan(30);
  });

  it("isometric dots sit where the isometric grid's lines cross", () => {
    const points = isometricPoints(A4, 32);
    expect(points.length).toBeGreaterThan(1000);
    const dx = (32 * Math.sqrt(3)) / 2;
    for (const [x, y] of points.slice(0, 200)) {
      // On a vertical line, and on a +30° line through a multiple of the pitch.
      const k = Math.round(x / dx);
      expect(x).toBeCloseTo(k * dx);
      const b = y - x / Math.sqrt(3);
      expect(Math.abs(b / 32 - Math.round(b / 32))).toBeLessThan(1e-9);
    }
    const ctx = draw({ kind: "isometric-dots" });
    expect(ctx.ops.filter((o) => o.op === "arc")).toHaveLength(points.length);
  });

  it("hexagon: edges of side `spacing`, clipped at the page edge", () => {
    const segs = segments(draw({ kind: "hexagon" }).ops);
    const lengths = segs.map((s) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0));
    const whole = lengths.filter((l) => Math.abs(l - 24) < 1e-6);
    // Most edges are whole; the rest were cut by the page edge, never grown.
    expect(whole.length / lengths.length).toBeGreaterThan(0.9);
    for (const l of lengths) expect(l).toBeLessThanOrEqual(24 + 1e-6);
  });
});

describe("planners", () => {
  it("daily planner: a date line, sixteen hours from 6:00, priorities, to-dos, notes", () => {
    const labels = texts("daily-planner");
    expect(labels.slice(0, 4)).toEqual(["Date", "Priorities", "To do", "Notes"]);
    expect(labels.slice(4)).toEqual(Array.from({ length: 16 }, (_, i) => `${6 + i}:00`));
    expect(rects(draw({ kind: "daily-planner" }).ops)).toHaveLength(11);
  });

  it("daily planner: the right column stops at the page bottom on a small page", () => {
    const g = { width: 300, height: 420 };
    const ctx = draw({ kind: "daily-planner" }, g);
    for (const r of rects(ctx.ops)) expect(r.y + r.h).toBeLessThan(420);
    expect(texts("daily-planner", g)).not.toContain("Notes");
  });

  it("habit tracker: a column for each of 31 days, numbered", () => {
    const labels = texts("habit-tracker");
    expect(labels.slice(0, 2)).toEqual(["Month", "Habits"]);
    expect(labels.slice(2)).toEqual(Array.from({ length: 31 }, (_, d) => String(d + 1)));
    // The habit column's left edge, plus 32 day boundaries.
    expect(new Set(verticalXs(draw({ kind: "habit-tracker" }).ops)).size).toBe(33);
  });

  it("weekly grid: seven days and notes in a two-by-four grid", () => {
    expect(texts("weekly-grid")).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
      "SAT",
      "SUN",
      "NOTES",
      "Week of",
    ]);
    expect(new Set(verticalXs(draw({ kind: "weekly-grid" }).ops)).size).toBe(3);
  });
});

describe("score & tab", () => {
  it("pairs a five-line staff with a six-line tab, marked TAB, in every system", () => {
    const ctx = draw({ kind: "music-tab" });
    const lines = horizontalYs(ctx.ops).length;
    expect(lines % 11).toBe(0);
    const systems = lines / 11;
    expect(systems).toBeGreaterThan(3);
    expect(texts("music-tab")).toEqual(
      Array.from({ length: systems }, () => ["T", "A", "B"]).flat(),
    );
  });
});

describe("cover catalogue", () => {
  it("offers sixteen designs in two groups, every one a cover ruling", () => {
    expect(COVER_SECTIONS.map((s) => s.title)).toEqual(["Classic", "Patterns"]);
    expect(COVER_TEMPLATES.map((t) => t.ruling)).toEqual([...COVER_RULINGS]);
  });

  it("sets every pattern's title on a plate, and no classic design but the label's", () => {
    const [classic, patterns] = COVER_SECTIONS;
    for (const t of patterns.templates) expect(coverHasPlate(t.ruling as CoverRuling)).toBe(true);
    const plated = classic.templates.filter((t) => coverHasPlate(t.ruling as CoverRuling));
    expect(plated.map((t) => t.ruling)).toEqual(["cover-label"]);
  });

  it("offers sixteen colours, deep and light in equal numbers", () => {
    expect(COVER_COLORS).toHaveLength(16);
    const dark = COVER_COLORS.filter((c) => isDarkColor(c.color)).length;
    expect(dark).toBe(8);
  });
});

describe("cover designs", () => {
  const navy = COVER_COLORS[0].color;

  it("repaint identically, at the page and in a preview, so tiles never show seams", () => {
    for (const kind of COVER_RULINGS) {
      for (const weight of [1, 9]) {
        const a = draw({ kind, paperColor: navy }, A4, weight);
        const b = draw({ kind, paperColor: navy }, A4, weight);
        expect(a.ops, kind).toEqual(b.ops);
      }
    }
  });

  it("stay inside the page in every orientation, colour and preview weight", () => {
    for (const kind of COVER_RULINGS) {
      for (const g of [A4, LANDSCAPE, { width: 300, height: 420 }]) {
        for (const { color } of [COVER_COLORS[0], COVER_COLORS[13]]) {
          const ctx = draw({ kind, paperColor: color }, g, 9);
          for (const op of ctx.ops) {
            if (op.op !== "moveTo" && op.op !== "lineTo") continue;
            expect(op.x, kind).toBeGreaterThanOrEqual(-1e-9);
            expect(op.x, kind).toBeLessThanOrEqual(g.width + 1);
            expect(op.y, kind).toBeGreaterThanOrEqual(-1e-9);
            expect(op.y, kind).toBeLessThanOrEqual(g.height + 1);
          }
          expect(ctx.depth, kind).toBe(0);
        }
      }
    }
  });

  it("paint a visible pattern: every pattern fills in its motif colours", () => {
    const palette = coverPalette(navy);
    const motifs = new Set([palette.motif, palette.motifSoft, palette.fleck]);
    for (const t of COVER_SECTIONS[1].templates) {
      const ops = draw({ kind: t.ruling, paperColor: navy }).ops;
      const painted = ops.filter(
        (o) =>
          (o.op === "fill" && motifs.has(o.fillStyle)) ||
          (o.op === "stroke" && motifs.has(o.strokeStyle)),
      );
      expect(painted.length, t.ruling).toBeGreaterThan(0);
      // And a lot of it: a pattern that draws a handful of shapes is a bug.
      const shapes = ops.filter((o) => o.op === "arc" || o.op === "closePath" || o.op === "lineTo");
      expect(shapes.length, t.ruling).toBeGreaterThan(50);
    }
  });

  it("strap: a band down the cloth near the right edge, where the layout says", () => {
    const strap = coverLayout("cover-strap", A4).strap;
    expect(strap).not.toBeNull();
    if (!strap) return;
    const ctx = draw({ kind: "cover-strap", paperColor: navy });
    expect(ctx.ops).toContainEqual({
      op: "fillRect",
      x: strap.x,
      y: 0,
      w: strap.w,
      h: 1448,
      fillStyle: coverPalette(navy).band,
    });
    const { title } = coverLayout("cover-strap", A4);
    expect(title.x + title.w).toBeLessThan(strap.x);
  });

  it("bound and composition carry a spine band; bound adds two corner pieces", () => {
    for (const kind of ["cover-bound", "cover-composition"] as const) {
      expect(coverLayout(kind, A4).band, kind).toBeGreaterThan(0);
    }
    const ctx = draw({ kind: "cover-bound", paperColor: navy });
    const fills = ctx.ops.filter((o) => o.op === "fill" && o.fillStyle === coverPalette(navy).band);
    expect(fills).toHaveLength(1);
    expect(ctx.ops.filter((o) => o.op === "closePath")).toHaveLength(2);
  });

  it("frame: two nested rectangles in the trim colour", () => {
    const ctx = draw({ kind: "cover-frame", paperColor: COVER_COLORS[12].color });
    const [outer, inner] = rects(ctx.ops);
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.w).toBeLessThan(outer.w);
    const trim = coverPalette(COVER_COLORS[12].color).trim;
    expect(ctx.ops.filter((o) => o.op === "stroke" && o.strokeStyle === trim)).toHaveLength(2);
  });

  it("fade: a linear gradient, clear at the top, darkest at the bottom", () => {
    const ctx = draw({ kind: "cover-fade", paperColor: navy });
    const gradient = ctx.ops.find((o) => o.op === "gradient" && o.kind === "linear") as {
      stops: Array<{ at: number; color: string }>;
    };
    expect(gradient.stops[0].color).toMatch(/, 0\)$/);
    expect(gradient.stops.at(-1)?.color).toMatch(/, 0\.75\)$/);
  });
});

describe("cover pattern helpers", () => {
  it("cellHash stays in [0, 1) and spreads evenly", () => {
    // Pinned: a signed-int slip once sent half the hashes negative, which
    // blanked the mosaic and shrank every chip.
    const values: number[] = [];
    for (let i = -50; i < 50; i++) for (let j = 0; j < 50; j++) values.push(cellHash(i, j, 0x91));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(cellHash(3, 4, 5)).toBe(cellHash(3, 4, 5));
  });

  it("clipPolygon keeps a shape inside, drops one outside, and cuts one across an edge", () => {
    const inside: Array<[number, number]> = [
      [10, 10],
      [20, 10],
      [15, 20],
    ];
    expect(clipPolygon(inside, 100, 100)).toEqual(inside);
    expect(
      clipPolygon(
        [
          [-30, -30],
          [-10, -30],
          [-20, -10],
        ],
        100,
        100,
      ),
    ).toEqual([]);
    const cut = clipPolygon(
      [
        [-10, 50],
        [50, 50],
        [50, 60],
        [-10, 60],
      ],
      100,
      100,
    );
    expect(cut.map(([x]) => x).sort((a, b) => a - b)).toEqual([0, 0, 50, 50]);
    for (const [x, y] of clipPolygon(
      [
        [-20, -20],
        [120, 50],
        [50, 130],
      ],
      100,
      100,
    )) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });
});
