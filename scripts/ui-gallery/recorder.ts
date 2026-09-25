/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * What each on-screen canvas shows, recorded as a short list of paint ops, so
 * an exported snapshot can repaint it (paper.js) instead of shipping pixels.
 *
 * Two sources: the build tags `drawSynthetic` and `renderPageThumbnail`
 * (a ruled page becomes one op, however many lines it has; a page's ink and
 * text become one reference into the shared pages.js), and a thin recorder on
 * the 2D context catches the rest — `fill(Path2D)`, `stroke(Path2D)`,
 * `fillText`, `fillRect`. Only canvases in the document are recorded, never
 * the surface's own full-pane layers.
 */
import { paintTextBox } from "../../src/canvas/renderer";
import type { Page } from "../../src/model/document";

export type PaintOp = Record<string, unknown>;
export const paintOps = new WeakMap<HTMLCanvasElement, PaintOp[]>();

const G = globalThis as any;
const MAX_OPS = 3000;
let syntheticDepth = 0;
/** The page a thumbnail is painting, and the transform its content uses. */
let thumbnail: { page: Page; t: number[] | null } | null = null;

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
/** Ink paths in page px; a whole page px is well under a device pixel on screen. */
export const roundPath = (d: string): string =>
  d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n))));

function recordable(canvas: unknown): canvas is HTMLCanvasElement {
  return (
    canvas instanceof HTMLCanvasElement &&
    canvas.isConnected &&
    !canvas.classList.contains("goodobsidian-canvas")
  );
}

function push(canvas: HTMLCanvasElement, op: PaintOp): void {
  const list = paintOps.get(canvas) ?? [];
  if (list.length < MAX_OPS) list.push(op);
  paintOps.set(canvas, list);
}

function matrix(ctx: CanvasRenderingContext2D): number[] {
  const m = ctx.getTransform();
  return [m.a, m.b, m.c, m.d, m.e, m.f].map(r3);
}

function styleOf(
  ctx: CanvasRenderingContext2D,
  kind: "fill" | "stroke" | "text",
): Record<string, unknown> | null {
  const s: Record<string, unknown> = {};
  if (kind === "stroke") {
    if (typeof ctx.strokeStyle !== "string") return null;
    s.s = ctx.strokeStyle;
    s.w = r3(ctx.lineWidth);
    s.c = ctx.lineCap;
    s.j = ctx.lineJoin;
  } else {
    if (typeof ctx.fillStyle !== "string") return null;
    s.f = ctx.fillStyle;
  }
  if (kind === "text") {
    s.font = ctx.font;
    s.al = ctx.textAlign;
    s.bl = ctx.textBaseline;
  }
  if (ctx.globalAlpha !== 1) s.a = r3(ctx.globalAlpha);
  if (ctx.globalCompositeOperation !== "source-over") s.o = ctx.globalCompositeOperation;
  return s;
}

// Path2D built from SVG path data remembers it.
const NativePath2D = window.Path2D;
class TrackedPath2D extends NativePath2D {
  __d?: string;
  constructor(arg?: string | Path2D) {
    super(arg as any);
    if (typeof arg === "string") this.__d = arg;
    else if (arg instanceof TrackedPath2D) this.__d = arg.__d;
  }
}
(window as any).Path2D = TrackedPath2D;

// A canvas resized is a canvas cleared.
for (const prop of ["width", "height"] as const) {
  const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop)!;
  Object.defineProperty(HTMLCanvasElement.prototype, prop, {
    configurable: true,
    get: d.get,
    set(this: HTMLCanvasElement, v: number) {
      paintOps.delete(this);
      d.set!.call(this, v);
    },
  });
}

let capture: PaintOp[] | null = null;
const P = CanvasRenderingContext2D.prototype as any;
function wrap(
  name: string,
  record: (ctx: CanvasRenderingContext2D, args: any[]) => PaintOp | null,
): void {
  const native = P[name];
  P[name] = function (this: CanvasRenderingContext2D, ...args: any[]) {
    if (syntheticDepth === 0) {
      if (capture) {
        const op = record(this, args);
        if (op) capture.push(op);
      } else if (recordable(this.canvas) && !(thumbnail && name !== "fillRect")) {
        const op = record(this, args);
        if (op) push(this.canvas, op);
      }
    }
    return native.apply(this, args);
  };
}
wrap("fillRect", (ctx, a) => {
  const st = styleOf(ctx, "fill");
  return st ? { g: "fillRect", t: matrix(ctx), st, a: a.map(r3) } : null;
});
wrap("fill", (ctx, a) => {
  const path = a[0];
  const st = styleOf(ctx, "fill");
  if (!st || !(path instanceof TrackedPath2D) || !path.__d) return null;
  return {
    g: "fill",
    t: matrix(ctx),
    st,
    d: roundPath(path.__d),
    r: typeof a[1] === "string" ? a[1] : undefined,
  };
});
wrap("stroke", (ctx, a) => {
  const path = a[0];
  const st = styleOf(ctx, "stroke");
  if (!st || !(path instanceof TrackedPath2D) || !path.__d) return null;
  return { g: "stroke", t: matrix(ctx), st, d: roundPath(path.__d) };
});
wrap("fillText", (ctx, a) => {
  const st = styleOf(ctx, "text");
  return st ? { g: "fillText", t: matrix(ctx), st, a: [String(a[0]), r3(a[1]), r3(a[2])] } : null;
});

// --- Shared page content (pages.js) --------------------------------------------

/** Pages whose ink or text a snapshot refers to, by a key of their content. */
export const pageRegistry = new Map<string, Page>();

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The key for a page's content, or null when it has none to share. */
export function pageKey(page: Page): string | null {
  if (page.strokes.length === 0 && (page.textBoxes ?? []).length === 0) return null;
  // Content, not layout or field order: a fitted text box's measured width
  // varies a little with the zoom it was laid out at, and the file loader
  // rebuilds each object with its own key order. Either would copy the page.
  const content = JSON.stringify([page.strokes, page.textBoxes ?? []], (k, v) => {
    if (k === "w" || k === "h" || k === "fit") return undefined;
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
  });
  const key = `pg${hash(content)}`;
  if (pageRegistry.has(key)) return key;
  pageRegistry.set(key, page);
  return key;
}

/** A canvas's ops ready to serialise: page references resolved to keys. */
export function resolvedOps(ops: PaintOp[]): PaintOp[] {
  return ops.flatMap((op) => {
    if (!op.refPage) return [op];
    const key = pageKey(op.refPage as Page);
    return key ? [{ ref: key, t: op.t, text: op.text }] : [];
  });
}

/** A page's text boxes as paint ops in page space, as the thumbnail paints them. */
export function textOps(page: Page): PaintOp[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  capture = [];
  try {
    for (const box of page.textBoxes ?? []) paintTextBox(ctx, box);
    return capture;
  } finally {
    capture = null;
  }
}

// --- Tags from the build (see build.mjs) -----------------------------------------

G.__galleryTag = (tag: string, args: any[], phase: "begin" | "end"): void => {
  if (tag === "thumbnail") {
    const canvas = args[0] as HTMLCanvasElement;
    if (phase === "begin") {
      paintOps.delete(canvas);
      thumbnail = { page: args[1] as Page, t: null };
      return;
    }
    const done = thumbnail;
    thumbnail = null;
    if (!done || !recordable(canvas) || !done.t) return;
    // The page itself, not its key yet: the view may still change it (a
    // fitted text box takes its width after the first paint). The key is
    // taken at export, from the page as the surface shows it too.
    push(canvas, { refPage: done.page, t: done.t, text: 1 });
    return;
  }
  if (tag !== "synthetic") return;
  if (phase === "end") {
    syntheticDepth--;
    return;
  }
  syntheticDepth++;
  const [ctx, backdrop, geometry, theme, weight] = args as [
    CanvasRenderingContext2D,
    any,
    any,
    any,
    number,
  ];
  if (thumbnail) thumbnail.t = matrix(ctx);
  if (!recordable(ctx.canvas)) return;
  push(ctx.canvas, { t: matrix(ctx), s: [backdrop, geometry, theme, weight ?? 1] });
};
