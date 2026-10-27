/**
 * A finger tap on a shape or a table with a pen in hand selects it, as a
 * lasso tap would, and picks the lasso, as a tap on a picture does (`InkSurface.fingerPicksShape`,
 * `fingerPicksTable`; discussion #51). Handwriting is left to the pen.
 */

import { describe, expect, it, vi } from "vitest";
import type { ActiveTool } from "../../src/view/toolbar";
import type { Stroke, TableElement } from "../../src/model/document";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

type Fake = Record<string, unknown>;
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

function stroke(id: string, pts: number[], extra: Partial<Stroke> = {}): Stroke {
  return { id, color: "#000", size: 2, tool: "pen", pts, ...extra };
}

/** A rectangle outline from (100, 100) to (300, 200). */
const rect = stroke(
  "r",
  [100, 100, 0.5, 300, 100, 0.5, 300, 200, 0.5, 100, 200, 0.5, 100, 100, 0.5],
  { shape: "rect" },
);
const arrow = stroke("a", [400, 100, 0.5, 600, 100, 0.5], { shape: "arrow" });
const writing = stroke("w", [100, 300, 0.5, 120, 310, 0.5, 140, 300, 0.5]);
const table = { id: "t1", x: 100, y: 400 } as unknown as TableElement;

function surface(
  tool: ActiveTool,
  opts: { practice?: object; scale?: number; filter?: object } = {},
) {
  const strokes = [rect, arrow, writing];
  const s: Fake = Object.assign(Object.create(InkSurface.prototype), {
    toolState: { tool, lassoFilter: opts.filter },
    practice: opts.practice ?? null,
    callbacks: { onToolChange: vi.fn() },
    setTool: vi.fn(),
    select: vi.fn(),
    strokeIndex: {
      near: () => new Set(strokes.map((candidate) => candidate.id)),
      get: (id: string) => strokes.find((candidate) => candidate.id === id),
    },
    tableAt: (_page: unknown, p: { x: number; y: number }) =>
      p.x >= 100 && p.x <= 300 && p.y >= 400 && p.y <= 500 ? { table } : null,
    tableWithInk: vi.fn(() => ({ strokes: [], images: [], textBoxes: [], tables: [table] })),
  });
  // A getter on the class: shadow it on the instance.
  Object.defineProperty(s, "unitScale", { value: opts.scale ?? 1 });
  return s;
}

const page = { id: "p1", strokes: [rect, arrow, writing], images: [], tables: [table] };

describe("a finger tap on a shape", () => {
  it.each(["pen", "highlighter", "eraser", "shape"] as ActiveTool[])(
    "with the %s in hand picks the lasso and selects it",
    (tool) => {
      const s = surface(tool);
      // On the rectangle's top side, a few px off the line.
      expect(run(s, "fingerPicksShape", page, { x: 200, y: 108 })).toBe(true);
      expect(s.select).toHaveBeenCalledWith("p1", { strokes: [rect], images: [], textBoxes: [] });
      expect(s.setTool).toHaveBeenCalledWith("select");
      expect((s.callbacks as Fake).onToolChange).toHaveBeenCalledWith("select");
    },
  );

  it("takes arrows too, and leaves handwriting to the pen", () => {
    const s = surface("pen");
    expect(run(s, "fingerPicksShape", page, { x: 500, y: 102 })).toBe(true);
    expect(s.select).toHaveBeenLastCalledWith("p1", {
      strokes: [arrow],
      images: [],
      textBoxes: [],
    });
    expect(run(s, "fingerPicksShape", page, { x: 120, y: 310 })).toBe(false);
  });

  it("reaches a fixed distance on screen, whatever the zoom", () => {
    // 12 screen px: 12 page px at fit, 2.4 at 5x.
    expect(run(surface("pen"), "fingerPicksShape", page, { x: 200, y: 112 })).toBe(true);
    expect(run(surface("pen", { scale: 5 }), "fingerPicksShape", page, { x: 200, y: 112 })).toBe(
      false,
    );
    expect(run(surface("pen", { scale: 5 }), "fingerPicksShape", page, { x: 200, y: 103 })).toBe(
      true,
    );
  });

  it("does nothing inside an unfilled shape, with the Text tool, in a practice file, or switched off", () => {
    const cases: Fake[] = [
      surface("text"),
      surface("pen", { practice: { device: "ipad" } }),
      surface("pen", { filter: { shapes: false } }),
    ];
    for (const s of cases) {
      expect(run(s, "fingerPicksShape", page, { x: 200, y: 108 })).toBe(false);
      expect(s.select).not.toHaveBeenCalled();
      expect(s.setTool).not.toHaveBeenCalled();
    }
    expect(run(surface("pen"), "fingerPicksShape", page, { x: 200, y: 150 })).toBe(false);
  });
});

describe("a finger tap on a table", () => {
  it("picks the lasso and selects it with its ink", () => {
    const s = surface("pen");
    expect(run(s, "fingerPicksTable", page, { x: 150, y: 450 })).toBe(true);
    expect(s.tableWithInk).toHaveBeenCalledWith(page, table, expect.anything());
    expect(s.select).toHaveBeenCalledWith("p1", expect.objectContaining({ tables: [table] }));
    expect(s.setTool).toHaveBeenCalledWith("select");
  });

  it("does nothing beside it, with the Text tool, or with tables switched off", () => {
    const cases: Array<[Fake, { x: number; y: number }]> = [
      [surface("pen"), { x: 50, y: 450 }],
      [surface("text"), { x: 150, y: 450 }],
      [surface("pen", { filter: { tables: false } }), { x: 150, y: 450 }],
    ];
    for (const [s, at] of cases) {
      expect(run(s, "fingerPicksTable", page, at)).toBe(false);
      expect(s.select).not.toHaveBeenCalled();
      expect(s.setTool).not.toHaveBeenCalled();
    }
  });
});
