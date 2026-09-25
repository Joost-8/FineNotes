/**
 * `renderStrokesForRecognition` on a recording fake canvas: the size of the
 * picture, where the ink lands in it, and the colours each tool is painted
 * in. What the pixels look like is perfect-freehand's business and is not
 * checked here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stroke } from "../../src/model/document";
import { renderStrokesForRecognition } from "../../src/recognition/render";

/** What reached the canvas, in order, with the style it was painted in. */
let ops: string[] = [];
let canvases: FakeCanvas[] = [];
let contextAvailable = true;

class FakeContext {
  fillStyle = "#000000";
  strokeStyle = "#000000";
  globalAlpha = 1;
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  private saved: Array<Record<string, unknown>> = [];

  fillRect(x: number, y: number, w: number, h: number): void {
    ops.push(`fillRect ${x},${y},${w},${h} ${this.fillStyle}`);
  }
  setTransform(...m: number[]): void {
    ops.push(`transform ${m.map((v) => Math.round(v * 1000) / 1000).join(",")}`);
  }
  save(): void {
    this.saved.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
  }
  restore(): void {
    Object.assign(this, this.saved.pop());
  }
  fill(): void {
    ops.push(`fill ${this.fillStyle} alpha=${this.globalAlpha}`);
  }
  stroke(): void {
    ops.push(
      `stroke ${this.strokeStyle} alpha=${this.globalAlpha} width=${this.lineWidth} ` +
        `${this.lineCap}/${this.lineJoin}`,
    );
  }
}

class FakeCanvas {
  width = 300;
  height = 150;
  readonly context = new FakeContext();
  getContext(kind: string): FakeContext | null {
    expect(kind).toBe("2d");
    return contextAvailable ? this.context : null;
  }
  toDataURL(type: string): string {
    ops.push(`export ${type} ${this.width}x${this.height}`);
    return "data:image/png;base64,UE5H";
  }
}

beforeEach(() => {
  ops = [];
  canvases = [];
  contextAvailable = true;
  vi.stubGlobal("createEl", (tag: string) => {
    expect(tag).toBe("canvas");
    const canvas = new FakeCanvas();
    canvases.push(canvas);
    return canvas;
  });
  vi.stubGlobal(
    "Path2D",
    class {
      constructor(readonly d: string) {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stroke(pts: number[], extra: Partial<Stroke> = {}): Stroke {
  return { id: "s", color: "#ff0000", size: 4, tool: "pen", pts, ...extra };
}

describe("renderStrokesForRecognition", () => {
  it("frames the ink with a 16 px margin, at up to 3x, on white", () => {
    // Ink spans (10, 20)–(110, 70): 132 x 82 with the margin, so 3x fits.
    const out = renderStrokesForRecognition([stroke([10, 20, 0.5, 60, 45, 0.5, 110, 70, 0.5])]);
    expect(out).toEqual({ base64: "UE5H", width: 396, height: 246 });
    expect(canvases).toHaveLength(1);
    expect(ops[0]).toBe("fillRect 0,0,396,246 #ffffff");
    expect(ops[1]).toBe("transform 3,0,0,3,18,-12");
    expect(ops.at(-1)).toBe("export image/png 396x246");
  });

  it("fits a large drawing's long edge to 1568 px", () => {
    const out = renderStrokesForRecognition([stroke([0, 0, 0.5, 3000, 1000, 0.5])]);
    // 3032 x 1032 world px at 1568 / 3032.
    expect(out).toMatchObject({ width: 1568, height: 534 });
    const scale = 1568 / 3032;
    const s = Math.round(scale * 1000) / 1000;
    const t = Math.round(16 * scale * 1000) / 1000;
    expect(ops[1]).toBe(`transform ${s},0,0,${s},${t},${t}`);
  });

  it("takes its edge and margin from the options", () => {
    const out = renderStrokesForRecognition([stroke([0, 0, 0.5, 100, 50, 0.5])], {
      maxEdge: 60,
      pad: 0,
    });
    expect(out).toMatchObject({ width: 60, height: 30 });
    expect(ops[1]).toBe("transform 0.6,0,0,0.6,0,0");
  });

  it("frames all strokes together", () => {
    const out = renderStrokesForRecognition([
      stroke([100, 100, 0.5, 110, 110, 0.5]),
      stroke([], { id: "empty" }),
      stroke([0, 50, 0.5, 20, 60, 0.5]),
    ]);
    // (0, 50)–(110, 110) plus the margin: 142 x 92 at 3x.
    expect(out).toMatchObject({ width: 426, height: 276 });
    expect(ops[1]).toBe("transform 3,0,0,3,48,-102");
  });

  it("gives a single dot a canvas of its own", () => {
    expect(renderStrokesForRecognition([stroke([5, 5, 0.5])])).toMatchObject({
      width: 96,
      height: 96,
    });
  });

  it("paints pens near-black and highlighters in translucent grey, whatever their colour", () => {
    renderStrokesForRecognition([
      stroke([0, 0, 0.5, 50, 50, 0.5]),
      stroke([0, 50, 0.5, 50, 0, 0.5], { tool: "highlighter", color: "#ffff00" }),
      stroke([0, 0, 0.5, 50, 0, 0.5]),
    ]);
    expect(ops.filter((op) => op.startsWith("fill "))).toEqual([
      "fill #111111 alpha=1",
      "fill #888888 alpha=0.25",
      "fill #111111 alpha=1",
    ]);
  });

  it("strokes a clean shape along its centreline at the pen's width", () => {
    renderStrokesForRecognition([
      stroke([0, 0, 0.5, 40, 0, 0.5, 40, 40, 0.5, 0, 0, 0.5], { shape: "polygon", size: 6 }),
    ]);
    expect(ops.filter((op) => op.startsWith("stroke") || op.startsWith("fill "))).toEqual([
      "stroke #111111 alpha=1 width=6 round/round",
    ]);
  });

  it("draws nothing for no ink at all", () => {
    expect(renderStrokesForRecognition([])).toBeNull();
    expect(renderStrokesForRecognition([stroke([]), stroke([1, 2])])).toBeNull();
    expect(canvases).toHaveLength(0);
  });

  it("gives up when the canvas has no 2D context", () => {
    contextAvailable = false;
    expect(renderStrokesForRecognition([stroke([0, 0, 0.5, 10, 10, 0.5])])).toBeNull();
  });
});
