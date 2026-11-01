/**
 * The wet layer drawn again into the Zoom box (`Renderer.paintWetInto`): the
 * stroke in flight is painted into the box's own context, at its own
 * resolution, from the same call that drew the wet layer, instead of a
 * magnified copy of the wet layer's pixels (blurred at 4-5x, empty while the
 * target was off screen). Recording contexts stand in for canvas, as in
 * `renderer-lasso.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Renderer } from "../../src/canvas/renderer";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import type { InkRun } from "../../src/ink/freehand";

type Call = [string, ...unknown[]];

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

function fakeCanvas(log: Call[]): unknown {
  const classes = new Set<string>();
  const ctx = recorder(log);
  return {
    width: 0,
    height: 0,
    style: {},
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
    },
    getContext: () => ctx,
  };
}

class FakePath2D {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
}

const LAYOUT: DocumentLayout = {
  boxes: [
    { index: 0, id: "p1", x: 40, y: 0, width: 800, height: 1000 },
    { index: 1, id: "p2", x: 40, y: 1020, width: 800, height: 1000 },
  ],
  width: 880,
  height: 2020,
  direction: "vertical",
  fitWidth: 880,
};

const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  globals.Path2D = FakePath2D;
  globals.createEl = () => fakeCanvas([]);
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

function setup(): Renderer {
  const renderer = new Renderer(
    fakeCanvas([]) as HTMLCanvasElement,
    fakeCanvas([]) as HTMLCanvasElement,
    fakeCanvas([]) as HTMLCanvasElement,
    false,
  );
  renderer.setLayout(LAYOUT);
  renderer.resize(880, 1000, 1);
  renderer.setViewport({ scrollY: 0, scale: 1, width: 880 }, 0);
  return renderer;
}

const style = { color: "#123456", size: 2, tool: "pen" as const, usePressure: false };
const runs: InkRun[] = [{ width: 2, pts: [10, 10, 60, 40] }];

describe("paintWetInto", () => {
  it("draws the stroke in flight into the box's own context, in page space", () => {
    const renderer = setup();
    renderer.renderWetRuns(0, runs, style);
    const log: Call[] = [];
    const drawn = renderer.paintWetInto(recorder(log), LAYOUT.boxes[0], 4);
    expect(drawn).toBe(true);
    // Its own page: no offset; then the run is stroked there, not copied in.
    expect(log).toContainEqual(["translate", 0, 0]);
    expect(log.some(([name]) => name === "stroke")).toBe(true);
    expect(log.some(([name]) => name === "drawImage")).toBe(false);
  });

  it("places a stroke on another (joined) page by the two pages' layout", () => {
    const renderer = setup();
    renderer.renderWetRuns(1, runs, style);
    const log: Call[] = [];
    renderer.paintWetInto(recorder(log), LAYOUT.boxes[0], 4);
    expect(log).toContainEqual(["translate", 0, 1020]);
  });

  it("dashes a lasso loop for the box's scale, not the page's", () => {
    const renderer = setup();
    renderer.renderLasso(0, [10, 10, 100, 10, 60, 80]);
    const log: Call[] = [];
    renderer.paintWetInto(recorder(log), LAYOUT.boxes[0], 4);
    expect(log).toContainEqual(["setLineDash", [1.5, 1]]);
  });

  it("has nothing to draw once the layer is cleared", () => {
    const renderer = setup();
    renderer.renderWetRuns(0, runs, style);
    renderer.clearWet();
    const log: Call[] = [];
    expect(renderer.paintWetInto(recorder(log), LAYOUT.boxes[0], 4)).toBe(true);
    expect(log).toEqual([]);
  });

  it("leaves a dragged selection to be copied: only its pixels have it", () => {
    const renderer = setup();
    renderer.renderSelectionDraft(0, [], [], 10, 10, false);
    const log: Call[] = [];
    expect(renderer.paintWetInto(recorder(log), LAYOUT.boxes[0], 4)).toBe(false);
    expect(log).toEqual([]);
  });
});
