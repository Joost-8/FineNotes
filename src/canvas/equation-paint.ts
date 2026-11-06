/**
 * Paint a typed equation (`EquationElement`, discussion #166) in page space:
 * its LaTeX read into boxes (`model/latex`), laid out (`math-layout`) and
 * drawn with `fillText` and paths, fitted into the frame the editor
 * measured. The same painter draws the page's tiles, the drag preview,
 * thumbnails, the equation editor's preview and the PDF export, so what the
 * editor shows is what lands on the page.
 */

import type { EquationElement } from "../model/document";
import { parseLatex } from "../model/latex";
import { type MathLayout, type MathMeasure, layoutMath, mathFont } from "./math-layout";
import { nightColor } from "./night";

/** Room around the formula inside its frame, as a share of its size. */
const PAD = 0.18;
/** Layouts kept, by size and source: enough for every equation on a few pages. */
const CACHE_LIMIT = 256;
const layouts = new Map<string, MathLayout>();

type Measuring = Pick<CanvasRenderingContext2D, "font" | "measureText" | "save" | "restore">;

/** A measure that sets `ctx`'s font for each run (kept as it was afterwards). */
function measurer(ctx: Measuring): MathMeasure {
  return (s, font) => {
    if (ctx.font !== font) ctx.font = font;
    return ctx.measureText(s).width;
  };
}

/** `tex` laid out at `size` with `ctx`'s measuring, from the cache while it holds. */
export function equationLayout(ctx: Measuring, tex: string, size: number): MathLayout {
  const key = `${size}|${tex}`;
  const cached = layouts.get(key);
  if (cached) {
    // Most recently used last, so the oldest goes first.
    layouts.delete(key);
    layouts.set(key, cached);
    return cached;
  }
  ctx.save();
  const layout = layoutMath(parseLatex(tex), size, measurer(ctx));
  ctx.restore();
  layouts.set(key, layout);
  if (layouts.size > CACHE_LIMIT) {
    const oldest = layouts.keys().next().value;
    if (oldest !== undefined) layouts.delete(oldest);
  }
  return layout;
}

/** The frame `layout` set at `size` is placed in, page px: the formula and its room around it. */
export function equationFrameSize(layout: MathLayout, size: number): { w: number; h: number } {
  const pad = PAD * size;
  return {
    w: Math.max(size * 0.5, layout.w) + 2 * pad,
    h: Math.max(size * 0.8, layout.a + layout.d) + 2 * pad,
  };
}

/**
 * The frame an equation of `tex` at `size` needs, measured with `ctx`: what
 * the editor stores as its `w` and `h`.
 */
export function measureEquation(
  ctx: Measuring,
  tex: string,
  size: number,
): { w: number; h: number } {
  const size2 = equationFrameSize(equationLayout(ctx, tex, size), size);
  return { w: Math.ceil(size2.w), h: Math.ceil(size2.h) };
}

/**
 * Paint `equation` in page space into `ctx`, fitted into its frame (kept in
 * proportion, centred), its colour as a night page shows it when `night`.
 */
export function paintEquation(
  ctx: CanvasRenderingContext2D,
  equation: Pick<EquationElement, "x" | "y" | "w" | "h" | "tex" | "color" | "size">,
  night = false,
): void {
  const layout = equationLayout(ctx, equation.tex, equation.size);
  if (layout.ops.length === 0) return;
  const natural = equationFrameSize(layout, equation.size);
  const k = Math.min(equation.w / natural.w, equation.h / natural.h);
  if (!(k > 0) || !Number.isFinite(k)) return;
  const pad = PAD * equation.size;
  const height = Math.max(equation.size * 0.8, layout.a + layout.d);
  // The formula's own box, centred in the frame's room.
  const left = equation.x + (equation.w - natural.w * k) / 2 + pad * k;
  const top = equation.y + (equation.h - natural.h * k) / 2 + pad * k;
  const baseline = top + (layout.a + (height - layout.a - layout.d) / 2) * k;
  const color = night ? nightColor(equation.color) : equation.color;
  ctx.save();
  ctx.translate(left + (Math.max(equation.size * 0.5, layout.w) - layout.w) * k * 0.5, baseline);
  ctx.scale(k, k);
  paintLayout(ctx, layout, color);
  ctx.restore();
}

/** Draw `layout`'s ops at the origin (its left edge, on its baseline) in `color`. */
export function paintLayout(
  ctx: CanvasRenderingContext2D,
  layout: MathLayout,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const op of layout.ops) {
    switch (op.k) {
      case "glyph": {
        const font = mathFont(op);
        if (ctx.font !== font) ctx.font = font;
        ctx.fillText(op.s, op.x, op.y);
        break;
      }
      case "rule":
        ctx.fillRect(op.x, op.y, op.w, op.h);
        break;
      case "path": {
        ctx.beginPath();
        for (const seg of op.d) {
          if (seg[0] === "M") ctx.moveTo(seg[1], seg[2]);
          else if (seg[0] === "L") ctx.lineTo(seg[1], seg[2]);
          else ctx.quadraticCurveTo(seg[1], seg[2], seg[3], seg[4]);
        }
        if (op.fill) ctx.fill();
        else {
          ctx.lineWidth = op.w;
          ctx.stroke();
        }
        break;
      }
    }
  }
}
