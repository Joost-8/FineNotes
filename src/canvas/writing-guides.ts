/** Shared non-printing writing guide painter for InkSurface and opt-in inline previews. */
import type { Bounds, Page } from "../model/document";
import { guideColor, guidesEligible, type WritingGuideStyle } from "../model/writing-guides";

/** Effective page-space pitch between rendered guides at `rasterScale`. */
export function writingGuidePitch(style: WritingGuideStyle, rasterScale: number): number {
  const minPitch = style.style === "dots" ? 8 : 2;
  const stride = 2 ** Math.max(0, Math.ceil(Math.log2(minPitch / (style.spacing * rasterScale))));
  return style.spacing * stride;
}

/**
 * The page-local positions of guides between `from` and `to` along one axis:
 * every multiple of `pitch` counted from the notebook's start, which is
 * `offset` before this page's (joined pages, `gridPhase`), so lines run on
 * across a join. The notebook's own first edge gets none: a line there would
 * sit on the page's edge.
 */
export function guideStops(from: number, to: number, pitch: number, offset = 0): number[] {
  if (!(pitch > 0) || !(to >= from)) return [];
  const out: number[] = [];
  for (let k = Math.max(1, Math.ceil((from + offset) / pitch)); ; k++) {
    const at = k * pitch - offset;
    if (at > to) break;
    out.push(at);
    if (out.length > 16384) break;
  }
  return out;
}

export function paintWritingGuides(
  ctx: CanvasRenderingContext2D,
  page: Page,
  region: Bounds,
  style: WritingGuideStyle | null,
  paper: string,
  screenScale: number,
  rasterScale: number,
  phase?: { x: number; y: number },
): number {
  if (!style || !guidesEligible(page) || !(screenScale > 0) || !(rasterScale > 0)) return 0;
  const { width, height } = page.geometry;
  const left = Math.max(0, region.minX);
  const top = Math.max(0, region.minY);
  const right = Math.min(width, region.maxX);
  const bottom = Math.min(height, region.maxY);
  if (!(right > left) || !(bottom > top)) return 0;

  const pitch = writingGuidePitch(style, rasterScale);
  const weight = style.thickness / screenScale;
  const pad = weight / 2;
  const xs =
    style.style === "lines"
      ? []
      : guideStops(left - pad, Math.min(width, right + pad), pitch, phase?.x ?? 0);
  const ys = guideStops(top - pad, Math.min(height, bottom + pad), pitch, phase?.y ?? 0);
  if ((style.style === "dots" ? xs.length * ys.length : xs.length + ys.length) > 32768) return 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = ctx.fillStyle = guideColor(style, paper);
  ctx.lineWidth = weight;
  ctx.lineCap = "butt";
  ctx.beginPath();

  let count = 0;
  if (style.style === "dots") {
    for (const y of ys) {
      for (const x of xs) {
        ctx.moveTo(x + pad, y);
        ctx.arc(x, y, pad, 0, Math.PI * 2);
        count++;
      }
    }
    ctx.fill();
  } else {
    for (const y of ys) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      count++;
    }
    for (const x of xs) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      count++;
    }
    ctx.stroke();
  }
  ctx.restore();
  return count;
}
