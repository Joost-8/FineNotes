/**
 * Styled shapes in the renderer (`src/canvas/renderer.ts`): a fill under the
 * outline, a dashed or dotted outline, rounded corners and arrowheads — and
 * the same outlines painted on the page's tiles as in its thumbnail, which is
 * what PDF export and the AI page render use too.
 *
 * `draw-log.ts` records every draw with its path and style.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import {
  type BackdropPainter,
  Renderer,
  decorOf,
  renderPageThumbnail,
  styleOf,
} from "../../src/canvas/renderer";
import { type Page, type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import { createHash } from "node:crypto";
import { DrawLog, LoggedPath2D } from "./draw-log";

const globals = globalThis as unknown as Record<string, unknown>;
let log: DrawLog;
/** Every path made, so a test can read the points behind a draw. */
let made: LoggedPath2D[];

beforeEach(() => {
  log = new DrawLog();
  made = [];
  globals.Path2D = class extends LoggedPath2D {
    constructor(init?: string | LoggedPath2D) {
      super(init);
      made.push(this);
    }
  };
  globals.createEl = () => log.canvas();
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

const flat = (points: Array<[number, number]>): number[] => points.flatMap(([x, y]) => [x, y, 0.5]);

const card: Stroke = {
  id: "card",
  color: "#e03131",
  size: 2,
  tool: "pen",
  shape: "rect",
  fill: "#e031314d",
  dash: "dash",
  radius: 12,
  pts: flat([
    [40, 40],
    [240, 40],
    [240, 140],
    [40, 140],
    [40, 40],
  ]),
};

const pointer: Stroke = {
  id: "pointer",
  color: "#1971c2",
  size: 2,
  tool: "pen",
  shape: "line",
  heads: { start: "filled", end: "open" },
  pts: flat([
    [40, 300],
    [340, 300],
  ]),
};

function page(strokes: Stroke[]): Page {
  return { ...blankPage("a", { width: 400, height: 500 }), strokes };
}

const backdrop: BackdropPainter = { paint: () => undefined };

/** The name the log gives a path: as `draw-log.ts` hashes it. */
function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** The path a logged draw used, by the hash the log names it with; "" for an inline path. */
function hashOf(line: string): string {
  return /path2d#(\w+)/.exec(line)?.[1] ?? "";
}

/** The fills and strokes drawn, as `fill|stroke <path>`, in page space. */
function draws(lines: readonly string[], prefix: string): string[] {
  return lines
    .filter((l) => l.startsWith(`${prefix} fill`) || l.startsWith(`${prefix} stroke`))
    .map((l) => l.slice(prefix.length + 1));
}

describe("a styled shape", () => {
  it("is drawn as plain ink when it has no style", () => {
    expect(decorOf({ shape: "rect" })).toBeNull();
    expect(decorOf({})).toBeNull();
    // A fill a line cannot have, corners an ellipse cannot have: nothing.
    expect(decorOf({ shape: "line", fill: "#ff0000" })).toBeNull();
    expect(decorOf({ shape: "ellipse", radius: 8 })).toBeNull();
    expect(decorOf({ shape: "rect", radius: 0 })).toBeNull();
    expect(styleOf(card, false).decor).toEqual({
      kind: "rect",
      fill: "#e031314d",
      dash: "dash",
      radius: 12,
    });
  });

  it("fills under its rounded, dashed outline in its fill's colour and alpha", () => {
    renderPageThumbnail(log.canvas("thumb"), page([card]), backdrop, 400, 1, {
      usePressure: false,
    });
    const lines = log.lines.filter(
      (l) => l.startsWith("thumb fill") || l.startsWith("thumb stroke"),
    );
    const fill = lines.findIndex(
      (l) => l.includes("fillStyle=#e03131") && l.includes("globalAlpha"),
    );
    const outline = lines.findIndex((l) => l.startsWith("thumb stroke") && l.includes("lineDash"));
    expect(fill).toBeGreaterThanOrEqual(0);
    expect(outline).toBeGreaterThan(fill);
    expect(lines[fill]).toMatch(/globalAlpha=0\.30/);
    // The corners are arcs, and the path filled is the path stroked.
    const rounded = made.filter((path) => path.d.includes(" A "));
    expect(rounded).toHaveLength(1);
    expect(rounded[0].d.match(/ A /g)).toHaveLength(4);
    expect(hashOf(lines[fill])).toBe(hashOf(lines[outline]));
  });

  it("draws a filled head as a filled triangle, an open one as a V, the line between", () => {
    renderPageThumbnail(log.canvas("thumb"), page([pointer]), backdrop, 400, 1, {
      usePressure: false,
    });
    const lines = draws(log.lines, "thumb");
    const triangles = made.filter((path) => /^M \S+ \S+ L \S+ \S+ L \S+ \S+ Z$/.test(path.d));
    const vees = made.filter((path) => /^M \S+ \S+ L 340 300 L \S+ \S+$/.test(path.d));
    expect(triangles).toHaveLength(1);
    expect(vees).toHaveLength(1);
    // The triangle is filled and outlined; the V only outlined.
    const filled = lines.filter((l) => l.startsWith("fill")).map(hashOf);
    expect(filled).toContain(hash(triangles[0].d));
    expect(filled).not.toContain(hash(vees[0].d));
    // The shaft stops at the filled head's base, short of its point at x 40.
    const shaft = made.find((path) => /^M \S+ 300 L 340 300$/.test(path.d));
    expect(shaft?.d.startsWith("M 40 ")).toBe(false);
  });

  it("paints the same outlines on the page's tiles as in its thumbnail", () => {
    const doc = emptyDocument(400);
    doc.pages = [page([card, pointer])];
    const layout: DocumentLayout = {
      boxes: [{ index: 0, id: "a", x: 0, y: 0, width: 400, height: 500 }],
      width: 400,
      height: 500,
      direction: "vertical",
      fitWidth: 400,
    };
    const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
    renderer.resize(400, 500, 1);
    renderer.setLayout(layout);
    renderer.setPainter(backdrop);
    renderer.setViewport({ scrollY: 0, scale: 1, width: 400 }, 0);
    renderer.renderDocument(doc, false);
    const paths = (lines: readonly string[]): string[] =>
      [...new Set(lines.map(hashOf).filter((h) => h !== ""))].sort();
    const tiles = paths(
      log.lines.filter((l) => / (fill|stroke) /.test(l) && !l.startsWith("thumb")),
    );
    log.lines.length = 0;
    renderPageThumbnail(log.canvas("thumb"), doc.pages[0], backdrop, 400, 1, {
      usePressure: false,
    });
    const thumb = paths(log.lines.filter((l) => l.startsWith("thumb ")));
    expect(thumb.length).toBeGreaterThan(0);
    expect(tiles).toEqual(thumb);
  });
});
