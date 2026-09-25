/**
 * Export pages as a PDF: each page is rasterised through the painter the
 * sidebar thumbnails use — paper and ruling, PDF slide, pictures, text boxes
 * and ink, exactly as the reader sees them — encoded as JPEG, and wrapped by
 * the dependency-free writer in `src/export/pdf-writer.ts`.
 *
 * Pages render one at a time and each canvas is released before the next,
 * so a long notebook never holds more than one page raster: an iPad's web
 * view is killed, not slowed, when it runs out of canvas memory.
 *
 * DOM (canvas) but no Obsidian imports.
 */

import type { PaperTheme } from "../canvas/backdrop";
import { renderPageThumbnail } from "../canvas/renderer";
import {
  POINTS_PER_PAGE_PX,
  type PdfImagePage,
  buildImagePdf,
  exportPixelScale,
} from "../export/pdf-writer";
import type { Page } from "../model/document";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import type { VaultImageCache } from "./image-cache";
import { releaseCanvas } from "./image-import";
import type { PdfBackdropCache } from "./pdf-backdrop";

/** JPEG quality: ink edges stay clean, a PDF slide stays small. */
const JPEG_QUALITY = 0.9;

export interface PdfExportSources {
  /** PDF backdrops' raster cache, shared with the view; `null` paints them as missing. */
  pdf: PdfBackdropCache | null;
  /** Placed pictures; `null` leaves them out. */
  images: VaultImageCache | null;
  paper: PaperTheme;
  usePressure: boolean;
  highlighterAlpha: number;
}

export interface PdfExportOptions {
  title: string;
  /** Called before each page renders: `done` pages of `total` are finished. */
  onProgress?: (done: number, total: number) => void;
  /** Checked between pages; when it returns true the export stops with an `AbortError`. */
  cancelled?: () => boolean;
}

/** Render `pages` in order and return the PDF's bytes. */
export async function exportPagesToPdf(
  pages: readonly Page[],
  sources: PdfExportSources,
  options: PdfExportOptions,
): Promise<Uint8Array> {
  const out: PdfImagePage[] = [];
  for (const [i, page] of pages.entries()) {
    if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
    options.onProgress?.(i, pages.length);
    // Let the dialog paint its progress before the next page blocks the thread.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    out.push(await renderPageJpeg(page, sources));
  }
  options.onProgress?.(pages.length, pages.length);
  return buildImagePdf(out, { title: options.title, created: new Date() });
}

/** One page as a JPEG, sized for print, with its size in points. */
export async function renderPageJpeg(page: Page, sources: PdfExportSources): Promise<PdfImagePage> {
  const { width, height } = page.geometry;
  const scale = exportPixelScale(width, height);
  if (scale === 0) throw new Error("A page has no size");

  const painter = await preparePage(page, sources, scale);

  // Offscreen: never inserted into a DOM, so the main-window createEl is right
  // even when the view lives in a popout window.
  const canvas = createEl("canvas");
  try {
    renderPageThumbnail(canvas, page, painter, width * scale, 1, {
      usePressure: sources.usePressure,
      highlighterAlpha: sources.highlighterAlpha,
      paper: sources.paper,
      ...(sources.images ? { images: sources.images } : {}),
    });
    const jpeg = await canvasToJpeg(canvas);
    return {
      jpeg,
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      widthPt: width * POINTS_PER_PAGE_PX,
      heightPt: height * POINTS_PER_PAGE_PX,
    };
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * Paint `page` into `canvas` at `cssWidth` CSS px, exactly as it will be
 * exported — for the export dialog's page previews. Resolves once painted.
 */
export async function paintPagePreview(
  canvas: HTMLCanvasElement,
  page: Page,
  sources: PdfExportSources,
  cssWidth: number,
  dpr: number,
): Promise<void> {
  const { width } = page.geometry;
  if (!(width > 0) || !(cssWidth > 0)) return;
  const painter = await preparePage(page, sources, (cssWidth / width) * dpr);
  renderPageThumbnail(canvas, page, painter, cssWidth, dpr, {
    usePressure: sources.usePressure,
    highlighterAlpha: sources.highlighterAlpha,
    paper: sources.paper,
    ...(sources.images ? { images: sources.images } : {}),
  });
}

/**
 * Everything a page needs before a one-shot synchronous paint: a backdrop
 * renderer of its own at `scale` device px per page px (the view's is tuned
 * to the zoom on screen, and changing it would re-rasterise every slide),
 * its PDF slide rasterised, and its pictures decoded — or the paint would
 * show plain paper and stand-in boxes.
 */
async function preparePage(
  page: Page,
  sources: PdfExportSources,
  scale: number,
): Promise<VaultBackdropRenderer> {
  const painter = new VaultBackdropRenderer(sources.pdf);
  painter.theme = sources.paper;
  painter.setDeviceScale(scale);
  if (page.backdrop.kind === "pdf") {
    // Warm the raster cache; the synchronous paint then finds it.
    const scratch = createEl("canvas");
    scratch.width = scratch.height = 1;
    const ctx = scratch.getContext("2d");
    if (ctx) {
      try {
        await painter.draw(ctx, page.backdrop, page.geometry);
      } catch {
        // A missing PDF paints its own "missing source" page.
      }
    }
    releaseCanvas(scratch);
  }
  if (sources.images && page.images.length > 0) {
    await sources.images.prepare(page.images, scale);
  }
  return painter;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The page could not be encoded — it may be too large"));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
