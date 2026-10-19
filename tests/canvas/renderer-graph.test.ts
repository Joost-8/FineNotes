/**
 * Graph elements in the renderer: drawn under the ink in thumbnails (and so
 * in the PDF export and the AI's page render, which use them) and on the
 * page's tiles, left out while hidden (Explore, a lasso drag), and sampled
 * once per content and resolution, so a moved graph reuses its curves.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { Renderer, renderPageThumbnail } from "../../src/canvas/renderer";
import { graphStats } from "../../src/canvas/graph-paint";
import { type Page, blankPage, emptyDocument } from "../../src/model/document";
import { makeGraph } from "../../src/model/graph-element";
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
const CURVE = "#c74440";

function page(): Page {
  const pts: number[] = [];
  for (let i = 0; i < 20; i++) pts.push(40 + i * 10, 100, 0.5);
  return {
    ...blankPage("a", { width: 400, height: 400 }),
    strokes: [{ id: "ink", color: INK, size: 3, tool: "pen", pts }],
    graphs: [
      makeGraph({
        id: "f1",
        x: 20,
        y: 40,
        w: 300,
        h: 200,
        spec: { expressions: ["sin(x)"], xMin: -5, xMax: 5, yMin: -2, yMax: 2 },
        colors: [CURVE],
      }),
    ],
  };
}

/** The order of the graph's curve and the ink on `canvas`. */
function order(lines: readonly string[], canvas: string): string[] {
  return lines
    .filter((l) => l.startsWith(`${canvas} `) && l.includes(" stroke"))
    .flatMap((l) => {
      if (l.includes(`strokeStyle=${CURVE}`)) return ["graph"];
      if (l.includes(`strokeStyle=${INK}`)) return ["ink"];
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

describe("a graph on a page", () => {
  it("is drawn under the ink in a thumbnail", () => {
    renderPageThumbnail(log.canvas("thumb"), page(), { paint: () => undefined }, 400, 1, {
      usePressure: false,
    });
    expect(order(log.lines, "thumb")).toEqual(["graph", "ink"]);
  });

  it("is drawn under the ink on the tiles, and left out while hidden", () => {
    const doc = emptyDocument(400);
    doc.pages = [page()];
    const r = renderer();
    r.renderDocument(doc, false);
    const shown = tileOrders().filter((o) => o.includes("graph"));
    expect(shown.length).toBeGreaterThan(0);
    for (const o of shown) if (o.includes("ink")) expect(o).toEqual(["graph", "ink"]);

    log = new DrawLog();
    globals.createEl = () => log.canvas();
    r.setHiddenGraphs(new Set(doc.pages[0].graphs));
    r.invalidateAll();
    r.renderDocument(doc, false);
    expect(tileOrders().some((o) => o.includes("graph"))).toBe(false);
  });

  it("samples once per content and resolution: a moved graph reuses its curves", () => {
    const p = page();
    const before = graphStats.samplings;
    const draw = (): void =>
      renderPageThumbnail(log.canvas(), p, { paint: () => undefined }, 400, 1, {
        usePressure: false,
      });
    draw();
    expect(graphStats.samplings).toBe(before + 1);
    p.graphs![0].x += 30;
    draw();
    expect(graphStats.samplings).toBe(before + 1);
    p.graphs![0].spec.xMax = 6;
    draw();
    expect(graphStats.samplings).toBe(before + 2);
  });
});
