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
  pageLook,
} from "../canvas/backdrop";
import { type PdfDraw, invertPdfArea } from "../canvas/night";
import type { BackdropPainter } from "../canvas/renderer";
import { tilesFor } from "../canvas/pdf-tiles";
import {
  type PdfRenderArea,
  boundsMeet,
  detailPdfArea,
  needsDetail,
  pageRasterScale,
  visiblePdfArea,
} from "../canvas/pdf-raster";
import type { Bounds, Backdrop, PageGeometry, PdfBackdrop, PdfFrame } from "../model/document";
import {
  type PdfBackdropCache,
  type PdfEntry,
  type PdfRasterRequest,
  type PdfShownArea,
  quantiseScale,
  releasePdfEntry,
} from "./pdf-backdrop";

/**
 * The share of the cache's soft budget the pages near the view may take
 * ahead of time: two or three A4 pages at their sharpest, a dozen zoomed out.
 */
const NEAR_SHARE = 0.6;

/**
 * A page of which less than this share shows (the neighbour beside the page
 * being read) is a side page. Once one, it stays one until more than
 * {@link SIDE_LEAVE} shows, so a pan across the line does not swap its raster.
 */
const SIDE_ENTER = 0.4;
const SIDE_LEAVE = 0.5;
/**
 * A side page's image is at most this sharp (device px per page px) and it
 * asks for no detail: its A4-sized raster and patch cost about as much as the
 * page being read, three times over with both neighbours showing.
 */
const SIDE_SCALE = 1;

/** The page px of the page that `region` shows. */
function shownArea(geometry: PageGeometry, region: Bounds): number {
  const w = Math.min(geometry.width, region.maxX) - Math.max(0, region.minX);
  const h = Math.min(geometry.height, region.maxY) - Math.max(0, region.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Bytes of a whole-page raster of `geometry` at `scale`. */
function imageBytes(geometry: PageGeometry, scale: number): number {
  return geometry.width * scale * geometry.height * scale * 4;
}

/** The key of one PDF page in {@link VaultBackdropRenderer}'s sets and maps. */
function pageKey(backdrop: { path: string; page: number }): string {
  return `${backdrop.page}:${backdrop.path}`;
}

export class VaultBackdropRenderer implements BackdropRenderer, BackdropPainter {
  /**
   * Paper colours, where a paint names none (`target.paper`) and for
   * {@link draw}. Paper-white unless set.
   */
  theme: PaperTheme = LIGHT_PAPER;

  /** `devicePixelRatio * viewScale`, quantised. Part of the PDF cache key. */
  private scale = 1;
  /**
   * The ink tiles' level as of the last settled frame (`null` before the
   * first): page images are drawn at it exactly where they can be
   * (`pageRasterScale`), and detail at it where they cannot. A pinch keeps
   * it until the zoom settles, so no frame of one mints a raster.
   */
  private level: number | null = null;
  /** Each PDF page's view centre at the last prepare, for the way the view moves. */
  private centres = new Map<string, { x: number; y: number }>();
  /** The pages that are side pages as of the last prepare ({@link SIDE_ENTER}). */
  private sides = new Set<string>();
  /** The one PDF page {@link prepareExact} drew for an export. */
  private exact: { path: string; page: number; entry: PdfEntry } | null = null;

  /**
   * @param pdf PDF raster cache, or `null` where there is no vault to read from
   *            (inline embeds, tests). A `pdf` backdrop then paints as a
   *            "missing source" page — never as nothing.
   */
  constructor(private readonly pdf: PdfBackdropCache | null) {}

  /**
   * Draw `backdrop` (a PDF page) from one raster at exactly `deviceScale`,
   * made now and kept until {@link releaseExact}: an image export's page,
   * sharper than the cache's whole-page rasters can be.
   */
  async prepareExact(
    backdrop: PdfBackdrop,
    geometry: PageGeometry,
    deviceScale: number,
  ): Promise<void> {
    this.releaseExact();
    if (!this.pdf) return;
    if (backdrop.annotations === false) this.pdf.skipAnnotations(backdrop.path);
    const entry = await this.pdf.renderExact(
      backdrop.path,
      backdrop.page,
      inFrame(backdrop, geometry).geometry,
      deviceScale,
    );
    this.exact = { path: backdrop.path, page: backdrop.page, entry };
  }

  /** Free the raster {@link prepareExact} made. */
  releaseExact(): void {
    if (this.exact) releasePdfEntry(this.exact.entry);
    this.exact = null;
  }

  /** Tell the renderer what resolution PDF pages should be rasterised at. */
  setDeviceScale(deviceScale: number): void {
    this.scale = quantiseScale(deviceScale);
  }

  /**
   * What PDF work to ask for, once per screen paint (never per ink tile), in
   * the order it is wanted:
   *
   * 1. the page images of the pages on screen;
   * 2. the page image of the next page a scroll shows (`near`, first);
   * 3. detail on screen, for the pages that need it (`needsDetail`: their
   *    page image cannot be as sharp as the tiles);
   * 4. the other near pages' images, up to {@link NEAR_SHARE} of the cache;
   * 5. detail just off screen.
   *
   * Detail with the PDF worker running (`usesWorker`) is the grid tiles on
   * screen, then one row or column ahead the way the view moves, nearest the
   * middle first — also while it moves, since rendering them costs this
   * thread nothing. Tiles already cached or in flight are not asked for
   * twice. Without the worker (pdf.js on this thread) no detail is asked
   * for while the view moves; once it rests, one patch of the view plus a
   * margin, unless a cached one already covers it. Page images are asked
   * for either way: a page coming on screen is drawn then anyway, and asked
   * for sooner it is drawn before it arrives.
   *
   * A page that came on screen before its image was asked for showed as
   * blank paper until pdf.js drew it, on every fast scroll (FineNotes#80);
   * tiles asked for before the page images made it worse.
   *
   * Mid-zoom (`transient`) nothing is asked for: the level is not settled.
   */
  prepare(
    visible: Array<{ backdrop: Backdrop; geometry: PageGeometry; region: Bounds }>,
    deviceScale: number,
    transient: boolean,
    moving = false,
    near: Array<{ backdrop: Backdrop; geometry: PageGeometry }> = [],
  ): void {
    if (!transient || this.level === null) this.level = deviceScale;
    if (transient || !this.pdf) return;
    const tiles = this.pdf.usesWorker;
    const pages: PdfRasterRequest[] = [];
    const detail: PdfRasterRequest[] = [];
    const offScreen: PdfRasterRequest[] = [];
    const shown: PdfShownArea[] = [];
    const centres = new Map<string, { x: number; y: number }>();
    const sides = new Set<string>();
    // The page being read shows the most; only a page showing less than it,
    // and little of itself, is a side page. A lone page zoomed far in is not.
    const shows = (at: ReturnType<typeof inFrame>, item: { region: Bounds }) =>
      shownArea(at.geometry, at.region ?? item.region);
    let most = 0;
    for (const item of visible) {
      if (item.backdrop.kind !== "pdf") continue;
      most = Math.max(most, shows(inFrame(item.backdrop, item.geometry, item.region), item));
    }
    for (const item of visible) {
      if (item.backdrop.kind !== "pdf") continue;
      const at = inFrame(item.backdrop, item.geometry, item.region);
      const { backdrop, geometry } = at;
      const region = at.region ?? item.region;
      const side = shows(at, item) < most && this.isSide(backdrop, geometry, region);
      if (side) sides.add(pageKey(backdrop));
      const image = this.pageImage(backdrop, geometry, deviceScale, side);
      pages.push(image);
      // A side page shows only a strip: its reduced image is all it gets.
      if (side) continue;
      // Only the margin of a page is in view: no detail of its PDF is wanted.
      if (region.maxX <= region.minX || region.maxY <= region.minY) continue;
      const view = visiblePdfArea(geometry, region, deviceScale)?.region;
      if (!view) continue;
      // Without the worker a moving view wants no detail: a patch still
      // drawing (on this thread, in slices between frames) is let go of.
      if (moving && !tiles) continue;
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
          (tile.visible ? detail : offScreen).push({
            path,
            page,
            dprScale: deviceScale,
            area: { ...areaFor(backdrop, geometry), region: tile.region },
          });
        }
        continue;
      }
      // The frame only when the page has one: every other page asks exactly as before.
      const framed = backdrop.frame ? [backdrop.frame] : [];
      if (this.pdf.detailCovers(path, page, deviceScale, geometry, view, ...framed)) continue;
      const area = detailPdfArea(geometry, region, deviceScale, backdrop.frame);
      if (area) detail.push({ path, page, dprScale: deviceScale, area });
    }
    this.centres = centres;
    this.sides = sides;
    const coming = this.nearImages(near, deviceScale);
    const now = [...pages, ...coming.slice(0, 1), ...detail];
    this.pdf.setVisibleRegions([...now, ...coming.slice(1), ...offScreen], shown, now.length);
  }

  /** The request for a page's image at `level`: the key {@link paint} looks for. */
  private pageImage(
    backdrop: PdfBackdrop,
    geometry: PageGeometry,
    level: number,
    side = false,
  ): PdfRasterRequest {
    // Before it is drawn, so it is drawn as it will be painted.
    if (backdrop.annotations === false) this.pdf?.skipAnnotations(backdrop.path);
    const whole = pageRasterScale(geometry, level);
    return {
      path: backdrop.path,
      page: backdrop.page,
      dprScale: side ? Math.min(whole, SIDE_SCALE) : whole,
      area: areaFor(backdrop, geometry),
    };
  }

  /** Whether the page, with `region` of it in view, is a side page (see {@link SIDE_ENTER}). */
  private isSide(backdrop: PdfBackdrop, geometry: PageGeometry, region: Bounds): boolean {
    const area = geometry.width * geometry.height;
    if (!(area > 0)) return false;
    const share = shownArea(geometry, region) / area;
    return share < (this.sides.has(pageKey(backdrop)) ? SIDE_LEAVE : SIDE_ENTER);
  }

  /** The images of the `near` PDF pages, in order, up to {@link NEAR_SHARE} of the cache. */
  private nearImages(
    near: Array<{ backdrop: Backdrop; geometry: PageGeometry }>,
    level: number,
  ): PdfRasterRequest[] {
    const room = (this.pdf?.memoryBudget.soft ?? 0) * NEAR_SHARE;
    const out: PdfRasterRequest[] = [];
    let bytes = 0;
    for (const item of near) {
      if (item.backdrop.kind !== "pdf") continue;
      const { backdrop, geometry } = inFrame(item.backdrop, item.geometry);
      const cost = imageBytes(geometry, pageRasterScale(geometry, level));
      // Always the next one, however large.
      if (out.length > 0 && bytes + cost > room) break;
      bytes += cost;
      out.push(this.pageImage(backdrop, geometry, level));
    }
    return out;
  }

  /**
   * Synchronous paint for the scroll path. Never blocks.
   *
   * With dark pages a PDF page is painted as it is, then inverted in place
   * (`invertPdfArea`), unless the theme keeps PDFs. So the raster cache
   * only ever holds the true page, whatever the setting: switching it
   * re-uses every raster, and no light raster can be shown for a dark one
   * or the other way round. The tiles holding the result are the
   * renderer's, which empties them when the theme changes.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    backdrop: Backdrop,
    geometry: PageGeometry,
    weight = 1,
    target?: { deviceScale: number; region?: Bounds; paper?: PaperTheme },
  ): void {
    const theme = target?.paper ?? this.theme;
    if (backdrop.kind !== "pdf") {
      drawSynthetic(ctx, backdrop, geometry, theme, weight, target?.region);
      return;
    }
    if (backdrop.frame) {
      const at = inFrame(backdrop, geometry, target?.region);
      ctx.save();
      ctx.beginPath();
      ctx.rect(backdrop.frame.x, backdrop.frame.y, at.geometry.width, at.geometry.height);
      ctx.clip();
      ctx.translate(backdrop.frame.x, backdrop.frame.y);
      const { region: _region, ...rest } = target ?? { deviceScale: this.scale };
      this.paint(ctx, at.backdrop, at.geometry, weight, {
        ...rest,
        ...(at.region ? { region: at.region } : {}),
      });
      ctx.restore();
      return;
    }
    // Inverted or kept, the page is painted as it is first.
    const invert = pageLook(backdrop, theme).night;
    const paper = theme.night ? LIGHT_PAPER : theme;
    if (!this.pdf) {
      drawMissingSource(ctx, geometry, paper, missingLabel(backdrop.path));
      if (invert) invertPdfArea(ctx, geometry.width, geometry.height, []);
      return;
    }
    const draws: PdfDraw[] = [];
    if (backdrop.annotations === false) this.pdf.skipAnnotations(backdrop.path);
    const scale =
      this.level !== null
        ? this.sides.has(pageKey(backdrop))
          ? Math.min(pageRasterScale(geometry, this.level), SIDE_SCALE)
          : pageRasterScale(geometry, this.level)
        : quantiseScale(target?.deviceScale ?? this.scale);
    const area = areaFor(backdrop, geometry);
    const exact = this.exact;
    const entry =
      exact && exact.path === backdrop.path && exact.page === backdrop.page
        ? exact.entry
        : this.pdf.peek(backdrop.path, backdrop.page, scale, area);
    // Only for a painter with no view of its own (thumbnails): the view's
    // painter asks for its exact level, which keeps detail tiles in step.
    const sharper =
      entry || this.level !== null
        ? null
        : this.pdf.peekNearest(backdrop.path, backdrop.page, scale, area, true);
    if (entry) this.paintEntry(ctx, entry, geometry, paper, draws, backdrop.frame);
    else if (sharper) {
      // A thumbnail of a page the view already drew sharper: drawn from that,
      // never rendered again for itself.
      this.paintEntry(ctx, sharper, geometry, paper, draws, backdrop.frame);
    } else {
      // Not rasterised at this scale yet: the page at another scale if one is
      // cached (a zoom just changed it), else plain paper; repaint when the
      // bitmap arrives.
      const stand = this.pdf.peekNearest(backdrop.path, backdrop.page, scale, area);
      if (stand) this.paintEntry(ctx, stand, geometry, paper, draws, backdrop.frame);
      else fillPaper(ctx, geometry, paper);
      this.pdf.request(backdrop.path, backdrop.page, scale, area);
    }
    // Previews/exports never pick up viewport detail. Where the page image
    // falls short, a tile draws every cached detail patch that meets it,
    // newest on top, even while the view moves; around them the page image
    // remains.
    const region = target?.region;
    if (region && this.level !== null && needsDetail(geometry, this.level)) {
      for (const patch of this.pdf.detailPatches(
        backdrop.path,
        backdrop.page,
        this.level,
        geometry,
        ...(backdrop.frame ? [backdrop.frame] : []),
      )) {
        const { box, canvas } = patch;
        const bounds = { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h };
        if (!canvas.width || !canvas.height || !boundsMeet(bounds, region)) continue;
        ctx.drawImage(canvas, box.x, box.y, box.w, box.h);
        draws.push({ source: canvas, x: box.x, y: box.y, w: box.w, h: box.h });
      }
    }
    if (invert) invertPdfArea(ctx, geometry.width, geometry.height, draws);
  }

  /** For the diagnostic HUD: see {@link PdfBackdropCache.diagnostics}. */
  diagnostics(): string {
    return this.pdf?.diagnostics() ?? "pdf=-";
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
    if (backdrop.annotations === false) this.pdf.skipAnnotations(backdrop.path);
    const at = inFrame(backdrop, geometry);
    const entry = await this.pdf.resolve(backdrop.path, backdrop.page, this.scale, {
      geometry: at.geometry,
    });
    const frame = backdrop.frame;
    if (!frame) {
      this.paintEntry(ctx, entry, geometry, this.theme, []);
      return;
    }
    ctx.save();
    ctx.translate(frame.x, frame.y);
    this.paintEntry(ctx, entry, at.geometry, this.theme, []);
    ctx.restore();
  }

  /** Paint a rasterised page on `paper`; each `drawImage` it makes is added to `draws`. */
  private paintEntry(
    ctx: CanvasRenderingContext2D,
    entry: PdfEntry,
    geometry: PageGeometry,
    paper: PaperTheme,
    draws: PdfDraw[] = [],
    frame?: PdfFrame,
  ): void {
    if (!entry.ok) {
      // The page still exists and the ink is still drawn over it.
      drawMissingSource(ctx, geometry, paper, entry.reason);
      return;
    }
    fillPaper(ctx, geometry, paper);
    const { canvas } = entry;
    if (canvas.width === 0 || canvas.height === 0) return;
    let box = entry.box;
    if (!box) {
      // Contain: a PDF page whose aspect differs from the notebook's page size is
      // centred rather than stretched — stretched slides read as a rendering bug.
      // A widened page (Add space) fits it into its frame instead of the whole page.
      const f = frame ?? { x: 0, y: 0, width: geometry.width, height: geometry.height };
      const k = Math.min(f.width / canvas.width, f.height / canvas.height);
      const w = canvas.width * k;
      const h = canvas.height * k;
      box = { x: f.x + (f.width - w) / 2, y: f.y + (f.height - h) / 2, w, h };
    }
    ctx.drawImage(canvas, box.x, box.y, box.w, box.h);
    draws.push({ source: canvas, ...box });
  }
}

/** The render area of a PDF backdrop on a page: its frame goes with it. */
function areaFor(backdrop: PdfBackdrop, geometry: PageGeometry): PdfRenderArea {
  return backdrop.frame ? { geometry, frame: backdrop.frame } : { geometry };
}

/**
 * A PDF page on a page with a margin, as the page it was before the margin:
 * the frame's own size, no frame, and `region` moved into the frame. Its
 * rasters are then the ones that page had, so adding or resizing a margin
 * never renders the PDF again and the slide stays on screen while the
 * margin's width is dragged (it went blank at every step, Joost 2026-11-02).
 */
function inFrame(
  backdrop: PdfBackdrop,
  geometry: PageGeometry,
  region?: Bounds,
): { backdrop: PdfBackdrop; geometry: PageGeometry; region?: Bounds } {
  const frame = backdrop.frame;
  if (!frame) return { backdrop, geometry, ...(region ? { region } : {}) };
  const { frame: _frame, ...plain } = backdrop;
  const local = region && {
    minX: Math.max(0, region.minX - frame.x),
    minY: Math.max(0, region.minY - frame.y),
    maxX: Math.min(frame.width, region.maxX - frame.x),
    maxY: Math.min(frame.height, region.maxY - frame.y),
  };
  return {
    backdrop: plain,
    geometry: { ...geometry, width: frame.width, height: frame.height },
    ...(local ? { region: local } : {}),
  };
}

function missingLabel(path: string): string {
  return `Missing PDF source — ${path}`;
}
