import { describe, expect, it } from "vitest";
import { pdfNumber, vectorInk, type VectorInkOptions } from "../../src/export/vector-ink";
import { inkRuns } from "../../src/ink/freehand";
import { penFor, styleOf } from "../../src/canvas/stroke-style";
import type { Stroke } from "../../src/model/document";

const day: VectorInkOptions = { usePressure: true, highlighterAlpha: 0.3, shade: "day" };

function stroke(over: Partial<Stroke> = {}): Stroke {
  return {
    id: "s",
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pts: [10, 10, 0.2, 30, 14, 0.5, 50, 22, 0.9, 70, 25, 0.6, 90, 40, 0.3],
    ...over,
  } as Stroke;
}

/** The operators, one per line, without the leading round caps and joins. */
function lines(ops: string): string[] {
  return ops.split("\n");
}

describe("vector ink", () => {
  it("strokes each run of the tracer at its own width with round caps and joins", () => {
    const s = stroke();
    const runs = inkRuns(s.pts, penFor(styleOf(s, true)));
    expect(runs.length).toBeGreaterThan(1);
    const { ops, states, groups } = vectorInk([s], day);
    expect(states.size).toBe(0);
    expect(groups.size).toBe(0);
    const out = lines(ops);
    expect(out[0]).toBe("1 J 1 j");
    // The colour once, then a width before each run whose width changed.
    expect(out.filter((l) => l.endsWith(" RG"))).toEqual(["0.102 0.102 0.102 RG"]);
    const widths = out.filter((l) => l.endsWith(" w")).map((l) => Number.parseFloat(l));
    const expected = runs
      .map((run) => Math.round(run.width * 100) / 100)
      .filter((w, i, all) => i === 0 || w !== all[i - 1]);
    expect(widths).toEqual(expected);
    expect(out.filter((l) => l === "S")).toHaveLength(runs.length);
    // Every run's points, in page px, in order.
    const first = runs[0];
    expect(
      out[out.indexOf(`${pdfNumber(first.pts[0])} ${pdfNumber(first.pts[1])} m`)],
    ).toBeDefined();
  });

  it("draws nothing for no strokes, and leaves out a cover tape", () => {
    expect(vectorInk([], day).ops).toBe("");
    expect(vectorInk([stroke({ tool: "tape", size: 30 })], day).ops).toBe("");
  });

  it("draws a single point as a zero-length line, which a round cap makes a dot", () => {
    const { ops } = vectorInk([stroke({ pts: [5, 6, 0.5] })], day);
    expect(lines(ops)).toContain("5 6 m");
    expect(lines(ops)).toContain("5 6 l");
  });

  it("multiplies a highlighter into the paper by day and screens it on dark paper", () => {
    const h = stroke({ tool: "highlighter", color: "#ffeb3b", size: 16 });
    const lit = vectorInk([h], day);
    expect([...lit.states.values()]).toEqual([{ alpha: 0.3, blend: "Multiply" }]);
    const out = lines(lit.ops);
    const at = out.indexOf("/Gs0 gs");
    expect(at).toBeGreaterThan(0);
    expect(out[at - 1]).toBe("q");
    expect(out.at(-1)).toBe("Q");
    const dark = vectorInk([h], { ...day, shade: "dark" });
    expect([...dark.states.values()]).toEqual([{ alpha: 0.3, blend: "Screen" }]);
    // On dark paper the highlighter is shown in its night colour, as on the canvas.
    expect(dark.ops).not.toBe(lit.ops);
  });

  it("shares one graphics state between highlighters of the same alpha", () => {
    const h = stroke({ tool: "highlighter", color: "#ffeb3b", size: 16 });
    const { states, ops } = vectorInk([h, { ...h, id: "h2", color: "#8bc34a" }], day);
    expect(states.size).toBe(1);
    expect(lines(ops).filter((l) => l === "/Gs0 gs")).toHaveLength(2);
  });

  it("lays a highlighter traced as several runs down once, as a transparency group", () => {
    // A tilted Pencil widens the line part of the way: several runs.
    const pts = [10, 10, 0.5, 40, 10, 0.5, 70, 10, 0.5, 100, 10, 0.5, 130, 10, 0.5];
    const h = stroke({
      tool: "highlighter",
      color: "#ffeb3b",
      size: 10,
      pts,
      tilt: [90, 60, 35, 25, 15],
    });
    expect(inkRuns(h.pts, penFor(styleOf(h, true)), false, h.tilt).length).toBeGreaterThan(1);
    const { ops, groups, states } = vectorInk([h], day);
    expect(groups.size).toBe(1);
    const group = groups.get("Ink0");
    expect(group?.ops).toContain("S");
    expect(group?.ops).not.toContain("gs");
    const [x0, y0, x1, y1] = group!.bbox;
    expect(x0).toBeLessThan(10);
    expect(y0).toBeLessThan(10);
    expect(x1).toBeGreaterThan(130);
    expect(y1).toBeGreaterThan(10);
    expect(lines(ops)).toEqual(["1 J 1 j", "q", "/Gs0 gs", "/Ink0 Do", "Q"]);
    expect(states.get("Gs0")).toEqual({ alpha: 0.3, blend: "Multiply" });
  });

  it("fills a chisel highlighter's swept outline instead of stroking it", () => {
    const h = stroke({ tool: "highlighter", color: "#ffeb3b", size: 16, tip: "chisel" });
    const out = lines(vectorInk([h], day).ops);
    expect(out).toContain("f");
    expect(out).not.toContain("S");
    expect(out.some((l) => l.endsWith(" rg"))).toBe(true);
  });

  it("shows ink in its night colour on a night page", () => {
    const night = vectorInk([stroke()], { ...day, shade: "night" });
    const rg = lines(night.ops).find((l) => l.endsWith(" RG"))!;
    // Near-black ink is shown near-white at night.
    expect(Number.parseFloat(rg)).toBeGreaterThan(0.8);
  });

  it("draws a rounded shape's corners as arcs: a line to the tangent point, a cubic to the next", () => {
    // An open L: (0,0) → (100,0) → (100,100), a 10 px corner.
    const shape = stroke({
      shape: "path",
      radius: 10,
      size: 2,
      pts: [0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5],
    } as Partial<Stroke>);
    const out = lines(vectorInk([shape], day).ops);
    expect(out).toContain("0 0 m");
    expect(out).toContain("90 0 l");
    const k = (4 / 3) * Math.tan(Math.PI / 8) * 10;
    expect(out).toContain(`${pdfNumber(90 + k)} 0 100 ${pdfNumber(10 - k)} 100 10 c`);
    expect(out).toContain("100 100 l");
  });

  it("fills a closed shape under its dashed outline, then stops dashing", () => {
    const square = stroke({
      shape: "rect",
      size: 2,
      fill: "#ff000080",
      dash: "dash",
      pts: [0, 0, 0.5, 50, 0, 0.5, 50, 50, 0.5, 0, 50, 0.5, 0, 0, 0.5],
    } as Partial<Stroke>);
    const { ops, states } = vectorInk([square], day);
    const out = lines(ops);
    // The fill's alpha is a graphics state of its own, inside a q … Q.
    expect([...states.values()]).toEqual([{ alpha: 0.502, blend: "Normal" }]);
    expect(out).toContain("1 0 0 rg");
    const fill = out.indexOf("f");
    const dash = out.findIndex((l) => l.endsWith(" 0 d") && l !== "[] 0 d");
    expect(fill).toBeGreaterThan(0);
    expect(dash).toBeGreaterThan(fill);
    expect(out[dash]).toBe("[4 6] 0 d");
    expect(out.indexOf("[] 0 d")).toBeGreaterThan(dash);
  });

  it("draws a filled arrowhead filled and stroked, and an open one stroked", () => {
    const arrow = (head: "open" | "filled"): string[] =>
      lines(
        vectorInk(
          [
            stroke({
              shape: "line",
              size: 2,
              heads: { end: head },
              pts: [0, 0, 0.5, 100, 0, 0.5],
            } as Partial<Stroke>),
          ],
          day,
        ).ops,
      );
    const filled = arrow("filled");
    expect(filled.filter((l) => l === "B")).toHaveLength(1);
    expect(filled[filled.indexOf("B") - 1]).toBe("h");
    const open = arrow("open");
    expect(open).not.toContain("B");
    expect(open.filter((l) => l === "S")).toHaveLength(2);
  });

  it("writes numbers as a content stream reads them", () => {
    expect(pdfNumber(1.005)).toBe("1");
    expect(pdfNumber(-0.001)).toBe("0");
    expect(pdfNumber(12.345)).toBe("12.35");
    expect(pdfNumber(1e21)).toBe("1000000000");
    expect(pdfNumber(Number.NaN)).toBe("0");
  });
});
