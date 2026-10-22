import { describe, expect, it } from "vitest";
import {
  type GraphColors,
  formatPi,
  minorValues,
  paintGraph,
  paintGraphGeometry,
  pointLabel,
  preparedOf,
  renderGraphSpec,
} from "../../src/canvas/graph-painter";
import type { LineGeometry } from "../../src/model/graph-sample";
import { sampleCurve } from "../../src/model/graph";

interface Call {
  name: string;
  args: unknown[];
  state: Record<string, unknown>;
}

/** A context that writes down each call with the style in force. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === "measureText") return (s: string) => ({ width: s.length * 6 });
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      return (...args: unknown[]) => calls.push({ name: key, args, state: { ...target } });
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const COLORS: GraphColors = {
  background: "#fff",
  grid: "#eee",
  axis: "#888",
  label: "#555",
  curves: ["#2f6fde", "#d9433b"],
};
const RANGE = { xMin: -10, xMax: 10, yMin: -5, yMax: 5 };
const FRAME = { x: 20, y: 30, w: 400, h: 200 };

describe("paintGraph", () => {
  it("draws grid, axes, labels and each curve in its colour, clipped to the frame", () => {
    const { ctx, calls } = recorder();
    const curves = [sampleCurve(Math.sin, RANGE, 400, 200), sampleCurve(Math.tan, RANGE, 400, 200)];
    paintGraph(ctx, FRAME, RANGE, curves, { colors: COLORS });
    expect(calls[0].name).toBe("save");
    expect(calls.find((c) => c.name === "rect")?.args).toEqual([20, 30, 400, 200]);
    expect(calls.some((c) => c.name === "clip")).toBe(true);
    expect(calls.find((c) => c.name === "fillRect")?.state.fillStyle).toBe("#fff");
    const strokes = calls.filter((c) => c.name === "stroke").map((c) => c.state.strokeStyle);
    // Minor grid, major grid, axes, then the curves.
    expect(strokes).toEqual(["#eee", "#eee", "#888", "#2f6fde", "#d9433b"]);
    const labels = calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(labels).toContain("5");
    expect(labels).toContain("−5");
    expect(labels).not.toContain("0");
    // tan breaks into separate runs: one moveTo per run.
    const moves = calls.filter((c) => c.name === "moveTo" && c.state.strokeStyle === "#d9433b");
    expect(moves.length).toBe(curves[1].length);
    expect(calls[calls.length - 1].name).toBe("restore");
  });

  it("maps value space into the frame", () => {
    const { ctx, calls } = recorder();
    paintGraph(ctx, FRAME, RANGE, [[[0, 0, 10, 5]]], {
      colors: COLORS,
      grid: false,
      labels: false,
    });
    const curve = calls.filter((c) => c.state.strokeStyle === "#2f6fde");
    expect(curve.find((c) => c.name === "moveTo")?.args).toEqual([220, 130]);
    expect(curve.find((c) => c.name === "lineTo")?.args).toEqual([420, 30]);
    expect(calls.some((c) => c.name === "fillText")).toBe(false);
  });

  it("scales lines and fonts by the unit", () => {
    const { ctx, calls } = recorder();
    paintGraph(ctx, { x: 0, y: 0, w: 800, h: 400 }, RANGE, [[[0, 0, 1, 1]]], {
      colors: COLORS,
      unit: 2,
      fontFamily: "Inter",
    });
    const curve = calls.find((c) => c.name === "stroke" && c.state.strokeStyle === "#2f6fde");
    expect(curve?.state.lineWidth).toBe(4.5);
    expect(calls.find((c) => c.name === "fillText")?.state.font).toBe("22px Inter");
  });

  it("puts labels on the frame's edge when an axis is out of view", () => {
    const { ctx, calls } = recorder();
    const away = { xMin: 5, xMax: 15, yMin: 5, yMax: 10 };
    paintGraph(ctx, FRAME, away, [], { colors: { ...COLORS, background: undefined } });
    const texts = calls.filter((c) => c.name === "fillText");
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      const [, x, y] = t.args as [string, number, number];
      expect(x).toBeGreaterThanOrEqual(FRAME.x);
      expect(x).toBeLessThanOrEqual(FRAME.x + FRAME.w);
      expect(y).toBeGreaterThanOrEqual(FRAME.y);
      expect(y).toBeLessThanOrEqual(FRAME.y + FRAME.h);
    }
    expect(calls.some((c) => c.name === "fillRect")).toBe(false);
  });

  it("draws a traced point and keeps its label inside the frame", () => {
    const { ctx, calls } = recorder();
    paintGraph(ctx, FRAME, RANGE, [[]], {
      colors: COLORS,
      trace: { x: 10, y: 5, curve: 1, label: "(10, 5)" },
    });
    const dot = calls.find((c) => c.name === "arc");
    expect(dot?.args.slice(0, 2)).toEqual([420, 30]);
    const label = calls.find((c) => c.name === "roundRect")!;
    const [left, top, width] = label.args as number[];
    expect(left + width).toBeLessThanOrEqual(FRAME.x + FRAME.w);
    expect(top).toBeGreaterThanOrEqual(FRAME.y);
    expect(label.state.fillStyle).toBe("#d9433b");
  });

  it("draws nothing into an empty frame", () => {
    const { ctx, calls } = recorder();
    paintGraph(ctx, { x: 0, y: 0, w: 0, h: 10 }, RANGE, [], { colors: COLORS });
    expect(calls).toEqual([]);
  });
});

describe("paintGraphGeometry and renderGraphSpec", () => {
  const geometry = (extra: Partial<LineGeometry> = {}): LineGeometry => ({
    id: "l1",
    color: "#c74440",
    dashed: false,
    width: 2.25,
    strokes: [[0, 0, 5, 5]],
    fills: [],
    dots: [],
    ...extra,
  });

  it("fills regions lightly under dashed strokes, and draws dots, derivatives and tangents", () => {
    const { ctx, calls } = recorder();
    paintGraphGeometry(
      ctx,
      FRAME,
      RANGE,
      [
        geometry({
          dashed: true,
          fills: [[0, 0, 5, 0, 5, 5]],
          dots: [1, 1, 2, 2],
          derivative: [[0, 1, 1, 2]],
          tangent: { stroke: [-10, -1, 10, 1], x: 0, y: 0, slope: 0.1 },
          area: { fills: [[0, 0, 1, 1, 1, 0]], value: 0.5, from: 0, to: 1 },
        }),
      ],
      { colors: COLORS },
    );
    const fills = calls.filter((c) => c.name === "fill");
    expect(fills.some((c) => c.state.globalAlpha === 0.15)).toBe(true);
    expect(fills.some((c) => c.state.globalAlpha === 0.3)).toBe(true);
    const dashes = calls.filter((c) => c.name === "setLineDash").map((c) => c.args[0]);
    expect(dashes).toContainEqual([7, 5]);
    expect(dashes).toContainEqual([3, 4]);
    expect(calls.filter((c) => c.name === "arc").length).toBeGreaterThanOrEqual(3);
    expect(calls.some((c) => c.name === "fillText" && c.args[0] === "∫ = 0.5")).toBe(true);
  });

  it("says when an area does not converge", () => {
    const { ctx, calls } = recorder();
    paintGraphGeometry(
      ctx,
      FRAME,
      RANGE,
      [geometry({ area: { fills: [[0, 0, 1, 1, 1, 0]], value: null, from: 0, to: 1 } })],
      { colors: COLORS },
    );
    expect(calls.some((c) => c.name === "fillText" && c.args[0] === "∫ does not converge")).toBe(
      true,
    );
  });

  it("draws an implicit region through a small canvas, or as rectangles without one", () => {
    const mask = { cols: 2, rows: 2, alpha: new Uint8Array([255, 0, 0, 255]) };
    const puts: unknown[] = [];
    const small = {
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image: { data: Uint8ClampedArray }) => puts.push(Array.from(image.data)),
      }),
    };
    const { ctx, calls } = recorder();
    paintGraphGeometry(ctx, FRAME, RANGE, [geometry({ mask })], {
      colors: COLORS,
      makeCanvas: () => small as unknown as HTMLCanvasElement,
    });
    expect(calls.find((c) => c.name === "drawImage")?.args.slice(1)).toEqual([20, 30, 400, 200]);
    expect((puts[0] as number[]).slice(0, 4)).toEqual([0xc7, 0x44, 0x40, 255]);
    const plain = recorder();
    paintGraphGeometry(plain.ctx, FRAME, RANGE, [geometry({ mask, color: "red" })], {
      colors: COLORS,
      makeCanvas: () => null,
    });
    expect(plain.calls.filter((c) => c.name === "rect").length).toBe(3);
  });

  it("draws points of interest, pins and π ticks", () => {
    const { ctx, calls } = recorder();
    paintGraphGeometry(ctx, { x: 0, y: 0, w: 800, h: 400 }, RANGE, [], {
      colors: COLORS,
      piTicks: true,
      pois: [{ x: 1, y: 1, kind: "root", lines: ["l1"] }],
      pins: [{ x: 2, y: 1, color: "#00f", label: "(2, 1)" }],
    });
    const labels = calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(labels).toContain("π");
    expect(labels).toContain("−2π");
    expect(labels).toContain("(2, 1)");
    expect(calls.filter((c) => c.name === "arc").length).toBe(2);
  });

  it("draws the selected line last, heavier, over a halo in its colour, with its points as rings", () => {
    const line = (id: string, color: string): LineGeometry => ({
      id,
      color,
      dashed: false,
      width: 2.5,
      strokes: [[-5, 0, 5, 1]],
      fills: [],
      dots: [],
    });
    const { ctx, calls } = recorder();
    paintGraphGeometry(
      ctx,
      { x: 0, y: 0, w: 400, h: 400 },
      RANGE,
      [line("a", "#f00"), line("b", "#00f")],
      {
        colors: COLORS,
        selected: "a",
        pois: [{ x: 0, y: 0, kind: "root", lines: ["a"] }],
      },
    );
    const strokes = calls.filter((c) => c.name === "stroke" && c.state.strokeStyle !== COLORS.grid);
    const curves = strokes.filter(
      (c) => c.state.strokeStyle === "#f00" || c.state.strokeStyle === "#00f",
    );
    // b first; then a's halo (wide, faint), then a itself one px heavier.
    expect(curves.slice(0, 3).map((c) => [c.state.strokeStyle, c.state.lineWidth])).toEqual([
      ["#00f", 2.5],
      ["#f00", 9.5],
      ["#f00", 3.5],
    ]);
    expect(curves[1].state.globalAlpha).toBeLessThan(0.5);
    // The ring: background inside, the selected line's colour round it.
    const ring = calls.filter((c) => c.name === "arc").at(-1);
    expect(ring).toBeDefined();
    const after = calls.slice(calls.indexOf(ring!));
    expect(after.find((c) => c.name === "stroke")?.state.strokeStyle).toBe("#f00");
    expect(after.find((c) => c.name === "fill")?.state.fillStyle).toBe(COLORS.background);
  });

  it("puts minor grid lines between the major ones, never on them", () => {
    const { step, values } = minorValues(-2, 2, 1, false);
    expect(step).toBeCloseTo(0.2, 12);
    expect(values.length).toBe(16);
    for (const v of values) expect(Math.abs(v - Math.round(v))).toBeGreaterThan(1e-6);
    // π ticks are halved.
    expect(minorValues(0, 2 * Math.PI, Math.PI, true).values).toEqual([
      Math.PI / 2,
      (3 * Math.PI) / 2,
    ]);
    // Minor lines are drawn only while far enough apart.
    const dense = recorder();
    paintGraphGeometry(
      dense.ctx,
      { x: 0, y: 0, w: 100, h: 100 },
      { xMin: -1000, xMax: 1000, yMin: -1000, yMax: 1000 },
      [],
      {
        colors: COLORS,
      },
    );
    expect(
      dense.calls.filter(
        (c) =>
          c.name === "stroke" && c.state.globalAlpha !== 1 && c.state.globalAlpha !== undefined,
      ).length,
    ).toBeLessThanOrEqual(1);
  });

  it("labels a named pin with its name alone", () => {
    const { ctx, calls } = recorder();
    paintGraphGeometry(ctx, { x: 0, y: 0, w: 400, h: 400 }, RANGE, [], {
      colors: COLORS,
      pins: [{ x: 2, y: 1, color: "#00f", label: "(2, 1)", name: "A" }],
    });
    const labels = calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(labels).toContain("A");
    expect(labels).not.toContain("(2, 1)");
  });

  it("names multiples of π", () => {
    expect(formatPi(0)).toBe("0");
    expect(formatPi(Math.PI)).toBe("π");
    expect(formatPi(-Math.PI)).toBe("−π");
    expect(formatPi(Math.PI / 2)).toBe("π/2");
    expect(formatPi((3 * Math.PI) / 4)).toBe("3π/4");
    expect(formatPi(-2 * Math.PI)).toBe("−2π");
    expect(formatPi(0.123 * Math.PI)).toBe("0.12π");
  });

  it("renders a whole spec, version 1 or 2, pins included, and caches its compilation", () => {
    const { ctx, calls } = recorder();
    const spec = {
      ...RANGE,
      expressions: [],
      lines: [
        { id: "a", text: "y = kx" },
        { id: "b", text: "x^2+y^2<4", color: "#00ff00" },
      ],
      sliders: [{ name: "k", value: 0.5, min: 0, max: 1, step: 0.1 }],
      pins: [
        { line: "a", x: 2 },
        { line: "nope", x: 1 },
      ],
      grid: false,
    };
    const geo = renderGraphSpec(ctx, FRAME, spec, { colors: COLORS, resolution: 2, unit: 1 });
    expect(geo).toHaveLength(2);
    expect(geo[1].mask).toBeDefined();
    expect(calls.some((c) => c.name === "fillText" && c.args[0] === "(2, 1)")).toBe(true);
    expect(preparedOf(spec)).toBe(preparedOf({ ...spec }));
    const old = recorder();
    expect(
      renderGraphSpec(old.ctx, FRAME, { ...RANGE, expressions: ["sin(x)"] }, { colors: COLORS }),
    ).toHaveLength(1);
    expect(renderGraphSpec(old.ctx, { x: 0, y: 0, w: 0, h: 0 }, spec, { colors: COLORS })).toEqual(
      [],
    );
  });

  it("labels points briefly", () => {
    expect(pointLabel(1.23456789, -0.000012)).toBe("(1.2346, −1.200e-5)");
    expect(pointLabel(0, 2e7)).toBe("(0, 2.000e+7)");
  });
});
