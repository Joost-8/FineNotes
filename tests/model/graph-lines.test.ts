import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDER,
  MAX_LINES,
  compileLine,
  newLineId,
  normalizeGraphSpec,
  sliderVars,
  syncSliders,
} from "../../src/model/graph-lines";

const RANGE = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
const kind = (text: string, angle: "deg" | "rad" = "rad"): string => {
  const plot = compileLine(text, angle).plot;
  return plot.kind === "error" ? `error: ${plot.error}` : plot.kind;
};

describe("what a line plots", () => {
  it.each([
    ["sin(x)", "function"],
    ["sinx", "function"],
    ["y = x^2", "function"],
    ["f(x) = 2x+1", "function"],
    ["x^2 = y", "function"],
    ["x = y^2", "sideways"],
    ["x = 3", "vertical"],
    ["x = a", "vertical"],
    ["y < sin(x)", "region"],
    ["sin(x) >= y", "region"],
    ["x > 2", "vregion"],
    ["x^2 + y^2 = 25", "implicit"],
    ["x^2 + y^2 < 25", "implicit"],
    ["xy = 1", "implicit"],
    ["(cos(t), sin(t))", "parametric"],
    ["r = 1 + cos(θ)", "polar"],
    ["r = 2", "polar"],
    ["(1, 2)", "points"],
    ["(1, 2), (3, a), (-1, -1)", "points"],
    ["", "empty"],
    ["   ", "empty"],
    ["x^2 + y^2", "error: Add = or < to plot a curve in x and y"],
    ["r < 2", "error: A polar curve is r = f(θ)"],
    ["(1, 2), 3", "error: Points are written (x, y), (x, y)"],
    ["sin(x) {x}", "error: A restriction needs < or >"],
    ["sin(", "error: Syntax error"],
    ["2+", "error: Syntax error"],
    ["y = t", "error: t has no meaning here"],
    ["y = foo(x)", "function"],
  ])("%s → %s", (text, want) => {
    expect(kind(text)).toBe(want);
  });

  it("finds slider letters, not its own variables", () => {
    expect(compileLine("y = ax^2 + bx + c").free).toEqual(["a", "b", "c"]);
    expect(compileLine("(a cos(t), b sin(t))").free).toEqual(["a", "b"]);
    expect(compileLine("r = k θ").free).toEqual(["k"]);
    expect(compileLine("x^2 + y^2 = r0").free).toEqual([]);
    expect(compileLine("sin(x) {a < x < b}").free).toEqual(["a", "b"]);
    expect(compileLine("Σ(n^k, k, 1, 3)").free).toEqual(["n"]);
  });

  it("compiles each kind into working functions", () => {
    const vars = new Map([["a", 2]]);
    const f = compileLine("y = ax + 1").plot;
    if (f.kind !== "function") throw new Error();
    vars.set("x", 3);
    expect(f.f(vars)).toBe(7);
    const c = compileLine("x = a").plot;
    if (c.kind !== "vertical") throw new Error();
    expect(c.c(vars)).toBe(2);
    const imp = compileLine("x^2 + y^2 = 25").plot;
    if (imp.kind !== "implicit") throw new Error();
    vars.set("x", 3).set("y", 4);
    expect(imp.F(vars)).toBe(0);
    const reg = compileLine("sin(x) > y").plot;
    expect(reg.kind === "region" && reg.below && reg.strict).toBe(true);
    const le = compileLine("y >= x").plot;
    expect(le.kind === "region" && !le.below && !le.strict).toBe(true);
  });

  it("reads plain bounds on t and θ as their range", () => {
    const p = compileLine("(cos(t), sin(t)) {0 < t < π}").plot;
    expect(p.kind === "parametric" && [p.from, p.to]).toEqual([0, Math.PI]);
    const q = compileLine("r = θ {0 ≤ θ ≤ 4π}").plot;
    expect(q.kind === "polar" && q.to).toBeCloseTo(4 * Math.PI, 12);
    const d = compileLine("r = 1", "deg").plot;
    expect(d.kind === "polar" && d.to).toBe(360);
    const pts = compileLine("(t, t^2) {-2 < t < 2}").plot;
    expect(pts.kind === "parametric" && [pts.from, pts.to]).toEqual([-2, 2]);
  });

  it("restricts a curve's domain", () => {
    const line = compileLine("y = x {0 < x < 5}");
    const vars = new Map([["x", 3]]);
    expect(line.domain?.(vars)).toBe(1);
    vars.set("x", 6);
    expect(line.domain?.(vars)).toBe(0);
    const two = compileLine("y = x {x > 0, x < 5}");
    vars.set("x", -1);
    expect(two.domain?.(vars)).toBe(0);
  });
});

describe("the spec", () => {
  it("reads version 1 into lines and mirrors expressions", () => {
    const spec = normalizeGraphSpec({ ...RANGE, expressions: ["sin(x)", "x^2"] });
    expect(spec.version).toBe(2);
    expect(spec.lines.map((l) => [l.id, l.text])).toEqual([
      ["l1", "sin(x)"],
      ["l2", "x^2"],
    ]);
    expect(spec.expressions).toEqual(["sin(x)", "x^2"]);
  });

  it("keeps unknown fields, checks known ones, caps the lines", () => {
    const spec = normalizeGraphSpec({
      ...RANGE,
      expressions: [],
      future: { keep: true },
      version: 7,
      lines: [
        { id: "a", text: "x", color: "#ff0000", hidden: true, style: "dashed", width: 4, glow: 3 },
        {
          id: "a",
          text: "y",
          color: "red",
          hidden: "yes",
          style: "wavy",
          width: -1,
          area: [0, "x"],
        },
        { text: 5 },
        "x^3",
        ...Array.from({ length: 10 }, (_, i) => `x+${i}`),
      ],
      sliders: [
        { name: "a", value: 3, min: 5, max: -5, step: 0.5, extra: 1 },
        { name: "a", value: 9 },
        { name: "bb" },
        { name: "c", min: 2, max: 2 },
      ],
    });
    expect(spec.future).toEqual({ keep: true });
    expect(spec.version).toBe(7);
    expect(spec.lines).toHaveLength(MAX_LINES);
    expect(spec.lines[0]).toMatchObject({
      id: "a",
      color: "#ff0000",
      hidden: true,
      style: "dashed",
      width: 4,
      glow: 3,
    });
    expect(spec.lines[1].id).not.toBe("a");
    expect(spec.lines[1].color).toBeUndefined();
    expect(spec.lines[1].hidden).toBeUndefined();
    expect(spec.lines[1].style).toBeUndefined();
    expect(spec.lines[1].width).toBeUndefined();
    expect(spec.lines[1].area).toBeUndefined();
    expect(spec.lines[2].text).toBe("x^3");
    expect(spec.sliders).toEqual([
      { name: "a", value: 3, min: -5, max: 5, step: 0.5, extra: 1 },
      { name: "c", value: 1, min: 2, max: 3, step: 0.1 },
    ]);
  });

  it("makes sliders follow the letters", () => {
    const lines = ["y = ax", "y = x + c"].map((t) => compileLine(t));
    const kept = [
      { name: "a", value: 5, min: 0, max: 9, step: 1 },
      { name: "z", ...DEFAULT_SLIDER },
    ];
    const synced = syncSliders(kept, lines);
    expect(synced.map((s) => s.name)).toEqual(["a", "c"]);
    expect(synced[0].value).toBe(5);
    expect(sliderVars(synced).get("c")).toBe(1);
  });

  it("names new lines uniquely", () => {
    expect(
      newLineId([
        { id: "l1", text: "" },
        { id: "l2", text: "" },
      ]),
    ).toBe("l3");
    expect(newLineId([{ id: "l2", text: "" }])).toBe("l3");
  });
});
