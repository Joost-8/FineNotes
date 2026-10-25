/**
 * An endless board's stand-in preview (FineNotes#46): it covers a window of
 * the page (the drawing and a screen around it), cut to the page, at up to
 * 2048 px, where a notebook page's preview is the whole page at 1024.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { Renderer } from "../../src/canvas/renderer";
import { blankPage, emptyDocument } from "../../src/model/document";
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

const SIDE = 5600;

function setup(): { renderer: Renderer; doc: ReturnType<typeof emptyDocument> } {
  const doc = emptyDocument(SIDE);
  doc.pages = [blankPage("p1", { width: SIDE, height: SIDE })];
  const layout: DocumentLayout = {
    boxes: [{ index: 0, id: "p1", x: 0, y: 0, width: SIDE, height: SIDE }],
    width: SIDE,
    height: SIDE,
    direction: "vertical",
    fitWidth: SIDE,
  };
  const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
  renderer.resize(800, 600, 1);
  renderer.setLayout(layout);
  renderer.setPainter({ paint: () => undefined });
  renderer.setViewport({ scrollY: 2500, scale: 1, width: SIDE }, -2500);
  // Tiles settle at scale 1; then a zoom out leaves them stale, so the
  // frame draws the preview.
  renderer.renderDocument(doc, false);
  renderer.setViewport({ scrollY: 2000, scale: 0.5, width: SIDE }, -1000);
  return { renderer, doc };
}

describe("a windowed preview", () => {
  it("covers the window, cut to the page", () => {
    const { renderer, doc } = setup();
    renderer.setPreviewWindow(() => ({ minX: -500, minY: 1000, maxX: 4000, maxY: 3000 }));
    expect(renderer.isTransient).toBe(true);
    renderer.renderDocument(doc, false);
    expect(renderer.previewArea("p1")).toEqual({ minX: 0, minY: 1000, maxX: 4000, maxY: 3000 });
  });

  it("is the whole page without a window, and dropped on demand", () => {
    const { renderer, doc } = setup();
    renderer.renderDocument(doc, false);
    expect(renderer.previewArea("p1")).toEqual({ minX: 0, minY: 0, maxX: SIDE, maxY: SIDE });
    renderer.dropPreview("p1");
    expect(renderer.previewArea("p1")).toBeNull();
    expect(renderer.previewArea("nope")).toBeNull();
  });

  it("falls back to the whole page for a window off the page", () => {
    const { renderer, doc } = setup();
    renderer.setPreviewWindow(() => ({ minX: 9000, minY: 9000, maxX: 9500, maxY: 9500 }));
    renderer.renderDocument(doc, false);
    expect(renderer.previewArea("p1")).toEqual({ minX: 0, minY: 0, maxX: SIDE, maxY: SIDE });
  });

  it("takes a committed stroke at its place in the window", () => {
    const { renderer, doc } = setup();
    renderer.setPreviewWindow(() => ({ minX: 1000, minY: 1000, maxX: 3000, maxY: 3000 }));
    renderer.renderDocument(doc, false);
    const stroke = {
      id: "s",
      color: "#000",
      size: 3,
      tool: "pen" as const,
      pts: [1500, 1500, 0.5, 1600, 1600, 0.5],
    };
    doc.pages[0].strokes.push(stroke);
    const before = log.lines.length;
    renderer.appendCommittedStroke(0, stroke, false);
    // Drawn into the preview moved by the window's corner: page (1000, 1000) is its origin.
    const drawn = log.lines.slice(before).filter((l) => l.includes(" stroke path2d"));
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toContain("at 1,0,0,1,-1000,-1000");
  });
});
