/**
 * What `SpatialIndex` returns, pinned against a model small enough to trust:
 * the page is cut into square cells, a stroke is filed under every cell its
 * bounding box reaches, and a query lists the strokes filed under the cells
 * its own box reaches — cells row by row, top to bottom and left to right,
 * and within a cell in the order the strokes were (last) inserted. Each id
 * appears once, where it is first met.
 *
 * The order matters, not only the set: the standard eraser mints the ids of
 * the pieces it cuts in the order the candidates come back.
 */

import { describe, expect, it } from "vitest";
import { SpatialIndex } from "../../src/canvas/spatial-index";
import { type Bounds, type Stroke, strokeBounds } from "../../src/model/document";

interface Span {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function spanOf(b: Bounds, cell: number): Span {
  return {
    x0: Math.floor(b.minX / cell),
    y0: Math.floor(b.minY / cell),
    x1: Math.floor(b.maxX / cell),
    y1: Math.floor(b.maxY / cell),
  };
}

/** The reference: a list of live strokes in insertion order, scanned per cell. */
class Model {
  private live: Array<{ id: string; span: Span }> = [];

  constructor(private readonly cell: number) {}

  insert(stroke: Stroke): void {
    const b = strokeBounds(stroke);
    if (b) this.live.push({ id: stroke.id, span: spanOf(b, this.cell) });
  }

  remove(id: string): void {
    this.live = this.live.filter((entry) => entry.id !== id);
  }

  clear(): void {
    this.live = [];
  }

  query(b: Bounds): string[] {
    const q = spanOf(b, this.cell);
    const out: string[] = [];
    for (let cy = q.y0; cy <= q.y1; cy++) {
      for (let cx = q.x0; cx <= q.x1; cx++) {
        for (const { id, span } of this.live) {
          const inCell = cx >= span.x0 && cx <= span.x1 && cy >= span.y0 && cy <= span.y1;
          if (inCell && !out.includes(id)) out.push(id);
        }
      }
    }
    return out;
  }
}

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

function line(id: string, x0: number, y0: number, x1: number, y1: number): Stroke {
  return { id, color: "#000000", size: 2, tool: "pen", pts: [x0, y0, 0.5, x1, y1, 0.5] };
}

function scatter(next: () => number, id: string): Stroke {
  const pts: number[] = [];
  const ox = next() * 2400 - 400;
  const oy = next() * 3000 - 400;
  const reach = next() < 0.2 ? 900 : 120;
  const n = 1 + Math.floor(next() * 5);
  for (let i = 0; i < n; i++) pts.push(ox + next() * reach, oy + next() * reach, 0.5);
  return { id, color: "#000000", size: 2, tool: "pen", pts };
}

function randomBox(next: () => number): Bounds {
  const x = next() * 2600 - 500;
  const y = next() * 3200 - 500;
  return { minX: x, minY: y, maxX: x + next() * 700, maxY: y + next() * 700 };
}

describe("SpatialIndex against the cell model", () => {
  for (const cell of [undefined, 64, 256, 300]) {
    it(`answers every query in the model's order (cell size ${cell ?? "default"})`, () => {
      const next = rng(cell ?? 17);
      const index = cell === undefined ? new SpatialIndex() : new SpatialIndex(cell);
      const model = new Model(cell ?? 256);
      const ids: string[] = [];
      let made = 0;
      for (let round = 0; round < 400; round++) {
        const roll = next();
        if (roll < 0.55 || ids.length === 0) {
          const stroke = scatter(next, `s${++made}`);
          index.insert(stroke);
          model.insert(stroke);
          ids.push(stroke.id);
        } else if (roll < 0.75) {
          const [id] = ids.splice(Math.floor(next() * ids.length), 1);
          index.remove(id);
          model.remove(id);
        } else if (roll < 0.9) {
          const box = randomBox(next);
          expect([...index.queryBounds(box)]).toEqual(model.query(box));
        } else {
          const x = next() * 2400 - 400;
          const y = next() * 3000 - 400;
          const r = next() < 0.3 ? 0 : next() * 60;
          const box = { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
          const found = r === 0 ? index.queryPoint(x, y) : index.queryPoint(x, y, r);
          expect([...found]).toEqual(model.query(box));
        }
      }
    });
  }

  it("files a re-inserted stroke after the ones that stayed", () => {
    const index = new SpatialIndex(100);
    index.insert(line("a", 10, 10, 20, 20));
    index.insert(line("b", 30, 30, 40, 40));
    index.remove("a");
    index.insert(line("a", 10, 10, 20, 20));
    expect([...index.queryPoint(15, 15, 50)]).toEqual(["b", "a"]);
  });

  it("lists by cell first: a stroke in an earlier cell comes first, whatever its age", () => {
    const index = new SpatialIndex(100);
    index.insert(line("late-cell", 250, 250, 260, 260));
    index.insert(line("early-cell", 10, 10, 20, 20));
    index.insert(line("both", 50, 50, 280, 280));
    const all = { minX: 0, minY: 0, maxX: 299, maxY: 299 };
    expect([...index.queryBounds(all)]).toEqual(["early-cell", "both", "late-cell"]);
  });
});

describe("SpatialIndex at the edges", () => {
  it("reaches the cell a bound lands on exactly", () => {
    const index = new SpatialIndex(100);
    index.insert(line("edge", 20, 20, 100, 40));
    // x = 100 is the first pixel of cell 1.
    expect(index.queryBounds({ minX: 100, minY: 0, maxX: 150, maxY: 50 }).has("edge")).toBe(true);
    expect(index.queryBounds({ minX: 200, minY: 0, maxX: 250, maxY: 50 }).has("edge")).toBe(false);
  });

  it("files strokes left of and above the origin", () => {
    const index = new SpatialIndex(100);
    index.insert(line("neg", -150, -30, -120, -10));
    expect([...index.queryPoint(-130, -20)]).toEqual(["neg"]);
    expect(index.queryPoint(-30, -20).size).toBe(0);
  });

  it("finds a whole-cell neighbour it does not touch: the index is only a broad phase", () => {
    const index = new SpatialIndex(256);
    index.insert(line("far", 250, 250, 255, 255));
    expect(index.queryPoint(5, 5).has("far")).toBe(true);
  });

  it("ignores a stroke without a whole point, and a query or stroke that is not a number", () => {
    const index = new SpatialIndex(100);
    index.insert({ ...line("empty", 0, 0, 0, 0), pts: [] });
    index.insert({ ...line("nan", 0, 0, 0, 0), pts: [Number.NaN, Number.NaN, 0.5] });
    index.insert(line("ok", 10, 10, 20, 20));
    expect([...index.queryBounds({ minX: -500, minY: -500, maxX: 500, maxY: 500 })]).toEqual([
      "ok",
    ]);
    expect(index.queryPoint(Number.NaN, 10).size).toBe(0);
  });

  it("forgets an unknown id quietly", () => {
    const index = new SpatialIndex(100);
    index.insert(line("a", 10, 10, 20, 20));
    index.remove("nobody");
    expect([...index.queryPoint(15, 15)]).toEqual(["a"]);
  });

  it("rebuild replaces everything; clear empties it", () => {
    const index = new SpatialIndex(100);
    index.insert(line("old", 10, 10, 20, 20));
    index.rebuild([line("n1", 10, 10, 20, 20), line("n2", 12, 12, 30, 30)]);
    expect([...index.queryPoint(15, 15)]).toEqual(["n1", "n2"]);
    index.clear();
    expect(index.queryPoint(15, 15).size).toBe(0);
    index.insert(line("again", 10, 10, 20, 20));
    expect([...index.queryPoint(15, 15)]).toEqual(["again"]);
  });

  it("returns a fresh set each time, which the caller may change", () => {
    const index = new SpatialIndex(100);
    index.insert(line("a", 10, 10, 20, 20));
    const first = index.queryPoint(15, 15);
    first.delete("a");
    expect(index.queryPoint(15, 15).has("a")).toBe(true);
  });
});
