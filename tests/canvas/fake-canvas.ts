/**
 * A recording stand-in for `CanvasRenderingContext2D`.
 *
 * `src/canvas/backdrop.ts` is "pure" only in the sense that it touches no
 * vault and no Obsidian API — it still draws. Recording every call is the only
 * way to assert the ruling *pitches* the contract's table specifies, which is
 * what a reader would actually notice on the page.
 */

export type Op =
  | { op: "save" }
  | { op: "restore" }
  | { op: "beginPath" }
  | { op: "fill"; fillStyle: string }
  | { op: "stroke"; strokeStyle: string }
  | { op: "clip" }
  | { op: "moveTo"; x: number; y: number }
  | { op: "lineTo"; x: number; y: number }
  | { op: "rect"; x: number; y: number; w: number; h: number }
  | { op: "fillRect"; x: number; y: number; w: number; h: number; fillStyle: string }
  | { op: "strokeRect"; x: number; y: number; w: number; h: number }
  | { op: "arc"; x: number; y: number; r: number }
  | { op: "fillText"; text: string; x: number; y: number }
  | { op: "setLineDash"; segments: number[] }
  | { op: "arcTo"; x1: number; y1: number; x2: number; y2: number; r: number }
  | { op: "closePath" }
  | { op: "gradient"; kind: "linear" | "radial"; stops: Array<{ at: number; color: string }> };

export interface FakeContext {
  ops: Op[];
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textBaseline: string;
  /** Depth tracking, so an unbalanced save/restore is visible to a test. */
  depth: number;
  maxDepth: number;
}

export function fakeContext(): FakeContext {
  const ctx: FakeContext = {
    ops: [],
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    font: "",
    textBaseline: "",
    depth: 0,
    maxDepth: 0,
  };
  const api = {
    save(): void {
      ctx.depth++;
      ctx.maxDepth = Math.max(ctx.maxDepth, ctx.depth);
      ctx.ops.push({ op: "save" });
    },
    restore(): void {
      ctx.depth--;
      ctx.ops.push({ op: "restore" });
    },
    beginPath: () => void ctx.ops.push({ op: "beginPath" }),
    fill: () => void ctx.ops.push({ op: "fill", fillStyle: String(ctx.fillStyle) }),
    stroke: () => void ctx.ops.push({ op: "stroke", strokeStyle: String(ctx.strokeStyle) }),
    clip: () => void ctx.ops.push({ op: "clip" }),
    moveTo: (x: number, y: number) => void ctx.ops.push({ op: "moveTo", x, y }),
    lineTo: (x: number, y: number) => void ctx.ops.push({ op: "lineTo", x, y }),
    rect: (x: number, y: number, w: number, h: number) =>
      void ctx.ops.push({ op: "rect", x, y, w, h }),
    fillRect: (x: number, y: number, w: number, h: number) =>
      void ctx.ops.push({ op: "fillRect", x, y, w, h, fillStyle: String(ctx.fillStyle) }),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      void ctx.ops.push({ op: "strokeRect", x, y, w, h }),
    arc: (x: number, y: number, r: number) => void ctx.ops.push({ op: "arc", x, y, r }),
    fillText: (text: string, x: number, y: number) =>
      void ctx.ops.push({ op: "fillText", text, x, y }),
    setLineDash: (segments: number[]) => void ctx.ops.push({ op: "setLineDash", segments }),
    arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) =>
      void ctx.ops.push({ op: "arcTo", x1, y1, x2, y2, r }),
    closePath: () => void ctx.ops.push({ op: "closePath" }),
    // A gradient records its stops as they are added; `fillStyle` then holds
    // the gradient object, which a fillRect records as "[gradient]".
    createLinearGradient: () => gradient("linear"),
    createRadialGradient: () => gradient("radial"),
  };
  function gradient(kind: "linear" | "radial") {
    const op = { op: "gradient" as const, kind, stops: [] as Array<{ at: number; color: string }> };
    ctx.ops.push(op);
    return {
      addColorStop: (at: number, color: string) => void op.stops.push({ at, color }),
      toString: () => "[gradient]",
    };
  }
  Object.assign(ctx, api);
  return ctx;
}

/** Hand the stub to code that wants a real 2D context. */
export function asCanvasContext(ctx: FakeContext): CanvasRenderingContext2D {
  return ctx as unknown as CanvasRenderingContext2D;
}

/** Every `moveTo -> lineTo` pair, as a flat segment list. */
export function segments(
  ops: readonly Op[],
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  let cursor: { x: number; y: number } | null = null;
  for (const op of ops) {
    if (op.op === "moveTo") cursor = { x: op.x, y: op.y };
    else if (op.op === "lineTo" && cursor) {
      out.push({ x0: cursor.x, y0: cursor.y, x1: op.x, y1: op.y });
      cursor = { x: op.x, y: op.y };
    }
  }
  return out;
}

/** Y positions of horizontal segments, in draw order. */
export function horizontalYs(ops: readonly Op[]): number[] {
  return segments(ops)
    .filter((s) => s.y0 === s.y1)
    .map((s) => s.y0);
}

/** X positions of vertical segments, in draw order. */
export function verticalXs(ops: readonly Op[]): number[] {
  return segments(ops)
    .filter((s) => s.x0 === s.x1)
    .map((s) => s.x0);
}

/** The gap between consecutive values, deduplicated. */
export function pitches(values: readonly number[]): number[] {
  const out = new Set<number>();
  for (let i = 1; i < values.length; i++) out.add(Number((values[i] - values[i - 1]).toFixed(6)));
  return [...out];
}
