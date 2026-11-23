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
import { panTileBytes } from "../../src/canvas/tile-grid";
import { Renderer, overscanLead } from "../../src/canvas/renderer";
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

  it("is painted whole once a scroll passes it, most of its overscan ahead of the scroll", () => {
    const { renderer, doc, dry } = setUp();
    renderer.setViewport({ scrollY: 1060, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    expect(dry.style.transform).not.toBe("");
    const before = renderer.stats().wholePaints;
    renderer.setViewport({ scrollY: 1100, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    expect(dryDraws()[0]).toContain("dry fillRect 0,0 2080,0 2080,1560 0,1560");
    expect(renderer.stats().wholePaints).toBe(before + 1);
    // Three quarters of the 90 px below the view now, a quarter above.
    expect(dry.style.transform).toBe("translate(0px, 67.5px)");
    // 157 px more of the scroll are covered, where the middle gave 90.
    log.lines.length = 0;
    renderer.setViewport({ scrollY: 1257, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    expect(dryDraws()).toHaveLength(0);
    expect(dry.style.transform).toBe("translate(0px, -89.5px)");
    renderer.setViewport({ scrollY: 1259, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    expect(dryDraws().length).toBeGreaterThan(0);
  });

  it("leads a move across too, and the other way when it goes back", () => {
    const { renderer, doc, dry } = setUp();
    // The picture moves 130 px left (a page turn going on): past the 120.
    renderer.setViewport({ scrollY: 1000, scale: 1, width: 800 }, -130);
    renderer.renderDocument(doc, false);
    expect(dry.style.transform).toBe("translate(90px, 0px)");
    renderer.setViewport({ scrollY: 1000, scale: 1, width: 800 }, -130 - 209);
    renderer.renderDocument(doc, false);
    expect(dry.style.transform).toBe("translate(-119px, 0px)");
    // Back to the right, past what was left behind: led to the right now.
    renderer.setViewport({ scrollY: 1000, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    expect(dry.style.transform).toBe("translate(-90px, 0px)");
  });

  it("is painted in the middle when painted whole while the view stays", () => {
    const { renderer, doc, dry } = setUp();
    renderer.setViewport({ scrollY: 1100, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    expect(dry.style.transform).toBe("translate(0px, 67.5px)");
    renderer.invalidateAll();
    renderer.renderDocument(doc, false);
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

describe("where a dry layer painted whole is put", () => {
  it("is shifted against the move by three quarters of the overscan, on whole device px", () => {
    expect(overscanLead(-40, 90, 2)).toBe(67.5);
    expect(overscanLead(40, 90, 2)).toBe(-67.5);
    expect(overscanLead(5, 167, 2)).toBe(-125.5);
  });

  it("stays in the middle when still, or without overscan", () => {
    expect(overscanLead(0, 90, 2)).toBe(0);
    expect(overscanLead(0.2, 90, 2)).toBe(0);
    expect(overscanLead(-40, 0, 2)).toBe(0);
  });
});

describe("pages made whole ahead of a turn", () => {
  const ROW: DocumentLayout = {
    boxes: [0, 1, 2, 3].map((index) => ({
      index,
      id: `p${index}`,
      x: index * 2000,
      y: 0,
      width: 800,
      height: 600,
    })),
    width: 6800,
    height: 600,
    direction: "horizontal",
    fitWidth: 800,
  };

  function row(): { renderer: Renderer; doc: InkDocument } {
    const doc = emptyDocument(800);
    doc.pages = ROW.boxes.map((box) => ({ ...blankPage(box.id, { width: 800, height: 600 }) }));
    const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
    renderer.resize(800, 600, 1);
    renderer.setLayout(ROW);
    renderer.setViewport({ scrollY: 0, scale: 1, width: 800 }, 0);
    renderer.renderDocument(doc, false);
    return { renderer, doc };
  }

  it("makes every tile of the pages named, though they are a screen away", () => {
    const { renderer, doc } = row();
    const shown = renderer.stats().tiles;
    expect(renderer.prefetch(doc, false, 1000)).toBe(false);
    expect(renderer.stats().tiles).toBe(shown);
    expect(renderer.prefetch(doc, false, 1000, [1, 2])).toBe(false);
    expect(renderer.stats().tiles).toBe(3 * shown);
    // The turn itself then makes none.
    renderer.setViewport({ scrollY: 0, scale: 1, width: 800 }, -2000);
    renderer.renderDocument(doc, false);
    expect(renderer.stats().tiles).toBe(3 * shown);
  });

  it("stops at the budget and says there is more", () => {
    const { renderer, doc } = row();
    expect(renderer.prefetch(doc, false, -1, [1])).toBe(true);
  });

  it("makes room from its own document only: another's tiles stay warm (PDF tabs)", () => {
    const { renderer, doc } = row();
    // The notes: one huge page whose tiles fill the budget.
    const notes = emptyDocument(800);
    notes.pages = [{ ...blankPage("n0", { width: 4200, height: 3200 }) }];
    renderer.setLayout({
      boxes: [{ index: 0, id: "n0", x: 0, y: 0, width: 4200, height: 3200 }],
      width: 4200,
      height: 3200,
      direction: "vertical",
      fitWidth: 4200,
    });
    renderer.prefetch(notes, false, 1000, [0]);
    const warm = renderer.stats().tileBytes;
    expect(warm).toBeGreaterThan(40 * 1024 * 1024);
    // Back on the tab: its next page wants room, and gets none of the notes'.
    renderer.setLayout(ROW);
    renderer.prefetch(doc, false, 1000, [1]);
    expect(renderer.stats().tileBytes).toBeGreaterThanOrEqual(warm);
  });

  it("keeps room for more panes' worth of tiles while warm viewports are asked for", () => {
    const { renderer, doc } = row();
    const notes = emptyDocument(800);
    notes.pages = [{ ...blankPage("n0", { width: 4200, height: 12800 }) }];
    renderer.setLayout({
      boxes: [{ index: 0, id: "n0", x: 0, y: 0, width: 4200, height: 12800 }],
      width: 4200,
      height: 12800,
      direction: "vertical",
      fitWidth: 4200,
    });
    renderer.resize(4000, 3000, 1);
    const fill = (): number => {
      renderer.prefetch(notes, false, 1000, [0]);
      return renderer.stats().tileBytes;
    };
    const plain = fill();
    renderer.setWarmViewports(2);
    expect(fill()).toBeGreaterThan(plain);
    renderer.setWarmViewports(0);
    // Back to 2.5 panes of 4000 x 3000 at once.
    expect(renderer.stats().tileBytes).toBeLessThanOrEqual(2.5 * 4000 * 3000 * 4);
    void doc;
  });
  it("keeps every tile a pan can come back to where there is memory for it (#298)", () => {
    const { renderer } = row();
    const notes = emptyDocument(800);
    notes.pages = [{ ...blankPage("n0", { width: 6400, height: 12800 }) }];
    renderer.setLayout({
      boxes: [{ index: 0, id: "n0", x: 0, y: 0, width: 6400, height: 12800 }],
      width: 6400,
      height: 12800,
      direction: "vertical",
      fitWidth: 6400,
    });
    // An Android tablet's screen, overscan on as on every phone and tablet.
    renderer.useOverscan(true);
    renderer.resize(1280, 800, 2.5);
    const screen = 3200 * 2000 * 4;
    const fill = (): number => {
      renderer.prefetch(notes, false, 1000, [0]);
      return renderer.stats().tileBytes;
    };
    expect(fill()).toBeLessThanOrEqual(2.5 * screen);
    renderer.setPanRoom(true);
    const roomy = fill();
    // More than the dry layer alone touches, which 2.5 screens did not hold.
    expect(roomy).toBeGreaterThan(2.5 * screen);
    expect(roomy).toBeLessThanOrEqual(panTileBytes(3200, 2000, 480 + 512, 300 + 512));
    renderer.setPanRoom(false);
    expect(renderer.stats().tileBytes).toBeLessThanOrEqual(2.5 * screen);
  });
});
