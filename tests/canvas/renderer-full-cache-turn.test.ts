/**
 * `Renderer.prefetch` with the tile cache full. A long notebook fills the
 * cache within a dozen pages, and from then on it stays within one tile of
 * its budget. A tile just beside the view that was missing and did not fit
 * ended the prefetch before the pages a turn goes to were looked at, though
 * that pass is the one that makes room (FineNotes#201: on a 43-page notebook
 * with the cache at its 48 MB, slow turns made 16-27 tiles mid-turn where a
 * fresh cache made none).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
  delete globals.Path2D;
  delete globals.createEl;
});

const PAGES = 40;
/** Pages 20 px apart, as a row lays them: a neighbour's edge is beside the view. */
const STEP = 820;

const ROW: DocumentLayout = {
  boxes: Array.from({ length: PAGES }, (_, index) => ({
    index,
    id: `p${index}`,
    x: index * STEP,
    y: 0,
    width: 800,
    height: 600,
  })),
  width: PAGES * STEP,
  height: 600,
  direction: "horizontal",
  fitWidth: 800,
};

interface Spied {
  rasterTile: (...args: unknown[]) => unknown;
}

/** A 40-page row, read from page 0 to `upTo`: the cache is full of the pages behind. */
function readTo(upTo: number): { renderer: Renderer; doc: InkDocument; show: (i: number) => void } {
  const doc = emptyDocument(800);
  doc.pages = ROW.boxes.map((box) => ({ ...blankPage(box.id, { width: 800, height: 600 }) }));
  const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
  renderer.resize(800, 600, 1);
  renderer.setLayout(ROW);
  const show = (index: number): void => {
    renderer.setViewport({ scrollY: 0, scale: 1, width: 800 }, -index * STEP);
    renderer.renderDocument(doc, false);
  };
  for (let index = 0; index <= upTo; index++) show(index);
  return { renderer, doc, show };
}

/** One tile of an 800 x 600 page at most: 512 x 512 px. */
const TILE = 512 * 512 * 4;

describe("pages made whole ahead of a turn, with the tile cache full", () => {
  it("fills the cache by reading on: nothing more fits", () => {
    const { renderer } = readTo(30);
    const { tileBytes } = renderer.stats();
    expect(tileBytes).toBeGreaterThan(48 * 1024 * 1024 - TILE);
  });

  it("still makes the next pages whole, from the room of pages far behind", () => {
    const { renderer, doc, show } = readTo(30);
    while (renderer.prefetch(doc, false, 1000, [31, 29, 32]));
    // The turn itself then makes no tile.
    const made = vi.spyOn(renderer as unknown as Spied, "rasterTile");
    show(31);
    expect(made).not.toHaveBeenCalled();
  });

  it("keeps the page in view and its neighbours when it makes that room", () => {
    const { renderer, doc, show } = readTo(30);
    while (renderer.prefetch(doc, false, 1000, [31, 29, 32]));
    const made = vi.spyOn(renderer as unknown as Spied, "rasterTile");
    show(30);
    show(29);
    expect(made).not.toHaveBeenCalled();
  });

  it("takes no more room than those pages need: the pages just read stay, for turning back", () => {
    const { renderer, doc, show } = readTo(30);
    const before = renderer.stats().tileBytes;
    while (renderer.prefetch(doc, false, 1000, [31, 29, 32]));
    // Two pages were made; the cache is as full as it was, not emptied of far pages.
    expect(renderer.stats().tileBytes).toBeGreaterThan(before - 2 * TILE);
    const made = vi.spyOn(renderer as unknown as Spied, "rasterTile");
    for (const back of [29, 28, 27, 26, 25]) show(back);
    expect(made).not.toHaveBeenCalled();
  });

  it("without pages to turn to, a full cache is left as it is", () => {
    const { renderer, doc } = readTo(30);
    const before = renderer.stats();
    expect(renderer.prefetch(doc, false, 1000)).toBe(false);
    expect(renderer.stats().tiles).toBe(before.tiles);
    expect(renderer.stats().tileBytes).toBe(before.tileBytes);
  });
});
