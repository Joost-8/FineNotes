/**
 * A notebook's first page drawn small, for the Folders library's cards: the
 * paper and its ruling, the PDF it is written on, its pictures, then the
 * ink (highlighters last, so they tint what is under them). The page is read
 * by `model/folder-thumbnail.ts`.
 */

import { type App, TFile } from "obsidian";
import {
  HIGHLIGHTER_ALPHA,
  MAX_THUMBNAIL_IMAGES,
  RULING_SPACING,
  type ThumbnailImage,
  type ThumbnailPage,
  type ThumbnailStroke,
  fitInto,
  readThumbnailPage,
} from "../../model/folder-thumbnail";
import { type PdfJs } from "./pdfjs";

/** How wide a thumbnail is drawn, px. */
const THUMB_WIDTH = 300;
/** The tallest a thumbnail may be, as a share of its width. */
const MAX_HEIGHT_SHARE = 0.95;
/** A JPEG data URL longer than this is saved again at a lower quality. */
const MAX_DATA_URL_LENGTH = 45e3 * 1.37;
/** The widest a picture is decoded for a thumbnail, px. */
const IMAGE_DECODE_WIDTH = 600;

/** What a thumbnail needs of the outside world. */
export interface ThumbnailSources {
  /** Draw the PDF page onto the canvas, fitted to `size`, scaled by `scale`. Throws when it cannot. */
  drawPdf?: (
    ctx: CanvasRenderingContext2D,
    pdf: { path: string; page: number },
    size: { width: number; height: number },
    scale: number,
  ) => Promise<void>;
  /** A picture of the vault, or null when it is not there. */
  loadImage?: (path: string) => Promise<ImageBitmap | null>;
}

/** The file at a vault path (a leading slash is ignored), if it is a file. */
export function fileAt(app: App, path: string): TFile | null {
  const found = app.vault.getAbstractFileByPath(path.replace(/^\/+/, ""));
  return found instanceof TFile ? found : null;
}

/** The paper: its colour and its rules or dots. */
function drawPaper(
  ctx: CanvasRenderingContext2D,
  page: ThumbnailPage,
  scale: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = page.paperColor;
  ctx.fillRect(0, 0, width, height);
  const ruling = page.ruling;
  const spacing = (page.spacing ?? RULING_SPACING[ruling] ?? 0) * scale;
  if (spacing <= 3) return;
  ctx.strokeStyle = page.ruleColor ?? "#c9d3e0";
  ctx.fillStyle = page.ruleColor ?? "#c9d3e0";
  ctx.lineWidth = Math.max(0.5, scale);
  if (ruling === "dotted") {
    for (let y = spacing; y < height; y += spacing) {
      for (let x = spacing; x < width; x += spacing) ctx.fillRect(x - 0.5, y - 0.5, 1.2, 1.2);
    }
    return;
  }
  ctx.beginPath();
  for (let y = spacing * 1.5; y < height; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  if (ruling === "squared" || ruling === "grid" || ruling === "graph") {
    for (let x = spacing; x < width; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
  }
  ctx.stroke();
}

/** Draw `images` in order (at most eight); `failed.count` counts the ones that could not be drawn. */
async function drawImages(
  ctx: CanvasRenderingContext2D,
  images: readonly ThumbnailImage[],
  scale: number,
  sources: ThumbnailSources,
  failed: { count: number },
): Promise<void> {
  for (const image of images.slice(0, MAX_THUMBNAIL_IMAGES)) {
    ctx.save();
    ctx.globalAlpha = image.opacity;
    ctx.translate((image.x + image.w / 2) * scale, (image.y + image.h / 2) * scale);
    if (image.rotation) ctx.rotate(image.rotation);
    if (image.flipX || image.flipY) ctx.scale(image.flipX ? -1 : 1, image.flipY ? -1 : 1);
    const width = image.w * scale;
    const height = image.h * scale;
    if (image.sticky) {
      ctx.fillStyle = image.sticky;
      ctx.fillRect(-width / 2, -height / 2, width, height);
    } else if (sources.loadImage) {
      try {
        const bitmap = await sources.loadImage(image.path);
        if (!bitmap) throw new Error("not in the vault");
        const crop = image.crop;
        if (crop) {
          ctx.drawImage(
            bitmap,
            crop.x * bitmap.width,
            crop.y * bitmap.height,
            crop.w * bitmap.width,
            crop.h * bitmap.height,
            -width / 2,
            -height / 2,
            width,
            height,
          );
        } else {
          ctx.drawImage(bitmap, -width / 2, -height / 2, width, height);
        }
      } catch (error) {
        console.warn(`FineNotes: picture ${image.path} could not be drawn`, error);
        failed.count++;
      }
    }
    ctx.restore();
  }
}

/** One stroke: a dot, a polyline for a shape, or a smooth curve through its points. */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: ThumbnailStroke, scale: number): void {
  const pts = stroke.pts;
  const count = pts.length / 3;
  if (count === 0) return;
  let total = 0;
  let pressed = 0;
  for (let i = 2; i < pts.length; i += 3) {
    if (pts[i] > 0) {
      total += pts[i];
      pressed++;
    }
  }
  const pressure = !stroke.highlighter && pressed > 0 ? 0.55 + 0.9 * (total / pressed) : 1;
  const width = Math.max(stroke.size * pressure * scale, stroke.highlighter ? 1 : 0.6);
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = width;
  ctx.lineCap = stroke.highlighter ? "butt" : "round";
  ctx.lineJoin = "round";
  if (stroke.highlighter) {
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.globalCompositeOperation = "multiply";
  }
  const x = (i: number): number => pts[i * 3] * scale;
  const y = (i: number): number => pts[i * 3 + 1] * scale;
  if (count === 1) {
    ctx.beginPath();
    ctx.arc(x(0), y(0), width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x(0), y(0));
  if (stroke.shape || count === 2) {
    for (let i = 1; i < count; i++) ctx.lineTo(x(i), y(i));
  } else {
    for (let i = 1; i < count - 1; i++) {
      ctx.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
    }
    ctx.lineTo(x(count - 1), y(count - 1));
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a page onto `ctx`: paper, PDF, the pictures behind the ink, the ink
 * (highlighter last), then the pictures in front. Whether everything could be
 * drawn.
 */
async function drawPage(
  ctx: CanvasRenderingContext2D,
  page: ThumbnailPage,
  width: number,
  height: number,
  scale: number,
  sources: ThumbnailSources,
): Promise<boolean> {
  drawPaper(ctx, page, scale, width, height);
  const failed = { count: 0 };
  if (page.pdf && sources.drawPdf) {
    try {
      await sources.drawPdf(ctx, page.pdf, { width: page.width, height: page.height }, scale);
    } catch (error) {
      console.warn(`FineNotes: PDF ${page.pdf.path} could not be drawn`, error);
      failed.count++;
    }
  }
  await drawImages(
    ctx,
    page.images.filter((image) => !image.front),
    scale,
    sources,
    failed,
  );
  for (const stroke of page.strokes) if (!stroke.highlighter) drawStroke(ctx, stroke, scale);
  for (const stroke of page.strokes) if (stroke.highlighter) drawStroke(ctx, stroke, scale);
  await drawImages(
    ctx,
    page.images.filter((image) => image.front),
    scale,
    sources,
    failed,
  );
  return failed.count === 0;
}

/** One page of a PDF drawn onto `ctx`, fitted into `size`. */
async function drawPdfPage(
  lib: PdfJs,
  data: ArrayBuffer,
  ctx: CanvasRenderingContext2D,
  pdf: { path: string; page: number },
  size: { width: number; height: number },
  scale: number,
): Promise<void> {
  const document = await lib.getDocument({ data }).promise;
  try {
    const number = Math.min(Math.max(pdf.page, 0), document.numPages - 1) + 1;
    const page = await document.getPage(number);
    const natural = page.getViewport({ scale: 1 });
    const { fit, dx, dy } = fitInto(natural, size);
    const viewport = page.getViewport({ scale: fit * scale });
    await page.render({
      canvasContext: ctx,
      viewport,
      canvas: ctx.canvas,
      transform: [1, 0, 0, 1, dx * scale, dy * scale],
    }).promise;
  } finally {
    await document.destroy();
  }
}

/** A drawn thumbnail: a JPEG data URL, and whether everything on the page could be drawn. */
export interface RenderedThumbnail {
  url: string;
  complete: boolean;
}

/** The first page of the notebook `file`, drawn small; null when it is not a readable notebook. */
export async function renderNotebookThumbnail(
  app: App,
  file: TFile,
  loadPdfLibrary: () => Promise<PdfJs>,
): Promise<RenderedThumbnail | null> {
  let markdown: string | null = await app.vault.cachedRead(file);
  let page = readThumbnailPage(markdown);
  markdown = null;
  if (!page) return null;
  const scale = THUMB_WIDTH / page.width;
  const width = THUMB_WIDTH;
  const height = Math.max(
    1,
    Math.round(Math.min(page.height * scale, THUMB_WIDTH * MAX_HEIGHT_SHARE)),
  );
  const canvas = createEl("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const complete = await drawPage(ctx, page, width, height, scale, {
    drawPdf: async (target, pdf, size, drawScale) => {
      const source = fileAt(app, pdf.path);
      if (!source) throw new Error("not in the vault");
      const data = await app.vault.readBinary(source);
      await drawPdfPage(await loadPdfLibrary(), data, target, pdf, size, drawScale);
    },
    loadImage: async (path) => {
      const source = fileAt(app, path);
      if (!source) return null;
      const data = await app.vault.readBinary(source);
      return createImageBitmap(new Blob([data]), {
        resizeWidth: IMAGE_DECODE_WIDTH,
        resizeQuality: "low",
      });
    },
  });
  page = null;
  let url = canvas.toDataURL("image/jpeg", 0.7);
  if (url.length > MAX_DATA_URL_LENGTH) url = canvas.toDataURL("image/jpeg", 0.5);
  canvas.width = 0;
  canvas.height = 0;
  return { url, complete };
}
