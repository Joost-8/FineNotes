/**
 * The renderer's lasso work (0.5): the loop on the wet layer, a dragged
 * selection drawn there moved, and dragged strokes left out of the tiles.
 * Recording contexts stand in for canvas; `Path2D` and Obsidian's global
 * `createEl` are stubbed, which is all the renderer needs under Node.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ImagePainter, Renderer, drawPlacedImage } from "../../src/canvas/renderer";
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

/** The stub `Path2D`: it records the polyline a stroke's run traces into it. */
class FakePath2D {
  d = "";
  moveTo(x: number, y: number): void {
    this.d += `M ${x} ${y} `;
  }
  lineTo(x: number, y: number): void {
    this.d += `L ${x} ${y} `;
  }
  closePath(): void {
    this.d += "Z ";
  }
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
  it("draws the loop closed and dashed, its line only, and shows the wet layer", () => {
    const { renderer, wet, wetLog } = setup();
    expect(wet.classes.has("goodobsidian-wet-hidden")).toBe(true);
    renderer.renderLasso(0, [10, 10, 100, 10, 60, 80]);
    const names = wetLog.map(([name]) => name);
    expect(names).toContain("closePath");
    expect(wetLog.filter(([name]) => name === "lineTo")).toEqual([
      ["lineTo", 100, 10],
      ["lineTo", 60, 80],
    ]);
    // No filled area inside the loop while it is drawn (Joost on PR #59).
    expect(names).not.toContain("fill");
    expect(names).toContain("setLineDash");
    expect(names).toContain("stroke");
    expect(wet.classes.has("goodobsidian-wet-hidden")).toBe(false);
  });

  it("leaves a freehand lasso open while the pen is down, as Goodnotes does", () => {
    const { renderer, wetLog } = setup();
    renderer.renderLasso(0, [10, 10, 100, 10, 60, 80], false);
    const names = wetLog.map(([name]) => name);
    expect(names).not.toContain("closePath");
    expect(names).toContain("stroke");
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
    // Ink is stroked: one line per stroke (one width each, pressure or not).
    expect(names.filter((name) => name === "stroke")).toHaveLength(2);
    const offset = wetLog.findIndex(([name, x]) => name === "translate" && x === 30);
    // drawPlacedImage moves to the picture's centre, (5, 5), to paint it.
    const picture = wetLog.findIndex(([name, x]) => name === "translate" && x === 5);
    expect(offset).toBeLessThan(picture);
    expect(picture).toBeLessThan(names.indexOf("stroke"));
  });
});

describe("renderSelectionDraft while resizing", () => {
  it("scales about the anchor after the move, before anything is drawn", () => {
    const { renderer, wetLog } = setup();
    renderer.renderSelectionDraft(0, [stroke("s1", 0)], [], 0, 0, true, { x: 40, y: 60, k: 2 });
    const names = wetLog.map(([name]) => name);
    const scale = names.indexOf("scale");
    expect(wetLog[scale]).toEqual(["scale", 2, 2]);
    expect(wetLog[scale - 1]).toEqual(["translate", 40, 60]);
    expect(wetLog[scale + 1]).toEqual(["translate", -40, -60]);
    expect(scale).toBeLessThan(names.indexOf("stroke"));
  });

  it("ignores a scale that is not a finite positive number", () => {
    const { renderer, wetLog } = setup();
    renderer.renderSelectionDraft(0, [stroke("s1", 0)], [], 0, 0, true, { x: 0, y: 0, k: 0 });
    renderer.renderSelectionDraft(0, [stroke("s1", 0)], [], 0, 0, true, {
      x: 0,
      y: 0,
      k: Number.NaN,
    });
    expect(wetLog.some(([name]) => name === "scale")).toBe(false);
  });

  it("traces a stroke again when only its width changed", () => {
    const { renderer } = setup();
    const s = stroke("s1", 0);
    renderer.renderSelectionDraft(0, [s], [], 0, 0, false);
    // A closed loop scaled about its own seam keeps both end points: only the width says so.
    const paths = new Set<unknown>();
    const capture = (): void => {
      const draft = renderer as unknown as { paths: WeakMap<Stroke, { paths: unknown[] }> };
      paths.add(draft.paths.get(s)?.paths[0]);
    };
    capture();
    s.size = 4;
    renderer.renderSelectionDraft(0, [s], [], 0, 0, false);
    capture();
    expect(paths.size).toBe(2);
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

  // Ink is stroked, a line per stroke here (each is one width).
  const fills = (): number => tileLog.filter(([name]) => name === "stroke").length;

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

describe("renderSelectionDraft while turning", () => {
  it("turns about the centre after the move, before anything is drawn", () => {
    const { renderer, wetLog } = setup();
    const turn = { x: 40, y: 60, angle: 0.5 };
    renderer.renderSelectionDraft(0, [stroke("s1", 0)], [], 0, 0, true, undefined, turn);
    const names = wetLog.map(([name]) => name);
    const rotate = names.indexOf("rotate");
    expect(wetLog[rotate]).toEqual(["rotate", 0.5]);
    expect(wetLog[rotate - 1]).toEqual(["translate", 40, 60]);
    expect(wetLog[rotate + 1]).toEqual(["translate", -40, -60]);
    expect(rotate).toBeLessThan(names.indexOf("stroke"));
  });

  it("does not turn by nothing, or by a non-finite angle", () => {
    const { renderer, wetLog } = setup();
    for (const angle of [0, Number.NaN]) {
      renderer.renderSelectionDraft(0, [stroke("s1", 0)], [], 0, 0, true, undefined, {
        x: 0,
        y: 0,
        angle,
      });
    }
    expect(wetLog.some(([name]) => name === "rotate")).toBe(false);
  });

  it("traces a stroke again when a command gave it new points with the same ends", () => {
    const { renderer } = setup();
    // A figure eight started and ended in its middle: a turn about that
    // middle keeps both ends, the count and the width.
    const s: Stroke = {
      id: "s8",
      color: "#000000",
      size: 2,
      tool: "pen",
      pts: [50, 50, 0.5, 70, 40, 0.5, 50, 50, 0.5, 30, 60, 0.5, 50, 50, 0.5],
    };
    const traced = (): unknown => {
      const draft = renderer as unknown as { paths: WeakMap<Stroke, { paths: unknown[] }> };
      return draft.paths.get(s)?.paths[0];
    };
    renderer.renderSelectionDraft(0, [s], [], 0, 0, false);
    const first = traced();
    renderer.renderSelectionDraft(0, [s], [], 0, 0, false);
    expect(traced()).toBe(first);
    s.pts = [50, 50, 0.5, 30, 60, 0.5, 50, 50, 0.5, 70, 40, 0.5, 50, 50, 0.5];
    renderer.renderSelectionDraft(0, [s], [], 0, 0, false);
    expect(traced()).not.toBe(first);
  });
});

describe("drawPlacedImage with a flipped picture", () => {
  it("mirrors in the picture's own frame, after turning, before the painter draws", () => {
    const log: Call[] = [];
    const ctx = recorder(log);
    const painted: ImageElement[] = [];
    const image: ImageElement = {
      id: "i1",
      path: "a.png",
      x: 10,
      y: 20,
      w: 40,
      h: 30,
      rotation: 0.25,
      flipX: true,
    };
    drawPlacedImage(ctx, image, { paintImage: (_c, i) => void painted.push(i) }, 1);
    expect(log.slice(0, 5)).toEqual([
      ["save"],
      ["translate", 30, 35],
      ["rotate", 0.25],
      ["scale", -1, 1],
      ["translate", -20, -15],
    ]);
    expect(painted).toEqual([image]);
    const flippedY: ImageElement = { ...image, rotation: undefined, flipX: undefined, flipY: true };
    log.length = 0;
    drawPlacedImage(ctx, flippedY, { paintImage: () => undefined }, 1);
    expect(log.find(([name]) => name === "scale")).toEqual(["scale", 1, -1]);
    expect(log.some(([name]) => name === "rotate")).toBe(false);
  });

  it("does not mirror an unflipped picture", () => {
    const log: Call[] = [];
    const image: ImageElement = { id: "i1", path: "a.png", x: 0, y: 0, w: 4, h: 4 };
    drawPlacedImage(recorder(log), image, { paintImage: () => undefined }, 1);
    expect(log.some(([name]) => name === "scale")).toBe(false);
  });
});
