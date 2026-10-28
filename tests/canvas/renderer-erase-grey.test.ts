/**
 * The eraser's grey preview in the renderer ("Grey out while erasing",
 * discussion #51): strokes, or cut pieces, passed as `greyed` are painted in
 * `ERASING_GREY` in the tiles, shown through `nightColor` on dark pages, and
 * re-use the outlines already traced, so greying a stroke costs one
 * re-rasterised tile and no tracing. Hidden strokes are still left out.
 *
 * `draw-log.ts` records every draw with the style it was made in.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DARK_PAPER } from "../../src/canvas/backdrop";
import { ERASING_GREY } from "../../src/canvas/erase-look";
import { nightColor } from "../../src/canvas/night";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { Renderer } from "../../src/canvas/renderer";
import { type InkDocument, type Page, blankPage, emptyDocument } from "../../src/model/document";
import { DrawLog, LoggedPath2D } from "./draw-log";

const globals = globalThis as unknown as Record<string, unknown>;
let log: DrawLog;
let paths = 0;

beforeEach(() => {
  log = new DrawLog();
  paths = 0;
  globals.Path2D = class extends LoggedPath2D {
    constructor() {
      super();
      paths++;
    }
  };
  globals.createEl = () => log.canvas();
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

const INK = "#1a1a1a";
const RED = "#e03131";

function line(y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 30; i++) out.push(60 + i * 10, y + 4 * Math.sin(i / 3), 0.5);
  return out;
}

function page(): Page {
  return {
    ...blankPage("a", { width: 400, height: 500 }),
    strokes: [
      { id: "ink", color: INK, size: 3, tool: "pen", pts: line(100) },
      { id: "red", color: RED, size: 3, tool: "pen", pts: line(200) },
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

/** Repaint every tile, as the surface does after invalidating the erased strokes. */
function repaint(renderer: Renderer, doc: InkDocument, greyed?: ReadonlySet<string>): string {
  renderer.invalidateAll();
  log.lines.length = 0;
  renderer.renderDocument(doc, false, undefined, null, undefined, Infinity, false, greyed);
  return log.lines.join("\n");
}

describe("strokes the whole-stroke eraser holds", () => {
  it("are painted grey; the rest keep their colours", () => {
    const { renderer, doc } = setUp();
    const drawn = repaint(renderer, doc, new Set(["red"]));
    expect(drawn).toContain(`fillStyle=${ERASING_GREY}`);
    expect(drawn).toContain(`fillStyle=${INK}`);
    expect(drawn).not.toContain(`fillStyle=${RED}`);
  });

  it("show their grey through nightColor on dark pages", () => {
    const { renderer, doc } = setUp();
    renderer.paper = DARK_PAPER;
    const drawn = repaint(renderer, doc, new Set(["red"]));
    expect(drawn).toContain(`fillStyle=${nightColor(ERASING_GREY)}`);
    expect(drawn).not.toContain(`fillStyle=${ERASING_GREY}`);
  });

  it("re-use the outlines already traced: greying traces nothing", () => {
    const { renderer, doc } = setUp();
    renderer.renderDocument(doc, false);
    const traced = paths;
    expect(traced).toBeGreaterThan(0);
    repaint(renderer, doc, new Set(["ink", "red"]));
    expect(paths).toBe(traced);
  });

  it("include a cut stroke's piece listed as greyed: the By line eraser's cut stretch", () => {
    const { renderer, doc } = setUp();
    const red = doc.pages[0].strokes[1];
    const stretch = { ...red, id: "red~erasing0", pts: red.pts.slice(0, 30) };
    const survivor = { ...red, id: "red-piece", pts: red.pts.slice(27) };
    renderer.invalidateAll();
    log.lines.length = 0;
    renderer.renderDocument(
      doc,
      false,
      undefined,
      null,
      new Map([["red", [stretch, survivor]]]),
      Infinity,
      false,
      new Set(["red~erasing0"]),
    );
    const drawn = log.lines.join("\n");
    expect(drawn).toContain(`fillStyle=${ERASING_GREY}`);
    expect(drawn).toContain(`fillStyle=${RED}`);
  });

  it("leave the document as it was, and hidden strokes stay hidden", () => {
    const { renderer, doc } = setUp();
    const before = JSON.stringify(doc);
    renderer.invalidateAll();
    log.lines.length = 0;
    renderer.renderDocument(doc, false, new Set(["red"]), null, undefined, Infinity, false);
    const drawn = log.lines.join("\n");
    expect(drawn).not.toContain(`fillStyle=${RED}`);
    expect(drawn).not.toContain(`fillStyle=${ERASING_GREY}`);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
