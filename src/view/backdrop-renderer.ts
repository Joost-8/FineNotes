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
import { tilesFor } from "../canvas/pdf-tiles";
import {
  PDF_DETAIL_ZOOM,
  boundsMeet,
  detailPdfArea,
  visiblePdfArea,
  type PdfRenderArea,
} from "../canvas/pdf-raster";
import type { Bounds, Backdrop, PageGeometry } from "../model/document";
import {
  type PdfBackdropCache,
  type PdfEntry,
  type PdfShownArea,
  quantiseScale,
} from "./pdf-backdrop";

export class VaultBackdropRenderer implements BackdropRenderer, BackdropPainter {
  /** Paper colours. Paper-white unless the notebook overrides it. */
  theme: PaperTheme = LIGHT_PAPER;

  /** `devicePixelRatio * viewScale`, quantised. Part of the PDF cache key. */
  private scale = 1;
  private pageScale: number | null = null;
  /**
   * The device scale detail is drawn at while zoomed in past
   * `PDF_DETAIL_ZOOM`, as of the last settled frame; `null` below it.
   */
  private detailScale: number | null = null;
  /** Each PDF page's view centre at the last prepare, for the way the view moves. */
  private centres = new Map<string, { x: number; y: number }>();

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

  /**
   * What PDF detail to ask for, once per screen paint (never per ink tile).
   *
   * - With the PDF worker running (`usesWorker`): the grid tiles on screen,
   *   then one row or column ahead the way the view moves, nearest the middle
   *   first — also while it moves, since rendering them costs this thread
   *   nothing. Tiles already cached or in flight are not asked for twice.
   * - Without it (pdf.js on this thread): nothing while the view moves; once
   *   it rests, one patch of the view plus a margin, unless a cached one
   *   already covers it.
   *
   * Mid-zoom (`transient`) nothing is asked for: the level is not settled.
   */
  prepare(
    visible: Array<{ backdrop: Backdrop; geometry: PageGeometry; region: Bounds }>,
    deviceScale: number,
    zoom: number,
    transient: boolean,
    moving = false,
  ): void {
    if (!transient || this.pageScale === null)
      this.pageScale = quantiseScale(
        deviceScale * Math.min(1, PDF_DETAIL_ZOOM / Math.max(1, zoom)),
      );
    if (transient || !this.pdf) return;
    const tiles = this.pdf.usesWorker;
    if (moving && !tiles) return;
    this.detailScale = zoom > PDF_DETAIL_ZOOM ? deviceScale : null;
    const requests: Array<{ path: string; page: number; dprScale: number; area: PdfRenderArea }> =
      [];
    const shown: PdfShownArea[] = [];
    const centres = new Map<string, { x: number; y: number }>();
    for (const { backdrop, geometry, region } of visible) {
      if (backdrop.kind !== "pdf") continue;
      const view = visiblePdfArea(geometry, region, zoom)?.region;
      if (!view) continue;
      const { path, page } = backdrop;
      shown.push({ path, page, dprScale: deviceScale, geometry, region: view });
      if (tiles) {
        // Which way the view moves, from where the page sat last frame.
        const key = `${page}:${path}`;
        const centre = { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 };
        const last = this.centres.get(key);
        centres.set(key, centre);
        const ahead = last ? { x: centre.x - last.x, y: centre.y - last.y } : { x: 0, y: 0 };
        for (const tile of tilesFor(geometry, view, deviceScale, 0, ahead)) {
          requests.push({
            path,
            page,
            dprScale: deviceScale,
            area: { geometry, region: tile.region },
          });
        }
        continue;
      }
      if (this.pdf.detailCovers(path, page, deviceScale, geometry, view)) continue;
      const area = detailPdfArea(geometry, region, zoom);
      if (area) requests.push({ path, page, dprScale: deviceScale, area });
    }
    this.centres = centres;
    this.pdf.setVisibleRegions(requests, shown);
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
    // Previews/exports never pick up viewport detail. Zoomed in, a tile draws
    // every cached detail patch that meets it, newest on top, even while the
    // view moves; around them the page image remains.
    const region = target?.region;
    if (!region || this.detailScale === null) return;
    for (const patch of this.pdf.detailPatches(
      backdrop.path,
      backdrop.page,
      this.detailScale,
      geometry,
    )) {
      const { box, canvas } = patch;
      const bounds = { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h };
      if (!canvas.width || !canvas.height || !boundsMeet(bounds, region)) continue;
      ctx.drawImage(canvas, box.x, box.y, box.w, box.h);
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
