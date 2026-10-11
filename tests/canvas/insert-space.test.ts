/**
 * `src/canvas/insert-space.ts`: inserting and closing up lines, and ink
 * flowing onto the next page.
 */

import { describe, expect, it } from "vitest";
import { writingLines } from "../../src/canvas/backdrop";
import {
  type SpaceLayout,
  planInsertSpace,
  spaceStrip,
  spaceTargetAt,
} from "../../src/canvas/insert-space";
import type { Backdrop, InkDocument, Page, Stroke } from "../../src/model/document";

const A4 = { width: 1024, height: 1448 };
const RULED: Backdrop = { kind: "ruled-wide" }; // rules at 40, 80, … 1440: 36 lines
const LAST = 35;

const layout: SpaceLayout = {
  lines: (page) => writingLines(page.backdrop, page.geometry),
  textBoxBounds: (_page, t) => ({ minX: t.x, minY: t.y, maxX: t.x + t.w, maxY: t.y + 24 }),
};

/** A word on line `line` (rule at 40·(line + 1)), from x0 to x1. */
function word(id: string, line: number, x0 = 100, x1 = 200): Stroke {
  const base = 40 * (line + 1);
  return {
    id,
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [x0, base - 2, 0.5, (x0 + x1) / 2, base - 14, 0.5, x1, base - 2, 0.5],
  };
}

function page(id: string, strokes: Stroke[], backdrop: Backdrop = RULED): Page {
  return { id, kind: "ink", geometry: { ...A4 }, backdrop, strokes, images: [], textBoxes: [] };
}

function doc(...pages: Page[]): InkDocument {
  return { version: 3, view: { scrollY: 0, zoom: 1 }, pages } as unknown as InkDocument;
}

/** The line a stroke now sits on, by its lowest point. */
const lineOf = (s: Stroke): number => Math.round((Math.max(s.pts[1], s.pts[7]) + 2) / 40) - 1;
const where = (d: InkDocument): Record<string, string> =>
  Object.fromEntries(
    d.pages.flatMap((p, i) => p.strokes.map((s) => [s.id, `${i}:${lineOf(s)}`] as const)),
  );

function apply(d: InkDocument, pageIndex: number, line: number, count: number, block = 0) {
  const plan = planInsertSpace(d, pageIndex, { block, line }, count, layout);
  plan.command?.apply(d);
  return plan;
}

describe("spaceTargetAt", () => {
  const ruled = writingLines(RULED, A4);
  const columns = writingLines({ kind: "two-column" }, A4);
  const legal = writingLines({ kind: "legal" }, A4);

  it("starts from the margin next to a line", () => {
    expect(spaceTargetAt(ruled, A4.width, 10, 112)).toEqual({ block: 0, line: 2 });
    expect(spaceTargetAt(legal, A4.width, 30, 112)).toEqual({ block: 0, line: 2 });
  });

  it("is nothing in the writing, or off the lines", () => {
    expect(spaceTargetAt(ruled, A4.width, 100, 112)).toBeNull();
    expect(spaceTargetAt(ruled, A4.width, 10, -100)).toBeNull();
    expect(spaceTargetAt([], A4.width, 10, 112)).toBeNull();
  });

  it("a column next to another has its own strip at its edge", () => {
    expect(spaceTargetAt(columns, A4.width, 520, 112)).toEqual({ block: 1, line: 2 });
    expect(spaceTargetAt(columns, A4.width, 500, 112)).toBeNull();
    expect(spaceTargetAt(columns, A4.width, 10, 112)).toEqual({ block: 0, line: 2 });
  });
});

describe("inserting lines", () => {
  it("moves the line and everything below it down, and leaves what is above", () => {
    const d = doc(page("p1", [word("above", 1), word("at", 2), word("below", 5)]));
    const plan = apply(d, 0, 2, 2);
    expect(plan).toMatchObject({ lines: 2, moved: 2, spilled: 0, addedPages: 0 });
    expect(where(d)).toEqual({ above: "0:1", at: "0:4", below: "0:7" });
  });

  it("undoes to exactly the document it started from", () => {
    const d = doc(
      page("p1", [word("a", 2), word("b", LAST)]),
      page("p2", [word("c", 0), word("d", LAST)]),
    );
    const before = JSON.stringify(d);
    const plan = planInsertSpace(d, 0, { block: 0, line: 2 }, 3, layout);
    plan.command!.apply(d);
    expect(JSON.stringify(d)).not.toBe(before);
    plan.command!.invert(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("does nothing with nothing below the line", () => {
    const d = doc(page("p1", [word("above", 1)]));
    expect(apply(d, 0, 3, 2).command).toBeNull();
  });

  it("does nothing for no lines, a bad count, a missing page or a page without lines", () => {
    const d = doc(page("p1", [word("a", 2)]), page("p2", [word("b", 2)], { kind: "blank" }));
    expect(apply(d, 0, 2, 0).command).toBeNull();
    expect(apply(d, 0, 2, 1.5).command).toBeNull();
    expect(apply(d, 5, 2, 1).command).toBeNull();
    expect(apply(d, 1, 2, 1).command).toBeNull();
  });

  it("moves pictures and text boxes on those lines too", () => {
    const p = page("p1", [word("a", 2)]);
    p.images = [{ id: "i1", path: "a.png", x: 300, y: 170, w: 40, h: 30 }]; // line 4
    p.textBoxes = [{ id: "t1", x: 400, y: 50, w: 80, text: "x", color: "#000", fontSize: 16 }]; // line 1
    const d = doc(p);
    apply(d, 0, 2, 1);
    expect(p.images[0].y).toBe(210);
    expect(p.textBoxes[0].y).toBe(50);
  });

  it("leaves the other column alone", () => {
    const columns: Backdrop = { kind: "two-column" };
    const d = doc(page("p1", [word("left", 3), word("right", 3, 600, 700)], columns));
    apply(d, 0, 2, 1);
    expect(where(d)).toEqual({ left: "0:4", right: "0:3" });
  });
});

describe("spilling onto the next page", () => {
  it("carries ink past the last line to the next page's first lines, which make room", () => {
    const d = doc(
      page("p1", [word("stays", LAST - 3), word("last", LAST)]),
      page("p2", [word("top", 0), word("deep", 10)]),
    );
    const plan = apply(d, 0, LAST - 3, 2);
    expect(plan).toMatchObject({ lines: 2, spilled: 1, addedPages: 0 });
    // "last" lands on p2's line 1 (two lines past the end of p1: lines 0 and 1);
    // p2 made two lines of room, so "top" is now on line 2.
    expect(where(d)).toEqual({ stays: "0:34", last: "1:1", top: "1:2", deep: "1:12" });
  });

  it("keeps a spilled word's place relative to its line", () => {
    const d = doc(page("p1", [word("last", LAST, 300, 360)]), page("p2", []));
    apply(d, 0, LAST, 1);
    const moved = d.pages[1].strokes[0];
    expect(moved.pts.slice(0, 6)).toEqual([300, 38, 0.5, 330, 26, 0.5]);
  });

  it("adds a page with the same paper after the last one", () => {
    const d = doc(page("p1", [word("last", LAST)]));
    const plan = apply(d, 0, LAST, 1);
    expect(plan.addedPages).toBe(1);
    expect(d.pages).toHaveLength(2);
    expect(d.pages[1]).toMatchObject({ id: "p2", backdrop: RULED, geometry: A4 });
    expect(where(d)).toEqual({ last: "1:0" });
    plan.command!.invert(d);
    expect(d.pages).toHaveLength(1);
    expect(where(d)).toEqual({ last: "0:35" });
  });

  it("puts a new page in before a page ruled differently, which is left alone", () => {
    const d = doc(
      page("p1", [word("last", LAST)]),
      page("p7", [word("grid", 0)], { kind: "ruled-narrow" }),
    );
    const plan = apply(d, 0, LAST, 1);
    expect(plan.addedPages).toBe(1);
    expect(d.pages.map((p) => p.id)).toEqual(["p1", "p8", "p7"]);
    expect(where(d)).toEqual({ last: "1:0", grid: "2:0" });
  });

  it("flows on down a chain of full pages", () => {
    const d = doc(
      page("p1", [word("a", LAST)]),
      page("p2", [word("b", LAST)]),
      page("p3", [word("c", LAST)]),
    );
    const plan = apply(d, 0, LAST, 1);
    expect(plan).toMatchObject({ spilled: 3, addedPages: 1 });
    expect(where(d)).toEqual({ a: "1:0", b: "2:0", c: "3:0" });
  });

  it("a tall picture that would hang off the page goes over whole", () => {
    const p = page("p1", []);
    p.images = [{ id: "i1", path: "a.png", x: 300, y: 1290, w: 100, h: 140 }]; // line 32 by overlap
    const d = doc(p, page("p2", []));
    const plan = apply(d, 0, 30, 1);
    expect(plan.spilled).toBe(1);
    expect(d.pages[1].images).toHaveLength(1);
  });
});

describe("closing up", () => {
  it("closes empty lines above, never over ink", () => {
    const d = doc(page("p1", [word("top", 1), word("at", 5), word("below", 8)]));
    const plan = apply(d, 0, 5, -10);
    // Lines 2, 3 and 4 are empty: three close, the fourth would be "top".
    expect(plan.lines).toBe(-3);
    expect(where(d)).toEqual({ top: "0:1", at: "0:2", below: "0:5" });
  });

  it("does nothing right under ink, or with nothing to move", () => {
    const d = doc(page("p1", [word("top", 4), word("at", 5)]));
    expect(apply(d, 0, 5, -2).command).toBeNull();
    expect(apply(d, 0, 9, -2).command).toBeNull();
  });

  it("will not close the lines a drawing covers", () => {
    const drawing: Stroke = {
      id: "drawing",
      color: "#000",
      size: 2,
      tool: "pen",
      pts: [600, 85, 0.5, 700, 230, 0.5], // over lines 2 to 5, at the side
    };
    const d = doc(page("p1", [drawing, word("at", 6)]));
    const plan = apply(d, 0, 6, -3);
    expect(plan.command).toBeNull();
  });
});

describe("spaceStrip", () => {
  const block = writingLines(RULED, A4)[0];
  it("runs down from the line's top for an insert, up for a close-up", () => {
    expect(spaceStrip(block, { block: 0, line: 2 }, 2)).toEqual({
      minX: 0,
      maxX: A4.width,
      minY: 90,
      maxY: 170,
    });
    expect(spaceStrip(block, { block: 0, line: 2 }, -1)).toEqual({
      minX: 0,
      maxX: A4.width,
      minY: 50,
      maxY: 90,
    });
  });
});
