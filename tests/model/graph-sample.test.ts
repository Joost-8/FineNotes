import { describe, expect, it } from "vitest";
import type { GraphSpec } from "../../src/model/graph";
import {
  DEFAULT_LINE_WIDTH,
  LINE_COLORS,
  pointsOfInterest,
  prepareGraph,
  sampleGraphGeometry,
  sampleParametric,
  tableOfValues,
  valueOfLine,
} from "../../src/model/graph-sample";

const RANGE = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
const W = 400;
const H = 400;

function spec(
  lines: Array<string | Record<string, unknown>>,
  extra: Partial<GraphSpec> = {},
): GraphSpec {
  return {
    ...RANGE,
    expressions: [],
    lines: lines.map((l, i) =>
      typeof l === "string" ? { id: `l${i + 1}`, text: l } : { id: `l${i + 1}`, ...l },
    ) as GraphSpec["lines"],
    ...extra,
  };
}

const geometry = (s: GraphSpec, cell?: number) =>
  sampleGraphGeometry(prepareGraph(s), RANGE, W, H, cell ? { cell } : {});

/** Every vertex of every stroke. */
const vertices = (strokes: number[][]): Array<[number, number]> =>
  strokes.flatMap((p) =>
    Array.from({ length: p.length / 2 }, (_, i) => [p[2 * i], p[2 * i + 1]] as [number, number]),
  );

describe("prepareGraph", () => {
  it("colours lines by position unless they have their own, and syncs sliders", () => {
    const p = prepareGraph(
      spec(["y = ax", { text: "x^2", color: "#123456" }], {
        sliders: [{ name: "a", value: 3, min: 0, max: 5, step: 1 }],
      }),
    );
    expect(p.lines.map((l) => l.color)).toEqual([LINE_COLORS[0], "#123456"]);
    expect(p.sliders).toEqual([{ name: "a", value: 3, min: 0, max: 5, step: 1 }]);
    expect(prepareGraph({ ...RANGE, expressions: ["sin(x)"] }).lines[0].line.text).toBe("sin(x)");
  });
});

describe("geometry by kind", () => {
  it("draws a function with its style and width", () => {
    const [g] = geometry(spec([{ text: "sin(x)", style: "dashed", width: 4 }]));
    expect(g.strokes).toHaveLength(1);
    expect(g.dashed).toBe(true);
    expect(g.width).toBe(4);
    expect(geometry(spec(["x"]))[0].width).toBe(DEFAULT_LINE_WIDTH);
  });

  it("uses slider values, stored or given", () => {
    const s = spec(["y = a"], { sliders: [{ name: "a", value: 3, min: 0, max: 5, step: 1 }] });
    const ys = (g: ReturnType<typeof geometry>) => vertices(g[0].strokes).map(([, y]) => y);
    expect(new Set(ys(geometry(s)))).toEqual(new Set([3]));
    const moved = sampleGraphGeometry(prepareGraph(s), RANGE, W, H, { vars: new Map([["a", -2]]) });
    expect(new Set(ys(moved))).toEqual(new Set([-2]));
  });

  it("skips hidden lines and lines that fail", () => {
    const [hidden, broken] = geometry(spec([{ text: "x", hidden: true }, "2+"]));
    expect(hidden.strokes).toEqual([]);
    expect(broken.strokes).toEqual([]);
  });

  it("restricts a function to its domain", () => {
    const [g] = geometry(spec(["y = x {0 < x < 5}"]));
    for (const [x] of vertices(g.strokes)) {
      expect(x).toBeGreaterThan(-0.01);
      expect(x).toBeLessThan(5.01);
    }
  });

  it("draws x as a function of y, and vertical lines", () => {
    const [side] = geometry(spec(["x = y^2"]));
    // Points far off the view are pulled in by design; check those in view.
    for (const [x, y] of vertices(side.strokes))
      if (x < 10) expect(Math.abs(x - y * y)).toBeLessThan(0.15);
    const [line] = geometry(spec(["x = 3"]));
    expect(line.strokes).toEqual([[3, -30, 3, 30]]);
  });

  it("shades a region below or above its edge, dashed when strict", () => {
    const [below] = geometry(spec(["y < sin(x)"]));
    expect(below.edgeDashed).toBe(true);
    expect(below.fills).toHaveLength(1);
    const fill = below.fills[0];
    expect(fill[fill.length - 1]).toBe(-30);
    const [above] = geometry(spec(["y >= x"]));
    expect(above.edgeDashed).toBe(false);
    expect(above.fills[0][above.fills[0].length - 1]).toBe(30);
    const [left] = geometry(spec(["x < 2"]));
    expect(left.fills).toEqual([[2, -30, 2, 30, -30, 30, -30, -30]]);
  });

  it("traces an implicit circle by marching squares", () => {
    const [circle] = geometry(spec(["x^2 + y^2 = 25"]), 4);
    expect(circle.strokes.length).toBeGreaterThan(0);
    for (const [x, y] of vertices(circle.strokes))
      expect(Math.abs(Math.hypot(x, y) - 5)).toBeLessThan(0.05);
    // Joined into a few long lines, not hundreds of segments.
    expect(circle.strokes.length).toBeLessThan(4);
  });

  it("covers an implicit region and leaves the outside clear", () => {
    const [disc] = geometry(spec(["x^2 + y^2 < 25"]), 8);
    const mask = disc.mask!;
    expect(mask.cols).toBe(50);
    const centre = mask.alpha[Math.floor(mask.rows / 2) * mask.cols + Math.floor(mask.cols / 2)];
    expect(centre).toBe(255);
    expect(mask.alpha[0]).toBe(0);
    expect(disc.edgeDashed).toBe(true);
  });

  it("draws no edge through a pole", () => {
    // y·x = 1 is fine; tan(x) = y crosses through poles that must not join.
    const [g] = geometry(spec(["y = tan(x)".replace("y = ", "") + " - y = 0"]), 4);
    for (const poly of g.strokes) {
      for (let i = 0; i + 3 < poly.length; i += 2) {
        expect(Math.abs(poly[i + 3] - poly[i + 1])).toBeLessThan(5);
      }
    }
  });

  it("keeps the implicit grid bounded", () => {
    const [g] = sampleGraphGeometry(prepareGraph(spec(["x^2+y^2<25"])), RANGE, 4000, 4000, {
      cell: 1,
    });
    expect(g.mask!.cols * g.mask!.rows).toBeLessThanOrEqual(40_000);
  });

  it("draws parametric and polar curves", () => {
    const [circle] = geometry(spec(["(5cos(t), 5sin(t))"]));
    const pts = vertices(circle.strokes);
    for (const [x, y] of pts) expect(Math.abs(Math.hypot(x, y) - 5)).toBeLessThan(1e-9);
    expect(pts.length).toBeGreaterThan(100);
    const [rose] = geometry(spec(["r = 4cos(2θ)"]));
    expect(rose.strokes.length).toBeGreaterThan(0);
    const [deg] = sampleGraphGeometry(prepareGraph(spec(["r = 3"], { angle: "deg" })), RANGE, W, H);
    for (const [x, y] of vertices(deg.strokes))
      expect(Math.abs(Math.hypot(x, y) - 3)).toBeLessThan(1e-9);
  });

  it("breaks a parametric curve where it leaves its domain or jumps", () => {
    const lines = sampleParametric(
      (t) => t,
      (t) => (t === 0 ? NaN : 1 / t),
      -1,
      1,
      RANGE,
      W,
      H,
    );
    expect(lines.length).toBe(2);
    expect(
      sampleParametric(
        () => 0,
        () => 0,
        1,
        0,
        RANGE,
        W,
        H,
      ),
    ).toEqual([]);
  });

  it("plots points", () => {
    const [p] = geometry(spec(["(1, 2), (3, a), (0, 1/0)"]));
    expect(p.dots).toEqual([1, 2, 3, 1]);
  });

  it("draws the derivative, a tangent and a shaded area", () => {
    const [g] = geometry(spec([{ text: "x^2", derivative: true, tangentAt: 1, area: [3, 0] }]));
    for (const [x, y] of vertices(g.derivative!)) expect(Math.abs(y - 2 * x)).toBeLessThan(0.05);
    expect(g.tangent).toMatchObject({ x: 1, y: 1 });
    expect(g.tangent!.slope).toBeCloseTo(2, 8);
    expect(g.area!.value).toBeCloseTo(9, 9);
    expect([g.area!.from, g.area!.to]).toEqual([0, 3]);
    for (const poly of g.area!.fills) {
      for (const [x] of vertices([poly])) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(3);
      }
    }
    const [bad] = geometry(spec([{ text: "1/x", area: [-1, 1] }]));
    expect(bad.area!.value).toBeNull();
  });
});

describe("points of interest", () => {
  it("finds roots, extrema, the intercept and intersections", () => {
    const s = spec(["x^2 - 4", "x"]);
    const prepared = prepareGraph(s);
    const geo = sampleGraphGeometry(prepared, RANGE, W, H);
    const pois = pointsOfInterest(prepared, RANGE, geo);
    const find = (kind: string, x: number) =>
      pois.find((p) => p.kind === kind && Math.abs(p.x - x) < 1e-6);
    expect(find("root", 2)).toBeDefined();
    expect(find("root", -2)).toBeDefined();
    expect(find("min", 0)?.y).toBeCloseTo(-4, 8);
    // x and x² − 4 cross at (1 ± √17) / 2.
    expect(find("intersection", (1 + Math.sqrt(17)) / 2)?.lines).toEqual(["l1", "l2"]);
    expect(find("intersection", (1 - Math.sqrt(17)) / 2)).toBeDefined();
    // The line x passes through the origin: a root and an intercept at once, one dot.
    expect(pois.filter((p) => Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9)).toHaveLength(1);
  });

  it("finds a maximum, ignores hidden lines and what is out of view", () => {
    const prepared = prepareGraph(spec(["-(x-1)^2 + 3", { text: "x - 100", hidden: true }]));
    const geo = sampleGraphGeometry(prepared, RANGE, W, H);
    const pois = pointsOfInterest(prepared, RANGE, geo);
    const max = pois.find((p) => p.kind === "max");
    expect(max?.x).toBeCloseTo(1, 6);
    expect(max?.y).toBeCloseTo(3, 9);
    expect(pois.every((p) => p.lines[0] === "l1")).toBe(true);
  });

  it("reads a function line's value and a table", () => {
    const prepared = prepareGraph(
      spec(["y = ax", "x^2 + y^2 = 1"], {
        sliders: [{ name: "a", value: 2, min: 0, max: 5, step: 1 }],
      }),
    );
    expect(valueOfLine(prepared, "l1", 3)).toBe(6);
    expect(valueOfLine(prepared, "l2", 0)).toBeNaN();
    expect(valueOfLine(prepared, "nope", 0)).toBeNaN();
    const table = tableOfValues(prepared, "l1", RANGE);
    expect(table.map((r) => r.x)).toEqual([-6, -4, -2, 0, 2, 4, 6]);
    expect(table.map((r) => r.y)).toEqual([-12, -8, -4, 0, 4, 8, 12]);
  });
});
