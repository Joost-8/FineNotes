import { describe, expect, it } from "vitest";
import { type GraphColors, paintGraph } from "../../src/canvas/graph-painter";
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
    expect(strokes).toEqual(["#eee", "#888", "#2f6fde", "#d9433b"]);
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
