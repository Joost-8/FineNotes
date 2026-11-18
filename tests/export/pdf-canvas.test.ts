import { describe, expect, it } from "vitest";
import { PdfCanvasRecorder, arcCubics } from "../../src/export/pdf-canvas";
import { LIGHT_PAPER, drawSynthetic } from "../../src/canvas/backdrop";

function recorder(): { rec: PdfCanvasRecorder; ctx: CanvasRenderingContext2D } {
  const rec = new PdfCanvasRecorder(200, 100);
  return { rec, ctx: rec.asContext() };
}

const lines = (rec: PdfCanvasRecorder): string[] => rec.result().ops.split("\n");

describe("PDF canvas recorder", () => {
  it("records nothing until something is painted", () => {
    const { rec, ctx } = recorder();
    ctx.beginPath();
    ctx.moveTo(1, 2);
    ctx.lineTo(3, 4);
    expect(rec.result().ops).toBe("");
    expect(rec.unsupported).toBeNull();
  });

  it("writes a stroke in device space, its width scaled by the transform", () => {
    const { rec, ctx } = recorder();
    ctx.setTransform(2, 0, 0, 2, 10, 0);
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, 5);
    ctx.stroke();
    expect(lines(rec)).toEqual([
      "q",
      "1 0 0 RG",
      "3 w",
      "1 J",
      "0 j",
      "10 M",
      "10 0 m",
      "20 10 l",
      "S",
      "Q",
    ]);
  });

  it("scales dashes with the transform", () => {
    const { rec, ctx } = recorder();
    ctx.scale(2, 2);
    ctx.setLineDash([3, 1]);
    ctx.lineDashOffset = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(9, 0);
    ctx.stroke();
    expect(lines(rec)).toContain("[6 2] 2 d");
    // An odd dash list repeats, as the canvas does.
    ctx.setLineDash([1, 2, 3]);
    expect(ctx.getLineDash()).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("fills with the colour's and the context's alpha in a graphics state", () => {
    const { rec, ctx } = recorder();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "rgba(0, 0, 255, 0.5)";
    ctx.fillRect(1, 2, 3, 4);
    expect([...rec.result().states.values()]).toEqual([{ alpha: 0.25, blend: "Normal" }]);
    expect(lines(rec)).toEqual([
      "q",
      "/Gs0 gs",
      "0 0 1 rg",
      "1 2 m",
      "4 2 l",
      "4 6 l",
      "1 6 l",
      "h",
      "1 2 m",
      "f",
      "Q",
    ]);
  });

  it("keeps the current path across fillRect, and fills even-odd when asked", () => {
    const { rec, ctx } = recorder();
    ctx.beginPath();
    ctx.rect(0, 0, 10, 10);
    ctx.fillRect(50, 50, 1, 1);
    ctx.fill("evenodd");
    const out = lines(rec);
    expect(out.at(-2)).toBe("f*");
    expect(out).toContain("10 10 l");
  });

  it("draws a full circle as four quarter cubics", () => {
    const { rec, ctx } = recorder();
    ctx.beginPath();
    ctx.arc(50, 50, 10, 0, Math.PI * 2);
    ctx.fill();
    const out = lines(rec);
    expect(out.filter((l) => l.endsWith(" c"))).toHaveLength(4);
    expect(out).toContain("60 50 m");
    expect(out.find((l) => l.endsWith(" c"))?.endsWith("50 60 c")).toBe(true);
    const pieces = arcCubics(0, 0, 1, 0, Math.PI / 2);
    expect(pieces).toHaveLength(1);
    // The quarter circle's handles are the classic 0.5523 long.
    expect(pieces[0][1]).toBeCloseTo(0.5523, 3);
  });

  it("joins an arc to the path with a line, and turns arcTo and quadratics into cubics", () => {
    const { rec, ctx } = recorder();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(20, 0, 5, Math.PI, 0, true);
    ctx.arcTo(40, 0, 40, 20, 5);
    ctx.quadraticCurveTo(40, 40, 20, 40);
    ctx.stroke();
    const out = lines(rec);
    expect(out).toContain("15 0 l");
    expect(out).toContain("35 0 l");
    expect(out.filter((l) => l.endsWith(" c")).length).toBeGreaterThanOrEqual(4);
    expect(out.some((l) => l.endsWith("40 5 c"))).toBe(true);
    expect(out.some((l) => l.endsWith("20 40 c"))).toBe(true);
  });

  it("writes a clip with the path kept for what follows, and brackets save and restore", () => {
    const { rec, ctx } = recorder();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 10, 10);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
    ctx.restore();
    const out = lines(rec);
    expect(out[0]).toBe("q");
    expect(out).toContain("W n");
    expect(out.at(-1)).toBe("Q");
    expect(out.filter((l) => l === "Q")).toHaveLength(2);
  });

  it("refuses what PDF paths cannot reproduce, naming the first thing", () => {
    for (const draw of [
      (ctx: CanvasRenderingContext2D) => ctx.drawImage({} as CanvasImageSource, 0, 0),
      (ctx: CanvasRenderingContext2D) => ctx.fillText("Page 1", 0, 0),
      (ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = {} as CanvasGradient;
        ctx.fillRect(0, 0, 1, 1);
      },
      (ctx: CanvasRenderingContext2D) => {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillRect(0, 0, 1, 1);
      },
      (ctx: CanvasRenderingContext2D) => {
        ctx.scale(1, 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(1, 1);
        ctx.stroke();
      },
      (ctx: CanvasRenderingContext2D) => ctx.stroke({} as Path2D),
      (ctx: CanvasRenderingContext2D) => {
        ctx.fillRect(0, 0, 1, 1);
        ctx.clearRect(0, 0, 1, 1);
      },
      (ctx: CanvasRenderingContext2D) => {
        ctx.shadowBlur = 4;
        ctx.shadowColor = "#000";
        ctx.fillRect(0, 0, 1, 1);
      },
    ]) {
      const { rec, ctx } = recorder();
      draw(ctx);
      expect(rec.unsupported).not.toBeNull();
    }
    const { rec, ctx } = recorder();
    ctx.clearRect(0, 0, 200, 100);
    ctx.font = "12px serif";
    expect(rec.unsupported).toBeNull();
  });

  it("records the app's own paper painters: squared paper is a fill and one stroke of lines", () => {
    const { rec, ctx } = recorder();
    drawSynthetic(ctx, { kind: "squared" }, { width: 200, height: 100 }, LIGHT_PAPER);
    expect(rec.unsupported).toBeNull();
    const out = lines(rec);
    expect(out.filter((l) => l === "f")).toHaveLength(1);
    expect(out.filter((l) => l === "S")).toHaveLength(1);
    // Six vertical and three horizontal rules at 28 px, each a move and a line.
    expect(out.filter((l) => l.endsWith(" m")).length).toBeGreaterThanOrEqual(9);
  });

  it("records dotted paper's dots as filled circles", () => {
    const { rec, ctx } = recorder();
    drawSynthetic(ctx, { kind: "dotted" }, { width: 200, height: 100 }, LIGHT_PAPER);
    expect(rec.unsupported).toBeNull();
    expect(lines(rec).filter((l) => l.endsWith(" c")).length).toBeGreaterThan(8);
  });

  it("reads back the size and the transform painters ask for", () => {
    const { rec, ctx } = recorder();
    expect(ctx.canvas.width).toBe(200);
    ctx.translate(5, 6);
    ctx.rotate(Math.PI / 2);
    const m = ctx.getTransform();
    expect([m.a, m.b, m.c, m.d, m.e, m.f].map((v) => Math.round(v * 1000) / 1000)).toEqual([
      0, 1, -1, 0, 5, 6,
    ]);
    ctx.resetTransform();
    ctx.setTransform({ a: 2, d: 2 });
    expect(ctx.getTransform().a).toBe(2);
    expect(rec.painted).toBe(false);
  });
});
