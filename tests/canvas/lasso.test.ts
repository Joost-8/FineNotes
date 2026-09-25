/**
 * `src/canvas/lasso.ts` — the lasso's loop, its hit rules and the geometry of
 * the selection it makes.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LASSO_FILTER,
  LASSO_FILTER_KEYS,
  LassoPath,
  type Polygon,
  STROKE_SAMPLES,
  boxInLasso,
  clampGroupDelta,
  lassoFilterOf,
  lassoModeOf,
  lassoTakesStroke,
  pointInPolygon,
  polygonOf,
  rectLoop,
  selectionBounds,
  strokeInLasso,
  strokeKind,
  strokeShareInside,
  textBoxFrame,
  smoothLoop,
} from "../../src/canvas/lasso";
import type { ImageElement, Stroke, TextBoxElement } from "../../src/model/document";

const PAGE = { width: 800, height: 1000 };

function poly(pts: number[]): Polygon {
  const p = polygonOf(pts);
  if (!p) throw new Error("not a polygon");
  return p;
}

/** An axis-aligned square loop. */
function square(x0: number, y0: number, x1: number, y1: number): Polygon {
  return poly([x0, y0, x1, y0, x1, y1, x0, y1]);
}

/** A straight stroke from (x0, y) to (x1, y), `n` points. */
function line(x0: number, x1: number, y = 50, n = 11): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(x0 + ((x1 - x0) * i) / (n - 1), y, 0.5);
  return pts;
}

function stroke(pts: number[], extra: Partial<Stroke> = {}): Stroke {
  return { id: "s1", color: "#000", size: 2, tool: "pen", pts, ...extra };
}

describe("lasso settings", () => {
  it("reads the mode, defaulting to freehand", () => {
    expect(lassoModeOf("rect")).toBe("rect");
    expect(lassoModeOf("freehand")).toBe("freehand");
    expect(lassoModeOf(undefined)).toBe("freehand");
    expect(lassoModeOf("marquee")).toBe("freehand");
  });

  it("sanitises a stored filter, keeping only booleans and defaulting to on", () => {
    expect(lassoFilterOf(undefined)).toEqual(DEFAULT_LASSO_FILTER);
    expect(lassoFilterOf(null)).toEqual(DEFAULT_LASSO_FILTER);
    expect(lassoFilterOf("images")).toEqual(DEFAULT_LASSO_FILTER);
    const f = lassoFilterOf({ images: false, arrows: "no", shapes: 0, extra: false });
    expect(f).toEqual({ ...DEFAULT_LASSO_FILTER, images: false });
    // A fresh object each time: the default is never handed out to be mutated.
    expect(lassoFilterOf({})).not.toBe(DEFAULT_LASSO_FILTER);
    // Inherited members are not keys.
    expect(lassoFilterOf(Object.create({ images: false }))).toEqual(DEFAULT_LASSO_FILTER);
  });

  it("names every switch, all on by default", () => {
    expect([...LASSO_FILTER_KEYS].sort()).toEqual(Object.keys(DEFAULT_LASSO_FILTER).sort());
    for (const key of LASSO_FILTER_KEYS) expect(DEFAULT_LASSO_FILTER[key]).toBe(true);
  });

  it("sorts strokes into handwriting, shapes and arrows", () => {
    expect(strokeKind({})).toBe("handwriting");
    expect(strokeKind({ shape: "rect" })).toBe("shape");
    expect(strokeKind({ shape: "line" })).toBe("shape");
    expect(strokeKind({ shape: "star" })).toBe("shape");
    expect(strokeKind({ shape: "arrow" })).toBe("arrow");
  });

  it("lets each switch keep its own kind of stroke out", () => {
    const all = DEFAULT_LASSO_FILTER;
    expect(lassoTakesStroke({}, all)).toBe(true);
    expect(lassoTakesStroke({}, { ...all, handwriting: false })).toBe(false);
    expect(lassoTakesStroke({ shape: "circle" }, { ...all, handwriting: false })).toBe(true);
    expect(lassoTakesStroke({ shape: "circle" }, { ...all, shapes: false })).toBe(false);
    expect(lassoTakesStroke({ shape: "arrow" }, { ...all, shapes: false })).toBe(true);
    expect(lassoTakesStroke({ shape: "arrow" }, { ...all, arrows: false })).toBe(false);
  });
});

describe("LassoPath", () => {
  it("clamps points to the page it started on", () => {
    const path = new LassoPath(PAGE);
    path.add({ x: -40, y: 20 });
    path.add({ x: 900, y: 1200 });
    expect(path.points).toEqual([0, 20, 800, 1000]);
  });

  it("drops points closer than the spacing, and non-finite ones", () => {
    const path = new LassoPath(PAGE, 5);
    expect(path.add({ x: 10, y: 10 })).toBe(true);
    expect(path.add({ x: 12, y: 12 })).toBe(false);
    expect(path.add({ x: 20, y: 10 })).toBe(true);
    expect(path.add({ x: Number.NaN, y: 10 })).toBe(false);
    expect(path.count).toBe(2);
  });

  it("thins a very long loop instead of growing without bound", () => {
    const path = new LassoPath(PAGE, 1, 100);
    for (let i = 0; i < 1000; i++) {
      const a = (i / 1000) * Math.PI * 2;
      path.add({ x: 400 + 300 * Math.cos(a), y: 500 + 300 * Math.sin(a) });
    }
    expect(path.count).toBeLessThanOrEqual(100);
    expect(path.count).toBeGreaterThan(20);
    // The first point survives every thinning, and the loop still closes
    // round the whole circle.
    expect(path.points[0]).toBeCloseTo(700, 6);
    expect(path.points[1]).toBeCloseTo(500, 6);
    const n = path.points.length;
    expect(Math.hypot(path.points[n - 2] - 700, path.points[n - 1] - 500)).toBeLessThan(40);
  });

  it("keeps the newest point when thinning an even count", () => {
    const path = new LassoPath(PAGE, 0, 4);
    for (let i = 0; i < 5; i++) path.add({ x: i * 10, y: 0 });
    // 5 points > 4: kept 0, 20, 40 (every other one, which includes the newest).
    expect(path.points).toEqual([0, 0, 20, 0, 40, 0]);
    const other = new LassoPath(PAGE, 0, 5);
    for (let i = 0; i < 6; i++) other.add({ x: i * 10, y: 0 });
    // 6 points > 5: every other one is 0, 20, 40, and the newest (50) is appended.
    expect(other.points).toEqual([0, 0, 20, 0, 40, 0, 50, 0]);
  });
});

describe("rectLoop", () => {
  it("normalises the corners and clamps to the page", () => {
    expect(rectLoop({ x: 300, y: 400 }, { x: 100, y: 200 }, PAGE)).toEqual([
      100, 200, 300, 200, 300, 400, 100, 400,
    ]);
    expect(rectLoop({ x: -10, y: -10 }, { x: 900, y: 50 }, PAGE)).toEqual([
      0, 0, 800, 0, 800, 50, 0, 50,
    ]);
  });
});

describe("pointInPolygon", () => {
  it("needs three vertices", () => {
    expect(polygonOf([0, 0, 10, 10])).toBeNull();
    expect(polygonOf([0, 0, 10, 0, 10])).toBeNull();
    // A trailing odd coordinate is ignored.
    expect(polygonOf([0, 0, 10, 0, 10, 10, 99])?.pts).toEqual([0, 0, 10, 0, 10, 10]);
  });

  it("tells inside from outside for a convex loop", () => {
    const p = square(0, 0, 100, 100);
    expect(pointInPolygon(50, 50, p)).toBe(true);
    expect(pointInPolygon(150, 50, p)).toBe(false);
    expect(pointInPolygon(50, -1, p)).toBe(false);
  });

  it("handles a concave loop", () => {
    // A "U": the notch between the arms is outside.
    const u = poly([0, 0, 30, 0, 30, 70, 70, 70, 70, 0, 100, 0, 100, 100, 0, 100]);
    expect(pointInPolygon(15, 50, u)).toBe(true);
    expect(pointInPolygon(50, 30, u)).toBe(false);
    expect(pointInPolygon(50, 85, u)).toBe(true);
  });

  it("is even–odd on a self-crossing loop", () => {
    // A figure eight (bow tie): both lobes are inside, the crossing's
    // surroundings above and below it are outside.
    const bow = poly([0, 0, 100, 100, 100, 0, 0, 100]);
    expect(pointInPolygon(10, 50, bow)).toBe(true);
    expect(pointInPolygon(90, 50, bow)).toBe(true);
    expect(pointInPolygon(50, 10, bow)).toBe(false);
    expect(pointInPolygon(50, 90, bow)).toBe(false);
    // A loop wrapped twice round the same square: its middle is covered twice
    // and reads as outside, as an even–odd fill draws it.
    const twice = poly([0, 0, 100, 0, 100, 100, 0, 100, 0, 0, 100, 0, 100, 100, 0, 100]);
    expect(pointInPolygon(50, 50, twice)).toBe(false);
  });
});

describe("strokes", () => {
  it("selects a stroke with at least half of its length inside — and not below", () => {
    // Samples sit at the midpoints of 64 equal pieces: the lasso edge at
    // x = 50 holds exactly 32 of them.
    const s = stroke(line(0, 100));
    expect(strokeShareInside(s.pts, square(-10, 0, 50, 100))).toBe(0.5);
    expect(strokeInLasso(s, square(-10, 0, 50, 100))).toBe(true);
    expect(strokeShareInside(s.pts, square(-10, 0, 49, 100))).toBe(31 / STROKE_SAMPLES);
    expect(strokeInLasso(s, square(-10, 0, 49, 100))).toBe(false);
    expect(strokeInLasso(s, square(-10, 0, 200, 100))).toBe(true);
    expect(strokeInLasso(s, square(200, 0, 300, 100))).toBe(false);
  });

  it("judges a sparse shape by its length, not its vertex count", () => {
    // A two-point line: its endpoints alone would read 50 % for a lasso
    // round one end. By length, a lasso round the first 30 % leaves it out.
    const twoPoint = stroke([0, 50, 0.5, 100, 50, 0.5], { shape: "line" });
    expect(strokeInLasso(twoPoint, square(-10, 0, 30, 100))).toBe(false);
    expect(strokeInLasso(twoPoint, square(-10, 0, 70, 100))).toBe(true);
    // A rectangle outline with one corner outside is still mostly inside.
    const rect = stroke([0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5, 0, 100, 0.5, 0, 0, 0.5], {
      shape: "rect",
    });
    expect(strokeInLasso(rect, poly([-10, -10, 110, -10, 110, 60, 60, 110, -10, 110]))).toBe(true);
  });

  it("treats a dot, or a stroke that never moved, as one point", () => {
    expect(strokeShareInside([50, 50, 0.5], square(0, 0, 100, 100))).toBe(1);
    expect(strokeShareInside([50, 50, 0.5, 50, 50, 0.5], square(0, 0, 10, 10))).toBe(0);
    expect(strokeShareInside([], square(0, 0, 10, 10))).toBe(0);
  });

  it("reads whole points only on a ragged array", () => {
    // The trailing `999` is half a point and must not become a coordinate.
    const ragged = [...line(0, 100, 50, 3), 999];
    expect(strokeShareInside(ragged, square(-10, 0, 200, 100))).toBe(1);
  });

  it("walks past zero-length segments", () => {
    const pts = [0, 50, 0.5, 0, 50, 0.5, 100, 50, 0.5, 100, 50, 0.5];
    expect(strokeShareInside(pts, square(-10, 0, 50, 100))).toBe(0.5);
  });
});

describe("boxInLasso", () => {
  it("selects a box whose centre is inside, even if most of it is not", () => {
    // A small lasso round the centre of a big picture.
    expect(boxInLasso({ x: 0, y: 0, w: 400, h: 300 }, square(190, 140, 210, 160))).toBe(true);
  });

  it("selects a box mostly inside although its centre is not", () => {
    // An L-shaped lasso missing the box's lower right, centre included. Of
    // the 5 × 5 grid (cell centres at 10, 30 … 90) it holds the two top rows
    // and two columns of the three rows below: 10 + 6 = 16 of 25.
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const l = poly([0, 0, 100, 0, 100, 45, 45, 45, 45, 100, 0, 100]);
    expect(pointInPolygon(50, 50, l)).toBe(false);
    expect(boxInLasso(box, l)).toBe(true);
    // A thinner L holds one row and one column: 5 + 4 = 9 of 25.
    const thin = poly([0, 0, 100, 0, 100, 25, 25, 25, 25, 100, 0, 100]);
    expect(boxInLasso(box, thin)).toBe(false);
  });

  it("leaves out a box barely touched", () => {
    expect(boxInLasso({ x: 0, y: 0, w: 100, h: 100 }, square(90, 90, 200, 200))).toBe(false);
    expect(boxInLasso({ x: 0, y: 0, w: 100, h: 100 }, square(300, 300, 400, 400))).toBe(false);
  });

  it("reads a rotated picture in its own frame", () => {
    // A long thin picture turned 90°: it now stands upright round its centre.
    const upright = { x: 0, y: 45, w: 100, h: 10, rotation: Math.PI / 2 };
    // Its centre is (50, 50); a lasso round a vertical strip there holds it all.
    expect(boxInLasso(upright, square(40, -10, 60, 45))).toBe(false);
    expect(boxInLasso(upright, square(40, -10, 60, 110))).toBe(true);
    // A horizontal strip through its middle holds its centre, so it is selected.
    expect(boxInLasso(upright, square(0, 40, 100, 60))).toBe(true);
    // Unrotated, the same top strip would have held none of it.
    expect(boxInLasso({ x: 0, y: 45, w: 100, h: 10 }, square(0, -10, 100, 30))).toBe(false);
    // Rotated, the upper half of the upright picture (y 0..45) is 2 of 5 rows.
    expect(boxInLasso(upright, square(0, -10, 100, 45))).toBe(false);
  });

  it("never selects an empty box", () => {
    expect(boxInLasso({ x: 10, y: 10, w: 0, h: 10 }, square(0, 0, 100, 100))).toBe(false);
  });
});

describe("selection geometry", () => {
  it("bounds strokes by their ink, images by their rotation, text by its frame", () => {
    const s = stroke([10, 10, 0.5, 20, 30, 0.5], { size: 4 });
    expect(selectionBounds([s], [], [])).toEqual({ minX: 8, minY: 8, maxX: 22, maxY: 32 });
    const turned = { x: 0, y: 45, w: 100, h: 10, rotation: Math.PI / 2 };
    const b = selectionBounds([], [turned], []);
    expect(b?.minX).toBeCloseTo(45, 6);
    expect(b?.maxY).toBeCloseTo(100, 6);
    expect(selectionBounds([], [], [{ x: 5, y: 6, w: 7, h: 8 }])).toEqual({
      minX: 5,
      minY: 6,
      maxX: 12,
      maxY: 14,
    });
    const all = selectionBounds([s], [turned], [{ x: 200, y: 6, w: 7, h: 8 }]);
    expect(all?.maxX).toBe(207);
    expect(all?.minY).toBeCloseTo(0, 6);
    expect(selectionBounds([], [], [])).toBeNull();
    // A stroke with no whole point contributes nothing.
    expect(selectionBounds([stroke([1, 2])], [], [])).toBeNull();
  });

  it("keeps the selection's centre on the page", () => {
    const b = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
    expect(clampGroupDelta(b, 10, -20, PAGE)).toEqual({ dx: 10, dy: -20 });
    expect(clampGroupDelta(b, -500, 0, PAGE)).toEqual({ dx: -150, dy: 0 });
    expect(clampGroupDelta(b, 0, 2000, PAGE)).toEqual({ dx: 0, dy: 850 });
  });

  it("lets a selection already off the page stay, but not go further out", () => {
    const off = { minX: -300, minY: 100, maxX: -100, maxY: 200 };
    expect(clampGroupDelta(off, -50, 0, PAGE)).toEqual({ dx: 0, dy: 0 });
    expect(clampGroupDelta(off, 50, 0, PAGE)).toEqual({ dx: 50, dy: 0 });
  });

  it("frames a text box by its own height, or the measured one", () => {
    const auto: TextBoxElement = {
      id: "t1",
      x: 1,
      y: 2,
      w: 3,
      text: "",
      color: "#000",
      fontSize: 16,
    };
    expect(textBoxFrame(auto, 40)).toEqual({ x: 1, y: 2, w: 3, h: 40 });
    expect(textBoxFrame({ ...auto, h: 90 }, 40)).toEqual({ x: 1, y: 2, w: 3, h: 90 });
    expect(textBoxFrame(auto, -5).h).toBe(0);
  });

  it("reads a placed image as the rectangle it covers", () => {
    const image: ImageElement = { id: "i1", path: "a.png", x: 0, y: 0, w: 100, h: 100 };
    expect(boxInLasso(image, square(-10, -10, 60, 60))).toBe(true);
  });
});

describe("smoothLoop", () => {
  const square = [0, 0, 100, 0, 100, 100, 0, 100];

  it("rounds a rough rectangle's corners, keeping the loop's size", () => {
    const smooth = smoothLoop(square, 2);
    expect(smooth.length).toBe(square.length * 4);
    const xs = smooth.filter((_, i) => i % 2 === 0);
    const ys = smooth.filter((_, i) => i % 2 === 1);
    // Within the original (the straight edges stay put), with no corner left at its tip.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    const nearCorner = (x: number, y: number): boolean => Math.hypot(x, y) < 10;
    expect(xs.some((x, i) => nearCorner(x, ys[i]))).toBe(false);
    // Still spans most of the square: a rounding, not a shrink to a blob.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(80);
  });

  it("keeps a loop's own wobble: it stays that person's loop", () => {
    const wobbly: number[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const r = 100 + 12 * Math.sin(5 * a);
      wobbly.push(r * Math.cos(a), r * Math.sin(a));
    }
    const smooth = smoothLoop(wobbly, 2);
    const radii: number[] = [];
    for (let i = 0; i < smooth.length; i += 2) radii.push(Math.hypot(smooth[i], smooth[i + 1]));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(15);
  });

  it("returns too short a loop as it is, dropping a dangling coordinate", () => {
    expect(smoothLoop([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(smoothLoop([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4]);
    expect(smoothLoop(square, 0)).toEqual(square);
  });

  it("does not change the loop it was given", () => {
    const copy = [...square];
    smoothLoop(square);
    expect(square).toEqual(copy);
  });
});
