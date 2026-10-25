/**
 * Designed paper on the canvas: the grain (`src/canvas/paper-texture.ts`)
 * and what `drawSynthetic` does with margins, a blank band and margin lines
 * (`src/canvas/backdrop.ts`), plus the lines the ruled tools read.
 */

import { describe, expect, it } from "vitest";
import { DARK_PAPER, LIGHT_PAPER, drawSynthetic, writingLines } from "../../src/canvas/backdrop";
import { nightRule } from "../../src/canvas/night";
import {
  TEXTURES,
  cellHash,
  isDarkTextureGround,
  textureMarks,
} from "../../src/canvas/paper-texture";
import type { PageGeometry, SyntheticBackdrop } from "../../src/model/document";
import { DEFAULT_MARGIN_LINE_COLOR } from "../../src/model/paper-extras";
import { asCanvasContext, fakeContext, horizontalYs, verticalXs } from "./fake-canvas";

const A4: PageGeometry = { width: 1024, height: 1448 };

function draw(
  backdrop: SyntheticBackdrop,
  theme = LIGHT_PAPER,
  region?: { minX: number; minY: number; maxX: number; maxY: number },
) {
  const ctx = fakeContext();
  drawSynthetic(asCanvasContext(ctx), backdrop, A4, theme, 1, region);
  return ctx;
}

/** Every speck of `marks`, as "x,y" keys. */
function speckKeys(rects: number[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < rects.length; i += 4) out.add(`${rects[i]},${rects[i + 1]}`);
  return out;
}

describe("the grain's hash", () => {
  it("lies in [0, 1) with a mean near a half: the >>> 0 is there", () => {
    let sum = 0;
    let n = 0;
    for (let x = -50; x < 50; x++) {
      for (let y = -50; y < 50; y++) {
        const h = cellHash(x, y, 3);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
        sum += h;
        n++;
      }
    }
    expect(sum / n).toBeGreaterThan(0.47);
    expect(sum / n).toBeLessThan(0.53);
  });

  it("is the same every time, and differs by salt", () => {
    expect(cellHash(12, 34, 1)).toBe(cellHash(12, 34, 1));
    expect(cellHash(12, 34, 1)).not.toBe(cellHash(12, 34, 2));
  });
});

describe("the grain", () => {
  it("is the same on every draw: never random", () => {
    expect(textureMarks("heavy", A4)).toEqual(textureMarks("heavy", A4));
  });

  it("a tile gets exactly the page's specks that fall in it, so seams line up", () => {
    const whole = textureMarks("fine", A4);
    const region = { minX: 256, minY: 512, maxX: 512, maxY: 768 };
    const tile = textureMarks("fine", A4, region);
    const inTile = new Set<string>();
    for (let i = 0; i < whole.dark.length; i += 4) {
      const [x, y, s] = [whole.dark[i], whole.dark[i + 1], whole.dark[i + 2]];
      if (x < region.maxX && y < region.maxY && x + s > region.minX && y + s > region.minY) {
        inTile.add(`${x},${y}`);
      }
    }
    expect(speckKeys(tile.dark)).toEqual(inTile);
    expect(tile.dark.length).toBeLessThan(whole.dark.length / 10);
  });

  it("stays on the page", () => {
    const marks = textureMarks("heavy", { width: 100, height: 60 });
    for (let i = 0; i < marks.dark.length; i += 4) {
      expect(marks.dark[i]).toBeLessThan(100);
      expect(marks.dark[i + 1]).toBeLessThan(60);
    }
  });

  it("only heavy paper has fibres; fine paper is specks only", () => {
    expect(textureMarks("fine", A4).fibres).toHaveLength(0);
    expect(textureMarks("heavy", A4).fibres.length).toBeGreaterThan(0);
  });

  it("a preview's weight coarsens it but keeps its tone", () => {
    const covered = (weight: number): number => {
      const marks = textureMarks("fine", A4, undefined, weight);
      let area = 0;
      for (let i = 0; i < marks.dark.length; i += 4) area += marks.dark[i + 2] * marks.dark[i + 3];
      return area / (A4.width * A4.height);
    };
    const fine = textureMarks("fine", A4).dark.length;
    const coarse = textureMarks("fine", A4, undefined, 4).dark.length;
    expect(coarse).toBeLessThan(fine / 10);
    expect(covered(4)).toBeGreaterThan(covered(1) * 0.7);
    expect(covered(4)).toBeLessThan(covered(1) * 1.3);
  });

  it("an empty region or a weight that is no number gives nothing odd", () => {
    expect(textureMarks("fine", A4, { minX: 50, minY: 50, maxX: 50, maxY: 80 }).dark).toEqual([]);
    expect(textureMarks("fine", A4, undefined, Number.NaN)).toEqual(textureMarks("fine", A4));
  });

  it("tells dark paper from light by its lightness", () => {
    expect(isDarkTextureGround("#26272b")).toBe(true);
    expect(isDarkTextureGround("#f6efe0")).toBe(false);
    expect(isDarkTextureGround("rebeccapurple")).toBe(false);
  });
});

describe("drawing designed paper", () => {
  it("draws its grain under the rules, in the light paper's inks", () => {
    const ctx = draw({ kind: "squared", texture: "heavy" });
    const fills = ctx.ops.filter((op) => op.op === "fill").map((op) => op.fillStyle);
    expect(fills).toContain(TEXTURES.heavy.onLight.dark);
    expect(fills).toContain(TEXTURES.heavy.onLight.light);
    const firstRect = ctx.ops.findIndex((op) => op.op === "rect");
    const firstRule = ctx.ops.findIndex(
      (op) => op.op === "stroke" && op.strokeStyle === LIGHT_PAPER.rule,
    );
    expect(firstRect).toBeGreaterThan(0);
    expect(firstRule).toBeGreaterThan(firstRect);
  });

  it("on a page shown dark the grain switches to its dark inks", () => {
    const fills = draw({ kind: "blank", texture: "fine" }, DARK_PAPER)
      .ops.filter((op) => op.op === "fill")
      .map((op) => op.fillStyle);
    expect(fills).toContain(TEXTURES.fine.onDark.dark);
    expect(fills).not.toContain(TEXTURES.fine.onLight.dark);
  });

  it("a tile draws only its part of the grain", () => {
    const rects = (ctx: ReturnType<typeof fakeContext>): number =>
      ctx.ops.filter((op) => op.op === "rect").length;
    const whole = rects(draw({ kind: "blank", texture: "fine" }));
    const tile = rects(
      draw({ kind: "blank", texture: "fine" }, LIGHT_PAPER, {
        minX: 0,
        minY: 0,
        maxX: 128,
        maxY: 128,
      }),
    );
    expect(tile).toBeLessThan(whole / 50);
  });

  it("rules only inside the margins, starting from the margin's corner", () => {
    const ctx = draw({
      kind: "ruled-wide",
      spacing: 40,
      margins: { top: 100, left: 80, right: 44 },
    });
    expect(ctx.ops.some((op) => op.op === "clip")).toBe(true);
    const clip = ctx.ops.find((op) => op.op === "rect");
    expect(clip).toEqual({ op: "rect", x: 80, y: 100, w: 900, h: 1348 });
    const ys = horizontalYs(ctx.ops);
    expect(ys[0]).toBe(140.5);
    expect(ys.every((y) => y > 100 && y < 1448)).toBe(true);
    const segs = ctx.ops.filter((op) => op.op === "moveTo");
    expect(segs.every((op) => op.op === "moveTo" && op.x === 80)).toBe(true);
  });

  it("no room left between the margins: no rules at all", () => {
    const ctx = draw({ kind: "ruled-wide", margins: { left: 600, right: 600 } });
    expect(horizontalYs(ctx.ops)).toEqual([]);
  });

  it("draws margin lines over the rules, crisp, in their colour or the soft red", () => {
    const ctx = draw({ kind: "ruled-wide", marginLines: { left: 100, right: 50 } });
    expect(verticalXs(ctx.ops)).toEqual([100.5, 974.5]);
    const last = ctx.ops.filter((op) => op.op === "stroke").at(-1);
    expect(last).toEqual({ op: "stroke", strokeStyle: DEFAULT_MARGIN_LINE_COLOR });
  });

  it("with dark pages a margin line is shown as a rule is", () => {
    const ctx = draw({ kind: "blank", marginLines: { left: 100, color: "#e8a3a3" } }, DARK_PAPER);
    const last = ctx.ops.filter((op) => op.op === "stroke").at(-1);
    expect(last).toEqual({ op: "stroke", strokeStyle: nightRule("#e8a3a3") });
  });

  it("save and restore stay balanced with every part on", () => {
    const ctx = draw({
      kind: "dotted",
      texture: "heavy",
      margins: { top: 50 },
      blankZone: { side: "right", size: 200 },
      marginLines: { left: 60 },
    });
    expect(ctx.depth).toBe(0);
  });
});

describe("the ruled tools read designed paper's lines where they are drawn", () => {
  it("lines start at the margin and stop at the blank band", () => {
    const backdrop: SyntheticBackdrop = {
      kind: "ruled-wide",
      spacing: 40,
      margins: { top: 100, left: 80 },
      blankZone: { side: "bottom", size: 248 },
    };
    const [block] = writingLines(backdrop, A4);
    expect(block.x0).toBe(80);
    expect(block.x1).toBe(1024);
    expect(block.baselines[0]).toBe(140);
    expect(block.baselines.at(-1)).toBeLessThan(1200);
    const ys = horizontalYs(draw(backdrop).ops).map((y) => y - 0.5);
    expect(ys).toEqual(block.baselines);
  });

  it("a ruled area with no room has no lines", () => {
    expect(writingLines({ kind: "ruled-wide", margins: { top: 2000 } }, A4)).toEqual([]);
  });
});
