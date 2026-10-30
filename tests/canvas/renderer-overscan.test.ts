/**
 * The dry layer with overscan (`Renderer.useOverscan`): it reaches past the
 * view on every side, and a scroll it still covers moves the canvas (a CSS
 * transform) instead of painting it again. Past the overscan, or after a
 * change of scale, it is painted whole for the view now; mid-zoom only the
 * part in view is painted. Damage meanwhile is painted where the canvas
 * shows it, in the view it was painted in.
 *
 * Measured with GPU compositing and the CPU slowed 4x (perf harness), a
 * scroll at the fit spent half the time painting the dry layer it did.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { Renderer } from "../../src/canvas/renderer";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
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

const LAYOUT: DocumentLayout = {
  boxes: [{ index: 0, id: "a", x: 0, y: 0, width: 800, height: 3000 }],
  width: 800,
  height: 3000,
  direction: "vertical",
  fitWidth: 800,
};

/** An 800 x 600 view at dpr 2 on a long page: overscan 120 CSS px a side (15% of 800, of 600 90). */
function setUp(): { renderer: Renderer; doc: InkDocument; dry: HTMLCanvasElement } {
  const doc = emptyDocument(800);
  doc.pages = [{ ...blankPage("a", { width: 800, height: 3000 }) }];
  const dry = log.canvas("dry");
  const renderer = new Renderer(log.canvas("bd"), dry, log.canvas("wet"), false);
  renderer.useOverscan(true);
  renderer.resize(800, 600, 2);
  renderer.setLayout(LAYOUT);
  renderer.setViewport({ scrollY: 1000, scale: 1, width: 800 }, 0);
  renderer.renderDocument(doc, false);
  log.lines.length = 0;
  return { renderer, doc, dry };
}

const dryDraws = (): string[] => log.lines.filter((l) => l.startsWith("dry "));

describe("the dry layer with overscan", () => {
  it("is larger than the view by its overscan, and placed above and left of it", () => {
    const { dry, renderer } = setUp();
    // 120 and 90 CSS px a side, at dpr 2.
    expect(dry.width).toBe(1600 + 480);
    expect(dry.height).toBe(1200 + 360);
    expect(dry.style.left).toBe("-120px");
    expect(dry.style.top).toBe("-90px");
    expect(renderer.dryOrigin()).toEqual({ x: -240, y: -180 });
  });

  it("follows a scroll it still covers by a transform, painting nothing", () => {
    const { renderer, doc, dry } = setUp();
    renderer.setViewport({ scrollY: 1060, scale: 1, width: 800 }, 0);
    expect(renderer.renderDocument(doc, false)).toBe(true);
    expect(dryDraws()).toHaveLength(0);
    expect(dry.style.transform).toBe("translate(0px, -60px)");
    expect(renderer.dryOrigin()).toEqual({ x: -240, y: -300 });
  });

  it("is painted whole for the view now once a scroll passes it, and put back", () => {
    const { renderer, doc, dry } = setUp();
    renderer.setViewport({ scrollY: 1060, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    expect(dry.style.transform).not.toBe("");
    renderer.setViewport({ scrollY: 1100, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    expect(dryDraws()[0]).toContain("dry fillRect 0,0 2080,0 2080,1560 0,1560");
    expect(dry.style.transform).toBe("");
  });

  it("paints damage where the canvas shows it, in the view it was painted in", () => {
    const { renderer, doc } = setUp();
    renderer.setViewport({ scrollY: 1060, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    log.lines.length = 0;
    // Page px 1200..1210 lies 200 px below the painted view's top (1000),
    // plus the 90 px of overscan: 290 CSS px into the canvas, 580 device
    // px at dpr 2; x 100 lies 220 in. One px round it for the soft edge.
    renderer.invalidateArea(0, { minX: 100, minY: 1200, maxX: 110, maxY: 1210 });
    renderer.renderDocument(doc, false);
    expect(dryDraws()[0]).toBe("dry clip nonzero [R(439,579 461,579 461,601 439,601)]");
  });

  it("is painted only in view mid-zoom, and whole after", () => {
    const { renderer, doc } = setUp();
    renderer.setViewport({ scrollY: 1000, scale: 1.2, width: 800 }, 0);
    expect(renderer.isTransient).toBe(true);
    renderer.renderDocument(doc, false);
    expect(dryDraws()[0]).toBe("dry clip nonzero [R(240,180 1840,180 1840,1380 240,1380)]");
    log.lines.length = 0;
    renderer.settle();
    renderer.renderDocument(doc, false);
    expect(dryDraws().some((l) => l.startsWith("dry clip"))).toBe(false);
  });

  it("stays as it was without overscan: the view's size, never moved", () => {
    const dry = log.canvas("plain");
    const renderer = new Renderer(log.canvas("pb"), dry, log.canvas("pw"), false);
    renderer.resize(800, 600, 2);
    expect(dry.width).toBe(1600);
    expect(renderer.dryOrigin()).toEqual({ x: 0, y: 0 });
    expect(log.lines.some((l) => l.includes("plain.style.transform"))).toBe(false);
  });
});
