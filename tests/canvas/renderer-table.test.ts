/**
 * `paintTable` in `src/canvas/renderer.ts`: the one function tiles,
 * previews, thumbnails, the PDF export and the lasso draft paint a table
 * with. Fills under the text, the text where the layout puts it (all but the
 * cell being typed in), the grid last, in the table's colour, width and dash;
 * a night page maps the colours.
 *
 * The context is the recording stub, with a monospace `measureText`: every
 * character is half the font size wide.
 */

import { describe, expect, it } from "vitest";
import { paintTable, tableLayoutOf } from "../../src/canvas/renderer";
import { nightColor } from "../../src/canvas/night";
import { headerFillOf, makeTable, setCellText } from "../../src/model/table";
import type { TableElement } from "../../src/model/document";
import { type FakeContext, asCanvasContext, fakeContext, segments } from "./fake-canvas";

function context(): FakeContext & { measureText: (t: string) => { width: number } } {
  const ctx = fakeContext();
  const px = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
  return Object.assign(ctx, {
    measureText: (text: string) => ({ width: text.length * px() * 0.5 }),
  });
}

function table(extra: Partial<TableElement> = {}): TableElement {
  const t = makeTable({
    id: "g1",
    x: 10,
    y: 20,
    w: 300,
    h: 90,
    rows: 3,
    cols: 3,
    color: "#112233",
    textColor: "#445566",
    fontSize: 16,
    header: true,
  });
  setCellText(t, 0, 0, "Name");
  setCellText(t, 1, 2, "Value");
  return { ...t, ...extra };
}

describe("paintTable", () => {
  it("fills the header, writes the cells and rules the grid over them", () => {
    const ctx = context();
    const t = table();
    paintTable(asCanvasContext(ctx), t);
    const ops = ctx.ops;
    // Every row is at least one line tall (16 px x 1.25, and 6 px inset above
    // and below), as the cell's textarea is: 32 px, over the 30 asked for.
    const fill = ops.find((o) => o.op === "fillRect");
    expect(fill).toMatchObject({ x: 10, y: 20, w: 300, h: 32 });
    const texts = ops.filter((o) => o.op === "fillText").map((o) => o.op === "fillText" && o.text);
    expect(texts).toEqual(["Name", "Value"]);
    // The grid comes after every text, in the table's colour.
    const lastText = ops.map((o) => o.op).lastIndexOf("fillText");
    const stroke = ops.findIndex((o) => o.op === "stroke");
    expect(stroke).toBeGreaterThan(lastText);
    expect(ops[stroke]).toMatchObject({ strokeStyle: "#112233" });
    // Two inner column lines and two inner row lines, then the outline.
    const lines = segments(ops);
    expect(lines.filter((l) => l.x0 === l.x1).map((l) => l.x0)).toEqual([110, 210]);
    expect(lines.filter((l) => l.y0 === l.y1).map((l) => l.y0)).toEqual([52, 84]);
    expect(ops).toContainEqual({ op: "rect", x: 10, y: 20, w: 300, h: 96 });
    expect(ctx.depth).toBe(0);
  });

  it("leaves out the text of the cell being typed in", () => {
    const ctx = context();
    paintTable(asCanvasContext(ctx), table(), false, { row: 1, col: 2 });
    const texts = ctx.ops.filter((o) => o.op === "fillText");
    expect(texts).toHaveLength(1);
  });

  it("dashes the grid, and maps colours on a night page", () => {
    const ctx = context();
    const t = table({ dash: "dash", fill: "#ffeeaa" });
    paintTable(asCanvasContext(ctx), t, true);
    expect(ctx.ops.find((o) => o.op === "setLineDash")).toMatchObject({
      segments: [3, 4.5],
    });
    expect(ctx.ops.find((o) => o.op === "stroke")).toMatchObject({
      strokeStyle: nightColor("#112233"),
    });
    const fills = ctx.ops.filter((o) => o.op === "fillRect");
    // The header's tint and two body rows' fill.
    expect(fills).toHaveLength(3);
    expect(fills[1]).toMatchObject({ fillStyle: nightColor("#ffeeaa") });
    expect(headerFillOf(t)).toMatch(/^#112233/);
  });

  it("reuses a layout until the table changes", () => {
    const ctx = asCanvasContext(context());
    const t = table();
    const first = tableLayoutOf(t, ctx);
    expect(tableLayoutOf(t, ctx)).toBe(first);
    setCellText(t, 2, 0, "a much longer cell that wraps onto lines");
    const second = tableLayoutOf(t, ctx);
    expect(second).not.toBe(first);
    expect(second.h).toBeGreaterThan(first.h);
  });
});
