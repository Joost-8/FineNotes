/**
 * The renderer's lasso work (0.5): the loop on the wet layer, a dragged
 * selection drawn there moved, and dragged strokes left out of the tiles.
 * Recording contexts stand in for canvas; `Path2D` and Obsidian's global
 * `createEl` are stubbed, which is all the renderer needs under Node.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ImagePainter, Renderer } from "../../src/canvas/renderer";
import {
  type ImageElement,
  type InkDocument,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import type { DocumentLayout } from "../../src/canvas/page-layout";

type Call = [string, ...unknown[]];

/** A 2D context that records every method call, in order. */
function recorder(log: Call[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {};
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => void log.push([String(prop), ...args]);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  classes: Set<string>;
  classList: { add: (c: string) => void; remove: (c: string) => void };
  getContext: () => CanvasRenderingContext2D;
}

function fakeCanvas(log: Call[]): FakeCanvas {
  const classes = new Set<string>();
  const ctx = recorder(log);
  return {
    width: 0,
    height: 0,
    style: {},
    classes,
    classList: { add: (c) => void classes.add(c), remove: (c) => void classes.delete(c) },
    getContext: () => ctx,
  };
}

/** Every fill of a stroke outline, as the stub `Path2D` records its SVG path. */
class FakePath2D {
  constructor(readonly d: string) {}
}

const LAYOUT: DocumentLayout = {
  boxes: [{ index: 0, id: "p1", x: 0, y: 0, width: 800, height: 1000 }],
  width: 800,
  height: 1000,
  direction: "vertical",
  fitWidth: 800,
};

function stroke(id: string, x: number): Stroke {
  return { id, color: "#123456", size: 2, tool: "pen", pts: [x, 10, 0.5, x + 50, 60, 0.5] };
}

let tileLog: Call[] = [];
const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  tileLog = [];
  globals.Path2D = FakePath2D;
  globals.createEl = () => fakeCanvas(tileLog);
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

function setup(): { renderer: Renderer; wet: FakeCanvas; wetLog: Call[] } {
  const wetLog: Call[] = [];
  const wet = fakeCanvas(wetLog);
  const renderer = new Renderer(
    fakeCanvas([]) as unknown as HTMLCanvasElement,
    fakeCanvas([]) as unknown as HTMLCanvasElement,
    wet as unknown as HTMLCanvasElement,
    false,
  );
  renderer.setLayout(LAYOUT);
  renderer.resize(800, 1000, 1);
  renderer.setViewport({ scrollY: 0, scale: 1, width: 800 }, 0);
  return { renderer, wet, wetLog };
}

describe("renderLasso", () => {
  it("draws the loop closed, filled even–odd, dashed, and shows the wet layer", () => {
    const { renderer, wet, wetLog } = setup();
    expect(wet.classes.has("goodobsidian-wet-hidden")).toBe(true);
    renderer.renderLasso(0, [10, 10, 100, 10, 60, 80]);
    const names = wetLog.map(([name]) => name);
    expect(names).toContain("closePath");
    expect(wetLog.filter(([name]) => name === "lineTo")).toEqual([
      ["lineTo", 100, 10],
      ["lineTo", 60, 80],
    ]);
    expect(wetLog.find(([name]) => name === "fill")).toEqual(["fill", "evenodd"]);
    expect(names).toContain("setLineDash");
    expect(names.indexOf("stroke")).toBeGreaterThan(names.indexOf("fill"));
    expect(wet.classes.has("goodobsidian-wet-hidden")).toBe(false);
  });

  it("draws nothing for a loop of one point, or an unknown page", () => {
    const { renderer, wetLog } = setup();
    renderer.renderLasso(0, [10, 10]);
    renderer.renderLasso(5, [10, 10, 100, 10, 60, 80]);
    expect(wetLog.some(([name]) => name === "stroke")).toBe(false);
  });
});

describe("renderSelectionDraft", () => {
  it("draws images, then ink over them, moved by the drag", () => {
    const { renderer, wetLog } = setup();
    const painted: string[] = [];
    const painter: ImagePainter = { paintImage: (_c, image) => void painted.push(image.id) };
    renderer.setImagePainter(painter);
    const image: ImageElement = { id: "i1", path: "a.png", x: 0, y: 0, w: 10, h: 10 };
    renderer.renderSelectionDraft(0, [stroke("s1", 0), stroke("s2", 100)], [image], 30, -5, true);
    const names = wetLog.map(([name]) => name);
    // The drag's offset is applied once the page is entered, before anything is drawn.
    const moves = wetLog.filter(([name]) => name === "translate");
    expect(moves).toContainEqual(["translate", 30, -5]);
    expect(painted).toEqual(["i1"]);
    expect(names.filter((name) => name === "fill")).toHaveLength(2);
    const offset = wetLog.findIndex(([name, x]) => name === "translate" && x === 30);
    // drawPlacedImage moves to the picture's centre, (5, 5), to paint it.
    const picture = wetLog.findIndex(([name, x]) => name === "translate" && x === 5);
    expect(offset).toBeLessThan(picture);
    expect(picture).toBeLessThan(names.indexOf("fill"));
  });
});

describe("renderImageCropDraft", () => {
  it("draws the whole picture, then veils what the crop leaves out", () => {
    const { renderer, wet, wetLog } = setup();
    const painted: ImageElement[] = [];
    renderer.setImagePainter({ paintImage: (_c, image) => void painted.push(image) });
    const picture: ImageElement = { id: "i1", path: "a.png", x: 100, y: 50, w: 200, h: 100 };
    renderer.renderImageCropDraft(0, picture, { x: 0.25, y: 0, w: 0.5, h: 1 });
    // The painter gets the uncropped picture: no crop of its own.
    expect(painted).toEqual([picture]);
    const rects = wetLog.filter(([name]) => name === "rect").slice(-2);
    expect(rects).toEqual([
      ["rect", 0, 0, 200, 100],
      ["rect", 50, 0, 100, 100],
    ]);
    expect(wetLog.at(-2)).toEqual(["fill", "evenodd"]);
    expect(wet.classes.has("goodobsidian-wet-hidden")).toBe(false);
  });

  it("draws nothing without a painter, an unknown page or an empty picture", () => {
    const { renderer, wetLog } = setup();
    const picture: ImageElement = { id: "i1", path: "a.png", x: 0, y: 0, w: 10, h: 10 };
    renderer.renderImageCropDraft(0, picture, { x: 0, y: 0, w: 1, h: 1 });
    renderer.setImagePainter({ paintImage: () => undefined });
    renderer.renderImageCropDraft(3, picture, { x: 0, y: 0, w: 1, h: 1 });
    renderer.renderImageCropDraft(0, { ...picture, w: 0 }, { x: 0, y: 0, w: 1, h: 1 });
    expect(wetLog.some(([name]) => name === "fill")).toBe(false);
  });
});

describe("hidden strokes", () => {
  function doc(strokes: Stroke[]): InkDocument {
    const d = emptyDocument(800);
    d.pages = [{ ...blankPage("p1", { width: 800, height: 1000 }), strokes }];
    return d;
  }

  const fills = (): number => tileLog.filter(([name]) => name === "fill").length;

  it("leaves dragged strokes out of the tiles until they are shown again", () => {
    const { renderer } = setup();
    const d = doc([stroke("s1", 10), stroke("s2", 200)]);
    renderer.renderDocument(d, false);
    expect(fills()).toBe(2);

    tileLog.length = 0;
    renderer.setHiddenStrokes(new Set(["s1"]));
    renderer.invalidateAll();
    renderer.renderDocument(d, false);
    expect(fills()).toBe(1);

    tileLog.length = 0;
    renderer.setHiddenStrokes(new Set());
    renderer.invalidateAll();
    renderer.renderDocument(d, false);
    expect(fills()).toBe(2);
  });
});
