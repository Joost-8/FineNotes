/**
 * `renderPageThumbnail` with a `crop`: a board's drawing or a named region
 * painted alone into a note's embed (discussion #167). The canvas is the
 * cut's size, the page is moved so the cut's corner is the canvas' corner,
 * and the paper is asked for the cut's part only, in page px, so the
 * ruling lies where it lies on the page.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BackdropPainter, renderPageThumbnail } from "../../src/canvas/renderer";
import { type Bounds, type Page, blankPage } from "../../src/model/document";
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

function page(): Page {
  return {
    ...blankPage("a", { width: 4000, height: 3000 }),
    strokes: [
      { id: "s", color: "#123456", size: 3, tool: "pen", pts: [1100, 1200, 0.5, 1300, 1250, 0.5] },
    ],
  };
}

/** A paper painter that remembers the region it was asked to cover. */
function painter(): BackdropPainter & { regions: Array<Bounds | undefined> } {
  const regions: Array<Bounds | undefined> = [];
  return {
    regions,
    paint: (_ctx, _backdrop, _geometry, _weight, target) => {
      regions.push(target?.region);
    },
  };
}

describe("a cropped thumbnail", () => {
  it("is the cut's size, at the width asked for", () => {
    const canvas = log.canvas("c");
    renderPageThumbnail(canvas, page(), painter(), 400, 2, {
      usePressure: false,
      crop: { x: 1000, y: 1100, width: 800, height: 400 },
    });
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(400);
  });

  it("moves the page so the cut's corner is the canvas' corner", () => {
    const canvas = log.canvas("c");
    renderPageThumbnail(canvas, page(), painter(), 400, 1, {
      usePressure: false,
      crop: { x: 1000, y: 1100, width: 800, height: 400 },
    });
    const lines = log.lines.join("\n");
    // Half a CSS px per page px: the cut's corner (1000, 1100) lands at (0, 0)…
    expect(lines).toContain("stroke path2d");
    expect(lines).toMatch(/stroke path2d#\w+ at 0\.5,0,0,0\.5,-500,-550/);
    // …and the clip is the canvas, not the page.
    expect(lines).toContain("clip nonzero [R(0,0 400,0 400,200 0,200)]");
  });

  it("asks the paper for the cut alone, in page px", () => {
    const paper = painter();
    renderPageThumbnail(log.canvas("c"), page(), paper, 400, 1, {
      usePressure: false,
      crop: { x: 1000, y: 1100, width: 800, height: 400 },
    });
    expect(paper.regions).toEqual([{ minX: 1000, minY: 1100, maxX: 1800, maxY: 1500 }]);
  });

  it("paints the whole page as before without one", () => {
    const canvas = log.canvas("c");
    const paper = painter();
    renderPageThumbnail(canvas, page(), paper, 400, 1, { usePressure: false });
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(paper.regions).toEqual([undefined]);
  });
});
