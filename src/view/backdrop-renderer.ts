/**
 * The view's `BackdropRenderer` (contracts/api.md §4): resolves a page's
 * `Backdrop` to pixels.
 *
 * It implements two interfaces on purpose:
 *
 * - `BackdropRenderer` — the asynchronous contract interface, for one-shot
 *   draws where waiting for a PDF raster is fine.
 * - `BackdropPainter` — the synchronous form the scroll path needs. A PDF page
 *   that is not yet rasterised paints as plain paper *now* and asks for a
 *   repaint when the bitmap lands, because blocking a scroll frame on I/O is
 *   exactly the iPad performance failure the contract warns about.
 */

import {
  type BackdropRenderer,
  LIGHT_PAPER,
  type PaperTheme,
  drawMissingSource,
  drawSynthetic,
  fillPaper,
} from "../canvas/backdrop";
import type { BackdropPainter } from "../canvas/renderer";
import {
  PDF_DETAIL_ZOOM,
  pdfAreaKey,
  visiblePdfArea,
  type PdfRenderArea,
} from "../canvas/pdf-raster";
import type { Bounds, Backdrop, PageGeometry } from "../model/document";
import { type PdfBackdropCache, type PdfEntry, quantiseScale } from "./pdf-backdrop";

export class VaultBackdropRenderer implements BackdropRenderer, BackdropPainter {
  /** Paper colours. Paper-white unless the notebook overrides it. */
  theme: PaperTheme = LIGHT_PAPER;

  /** `devicePixelRatio * viewScale`, quantised. Part of the PDF cache key. */
  private scale = 1;
  private pageScale: number | null = null;
  private readonly details = new Map<string, { scale: number; area: PdfRenderArea }>();

  /**
   * @param pdf PDF raster cache, or `null` where there is no vault to read from
   *            (inline embeds, tests). A `pdf` backdrop then paints as a
   *            "missing source" page — never as nothing.
   */
  constructor(private readonly pdf: PdfBackdropCache | null) {}

  /** Tell the renderer what resolution PDF pages should be rasterised at. */
  setDeviceScale(deviceScale: number): void {
    this.scale = quantiseScale(deviceScale);
  }

  /** One request per visible page, shared by every ink tile. */
  prepare(
    visible: Array<{ backdrop: Backdrop; geometry: PageGeometry; region: Bounds }>,
    deviceScale: number,
    zoom: number,
    transient: boolean,
  ): void {
    if (!transient || this.pageScale === null)
      this.pageScale = quantiseScale(
        deviceScale * Math.min(1, PDF_DETAIL_ZOOM / Math.max(1, zoom)),
      );
    this.details.clear();
    const requests: Array<{ path: string; page: number; dprScale: number; area: PdfRenderArea }> =
      [];
    for (const { backdrop, geometry, region } of visible) {
      if (backdrop.kind !== "pdf" || transient) continue;
      const area = visiblePdfArea(geometry, region, zoom);
      if (!area) continue;
      this.details.set(this.detailKey(backdrop.path, backdrop.page, geometry), {
        scale: deviceScale,
        area,
      });
      requests.push({ path: backdrop.path, page: backdrop.page, dprScale: deviceScale, area });
    }
    this.pdf?.setVisibleRegions(requests);
  }

  private detailKey(path: string, page: number, geometry: PageGeometry): string {
    return JSON.stringify([path, page, pdfAreaKey({ geometry })]);
  }

  /** Synchronous paint for the scroll path. Never blocks. */
  paint(
    ctx: CanvasRenderingContext2D,
    backdrop: Backdrop,
    geometry: PageGeometry,
    weight = 1,
    target?: { deviceScale: number; region?: Bounds },
  ): void {
    if (backdrop.kind !== "pdf") {
      drawSynthetic(ctx, backdrop, geometry, this.theme, weight);
      return;
    }
    if (!this.pdf) {
      drawMissingSource(ctx, geometry, this.theme, missingLabel(backdrop.path));
      return;
    }
    const scale = this.pageScale ?? quantiseScale(target?.deviceScale ?? this.scale);
    const area = { geometry };
    const entry = this.pdf.peek(backdrop.path, backdrop.page, scale, area);
    if (entry) this.paintEntry(ctx, entry, geometry);
    else {
      // Not rasterised at this scale yet: the page at another scale if one is
      // cached (a zoom just changed it), else plain paper; repaint when the
      // bitmap arrives.
      const stand = this.pdf.peekNearest(backdrop.path, backdrop.page, scale, area);
      if (stand) this.paintEntry(ctx, stand, geometry);
      else fillPaper(ctx, geometry, this.theme);
      this.pdf.request(backdrop.path, backdrop.page, scale, area);
    }
    // Previews/exports never pick up viewport detail. Ink tiles reuse one patch.
    const detail = target?.region
      ? this.details.get(this.detailKey(backdrop.path, backdrop.page, geometry))
      : undefined;
    if (detail) {
      const patch = this.pdf.peek(backdrop.path, backdrop.page, detail.scale, detail.area);
      if (patch?.ok) {
        // Do not repaint the whole paper: the full-page fallback must remain around the patch.
        const { box, canvas } = patch;
        if (box && canvas.width && canvas.height) ctx.drawImage(canvas, box.x, box.y, box.w, box.h);
      }
    }
  }

  /** The contract's asynchronous form: waits for the raster. */
  async draw(
    ctx: CanvasRenderingContext2D,
    backdrop: Backdrop,
    geometry: PageGeometry,
  ): Promise<void> {
    if (backdrop.kind !== "pdf") {
      drawSynthetic(ctx, backdrop, geometry, this.theme);
      return;
    }
    if (!this.pdf) {
      drawMissingSource(ctx, geometry, this.theme, missingLabel(backdrop.path));
      return;
    }
    const entry = await this.pdf.resolve(backdrop.path, backdrop.page, this.scale, { geometry });
    this.paintEntry(ctx, entry, geometry);
  }

  private paintEntry(ctx: CanvasRenderingContext2D, entry: PdfEntry, geometry: PageGeometry): void {
    if (!entry.ok) {
      // The page still exists and the ink is still drawn over it.
      drawMissingSource(ctx, geometry, this.theme, entry.reason);
      return;
    }
    fillPaper(ctx, geometry, this.theme);
    const { canvas } = entry;
    if (canvas.width === 0 || canvas.height === 0) return;
    if (entry.box) {
      const { x, y, w, h } = entry.box;
      ctx.drawImage(canvas, x, y, w, h);
      return;
    }
    // Contain: a PDF page whose aspect differs from the notebook's page size is
    // centred rather than stretched — stretched slides read as a rendering bug.
    const k = Math.min(geometry.width / canvas.width, geometry.height / canvas.height);
    const w = canvas.width * k;
    const h = canvas.height * k;
    ctx.drawImage(canvas, (geometry.width - w) / 2, (geometry.height - h) / 2, w, h);
  }
}

function missingLabel(path: string): string {
  return `Missing PDF source — ${path}`;
}
