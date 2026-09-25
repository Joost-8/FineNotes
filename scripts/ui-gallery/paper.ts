/**
 * Repaints the canvases of an exported snapshot from the few bytes of JSON the
 * gallery left on them (`data-gallery-paint`, see recorder.ts), with the
 * plugin's real ruling table. A `{ref, t}` op paints a page's ink (and, with
 * `text`, its text) from the shared table in pages.js. Shipped as paper.js.
 */
import { drawSynthetic, type PaperTheme } from "../../src/canvas/backdrop";
import type { PageGeometry, SyntheticBackdrop } from "../../src/model/document";

type Matrix = [number, number, number, number, number, number];
interface Style {
  f?: string;
  s?: string;
  w?: number;
  c?: CanvasLineCap;
  j?: CanvasLineJoin;
  a?: number;
  o?: GlobalCompositeOperation;
  font?: string;
  al?: CanvasTextAlign;
  bl?: CanvasTextBaseline;
}
type InkOp = { t?: Matrix; path: string; color: string; alpha?: number; stroke?: number };
/** Path data; a long one is stored as pieces, so no line of the page is long. */
type PathData = string | string[];
const pathOf = (d: PathData): string => (Array.isArray(d) ? d.join(" ") : d);
type GenericOp =
  | { g: "fillRect"; t: Matrix; st: Style; a: [number, number, number, number] }
  | { g: "fill"; t: Matrix; st: Style; d: PathData; r?: CanvasFillRule }
  | { g: "stroke"; t: Matrix; st: Style; d: PathData }
  | { g: "fillText"; t: Matrix; st: Style; a: [string, number, number] };
type Op =
  | { t: Matrix; s: [SyntheticBackdrop, PageGeometry, PaperTheme, number] }
  | { t: Matrix; rect: [number, number, number, number]; color: string }
  | { t: Matrix; ref: string; text?: number }
  | InkOp
  | GenericOp;

const PAGES = (
  window as unknown as { GALLERY_PAGES?: Record<string, { ink: InkOp[]; text: GenericOp[] }> }
).GALLERY_PAGES;

function applyStyle(ctx: CanvasRenderingContext2D, st: Style): void {
  if (st.f) ctx.fillStyle = st.f;
  if (st.s) ctx.strokeStyle = st.s;
  if (st.w !== undefined) ctx.lineWidth = st.w;
  if (st.c) ctx.lineCap = st.c;
  if (st.j) ctx.lineJoin = st.j;
  if (st.a !== undefined) ctx.globalAlpha = st.a;
  if (st.o) ctx.globalCompositeOperation = st.o;
  if (st.font) ctx.font = st.font;
  if (st.al) ctx.textAlign = st.al;
  if (st.bl) ctx.textBaseline = st.bl;
}

/** Set `op`'s transform, on top of `base` when it comes from a page reference. */
function place(ctx: CanvasRenderingContext2D, t: Matrix | undefined, base: Matrix | null): void {
  if (base) {
    ctx.setTransform(...base);
    if (t) ctx.transform(...t);
  } else if (t) ctx.setTransform(...t);
}

function paintOp(ctx: CanvasRenderingContext2D, op: Op, base: Matrix | null = null): void {
  ctx.save();
  if ("ref" in op) {
    const page = PAGES?.[op.ref];
    if (page) {
      for (const ink of page.ink) paintOp(ctx, ink, op.t);
      if (op.text) for (const text of page.text) paintOp(ctx, text, op.t);
    }
  } else if ("g" in op) {
    place(ctx, op.t, base);
    applyStyle(ctx, op.st);
    if (op.g === "fillRect") ctx.fillRect(...op.a);
    else if (op.g === "fill") ctx.fill(new Path2D(pathOf(op.d)), op.r);
    else if (op.g === "stroke") ctx.stroke(new Path2D(pathOf(op.d)));
    else ctx.fillText(...op.a);
  } else if ("s" in op) {
    place(ctx, op.t, base);
    drawSynthetic(ctx, ...op.s);
  } else if ("rect" in op) {
    place(ctx, op.t, base);
    ctx.fillStyle = op.color;
    ctx.fillRect(...op.rect);
  } else {
    place(ctx, op.t, base);
    if (op.alpha !== undefined) {
      ctx.globalAlpha = op.alpha;
      ctx.globalCompositeOperation = "multiply";
    }
    const path = new Path2D(op.path);
    if (op.stroke !== undefined) {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.stroke;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(path);
    } else {
      ctx.fillStyle = op.color;
      ctx.fill(path);
    }
  }
  ctx.restore();
}

function paintAll(): void {
  document.querySelectorAll<HTMLCanvasElement>("canvas[data-gallery-paint]").forEach((canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    for (const op of JSON.parse(canvas.dataset.galleryPaint ?? "[]") as Op[]) paintOp(ctx, op);
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintAll);
else paintAll();
