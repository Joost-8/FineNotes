/**
 * A golden record of what the renderer draws through one scripted session:
 * a two-page notebook painted, prefetched, written on, lassoed, zoomed,
 * settled, re-themed and resized, then a horizontal row of pages, and page
 * thumbnails. `draw-log.ts` turns every draw into a line of device-space
 * geometry plus the style it was drawn with, so the golden pins the picture,
 * not the order the code happened to set its state in.
 *
 * Written before the renderer's viewport plumbing was rewritten (2026-09-25),
 * to prove the rewrite paints the same pixels. An intended change to the
 * renderer's output shows up here as a diff; review it, then refresh the file
 * with `npx vitest run tests/canvas/renderer-golden.test.ts -u`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DARK_PAPER } from "../../src/canvas/backdrop";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import {
  type BackdropPainter,
  type ImagePainter,
  Renderer,
  renderPageThumbnail,
  styleOf,
} from "../../src/canvas/renderer";
import {
  type ImageElement,
  type InkDocument,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import squiggles from "../ink/fixtures/real-handwriting-squiggles.json";
import { DrawLog, LoggedPath2D, num } from "./draw-log";

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

/** Move a real stroke's points so it starts at (x, y). */
function placed(pts: readonly number[], x: number, y: number): number[] {
  const out = [...pts];
  const dx = x - pts[0];
  const dy = y - pts[1];
  for (let i = 0; i + 2 < out.length; i += 3) {
    out[i] += dx;
    out[i + 1] += dy;
  }
  return out;
}

/** A wavy line whose pressure swells and fades, like a real pen. */
function wave(x: number, y: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(x + i * 4, y + 12 * Math.sin(i / 5), 0.2 + 0.6 * Math.sin((Math.PI * i) / n));
  }
  return out;
}

function stroke(id: string, pts: number[], extra: Partial<Stroke> = {}): Stroke {
  return { id, color: "#1a1a1a", size: 3, tool: "pen", pts, ...extra };
}

const RECT = [300, 600, 0.5, 520, 600, 0.5, 520, 720, 0.5, 300, 720, 0.5, 300, 600, 0.5];

function notebook(): InkDocument {
  const doc = emptyDocument(800);
  const first: Page = {
    ...blankPage("p1", { width: 800, height: 1000 }),
    backdrop: { kind: "ruled-narrow" },
    strokes: [
      stroke("s1", placed(squiggles.strokes[0].pts, 60, 80)),
      stroke("s2", placed(squiggles.strokes[2].pts, 200, 140), { color: "#c0392b", size: 2 }),
      stroke("s3", wave(80, 400, 90), { size: 5 }),
      stroke("s4", [100, 520, 0.5, 700, 540, 0.5], {
        tool: "highlighter",
        color: "#ffd400",
        size: 12,
      }),
      stroke("s5", RECT, { shape: "rect", color: "#2563eb" }),
      stroke("s6", [640, 820, 0.4]),
      stroke("hidden", wave(100, 900, 20)),
      stroke("cut", wave(420, 300, 40)),
    ],
    images: [{ id: "i1", path: "a.png", x: 500, y: 150, w: 200, h: 120, rotation: 0.3 }],
    textBoxes: [
      {
        id: "t1",
        x: 60,
        y: 700,
        w: 220,
        text: "Hello there, page",
        color: "#333333",
        fontSize: 18,
      },
    ],
  };
  const second: Page = {
    ...blankPage("p2", { width: 800, height: 1000 }),
    backdrop: { kind: "squared", paperColor: "#fdf6e3" },
    strokes: [
      stroke("s7", placed(squiggles.strokes[4].pts, 120, 90), { size: 4 }),
      stroke("s8", wave(150, 500, 60), { tool: "highlighter", color: "#7dd3fc", size: 10 }),
    ],
  };
  doc.pages = [first, second];
  return doc;
}

const VERTICAL: DocumentLayout = {
  boxes: [
    { index: 0, id: "p1", x: 0, y: 0, width: 800, height: 1000 },
    { index: 1, id: "p2", x: 0, y: 1040, width: 800, height: 1000 },
  ],
  width: 800,
  height: 2040,
  direction: "vertical",
  fitWidth: 800,
};

const HORIZONTAL: DocumentLayout = {
  boxes: [
    { index: 0, id: "p1", x: 0, y: 0, width: 800, height: 1000 },
    { index: 1, id: "p2", x: 840, y: 0, width: 800, height: 1000 },
  ],
  width: 1640,
  height: 1000,
  direction: "horizontal",
  fitWidth: 800,
};

function backdropPainter(): BackdropPainter {
  return {
    paint: (ctx, backdrop, geometry, weight) =>
      log.write(
        `${log.nameOf(ctx)} painter ${backdrop.kind} ${geometry.width}x${geometry.height} ` +
          `weight=${num(weight ?? 1)} at ${log.matrixOf(ctx)}`,
      ),
  };
}

function imagePainter(): ImagePainter {
  return {
    paintImage: (ctx, image, deviceScale) =>
      log.write(
        `${log.nameOf(ctx)} image ${image.id} ${image.w}x${image.h} ` +
          `scale=${num(deviceScale)} at ${log.matrixOf(ctx)}`,
      ),
  };
}

function session(): string {
  const step = (name: string): void => log.write(`# ${name}`);
  const doc = notebook();
  const [p1] = doc.pages;
  const image = p1.images[0] as ImageElement;

  step("construct");
  const renderer = new Renderer(log.canvas("backdrop"), log.canvas("dry"), log.canvas("wet"), true);

  step("resize and view");
  renderer.resize(390, 700, 2);
  renderer.setLayout(VERTICAL);
  renderer.setPainter(backdropPainter());
  renderer.setImagePainter(imagePainter());
  renderer.setViewport({ scrollY: 120, scale: 0.45, width: 800 }, 12);
  log.write(`deviceScale=${num(renderer.deviceScale)} transient=${renderer.isTransient}`);

  step("backdrops");
  renderer.renderBackdrops(doc);

  step("document with hidden, selection and eraser preview");
  const pieces = [stroke("cut-a", wave(420, 300, 12)), stroke("cut-b", wave(520, 300, 14))];
  const complete = renderer.renderDocument(
    doc,
    true,
    new Set(["hidden"]),
    { pageIndex: 0, bounds: { minX: 280, minY: 580, maxX: 540, maxY: 740 } },
    new Map([["cut", pieces]]),
  );
  log.write(`complete=${complete} stats=${JSON.stringify(renderer.stats())}`);

  step("prefetch");
  log.write(`more=${renderer.prefetch(doc, true, 1e9)} stats=${JSON.stringify(renderer.stats())}`);

  step("commit a stroke");
  const fresh = stroke("s9", wave(90, 250, 50), { color: "#16a34a" });
  p1.strokes.push(fresh);
  renderer.appendCommittedStroke(0, fresh, true);
  renderer.renderDocument(doc, true);

  step("wet strokes");
  renderer.renderWet(0, wave(60, 200, 30), styleOf(fresh, true));
  renderer.renderWet(0, [100, 610, 0.5, 400, 615, 0.5], styleOf(p1.strokes[3], true));
  renderer.renderWet(0, RECT, styleOf(p1.strokes[4], true));
  renderer.renderWet(0, wave(60, 200, 30), styleOf(fresh, false));
  renderer.renderWet(0, [5, 5], styleOf(fresh, true));
  renderer.renderWetMany(1, [wave(100, 100, 10), [100, 300, 0.5, 400, 300, 0.5]], {
    color: "#000000",
    size: 2,
    tool: "pen",
    usePressure: false,
    shape: true,
  });
  renderer.renderWet(7, wave(60, 200, 30), styleOf(fresh, true));

  step("lasso, drafts and clear");
  renderer.renderLasso(0, [100, 100, 300, 120, 260, 300, 120, 280]);
  renderer.renderLasso(0, [100, 100]);
  renderer.renderSelectionDraft(0, [p1.strokes[0], p1.strokes[4]], [image], 30, -5, true);
  renderer.setHiddenStrokes(new Set(["s1"]));
  renderer.setHiddenImages(new Set([image]));
  renderer.invalidateRegion(0, { minX: 40, minY: 60, maxX: 720, maxY: 300 });
  renderer.renderDocument(doc, true);
  renderer.setHiddenStrokes(new Set());
  renderer.setHiddenImages(new Set());
  renderer.renderImageDraft(0, { ...image, x: 520, y: 160 });
  renderer.renderImageCropDraft(0, image, { x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
  renderer.clearWet();
  renderer.invalidateRegion(0, { minX: 40, minY: 60, maxX: 720, maxY: 300 });
  renderer.renderDocument(doc, true);

  step("pinch in flight, then settle");
  renderer.setViewport({ scrollY: 300, scale: 0.9, width: 800 }, -40);
  log.write(`transient=${renderer.isTransient} level=${renderer.tileLevel}`);
  renderer.renderBackdrops(doc);
  log.write(`complete=${renderer.renderDocument(doc, false)}`);
  renderer.settle();
  log.write(`transient=${renderer.isTransient} level=${renderer.tileLevel}`);
  renderer.renderDocument(doc, false);
  renderer.setViewport({ scrollY: 900, scale: 0.9, width: 800 }, -40);
  renderer.renderBackdrops(doc);
  renderer.renderDocument(doc, false);

  step("dark paper and a lighter highlighter");
  renderer.paper = DARK_PAPER;
  renderer.highlighterAlpha = 0.25;
  renderer.invalidatePage("p2");
  renderer.invalidateAll();
  renderer.renderBackdrops(doc);
  renderer.renderDocument(doc, true);
  renderer.renderWet(1, wave(150, 520, 20), styleOf(doc.pages[1].strokes[1], true));

  step("resize");
  renderer.resize(500, 300, 1);
  renderer.setViewport({ scrollY: 1000, scale: 0.6, width: 800 }, 0);
  renderer.renderBackdrops(doc);
  renderer.renderDocument(doc, true, undefined, null, undefined, Infinity);
  renderer.clearWet();

  step("pages side by side");
  renderer.setLayout(HORIZONTAL);
  renderer.setViewport({ scrollY: 100, scale: 0.5, width: 1640 }, -300);
  renderer.invalidateAll();
  renderer.renderBackdrops(doc);
  renderer.renderDocument(doc, true);
  renderer.renderSelectionDraft(1, doc.pages[1].strokes, [], 0, 0, false);

  step("destroy");
  renderer.destroy();

  step("thumbnails");
  renderPageThumbnail(log.canvas("thumb1"), p1, backdropPainter(), 120, 2, {
    usePressure: true,
    images: imagePainter(),
  });
  renderPageThumbnail(log.canvas("thumb2"), doc.pages[1], backdropPainter(), 90, 3, {
    usePressure: false,
    highlighterAlpha: 0.3,
    paper: DARK_PAPER,
  });

  return `${log.lines.join("\n")}\n`;
}

describe("the renderer, drawn call by call", () => {
  it("paints the scripted session exactly as the golden record says", async () => {
    await expect(session()).toMatchFileSnapshot("./golden/renderer-session.txt");
  });

  it("asks for a desynchronized context on the wet layer only, and hides it until used", () => {
    session();
    const contexts = log.lines.filter((line) => line.includes(".getContext"));
    expect(contexts.slice(0, 3)).toEqual([
      'backdrop.getContext 2d {"desynchronized":false}',
      'dry.getContext 2d {"desynchronized":false}',
      'wet.getContext 2d {"desynchronized":true}',
    ]);
    const firstDraw = log.lines.findIndex((line) => /^wet (fill|stroke|clearRect)/.test(line));
    const hidden = log.lines.indexOf("wet.classList + goodobsidian-wet-hidden");
    expect(hidden).toBeGreaterThanOrEqual(0);
    expect(hidden).toBeLessThan(firstDraw);
  });
});
