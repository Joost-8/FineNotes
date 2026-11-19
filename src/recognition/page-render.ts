/**
 * Render one whole notebook page — paper and ruling, PDF slide, typed text
 * boxes and ink — to a PNG for a vision model, through the same painter the
 * page-sidebar thumbnails use, so the model sees what the reader sees.
 *
 * Size: a long edge of at most 1568 px *and* at most ~1.15 megapixels.
 * Anthropic downscales anything larger before reading it (so extra pixels
 * cost upload time and nothing else), and the others bill by image tiles, so
 * this lands every vendor at about 1,500 input tokens per page. At that size
 * an A4-shaped page is ~900 × 1270 px, a little under 1:1 page px — plenty
 * for handwriting.
 *
 * Placed pictures are not drawn yet: the thumbnail painter does not draw them
 * (the 0.5 image work adds that), and this inherits it when it lands.
 *
 * DOM (canvas) but no Obsidian imports.
 */

import { LIGHT_PAPER } from "../canvas/backdrop";
import { type BackdropPainter, type ImagePainter, renderPageThumbnail } from "../canvas/renderer";
import type { Page } from "../model/document";

export const AI_MAX_EDGE = 1568;
export const AI_MAX_PIXELS = 1_150_000;

export interface RenderedPage {
  /** PNG, base64 without a data-URL prefix. */
  base64: string;
  width: number;
  height: number;
}

/** Output width in px for a page of this geometry under both budgets. */
export function aiRenderWidth(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0;
  const byEdge = AI_MAX_EDGE / Math.max(width, height);
  const byArea = Math.sqrt(AI_MAX_PIXELS / (width * height));
  return Math.max(1, Math.floor(width * Math.min(byEdge, byArea)));
}

/**
 * Output width for `cut`, a part of a page of size `whole`, at no larger a
 * scale than the whole page gets: sized on its own, a page cut for
 * transcription would be enlarged back to the budget and save nothing.
 */
export function aiCutWidth(
  cut: { width: number; height: number },
  whole: { width: number; height: number },
): number {
  const own = aiRenderWidth(cut.width, cut.height);
  if (!(whole.width > 0)) return own;
  const atWholeScale = Math.floor(
    (aiRenderWidth(whole.width, whole.height) * cut.width) / whole.width,
  );
  return Math.min(own, Math.max(1, atWholeScale));
}

/**
 * Anything that can wait for a page's backdrop to be ready to paint (a PDF
 * raster). `VaultBackdropRenderer.draw` does exactly that.
 */
export interface BackdropPreparer {
  draw(
    ctx: CanvasRenderingContext2D,
    backdrop: Page["backdrop"],
    geometry: Page["geometry"],
  ): Promise<void>;
}

/**
 * Render `page` for a model. A PDF backdrop is awaited first, so the slide is
 * in the picture rather than the plain paper the scroll path paints while a
 * raster is still loading.
 */
export async function renderPageForAi(
  page: Page,
  painter: BackdropPainter & BackdropPreparer,
  ink: { usePressure: boolean; highlighterAlpha: number; images?: ImagePainter },
  scaleOf: { width: number; height: number } = page.geometry,
): Promise<RenderedPage | null> {
  const width = aiCutWidth(page.geometry, scaleOf);
  if (width === 0) return null;
  if (page.backdrop.kind === "pdf") {
    // Warm the raster cache; the synchronous paint below then finds it.
    const scratch = createEl("canvas");
    scratch.width = scratch.height = 1;
    const ctx = scratch.getContext("2d");
    if (ctx) {
      try {
        await painter.draw(ctx, page.backdrop, page.geometry);
      } catch {
        // A missing PDF paints its own "missing source" page; nothing to add.
      }
    }
  }
  // Offscreen canvas: never inserted into a DOM, so the main-window createEl
  // global is correct even when the ink view lives in a popout window.
  const canvas = createEl("canvas");
  renderPageThumbnail(canvas, page, painter, width, 1, { ...ink, paper: LIGHT_PAPER });
  if (canvas.width <= 1 && canvas.height <= 1) return null;
  const dataUrl = canvas.toDataURL("image/png");
  return {
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    width: canvas.width,
    height: canvas.height,
  };
}
