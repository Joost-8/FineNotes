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
import type { Backdrop, PageGeometry } from "../model/document";
import { type PdfBackdropCache, type PdfEntry, quantiseScale } from "./pdf-backdrop";

export class VaultBackdropRenderer implements BackdropRenderer, BackdropPainter {
  /** Paper colours. Paper-white unless the notebook overrides it. */
  theme: PaperTheme = LIGHT_PAPER;

  /** `devicePixelRatio * viewScale`, quantised. Part of the PDF cache key. */
  private scale = 1;

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

  /** Synchronous paint for the scroll path. Never blocks. */
  paint(
    ctx: CanvasRenderingContext2D,
    backdrop: Backdrop,
    geometry: PageGeometry,
    weight = 1,
  ): void {
    if (backdrop.kind !== "pdf") {
      drawSynthetic(ctx, backdrop, geometry, this.theme, weight);
      return;
    }
    if (!this.pdf) {
      drawMissingSource(ctx, geometry, this.theme, missingLabel(backdrop.path));
      return;
    }
    const entry = this.pdf.peek(backdrop.path, backdrop.page, this.scale);
    if (!entry) {
      // Not rasterised yet: plain paper now, repaint when the bitmap arrives.
      fillPaper(ctx, geometry, this.theme);
      this.pdf.request(backdrop.path, backdrop.page, this.scale);
      return;
    }
    this.paintEntry(ctx, entry, geometry);
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
    const entry = await this.pdf.resolve(backdrop.path, backdrop.page, this.scale);
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
