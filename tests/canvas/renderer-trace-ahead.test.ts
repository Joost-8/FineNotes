/**
 * `Renderer.prefetch` traces a page's ink a stroke at a time before it makes
 * the page's first tile. Painting any part of a page asks every stroke on it
 * for its path, so that first tile used to trace the whole page in one frame,
 * whatever the budget (FineNotes#201: 22-58 ms a page of 300 strokes with the
 * CPU slowed 4x, in the frames of a page turn).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { Renderer } from "../../src/canvas/renderer";
import { type InkDocument, type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import { DrawLog, LoggedPath2D } from "./draw-log";

const globals = globalThis as unknown as Record<string, unknown>;
let log: DrawLog;
/** Paths made so far: one for each stroke traced. */
let traced = 0;
/** A clock that moves 1 ms every time it is read. */
let clock = 0;

beforeEach(() => {
  log = new DrawLog();
  traced = 0;
  clock = 0;
  globals.Path2D = class extends LoggedPath2D {
    constructor(init?: string | LoggedPath2D) {
      super(init);
      traced++;
    }
  };
  globals.createEl = () => log.canvas();
  vi.spyOn(performance, "now").mockImplementation(() => (clock += 1));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globals.Path2D;
  delete globals.createEl;
});

const STROKES = 40;

const ROW: DocumentLayout = {
  boxes: [0, 1, 2].map((index) => ({
    index,
    id: `p${index}`,
    x: index * 2000,
    y: 0,
    width: 800,
    height: 600,
  })),
  width: 4800,
  height: 600,
  direction: "horizontal",
  fitWidth: 800,
};

/** Short pen strokes in rows down the page, as lines of writing. */
function writing(page: string): Stroke[] {
  return Array.from({ length: STROKES }, (_, i): Stroke => {
    const x = 40 + (i % 10) * 70;
    const y = 60 + Math.floor(i / 10) * 120;
    return {
      id: `${page}-${i}`,
      color: "#1a1a1a",
      size: 3,
      tool: "pen",
      pts: [x, y, 0.5, x + 20, y + 14, 0.5, x + 40, y, 0.5, x + 55, y + 10, 0.5],
    } as Stroke;
  });
}

/** Page 0 in view and empty; page 1, a screen away, written on. */
function row(): { renderer: Renderer; doc: InkDocument } {
  const doc = emptyDocument(800);
  doc.pages = ROW.boxes.map((box) => ({ ...blankPage(box.id, { width: 800, height: 600 }) }));
  doc.pages[1].strokes = writing("p1");
  const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
  renderer.resize(800, 600, 1);
  renderer.setLayout(ROW);
  renderer.setViewport({ scrollY: 0, scale: 1, width: 800 }, 0);
  renderer.renderDocument(doc, false);
  return { renderer, doc };
}

describe("ink traced ahead of a page's first tile", () => {
  it("stops tracing at the budget, mid-page, and makes no tile of that page yet", () => {
    const { renderer, doc } = row();
    const tiles = renderer.stats().tiles;
    expect(traced).toBe(0);
    expect(renderer.prefetch(doc, false, 10, [1])).toBe(true);
    // About one stroke a ms of this clock: some, and far from all forty.
    expect(traced).toBeGreaterThan(0);
    expect(traced).toBeLessThan(STROKES / 2);
    expect(renderer.stats().tiles).toBe(tiles);
  });

  it("carries on where it stopped, then makes the tiles without tracing any more", () => {
    const { renderer, doc } = row();
    let calls = 0;
    let before = 0;
    // Until the whole page is traced no call traces more than its budget lets it.
    while (traced < STROKES) {
      before = traced;
      expect(renderer.prefetch(doc, false, 10, [1])).toBe(true);
      expect(traced - before).toBeLessThan(STROKES / 2);
      expect(++calls).toBeLessThan(20);
    }
    expect(calls).toBeGreaterThan(2);
    while (renderer.prefetch(doc, false, 10, [1])) expect(++calls).toBeLessThan(200);
    expect(traced).toBe(STROKES);
    // The turn then finds every tile made, and every path.
    const tiles = renderer.stats().tiles;
    renderer.setViewport({ scrollY: 0, scale: 1, width: 800 }, -2000);
    renderer.renderDocument(doc, false);
    expect(renderer.stats().tiles).toBe(tiles);
    expect(traced).toBe(STROKES);
  });

  it("after a stroke is added, looks only at the new one, not at the whole page again", () => {
    const { renderer, doc } = row();
    while (renderer.prefetch(doc, false, 1000, [1]));
    const asked = vi.spyOn(
      renderer as unknown as { pathEntry: (s: Stroke) => unknown },
      "pathEntry",
    );
    // Writing: the page gets a new array, one stroke longer.
    doc.pages[1].strokes = [...doc.pages[1].strokes, writing("new")[0]];
    renderer.prefetch(doc, false, 1000, [1]);
    const traced1 = asked.mock.calls.filter(([s]) => s.id === "new-0").length;
    expect(traced1).toBe(1);
    // The forty already traced were not asked for by the tracing pass.
    expect(asked.mock.calls.filter(([s]) => s.id.startsWith("p1-")).length).toBe(0);
  });

  it("starts over when ink in the middle of the page was replaced", () => {
    const { renderer, doc } = row();
    while (renderer.prefetch(doc, false, 1000, [1]));
    const strokes = [...doc.pages[1].strokes];
    // The eraser cut the last stroke in two: its pieces take its place.
    const [a, b] = writing("piece");
    strokes.splice(strokes.length - 1, 1, a, b);
    doc.pages[1].strokes = strokes;
    renderer.prefetch(doc, false, 1000, [1]);
    expect(traced).toBe(STROKES + 2);
  });

  it("traces a page again only when its ink changed", () => {
    const { renderer, doc } = row();
    while (renderer.prefetch(doc, false, 1000, [1]));
    expect(traced).toBe(STROKES);
    renderer.prefetch(doc, false, 1000, [1]);
    expect(traced).toBe(STROKES);
    doc.pages[1].strokes = [...doc.pages[1].strokes, ...writing("more").slice(0, 3)];
    renderer.prefetch(doc, false, 1000, [1]);
    expect(traced).toBe(STROKES + 3);
  });
});
