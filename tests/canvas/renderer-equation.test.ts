/**
 * Typed equations in the renderer (discussion #166): painted into the page's
 * tiles and thumbnails (and so the PDF export, which uses them) under the
 * ink, left out while a lasso drags them, and drawn in a night page's
 * colours.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { Renderer, renderPageThumbnail } from "../../src/canvas/renderer";
import {
  equationFrameSize,
  equationLayout,
  measureEquation,
  paintEquation,
} from "../../src/canvas/equation-paint";
import { nightColor } from "../../src/canvas/night";
import { type Page, blankPage, emptyDocument } from "../../src/model/document";
import { makeEquation } from "../../src/model/equation";
import { DrawLog, LoggedPath2D } from "./draw-log";

const globals = globalThis as unknown as Record<string, unknown>;
let log: DrawLog;

beforeEach(() => {
  log = new DrawLog();
  globals.Path2D = LoggedPath2D;
  globals.createEl = () => log.canvas();
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

const INK = "#1a1a1a";
const MATH = "#2244aa";

function page(): Page {
  const pts: number[] = [];
  for (let i = 0; i < 20; i++) pts.push(40 + i * 10, 100, 0.5);
  return {
    ...blankPage("a", { width: 400, height: 400 }),
    strokes: [{ id: "ink", color: INK, size: 3, tool: "pen", pts }],
    equations: [
      makeEquation({
        id: "q1",
        x: 30,
        y: 70,
        w: 200,
        h: 70,
        tex: "\\frac{a}{b} + \\sqrt{x}",
        color: MATH,
        size: 24,
      }),
    ],
  };
}

/** Which of the equation and the ink `canvas` draws, in order. */
function order(lines: readonly string[], canvas: string): string[] {
  return lines
    .filter((l) => l.startsWith(`${canvas} `))
    .flatMap((l) => {
      if (l.includes("fillText") && l.includes(`fillStyle=${MATH}`)) return ["equation"];
      if (l.includes(" stroke") && l.includes(`strokeStyle=${INK}`)) return ["ink"];
      if (l.includes(" fill ") && l.includes(`fillStyle=${INK}`)) return ["ink"];
      return [];
    })
    .filter((v, i, all) => all.indexOf(v) === i);
}

function renderer(): Renderer {
  const layout: DocumentLayout = {
    boxes: [{ index: 0, id: "a", x: 0, y: 0, width: 400, height: 400 }],
    width: 400,
    height: 400,
    direction: "vertical",
    fitWidth: 400,
  };
  const r = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
  r.resize(400, 400, 1);
  r.setLayout(layout);
  r.setPainter({ paint: () => undefined });
  r.setViewport({ scrollY: 0, scale: 1, width: 400 }, 0);
  return r;
}

function tileOrders(): string[][] {
  const canvases = new Set(log.lines.map((l) => l.split(" ")[0]).filter((n) => /^el\d+$/.test(n)));
  return [...canvases].map((name) => order(log.lines, name));
}

describe("an equation on a page", () => {
  it("is drawn under the ink in a thumbnail (and so in an export)", () => {
    renderPageThumbnail(log.canvas("thumb"), page(), { paint: () => undefined }, 400, 1, {
      usePressure: false,
    });
    expect(order(log.lines, "thumb")).toEqual(["equation", "ink"]);
    const texts = log.lines.filter((l) => l.startsWith("thumb fillText"));
    expect(texts.map((l) => l.split(" ")[2])).toEqual(
      expect.arrayContaining(['"a"', '"b"', '"+"', '"x"']),
    );
  });

  it("is drawn on the tiles, and left out while hidden (a lasso drag)", () => {
    const doc = emptyDocument(400);
    doc.pages = [page()];
    const r = renderer();
    r.renderDocument(doc, false);
    expect(tileOrders().some((o) => o.includes("equation"))).toBe(true);

    log = new DrawLog();
    globals.createEl = () => log.canvas();
    r.setHiddenEquations(new Set(doc.pages[0].equations));
    r.invalidateAll();
    r.renderDocument(doc, false);
    expect(tileOrders().some((o) => o.includes("equation"))).toBe(false);
  });

  it("is drawn on the wet layer while dragged, moved and upright under a turn", () => {
    const doc = emptyDocument(400);
    doc.pages = [page()];
    const r = renderer();
    r.renderDocument(doc, false);
    log.lines.length = 0;
    const e = doc.pages[0].equations!;
    r.renderSelectionDraft(
      0,
      [],
      [],
      10,
      0,
      false,
      undefined,
      { x: 200, y: 200, angle: 0.5 },
      [],
      [],
      true,
      e,
    );
    expect(log.lines.some((l) => l.startsWith("wet fillText"))).toBe(true);
  });

  it("is painted in a night page's colours", () => {
    const ctx = log.canvas("night").getContext("2d")!;
    paintEquation(ctx, page().equations![0], true);
    const text = log.lines.find((l) => l.startsWith("night fillText"));
    expect(text).toContain(`fillStyle=${nightColor(MATH)}`);
  });

  it("is measured into the frame it is drawn in, and fits a frame of another size", () => {
    const ctx = log.canvas("m").getContext("2d")!;
    const frame = measureEquation(ctx, "x^2", 24);
    const natural = equationFrameSize(equationLayout(ctx, "x^2", 24), 24);
    expect(frame.w).toBe(Math.ceil(natural.w));
    expect(frame.h).toBe(Math.ceil(natural.h));
    // Drawn into a frame twice as wide: kept in proportion, so no taller than its own.
    const e = makeEquation({
      id: "q",
      x: 0,
      y: 0,
      w: frame.w * 2,
      h: frame.h,
      tex: "x^2",
      color: MATH,
      size: 24,
    });
    log.lines.length = 0;
    paintEquation(ctx, e);
    expect(log.lines.some((l) => l.includes("fillText"))).toBe(true);
    // Nothing to draw for a source that reads as nothing, or a frame of no size.
    log.lines.length = 0;
    paintEquation(ctx, { ...e, tex: "\\displaystyle" });
    paintEquation(ctx, { ...e, w: 0 });
    expect(log.lines.filter((l) => l.includes("fillText"))).toHaveLength(0);
  });

  it("keeps a bounded cache of layouts", () => {
    const ctx = log.canvas("c").getContext("2d")!;
    const first = equationLayout(ctx, "a", 20);
    expect(equationLayout(ctx, "a", 20)).toBe(first);
    for (let i = 0; i < 300; i++) equationLayout(ctx, `x_${i}`, 20);
    expect(equationLayout(ctx, "a", 20)).not.toBe(first);
  });
});
