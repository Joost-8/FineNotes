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
import { type PdfLayer, PdfComposer } from "../export/pdf-composer";
import { type PaperTheme, inkShade, pageLook } from "../canvas/backdrop";
import { type BackdropPainter, hasOverInk, renderPageThumbnail } from "../canvas/renderer";
import { PdfCanvasRecorder } from "../export/pdf-canvas";
import { type VectorInk, vectorInk } from "../export/vector-ink";
import { isNoteInk, noteIdsOf } from "../model/sticky-notes";
import { marginBackdrop } from "../model/page-margin";
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
  /**
   * Most device px per page px to paint at, under the export's own scale:
   * 1 for a notebook sent to the AI, which reads an A4 page well at
   * 1024 px wide and would only pay for more.
   */
  maxPixelScale?: number;
  /**
   * `false`: every page that is not a PDF is one picture, the old export.
   * Otherwise (the default) ink, shapes and highlighters are vector paths,
   * the way Goodnotes exports, and so are the paper and its rulings when
   * nothing under the ink needs a picture; text boxes, pictures and tapes
   * stay pictures. A smaller file, sharp at any zoom.
   */
  vectorInk?: boolean;
  /** JPEG quality of picture pages, 0 to 1; {@link JPEG_QUALITY} when absent. */
  jpegQuality?: number;
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
  /** Optional PDF Subject metadata (used by Companion PDFs to store stable identity). */
  subject?: string;
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
  const vector = sources.vectorInk !== false;
  const composer =
    hasPdf || vector || options.subject
      ? await PdfComposer.create(options.title, sources.readPdf ?? null, options.subject)
      : null;
  for (const [i, original] of pages.entries()) {
    if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
    options.onProgress?.(i, pages.length);
    // Let the dialog paint its progress before the next page blocks the thread.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (composer && original.backdrop.kind === "pdf") {
      // Margins and plain paper reach a PDF page here; a picture page gets
      // them in paintForExport, which asks the furniture for the original.
      const page = withTapesOf(pageOf(original, sources), sources);
      await composer.addPdf(page, () =>
        vector
          ? renderVectorOverlay(page, sources)
          : renderAnnotationLayers(page, sources, options),
      );
    } else if (composer && vector) {
      const page = withTapesOf(pageOf(original, sources), sources);
      await composer.addLayered(
        page.geometry.width * POINTS_PER_PAGE_PX,
        page.geometry.height * POINTS_PER_PAGE_PX,
        renderVectorPage(original, page, sources),
      );
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
    jpeg: new Uint8Array(
      await (await canvasToBlob(canvas, "image/jpeg", sources.jpegQuality)).arrayBuffer(),
    ),
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
  parts?: "under" | "over",
): Promise<T> {
  const page = withTapesOf(pageOf(original, sources), sources);
  const { width, height } = page.geometry;
  const scale = Math.min(exportPixelScale(width, height), sources.maxPixelScale ?? Infinity);
  if (!(scale > 0)) throw new Error("A page has no size");

  // What lies over the ink needs neither the paper nor a PDF slide.
  const painter =
    parts === "over"
      ? await preparePage({ ...page, backdrop: plainBackdrop(page.backdrop) }, sources, scale)
      : await preparePage(page, sources, scale, exactPdf);

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
      ...(parts ? { parts } : {}),
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
 * With `crop` (page px) only that part is painted, `cssWidth` wide: a
 * board's drawing or a named region in a note's embed.
 */
export async function paintPagePreview(
  canvas: HTMLCanvasElement,
  original: Page,
  sources: PdfExportSources,
  cssWidth: number,
  dpr: number,
  crop?: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const page = withTapesOf(pageOf(original, sources), sources);
  const { width } = crop ?? page.geometry;
  if (!(width > 0) || !(cssWidth > 0)) return;
  // Cropped, only the pictures that reach into the cut are decoded.
  const shown = crop ? { ...page, images: page.images.filter((i) => reaches(i, crop)) } : page;
  const painter = await preparePage(shown, sources, (cssWidth / width) * dpr);
  renderPageThumbnail(canvas, page, painter, cssWidth, dpr, {
    usePressure: sources.usePressure,
    highlighterAlpha: sources.highlighterAlpha,
    paper: sources.paper,
    ...(sources.images ? { images: sources.images } : {}),
    ...(sources.furniture ? { furniture: sources.furniture(original) } : {}),
    ...(crop ? { crop } : {}),
  });
}

/** Whether a picture, turned any way about its centre, can reach into `box` (page px). */
function reaches(
  image: { x: number; y: number; w: number; h: number },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const r = Math.hypot(image.w, image.h) / 2;
  const cx = image.x + image.w / 2;
  const cy = image.y + image.h / 2;
  return (
    cx + r >= box.x &&
    cx - r <= box.x + box.width &&
    cy + r >= box.y &&
    cy - r <= box.y + box.height
  );
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

/** `canvas` encoded as `type` (JPEG at `quality`, else {@link JPEG_QUALITY}). */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The page could not be encoded — it may be too large"));
      },
      type,
      type === "image/jpeg" ? (quality ?? JPEG_QUALITY) : undefined,
    );
  });
}

/** Transparent ink/text/pictures only; source PDF content is composed separately. */
async function renderAnnotationPng(
  page: Page,
  sources: PdfExportSources,
  paper = false,
  parts?: "under" | "over",
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
      ...(parts ? { parts } : {}),
    });
    return await canvasToPng(canvas);
  } finally {
    releaseCanvas(canvas);
  }
}

/** `canvas` as PNG bytes. */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("PDF annotations could not be encoded"));
        return;
      }
      blob.arrayBuffer().then((bytes) => resolve(new Uint8Array(bytes)), reject);
    }, "image/png");
  });
}

/** Encode and release one layer at a time, preserving highlighter blending and stroke order. */
async function* renderAnnotationLayers(
  page: Page,
  sources: PdfExportSources,
  options: PdfExportOptions,
): AsyncGenerator<PdfLayer> {
  for (const layer of annotationLayers(page)) {
    if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    yield {
      png: await renderAnnotationPng(layer.page, sources, layer.paper === true),
      multiply: layer.multiply,
    };
  }
}

/** The ink `page` paints in its ink pass, as vectors: not a sticky note's (drawn with its note), not a tape. */
export function pageVectorInk(page: Page, sources: PdfExportSources): VectorInk {
  const notes = noteIdsOf(page.images);
  const strokes = page.strokes.filter((stroke) => !isNoteInk(stroke, notes) && !isTape(stroke));
  return vectorInk(strokes, {
    usePressure: sources.usePressure,
    highlighterAlpha: sources.highlighterAlpha,
    shade: inkShade(pageLook(page.backdrop, sources.paper)),
  });
}

/**
 * A page that is not a PDF as layers: a JPEG of everything under its ink,
 * the ink in vectors, and a PNG of what lies over the ink when anything does.
 * One raster at a time, each released before the next.
 */
async function* renderVectorPage(
  original: Page,
  page: Page,
  sources: PdfExportSources,
): AsyncGenerator<PdfLayer> {
  // The paper and its rulings as paths when nothing under the ink needs a picture.
  const paper =
    page.images.length === 0
      ? await recordUnderInk(
          page,
          sources,
          async (scale) => {
            const painter = await preparePage(page, sources, scale);
            return { painter, release: () => painter.releaseExact() };
          },
          sources.furniture?.(original),
        )
      : null;
  yield paper ??
    (await paintForExport(
      original,
      sources,
      false,
      async (canvas) => ({
        jpeg: new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg")).arrayBuffer()),
      }),
      "under",
    ));
  yield { ink: pageVectorInk(page, sources) };
  if (hasOverInk(page)) {
    yield await paintForExport(
      original,
      sources,
      false,
      async (canvas) => ({ png: await canvasToPng(canvas) }),
      "over",
    );
  }
}

/**
 * What lies under `page`'s ink, recorded as vector paths by the painters
 * that draw it on screen ({@link PdfCanvasRecorder}), at the export's scale;
 * `null` when anything there needs a picture (text, an image, a pattern),
 * for the caller to paint it as one instead.
 */
async function recordUnderInk(
  page: Page,
  sources: PdfExportSources,
  prepare: (scale: number) => Promise<{ painter: BackdropPainter; release: () => void }>,
  furniture: PageTexts | undefined,
  transparent = false,
): Promise<PdfLayer | null> {
  const { width, height } = page.geometry;
  const scale = Math.min(exportPixelScale(width, height), sources.maxPixelScale ?? Infinity);
  if (!(scale > 0)) return null;
  const { painter, release } = await prepare(scale);
  const recorder = new PdfCanvasRecorder(0, 0);
  const ctx = recorder.asContext();
  const canvas = Object.assign(recorder.canvas, { getContext: () => ctx });
  try {
    renderPageThumbnail(canvas as unknown as HTMLCanvasElement, page, painter, width * scale, 1, {
      usePressure: sources.usePressure,
      highlighterAlpha: sources.highlighterAlpha,
      paper: sources.paper,
      ...(furniture ? { furniture } : {}),
      ...(transparent ? { transparent } : {}),
      parts: "under",
    });
  } catch {
    return null;
  } finally {
    release();
  }
  if (recorder.unsupported) return null;
  return { ink: recorder.result(), box: [recorder.canvas.width, recorder.canvas.height] };
}

/** Whether a PDF page has anything under its ink besides the PDF: a margin's paper, pictures, tables… */
function hasUnderInk(page: Page): boolean {
  return (
    marginBackdrop(page) !== null ||
    page.images.length > 0 ||
    (page.tables?.length ?? 0) > 0 ||
    (page.graphs?.length ?? 0) > 0 ||
    (page.equations?.length ?? 0) > 0 ||
    (page.connectors?.length ?? 0) > 0
  );
}

/** A PDF page's annotations: a PNG of what lies under the ink, the ink in vectors, a PNG of what lies over it. */
async function* renderVectorOverlay(
  page: Page,
  sources: PdfExportSources,
): AsyncGenerator<PdfLayer> {
  if (hasUnderInk(page)) {
    // A margin's paper, tables, connectors: paths, unless a picture or text needs a raster.
    const margins = new VaultBackdropRenderer(null);
    margins.theme = sources.paper;
    const recorded =
      page.images.length === 0
        ? await recordUnderInk(
            page,
            sources,
            () => Promise.resolve({ painter: margins, release: () => undefined }),
            sources.furniture?.(page),
            true,
          )
        : null;
    yield recorded ?? { png: await renderAnnotationPng(page, sources, true, "under") };
  }
  yield { ink: pageVectorInk(page, sources) };
  if (hasOverInk(page)) yield { png: await renderAnnotationPng(page, sources, false, "over") };
}
