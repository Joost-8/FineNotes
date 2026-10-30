/**
 * The surface's Fill wiring (`fillAt`, `scribbleFill`): what ink bounds a
 * fill, where the fill goes, that a second tap recolours, that undo takes
 * it back, and when a scribble fills instead of staying ink. No DOM: the
 * surface is built from its prototype with only the state these read.
 */

import { describe, expect, it, vi } from "vitest";
import { History } from "../../src/model/history";
import { type InkDocument, type Stroke, blankPage } from "../../src/model/document";
import { isBucketFill } from "../../src/model/fill-region";
import { IdSequence } from "../../src/view/id-sequence";
import { StrokeIndex } from "../../src/view/stroke-index";

const notices: string[] = [];
vi.mock("obsidian", () => ({
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
  Platform: {},
  setIcon: () => {},
}));

const { InkSurface } = await import("../../src/view/ink-surface");

type State = Record<string, unknown>;

function run<T = unknown>(surface: State, method: string, ...args: unknown[]): T {
  const fn = (InkSurface.prototype as unknown as Record<string, (...a: unknown[]) => T>)[method];
  return fn.apply(surface, args);
}

const pen = (id: string, xy: number[], size = 2, tool: Stroke["tool"] = "pen"): Stroke => {
  const pts: number[] = [];
  for (let i = 0; i < xy.length; i += 2) pts.push(xy[i], xy[i + 1], 0.5);
  return { id, color: "#000000", size, tool, pts };
};

const box = (x: number, y: number, s: number): number[] => [
  x,
  y,
  x + s,
  y,
  x + s,
  y + s,
  x,
  y + s,
  x,
  y,
];

function setup(strokes: Stroke[], tool = "fill") {
  const page = blankPage("p1", { width: 400, height: 300 });
  page.strokes = strokes;
  const doc = { pages: [page] } as unknown as InkDocument;
  const history = new History();
  const strokeIndex = new StrokeIndex();
  const changed: string[][] = [];
  const surface: State = Object.assign(Object.create(InkSurface.prototype) as object, {
    doc,
    history,
    strokeIndex,
    strokeIds: new IdSequence("s"),
    toolState: {
      tool,
      color: "#cc0000",
      size: 2,
      pressureEnabled: false,
      penGestures: { scribbleErase: true, scribbleErasesAll: false, circleLasso: true },
    },
    practice: null,
    debug: false,
    renderer: { invalidateRegion: () => undefined },
    pageAt: () => page,
    inkChanged: (ids: string[]) => changed.push(ids),
    atFitZoom: (x: number) => x,
    currentStyle: () => ({ color: "#0000cc", size: 2, tool: "pen" }),
  });
  const pageBox = { index: 0, x: 0, y: 0, width: 400, height: 300 };
  return { surface, page, doc, history, pageBox, changed };
}

describe("the Fill tool", () => {
  it("fills inside an outline, behind its ink, as one undo step", () => {
    const outline = pen("a", box(100, 100, 100));
    const { surface, page, doc, history, pageBox } = setup([outline]);
    expect(run(surface, "fillAt", pageBox, 150, 150, "#CC0000", false)).toBe(true);
    expect(page.strokes).toHaveLength(2);
    expect(isBucketFill(page.strokes[0])).toBe(true);
    expect(page.strokes[0].color).toBe("#cc0000");
    expect(page.strokes[1]).toBe(outline);
    history.undo(doc);
    expect(page.strokes).toEqual([outline]);
  });

  it("recolours a fill tapped again rather than stacking another", () => {
    const { surface, page, pageBox } = setup([pen("a", box(100, 100, 100))]);
    run(surface, "fillAt", pageBox, 150, 150, "#cc0000", false);
    run(surface, "fillAt", pageBox, 160, 120, "#00aa00", false);
    expect(page.strokes).toHaveLength(2);
    expect(page.strokes[0]).toMatchObject({ color: "#00aa00", fill: "#00aa00" });
  });

  it("is not bounded by the highlighter, and refuses an open area", () => {
    notices.length = 0;
    const { surface, page, pageBox } = setup([pen("h", box(100, 100, 100), 8, "highlighter")]);
    expect(run(surface, "fillAt", pageBox, 150, 150, "#cc0000", false)).toBe(false);
    expect(page.strokes).toHaveLength(1);
    expect(notices).toHaveLength(1);
  });
});

describe("Scribble to fill", () => {
  /** A dense zigzag inside (x0..x1, y0..y1). */
  function zigzag(x0: number, x1: number, y0: number, y1: number): number[] {
    const pts: number[] = [];
    for (let k = 0; k <= 12; k++) {
      const y = y0 + ((y1 - y0) * k) / 12;
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        pts.push(k % 2 === 0 ? x0 + (x1 - x0) * t : x1 - (x1 - x0) * t, y + t * 2, 0.5);
      }
    }
    return pts;
  }

  it("fills the outline a scribble is drawn inside", () => {
    const { surface, page, pageBox } = setup([pen("a", box(100, 100, 100))], "pen");
    expect(run(surface, "scribbleFill", pageBox, zigzag(120, 180, 120, 170))).toBe(true);
    expect(isBucketFill(page.strokes[0])).toBe(true);
    expect(page.strokes[0].color).toBe("#0000cc");
  });

  it("stays ink outside an outline, small in a big one, or with the switch off", () => {
    const open = setup([], "pen");
    expect(run(open.surface, "scribbleFill", open.pageBox, zigzag(120, 180, 120, 170))).toBe(false);
    const big = setup([pen("a", box(10, 10, 380))], "pen");
    expect(run(big.surface, "scribbleFill", big.pageBox, zigzag(150, 170, 150, 165))).toBe(false);
    const off = setup([pen("a", box(100, 100, 100))], "pen");
    (off.surface.toolState as Record<string, unknown>).penGestures = { scribbleErase: false };
    expect(run(off.surface, "scribbleFill", off.pageBox, zigzag(120, 180, 120, 170))).toBe(false);
    expect(off.page.strokes).toHaveLength(1);
  });

  it("stays ink when it runs well out over the outline", () => {
    const { surface, page, pageBox } = setup([pen("a", box(100, 100, 100))], "pen");
    expect(run(surface, "scribbleFill", pageBox, zigzag(60, 180, 120, 170))).toBe(false);
    expect(page.strokes).toHaveLength(1);
  });
});
