/**
 * Painting a Markdown text box's words (discussion #107): the lines and marks
 * `markdown-layout.ts` placed, onto a canvas in page space. One painter for
 * every place a box is drawn: the page itself (the view's canvas over the
 * box at rest), tiles of a magnified view, thumbnails, exports and the AI's
 * page render. The box's fill and border are painted by the caller.
 *
 * Fonts are real family lists from the model, never `var(--…)`: canvas
 * string properties do not resolve CSS variables.
 */

import { shownColor } from "./backdrop";
import {
  type MarkdownBox,
  type MarkdownLayout,
  type MdFont,
  type MdMeasure,
  LIST_INDENT_EM,
  layoutMarkdownBox,
  taskBoxSize,
} from "./markdown-layout";
import { baselineOffset, canvasFont, decorationMetrics, traceBoxPath } from "./text-layout";
import { lineHeightOf, type TextStyle } from "../model/text-style";

/**
 * Links' colour where no theme says otherwise (exports, thumbnails): the
 * Obsidian default accent. The page passes its own resolved accent.
 */
export const MARKDOWN_LINK_COLOR = "#8a5cf5";

/** A `==highlight==`'s tint, see-through so the paper's lines show. */
const MARK_TINT = "rgba(255, 208, 0, 0.4)";

/** The canvas font for one run of a box: the box's face, or its monospace one. */
export function markdownFont(box: TextStyle, font: MdFont): string {
  const face: TextStyle = font.mono
    ? { color: box.color, fontSize: font.size, font: "mono" }
    : { color: box.color, fontSize: font.size, font: box.font, family: box.family };
  return canvasFont({ ...face, bold: font.bold, italic: font.italic }, font.size);
}

type FontContext = Pick<CanvasRenderingContext2D, "font" | "measureText">;

/** A measure for `markdown-layout.ts` from a canvas, setting its font only when it changes. */
export function markdownMeasure(ctx: FontContext, box: TextStyle): MdMeasure {
  let current = "";
  return (text, font) => {
    const wanted = markdownFont(box, font);
    if (wanted !== current) {
      ctx.font = wanted;
      current = wanted;
    }
    return ctx.measureText(text).width;
  };
}

/** A box laid out with `ctx`'s measuring; `ctx.font` is left changed. */
export function layoutMarkdownOn(ctx: FontContext, box: MarkdownBox): MarkdownLayout {
  return layoutMarkdownBox(box, markdownMeasure(ctx, box));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Paint a laid-out Markdown box's words and marks, clipped to the box (as
 * tall as the layout), in the box's colour; links in `linkColor`. On a night
 * page (`night`) the colours are shown as `./night` maps them. The caller
 * saves and restores round it.
 */
export function paintMarkdownText(
  ctx: CanvasRenderingContext2D,
  box: MarkdownBox,
  layout: MarkdownLayout,
  night: boolean,
  linkColor: string = MARKDOWN_LINK_COLOR,
): void {
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, layout.height);
  ctx.clip();
  const ink = shownColor(box.color, night);
  const link = linkColor;
  const lineHeight = lineHeightOf(box);
  // Older WebKit lacks the font-box metrics; fall back to typical proportions.
  ctx.font = canvasFont(box, box.fontSize);
  const metrics = ctx.measureText("Hg");
  const ascentK = finiteOr(metrics.fontBoundingBoxAscent, box.fontSize * 0.8) / box.fontSize;
  const descentK = finiteOr(metrics.fontBoundingBoxDescent, box.fontSize * 0.2) / box.fontSize;
  const baselineOf = (lineBox: number, size: number): number =>
    baselineOffset(lineBox, ascentK * size, descentK * size);
  const ox = layout.x;
  const oy = layout.y;

  // Grounds first: code blocks' tint, quote bars, rules.
  for (const mark of layout.marks) {
    if (mark.kind === "code") {
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = ink;
      ctx.fillRect(ox + mark.x, oy + mark.y, mark.w, mark.h);
      ctx.globalAlpha = 1;
    } else if (mark.kind === "quote") {
      ctx.fillStyle = link;
      ctx.fillRect(ox + mark.x, oy + mark.y, mark.w, mark.h);
    } else if (mark.kind === "rule") {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ink;
      ctx.fillRect(ox + mark.x, oy + mark.y, mark.w, mark.h);
      ctx.globalAlpha = 1;
    }
  }

  ctx.textBaseline = "alphabetic";
  const measure = markdownMeasure(ctx, box);
  for (const line of layout.lines) {
    const y = oy + line.top + baselineOf(line.height, line.size);
    const deco = decorationMetrics(line.size);
    for (const run of line.runs) {
      const x = ox + run.x;
      const inkW = measure(run.text.trimEnd(), run.font);
      if (run.mark || run.code) {
        const pad = run.code ? line.size * 0.15 : 0;
        ctx.fillStyle = run.mark ? MARK_TINT : ink;
        ctx.globalAlpha = run.mark ? 1 : 0.09;
        const top = oy + line.top + (line.height - line.size * 1.2) / 2;
        ctx.fillRect(x - pad, top, inkW + 2 * pad, line.size * 1.2);
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = run.muted ? 0.5 : 1;
      ctx.fillStyle = run.target !== undefined ? link : ink;
      ctx.font = markdownFont(box, run.font);
      ctx.fillText(run.text, x, y);
      if (run.underline) ctx.fillRect(x, y + deco.underline, inkW, deco.thickness);
      if (run.strike) ctx.fillRect(x, y + deco.strike, inkW, deco.thickness);
      ctx.globalAlpha = 1;
    }
  }

  // List markers on their item's first line.
  for (const mark of layout.marks) {
    if (mark.kind !== "bullet" && mark.kind !== "number" && mark.kind !== "task") continue;
    const lineBox = mark.size * lineHeight;
    const top = oy + mark.y;
    const left = ox + mark.x;
    if (mark.kind === "bullet") {
      const r = mark.size * 0.11;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(left + mark.size * LIST_INDENT_EM * 0.45, top + lineBox / 2, r, 0, Math.PI * 2);
      if (mark.depth % 2 === 1) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, mark.size / 16);
        ctx.stroke();
      } else ctx.fill();
    } else if (mark.kind === "number") {
      ctx.fillStyle = ink;
      ctx.font = markdownFont(box, { size: mark.size, bold: false, italic: false, mono: false });
      ctx.fillText(mark.text, left, top + baselineOf(lineBox, mark.size));
    } else {
      const s = taskBoxSize(mark.size);
      const x = left + mark.size * 0.1;
      const y = top + (lineBox - s) / 2;
      ctx.beginPath();
      traceBoxPath(ctx, x, y, s, s, s * 0.2);
      if (mark.done) {
        ctx.fillStyle = link;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1.2, s / 9);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x + s * 0.24, y + s * 0.52);
        ctx.lineTo(x + s * 0.43, y + s * 0.7);
        ctx.lineTo(x + s * 0.78, y + s * 0.3);
        ctx.stroke();
      } else {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(1.2, s / 11);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
}
