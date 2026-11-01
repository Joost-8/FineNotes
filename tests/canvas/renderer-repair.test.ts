/**
 * Painting again only what changed. A changed area of a page is painted
 * again in place on the tiles over it, clipped to the whole px it covers;
 * while the view stays, the dry layer draws only those px again; a sharper
 * PDF raster waits for a frame with the time; and after a zoom settles, the
 * last level's tiles stand in, scaled, for the new ones not made yet.
 *
 * Measured in a harness with Obsidian's pdf.js and the CPU slowed 4x, an
 * eraser pass over a page of 845 strokes took 3.6 s of main-thread time
 * before this and 0.9 s after; a zoom on stacked highlights settled in one
 * frame of half a second, now in frames of under 70 ms.
 *
 * `draw-log.ts` records every draw, and every canvas made.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { type BackdropPainter, Renderer } from "../../src/canvas/renderer";
import { type InkDocument, type Page, blankPage, emptyDocument } from "../../src/model/document";
import { DrawLog, LoggedPath2D } from "./draw-log";

const globals = globalThis as unknown as Record<string, unknown>;
let log: DrawLog;
let made = 0;

beforeEach(() => {
  log = new DrawLog();
  made = 0;
  globals.Path2D = LoggedPath2D;
  globals.createEl = () => {
    made++;
    return log.canvas();
  };
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

const TOP = "#c92a2a";
const LOW = "#1971c2";

function line(y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 40; i++) out.push(40 + i * 20, y + 4 * Math.sin(i / 3), 0.5);
  return out;
}

/** A page of two by two tiles at level 1 (512 px a tile), a stroke near its top and one near its foot. */
function page(): Page {
  return {
    ...blankPage("a", { width: 900, height: 1000 }),
    strokes: [
      { id: "top", color: TOP, size: 3, tool: "pen", pts: line(100) },
      { id: "low", color: LOW, size: 3, tool: "pen", pts: line(900) },
    ],
  };
}

const LAYOUT: DocumentLayout = {
  boxes: [{ index: 0, id: "a", x: 0, y: 0, width: 900, height: 1000 }],
  width: 900,
  height: 1000,
  direction: "vertical",
  fitWidth: 900,
};

function setUp(): { renderer: Renderer; doc: InkDocument } {
  const doc = emptyDocument(900);
  doc.pages = [page()];
  const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
  renderer.resize(900, 1000, 1);
  renderer.setLayout(LAYOUT);
  renderer.setViewport({ scrollY: 0, scale: 1, width: 900 }, 0);
  renderer.renderDocument(doc, false);
  log.lines.length = 0;
  made = 0;
  return { renderer, doc };
}

/** The lines a canvas got, by its name in the log. */
function linesOf(name: string): string[] {
  return log.lines.filter((l) => l.startsWith(`${name} `));
}

describe("a changed area is painted again in place", () => {
  it("on the tile over it alone, clipped to its px, and no canvas is made", () => {
    const { renderer, doc } = setUp();
    renderer.invalidateRegion(0, { minX: 100, minY: 90, maxX: 140, maxY: 110 });
    renderer.renderDocument(doc, false);
    expect(made).toBe(0);
    const drawn = log.lines.join("\n");
    // Only the top stroke reaches into the area; the one 800 px below does not.
    expect(drawn).toContain(`fillStyle=${TOP}`);
    expect(drawn).not.toContain(`fillStyle=${LOW}`);
    // The area padded by the widest ink (24 page px), whole px, then cleared.
    expect(drawn).toContain("clip nonzero [R(76,66 164,66 164,134 76,134)]");
    expect(drawn).toContain("clearRect 76,66 164,66 164,134 76,134");
  });

  it("a tall cover tape, even once erased, widens the area by half its height", () => {
    const { renderer, doc } = setUp();
    const tape = {
      id: "t",
      color: "#e6d3a3",
      size: 72,
      tool: "tape" as const,
      pts: [100, 100, 0.5, 300, 100, 0.5],
    };
    doc.pages[0].strokes.push(tape);
    renderer.invalidateRegion(0, { minX: 100, minY: 100, maxX: 300, maxY: 100 });
    renderer.renderDocument(doc, false);
    // Erased: no longer on the page when its tiles are repaired.
    doc.pages[0].strokes.pop();
    log.lines.length = 0;
    renderer.invalidateRegion(0, { minX: 100, minY: 100, maxX: 300, maxY: 100 });
    renderer.renderDocument(doc, false);
    // 36 px either side of the tape's line, and 2 for its edge: not INK_PAD's 24.
    expect(log.lines.join("\n")).toContain("clearRect 62,62 338,62 338,138 62,138");
  });

  it("an exact area is painted as given, with nothing round it", () => {
    const { renderer, doc } = setUp();
    renderer.invalidateArea(0, { minX: 100, minY: 90, maxX: 140, maxY: 110 });
    renderer.renderDocument(doc, false);
    expect(log.lines.join("\n")).toContain("clearRect 100,90 140,90 140,110 100,110");
  });

  it("on the dry layer only there, while the view stays", () => {
    const { renderer, doc } = setUp();
    renderer.invalidateArea(0, { minX: 100, minY: 90, maxX: 140, maxY: 110 });
    renderer.renderDocument(doc, false);
    const dry = linesOf("dry");
    // One px round it, for the page's soft edge.
    expect(dry[0]).toBe("dry clip nonzero [R(99,89 141,89 141,111 99,111)]");
    // The tile over it is drawn again; the one below it is not.
    expect(dry.filter((l) => l.includes("drawImage el") && !l.includes("el1["))).toHaveLength(1);
  });

  it("and nothing at all when nothing changed", () => {
    const { renderer, doc } = setUp();
    expect(renderer.renderDocument(doc, false)).toBe(true);
    expect(linesOf("dry")).toHaveLength(0);
  });

  it("a moved view paints the whole dry layer", () => {
    const { renderer, doc } = setUp();
    renderer.invalidateArea(0, { minX: 100, minY: 90, maxX: 140, maxY: 110 });
    renderer.setViewport({ scrollY: 40, scale: 1, width: 900 }, 0);
    renderer.renderDocument(doc, false);
    const dry = linesOf("dry");
    expect(dry.some((l) => l.startsWith("dry clip"))).toBe(false);
    expect(dry[0]).toContain("dry fillRect 0,0 900,0 900,1000 0,1000");
  });
});

describe("a sharper backdrop is painted when a frame has the time", () => {
  it("shown as it is past the budget, and the frame says it is not done", () => {
    const { renderer, doc } = setUp();
    renderer.refreshPage(0);
    expect(renderer.renderDocument(doc, false, undefined, null, undefined, -1)).toBe(false);
    expect(log.lines.some((l) => l.includes("clearRect"))).toBe(false);
    // The next paint with time for it paints the page again, in place.
    log.lines.length = 0;
    expect(renderer.renderDocument(doc, false)).toBe(true);
    expect(made).toBe(0);
    // The page's four tiles (two by two at level 1), each cleared and painted.
    expect(log.lines.filter((l) => l.includes(" clearRect "))).toHaveLength(4);
  });
});

describe("after a zoom settles", () => {
  it("the last level's tiles stand in, scaled, until the new ones are made", () => {
    const { renderer, doc } = setUp();
    renderer.setViewport({ scrollY: 0, scale: 1.5, width: 900 }, 0);
    renderer.settle();
    // No time for any new tile: the old ones are drawn in their place.
    expect(renderer.renderDocument(doc, false, undefined, null, undefined, -1)).toBe(false);
    const standIns = linesOf("dry").filter(
      (l) => /drawImage el\d+\[/.test(l) && !l.includes("el1["),
    );
    expect(standIns.length).toBeGreaterThan(0);
    expect(made).toBe(0);
    // With the time, the new level is made, and the old tiles are let go.
    log.lines.length = 0;
    expect(renderer.renderDocument(doc, false)).toBe(true);
    expect(made).toBeGreaterThan(0);
    expect(log.lines.some((l) => /^el\d+\.width = 0$/.test(l))).toBe(true);
    expect(renderer.stats().level).toBe(1.5);
  });

  it("a stand-in over a changed area goes: it would show what changed", () => {
    const { renderer } = setUp();
    renderer.setViewport({ scrollY: 0, scale: 1.5, width: 900 }, 0);
    renderer.settle();
    const tiles = renderer.stats().tiles;
    renderer.invalidateRegion(0, { minX: 100, minY: 90, maxX: 140, maxY: 110 });
    expect(renderer.stats().tiles).toBe(tiles - 1);
  });
});

describe("a PDF raster that lands", () => {
  it("paints again what it covers and two px round it, no ink's reach", () => {
    const { renderer, doc } = setUp();
    const painter: BackdropPainter = { paint: () => undefined };
    renderer.setPainter(painter);
    renderer.renderDocument(doc, false);
    log.lines.length = 0;
    renderer.invalidateBackdrop(0, { minX: 200, minY: 200, maxX: 300, maxY: 300 });
    renderer.renderDocument(doc, false);
    expect(log.lines.join("\n")).toContain("clearRect 198,198 302,198 302,302 198,302");
  });
});
