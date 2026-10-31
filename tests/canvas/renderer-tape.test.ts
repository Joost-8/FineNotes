/**
 * Cover tape in the renderer (`model/cover-tape`, `canvas/tape-paint`): a
 * tape is painted over all the ink whatever its place in the list, as a
 * dashed wash while the view shows it through, and always covered in a
 * thumbnail (the sidebar, PDF export and the AI's page image).
 *
 * `draw-log.ts` records every draw with the style it was made in.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { Renderer, renderPageThumbnail } from "../../src/canvas/renderer";
import { paintTape, tornOutline } from "../../src/canvas/tape-paint";
import { nightColor } from "../../src/canvas/night";
import { tapeCorners } from "../../src/model/cover-tape";
import { type InkDocument, type Page, blankPage, emptyDocument } from "../../src/model/document";
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
const TAPE = "#f2c14e";

function page(): Page {
  return {
    ...blankPage("a", { width: 400, height: 500 }),
    strokes: [
      // The tape first: laid before the ink, it still goes over it.
      { id: "tape", color: TAPE, size: 40, tool: "tape", pts: [50, 100, 0.5, 350, 100, 0.5] },
      { id: "ink", color: INK, size: 3, tool: "pen", pts: [60, 100, 0.5, 300, 104, 0.5] },
    ],
  };
}

const LAYOUT: DocumentLayout = {
  boxes: [{ index: 0, id: "a", x: 0, y: 0, width: 400, height: 500 }],
  width: 400,
  height: 500,
  direction: "vertical",
  fitWidth: 400,
};

function setUp(): { renderer: Renderer; doc: InkDocument } {
  const doc = emptyDocument(400);
  doc.pages = [page()];
  const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
  renderer.resize(400, 500, 1);
  renderer.setLayout(LAYOUT);
  renderer.setViewport({ scrollY: 0, scale: 1, width: 400 }, 0);
  return { renderer, doc };
}

function repaint(renderer: Renderer, doc: InkDocument): string[] {
  renderer.invalidateAll();
  log.lines.length = 0;
  renderer.renderDocument(doc, false);
  return [...log.lines];
}

/** The index of the first line drawn in `color`. */
function firstIn(lines: readonly string[], color: string): number {
  return lines.findIndex((line) => line.includes(`fillStyle=${color}`));
}

describe("a cover tape in the tiles", () => {
  it("is painted over the ink, though it was laid first", () => {
    const { renderer, doc } = setUp();
    const lines = repaint(renderer, doc);
    const ink = firstIn(lines, INK);
    const tape = firstIn(lines, TAPE);
    expect(ink).toBeGreaterThanOrEqual(0);
    expect(tape).toBeGreaterThan(ink);
  });

  it("is a dashed wash while the view shows it through, and covered again after", () => {
    const { renderer, doc } = setUp();
    renderer.setRevealedTapes(new Set(["tape"]));
    const shown = repaint(renderer, doc).join("\n");
    expect(shown).toContain("lineDash=");
    renderer.setRevealedTapes(new Set());
    const covered = repaint(renderer, doc).join("\n");
    expect(covered).not.toContain("lineDash=");
    expect(covered).toContain(`fillStyle=${TAPE}`);
  });

  it("goes with its owner when it is a mirror over a join", () => {
    const { renderer, doc } = setUp();
    doc.pages[0].strokes[0] = { ...doc.pages[0].strokes[0], id: "x@a", join: "b/tape" };
    renderer.setRevealedTapes(new Set(["tape"]));
    expect(repaint(renderer, doc).join("\n")).toContain("lineDash=");
  });
});

describe("a cover tape in a thumbnail", () => {
  it("is covered, over the ink, whatever the view shows", () => {
    const canvas = log.canvas("thumb");
    log.lines.length = 0;
    renderPageThumbnail(canvas, page(), { paint: () => undefined }, 200, 1, {
      usePressure: false,
    });
    const lines = log.lines;
    expect(firstIn(lines, TAPE)).toBeGreaterThan(firstIn(lines, INK));
    expect(lines.join("\n")).not.toContain("lineDash=");
  });
});

describe("paintTape", () => {
  it("draws nothing for a tape with no points or no height", () => {
    const ctx = log.canvas("c").getContext("2d") as CanvasRenderingContext2D;
    log.lines.length = 0;
    paintTape(ctx, [], 20, TAPE);
    paintTape(ctx, [0, 0, 0.5, 10, 0, 0.5], 0, TAPE);
    expect(log.lines.filter((line) => line.includes("fill"))).toEqual([]);
  });

  it("shows its colour as the night shows ink on a dark page", () => {
    const ctx = log.canvas("c").getContext("2d") as CanvasRenderingContext2D;
    log.lines.length = 0;
    paintTape(ctx, [0, 0, 0.5, 100, 0, 0.5], 20, TAPE, { night: true });
    expect(log.lines.join("\n")).toContain(`fillStyle=${nightColor(TAPE)}`);
  });

  it("tears its two ends and keeps its long edges straight", () => {
    const corners = tapeCorners([0, 0, 0.5, 100, 0, 0.5], 40) ?? [];
    const outline = tornOutline(corners, 40);
    // Both long edges run from corner to corner.
    expect(outline[0]).toEqual(corners[0]);
    expect(outline[1]).toEqual(corners[1]);
    // Every torn point lies on or just inside an end.
    for (const p of outline) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(20 + 1e-9);
    }
    expect(outline.length).toBeGreaterThan(10);
  });
});
