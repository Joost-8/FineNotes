import { describe, expect, it, vi } from "vitest";
import { type BackdropPainter, paintPagePaper } from "../../src/canvas/renderer";
import { blankPage } from "../../src/model/document";
import { LIGHT_PAPER } from "../../src/canvas/backdrop";

/** A context that records where each paint lands: the translation in force. */
function recordingContext(): { ctx: CanvasRenderingContext2D; at: () => number } {
  let x = 0;
  const stack: number[] = [];
  const ctx = {
    save: () => stack.push(x),
    restore: () => {
      x = stack.pop() ?? 0;
    },
    translate: (dx: number) => {
      x += dx;
    },
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, at: () => x };
}

describe("paintPagePaper", () => {
  it("paints a paper page with a margin in its frame only, leaving the margin plain", () => {
    const page = blankPage("p1", { width: 2600, height: 1400 });
    page.backdrop = { kind: "ruled-wide", frame: { x: 600, y: 0, width: 1000, height: 1400 } };
    const { ctx, at } = recordingContext();
    const calls: Array<{ kind: string; x: number; width: number }> = [];
    const painter: BackdropPainter = {
      paint: vi.fn((_ctx, backdrop, geometry) => {
        calls.push({ kind: backdrop.kind, x: at(), width: geometry.width });
      }),
    };
    paintPagePaper(painter, ctx, page, 1, { deviceScale: 1, paper: LIGHT_PAPER });
    expect(calls).toEqual([{ kind: "ruled-wide", x: 600, width: 1000 }]);
  });

  it("paints a margin's paper in each margin, and only that over an exported PDF", () => {
    const page = blankPage("p1", { width: 1600, height: 1400 });
    page.backdrop = {
      kind: "pdf",
      path: "Slides.pdf",
      page: 0,
      frame: { x: 300, y: 0, width: 1000, height: 1400 },
      marginPaper: "lined",
    };
    const { ctx, at } = recordingContext();
    const calls: Array<{ kind: string; x: number; width: number }> = [];
    const painter: BackdropPainter = {
      paint: vi.fn((_ctx, backdrop, geometry) => {
        calls.push({ kind: backdrop.kind, x: at(), width: geometry.width });
      }),
    };
    paintPagePaper(painter, ctx, page, 1, { deviceScale: 1 });
    expect(calls).toEqual([
      { kind: "ruled-wide", x: 0, width: 300 },
      { kind: "ruled-wide", x: 1300, width: 300 },
      { kind: "pdf", x: 0, width: 1600 },
    ]);
    calls.length = 0;
    paintPagePaper(painter, ctx, page, 1, { deviceScale: 1 }, true);
    expect(calls.map((c) => c.kind)).toEqual(["ruled-wide", "ruled-wide"]);
  });

  it("paints a page without a margin as it always did", () => {
    const page = blankPage();
    const { ctx } = recordingContext();
    const painter: BackdropPainter = { paint: vi.fn() };
    paintPagePaper(painter, ctx, page, 1, { deviceScale: 1 });
    expect(painter.paint).toHaveBeenCalledTimes(1);
    expect(painter.paint).toHaveBeenCalledWith(ctx, page.backdrop, page.geometry, 1, {
      deviceScale: 1,
    });
  });
});
