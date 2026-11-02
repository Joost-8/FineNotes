/**
 * Export pages as a PDF, or as pictures (PNG or JPG, one per page). PDF
 * backdrops in a PDF retain their original text/vector content with
 * transparent annotation overlays. Other pages, and every picture, use the
 * painter the sidebar thumbnails use — paper and ruling, PDF slide,
 * pictures, text boxes and ink, exactly as the reader sees them — at
 * {@link exportPixelScale}: 2 device px per page px, 2048 × 2896 px for an
 * A4 page (about 250 dpi). A PDF's raster pages are JPEG, wrapped by the
 * dependency-free writer in `src/export/pdf-writer.ts`.
 *
 * Pages render one at a time and each canvas is released before the next,
 * so a long notebook never holds more than one page raster: an iPad's web
 * view is killed, not slowed, when it runs out of canvas memory.
 *
 * DOM (canvas) but no Obsidian imports.
 */

import { annotationLayers } from "../export/annotation-layers";
import { type ExportFormat, type ExportMargins, mimeTypeOf } from "../export/export-choice";
import { type PdfAnnotationRaster, PdfComposer } from "../export/pdf-composer";
import type { PaperTheme } from "../canvas/backdrop";
import { renderPageThumbnail } from "../canvas/renderer";
import type { PageTexts } from "../model/furniture";
import {
  POINTS_PER_PAGE_PX,
  type PdfImagePage,
  buildImagePdf,
  exportPixelScale,
} from "../export/pdf-writer";
import { isTape } from "../model/cover-tape";
import type { Page } from "../model/document";
import { hasMargin, marginHasContent, withoutMargins } from "../model/page-margin";
import { plainBackdrop } from "../model/templates";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import type { VaultImageCache } from "./image-cache";
import { releaseCanvas } from "./image-import";
import type { PdfBackdropCache } from "./pdf-backdrop";

/** JPEG quality, in a PDF and a JPG: ink edges stay clean, a PDF slide stays small. */
const JPEG_QUALITY = 0.9;

export interface PdfExportSources {
  /** Read the original PDF bytes without modifying the source. */
  readPdf?: (path: string) => Promise<ArrayBuffer>;
  /** PDF backdrops' raster cache, shared with the view; `null` paints them as missing. */
  pdf: PdfBackdropCache | null;
  /** Placed pictures; `null` leaves them out. */
  images: VaultImageCache | null;
  paper: PaperTheme;
  usePressure: boolean;
  highlighterAlpha: number;
  /** A page's header and page number, when the notebook has them. */
  furniture?: (page: Page) => PageTexts;
  /** Leave each page's template out (`plainBackdrop`): plain paper under the ink. */
  plainPaper?: boolean;
  /** Leave the cover tapes out (`model/cover-tape`), so what is under them shows. */
  withoutTapes?: boolean;
  /** Which page margins to keep (`model/page-margin`); absent keeps them all. */
  margins?: ExportMargins;
}

/** Whether `page` exports as it is under `margins`, or without its margins. */
export function keepsMargins(page: Page, margins: ExportMargins = "all"): boolean {
  if (margins === "all" || !hasMargin(page)) return true;
  return margins === "inked" && marginHasContent(page);
}

/** `page` with the margins `sources` keep: all, only those with ink, or none. */
function withMarginsOf(page: Page, sources: PdfExportSources): Page {
  return keepsMargins(page, sources.margins) ? page : withoutMargins(page);
}

/** `page` as `sources` paint it: on plain paper when they ask for it. */
function pageOf(original: Page, sources: PdfExportSources): Page {
  const page = withMarginsOf(original, sources);
  if (!sources.plainPaper) return page;
  // A margin's lines are a template too: on plain paper the margin is plain.
  const { marginPaper: _margin, ...backdrop } = plainBackdrop(page.backdrop);
  return backdrop.kind === page.backdrop.kind && !page.backdrop.marginPaper
    ? page
    : { ...page, backdrop };
}

/** `page` as `sources` export it: without its cover tapes when they ask. */
function withTapesOf(page: Page, sources: PdfExportSources): Page {
  if (!sources.withoutTapes || !page.strokes.some(isTape)) return page;
  return { ...page, strokes: page.strokes.filter((stroke) => !isTape(stroke)) };
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
  const hasPdf = pages.some((page) => page.backdrop.kind === "pdf");
  if (hasPdf && !sources.readPdf) throw new Error("PDF source reader unavailable");
  const composer = hasPdf ? await PdfComposer.create(options.title, sources.readPdf!) : null;
  for (const [i, original] of pages.entries()) {
    if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
    options.onProgress?.(i, pages.length);
    // Let the dialog paint its progress before the next page blocks the thread.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (composer && original.backdrop.kind === "pdf") {
      // Margins and plain paper reach a PDF page here; a picture page gets
      // them in paintForExport, which asks the furniture for the original.
      const page = withTapesOf(pageOf(original, sources), sources);
      await composer.addPdf(page, () => renderAnnotationLayers(page, sources, options));
    } else {
      const rendered = await renderPageJpeg(original, sources);
      if (composer) await composer.addImage(rendered);
      else out.push(rendered);
    }
  }
  if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
  options.onProgress?.(pages.length, pages.length);
  if (composer) return composer.save();
  return buildImagePdf(out, { title: options.title, created: new Date() });
}

/** One page as a JPEG, sized for print, with its size in points. */
export async function renderPageJpeg(
  original: Page,
  sources: PdfExportSources,
): Promise<PdfImagePage> {
  return paintForExport(original, sources, false, async (canvas, page) => ({
    jpeg: new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg")).arrayBuffer()),
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    widthPt: page.geometry.width * POINTS_PER_PAGE_PX,
    heightPt: page.geometry.height * POINTS_PER_PAGE_PX,
  }));
}

export interface ImageExportOptions {
  /** Called before each page renders: `done` pages of `total` are finished. */
  onProgress?: (done: number, total: number) => void;
  /** Checked between pages; when it returns true the export stops with an `AbortError`. */
  cancelled?: () => boolean;
  /** Keep the picture of the `index`th page exported; awaited before the next renders. */
  save: (index: number, picture: Blob) => Promise<void>;
}

/**
 * Render `pages` in order as one picture each, handing each to
 * `options.save` as it is made, so no more than one page's raster is held
 * at a time. Pictures saved before a cancel stay saved.
 */
export async function exportPagesToImages(
  pages: readonly Page[],
  sources: PdfExportSources,
  format: Exclude<ExportFormat, "pdf">,
  options: ImageExportOptions,
): Promise<void> {
  for (const [i, page] of pages.entries()) {
    if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
    options.onProgress?.(i, pages.length);
    // Let the dialog paint its progress before the next page blocks the thread.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await options.save(i, await renderPageImage(page, sources, format));
  }
  if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
  options.onProgress?.(pages.length, pages.length);
}

/**
 * One page as a PNG or JPG picture at the export's scale. A PDF backdrop is
 * drawn for it at exactly that scale, not taken from the view's cache,
 * whose whole-page rasters stop short of it and would blur small print.
 */
export function renderPageImage(
  original: Page,
  sources: PdfExportSources,
  format: Exclude<ExportFormat, "pdf">,
): Promise<Blob> {
  return paintForExport(original, sources, true, (canvas) =>
    canvasToBlob(canvas, mimeTypeOf(format)),
  );
}

/**
 * Paint `original` as `sources` export it, at the export's scale, into an
 * offscreen canvas handed to `use`; the canvas and any raster made for it
 * are freed when `use` settles. `exactPdf`: draw a PDF backdrop at exactly
 * that scale ({@link VaultBackdropRenderer.prepareExact}).
 */
async function paintForExport<T>(
  original: Page,
  sources: PdfExportSources,
  exactPdf: boolean,
  use: (canvas: HTMLCanvasElement, page: Page) => Promise<T>,
): Promise<T> {
  const page = withTapesOf(pageOf(original, sources), sources);
  const { width, height } = page.geometry;
  const scale = exportPixelScale(width, height);
  if (scale === 0) throw new Error("A page has no size");

  const painter = await preparePage(page, sources, scale, exactPdf);

  // Offscreen: never inserted into a DOM, so the main-window createEl is right
  // even when the view lives in a popout window.
  const canvas = createEl("canvas");
  try {
    renderPageThumbnail(canvas, page, painter, width * scale, 1, {
      usePressure: sources.usePressure,
      highlighterAlpha: sources.highlighterAlpha,
      paper: sources.paper,
      ...(sources.images ? { images: sources.images } : {}),
      ...(sources.furniture ? { furniture: sources.furniture(original) } : {}),
    });
    return await use(canvas, page);
  } finally {
    releaseCanvas(canvas);
    painter.releaseExact();
  }
}

/**
 * Paint `page` into `canvas` at `cssWidth` CSS px, exactly as it will be
 * exported — for the export dialog's page previews. Resolves once painted.
 */
export async function paintPagePreview(
  canvas: HTMLCanvasElement,
  original: Page,
  sources: PdfExportSources,
  cssWidth: number,
  dpr: number,
): Promise<void> {
  const page = withTapesOf(pageOf(original, sources), sources);
  const { width } = page.geometry;
  if (!(width > 0) || !(cssWidth > 0)) return;
  const painter = await preparePage(page, sources, (cssWidth / width) * dpr);
  renderPageThumbnail(canvas, page, painter, cssWidth, dpr, {
    usePressure: sources.usePressure,
    highlighterAlpha: sources.highlighterAlpha,
    paper: sources.paper,
    ...(sources.images ? { images: sources.images } : {}),
    ...(sources.furniture ? { furniture: sources.furniture(original) } : {}),
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
  exactPdf = false,
): Promise<VaultBackdropRenderer> {
  const painter = new VaultBackdropRenderer(sources.pdf);
  painter.theme = sources.paper;
  painter.setDeviceScale(scale);
  if (page.backdrop.kind === "pdf" && exactPdf) {
    await painter.prepareExact(page.backdrop, page.geometry, scale);
  } else if (page.backdrop.kind === "pdf") {
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

/** `canvas` encoded as `type` (JPEG at {@link JPEG_QUALITY}). */
function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The page could not be encoded — it may be too large"));
      },
      type,
      type === "image/jpeg" ? JPEG_QUALITY : undefined,
    );
  });
}

/** Transparent ink/text/pictures only; source PDF content is composed separately. */
async function renderAnnotationPng(
  page: Page,
  sources: PdfExportSources,
  paper = false,
): Promise<Uint8Array> {
  const scale = exportPixelScale(page.geometry.width, page.geometry.height);
  if (!scale) throw new Error("A page has no size");
  if (sources.images) await sources.images.prepare(page.images, scale);
  const canvas = createEl("canvas");
  try {
    // The margin's paper is a layer of its own (`annotationLayers`): a painter
    // with no PDF draws it there, and every other layer has no paper at all.
    const margins = new VaultBackdropRenderer(null);
    margins.theme = sources.paper;
    const painter = paper ? margins : { paint: () => undefined };
    renderPageThumbnail(canvas, page, painter, page.geometry.width * scale, 1, {
      transparent: true,
      usePressure: sources.usePressure,
      highlighterAlpha: sources.highlighterAlpha,
      ...(sources.images ? { images: sources.images } : {}),
      ...(sources.furniture ? { furniture: sources.furniture(page) } : {}),
    });
    return await new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("PDF annotations could not be encoded"));
          return;
        }
        blob.arrayBuffer().then((bytes) => resolve(new Uint8Array(bytes)), reject);
      }, "image/png");
    });
  } finally {
    releaseCanvas(canvas);
  }
}

/** Encode and release one layer at a time, preserving highlighter blending and stroke order. */
async function* renderAnnotationLayers(
  page: Page,
  sources: PdfExportSources,
  options: PdfExportOptions,
): AsyncGenerator<PdfAnnotationRaster> {
  for (const layer of annotationLayers(page)) {
    if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    yield {
      png: await renderAnnotationPng(layer.page, sources, layer.paper === true),
      multiply: layer.multiply,
    };
  }
}
