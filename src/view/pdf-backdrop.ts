/**
 * PDF-backed page backdrops.
 *
 * Obsidian **bundles pdf.js and exposes it publicly** as `loadPdfJs()`
 * (`obsidian.d.ts`: "Load PDF.js and return a promise to the global pdfjsLib
 * object"), so nothing is bundled here — research/FEASIBILITY.md §2.2 measures
 * the saving at ~1.41 MB against a hard 5 MB Obsidian Sync wall.
 *
 * Three hard requirements from contracts/api.md §4, all implemented here:
 *
 * 1. **One whole-page raster at the ink tiles' level; visible detail where
 *    that would be too large** (`pageRasterScale`, `needsDetail`). Detail
 *    requests are shared across ink tiles, limited to two renders in flight,
 *    and cancelled/evicted when their visible area changes.
 * 2. **The source PDF is opened read-only and never written.** The only vault
 *    call in this file is `vault.readBinary`.
 * 3. **A failed backdrop never costs the user their ink.** Every failure path
 *    resolves to a `miss` entry; the caller paints the "missing source"
 *    placeholder and draws the strokes on top regardless.
 */

import { type App, type TFile, loadPdfJs } from "obsidian";
import { ByteLru, quantiseLevel } from "../canvas/tile-grid";
import {
  type PdfRenderArea,
  boundsCover,
  boundsMeet,
  pdfAreaKey,
  planPdfRaster,
} from "../canvas/pdf-raster";
import type { Bounds, PageGeometry } from "../model/document";
import {
  type PdfAssets,
  type PdfWorker,
  PdfCanvasUnavailable,
  PdfRenderCancelled,
  pdfAssets,
} from "./pdf-worker";
import { errorMessage } from "../util/errors";

/** Largest raster edge, in device px. A 1024x1448 page at dpr 3 would be 13 Mpx
 *  and ~53 MB per page — several of those will evict an iPad's web view. */
const MAX_RASTER_EDGE = 2400;

/**
 * What the cache keeps, in bytes.
 *
 * - `soft`: rasterised pages kept at once. It used to be a count of eight
 *   pages, and the page sidebar's dozen thumbnails plus the page in view
 *   asked for more than eight: each raster that landed evicted another one
 *   still on screen, whose repaint asked for it again, for as long as the
 *   sidebar stayed open — 40 renders a second and every tile redrawn each
 *   time, on a laptop (2026-10-01, FineNotes#1). A raster drawn within
 *   {@link RECENT_USE_MS} is not evicted to meet it.
 * - `hard`: the most ever held, whatever was drawn when.
 * - `keepDetail`: detail kept after the view moves on, besides what is in
 *   view, so going back to what was just read is sharp at once: the most
 *   recently drawn patches or tiles up to this many bytes, and always at
 *   least one (a patch can be ~36 MB, a tile is 4 MB).
 */
export interface PdfMemoryBudget {
  soft: number;
  hard: number;
  keepDetail: number;
}

const MB = 1024 * 1024;
export const PDF_BUDGET: PdfMemoryBudget = { soft: 48 * MB, hard: 96 * MB, keepDetail: 32 * MB };
/**
 * For a device short of memory. iOS ends a web view whose canvases hold too
 * much, and stops giving it canvases before that (`getContext` answers
 * `null`); a 2 GB iPad gets there first. This still holds two A4 pages at
 * their sharpest (16 MB each) and a screen of detail tiles.
 */
export const PDF_BUDGET_LOW: PdfMemoryBudget = { soft: 24 * MB, hard: 64 * MB, keepDetail: 8 * MB };
const RECENT_USE_MS = 1500;
/** After a canvas is refused twice in a row, the waits before trying again. */
const REFUSED_RETRY_MS = [500, 1500, 4000];

/**
 * Whether this device is short of memory by what it says of itself:
 * Chromium (Android, desktop) gives its memory in GB; WebKit gives none,
 * but one without OffscreenCanvas is iPadOS 16.3 or older, and the iPads
 * that stop there (iPad Air 2, iPad mini 4) have 2 GB. Others find out when
 * a canvas is refused ({@link PdfBackdropCache.lowMemory}).
 */
export function lowMemoryDevice(env: DeviceSigns = thisDevice()): boolean {
  const memory = env.navigator?.deviceMemory;
  if (typeof memory === "number" && memory > 0) return memory <= 2;
  return typeof env.OffscreenCanvas === "undefined";
}

/** What {@link lowMemoryDevice} reads: `navigator.deviceMemory` is Chromium's alone. */
interface DeviceSigns {
  navigator?: { deviceMemory?: unknown };
  OffscreenCanvas?: unknown;
}

function thisDevice(): DeviceSigns {
  return typeof window === "undefined" ? {} : (window as never);
}

/** What a miss is counted as: little, but not nothing, so misses cannot pile up. */
const MISS_BYTES = 1024;

/** Scale quantisation step. Continuous zoom must not mint a bitmap per frame. */
const SCALE_STEP = 0.25;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

/** A successfully rasterised PDF page, ready to `drawImage`. */
export interface PdfRaster {
  ok: true;
  /** A canvas from the main thread, or a bitmap from the PDF worker. */
  canvas: HTMLCanvasElement | ImageBitmap;
  /** Page-space destination of a PDF patch; absent on legacy whole-page rasters. */
  box?: { x: number; y: number; w: number; h: number };
}

/** A backdrop that could not be resolved. Cached so a missing file is not
 *  retried on every scroll frame. */
export interface PdfMiss {
  ok: false;
  reason: string;
  /**
   * Out of canvas memory, not a fault of the PDF: never cached (it would
   * paint as a missing source for good), and asked for again by the next
   * paint once memory is freed.
   */
  retry?: true;
}

const NO_CANVAS: PdfMiss = { ok: false, reason: "No canvas memory for the PDF page", retry: true };

export type PdfEntry = PdfRaster | PdfMiss;

// --- Minimal structural types for Obsidian's bundled pdf.js -----------------
// `loadPdfJs()` is declared `Promise<any>`; `@typescript-eslint/no-explicit-any`
// is an error in this repo, so the surface we actually use is typed here.

interface PdfViewportLike {
  width: number;
  height: number;
}

interface PdfPageLike {
  getViewport(params: { scale: number }): PdfViewportLike;
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
    transform?: number[];
    /** pdf.js `AnnotationMode`: 0 draws no annotations, the default 1 draws them. */
    annotationMode?: number;
  }): {
    promise: Promise<void>;
    cancel?: () => void;
    /**
     * pdf.js renders in ~15 ms slices; when set, it is handed each next
     * slice to run when it likes (`RenderTask.onContinue`).
     */
    onContinue?: ((next: () => void) => void) | null;
  };
  cleanup?: () => void;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}

interface PdfJsLike {
  getDocument(src: { data: Uint8Array } & PdfAssets): { promise: Promise<PdfDocumentLike> };
}

/** Round a view scale onto a coarse ladder so the cache key set stays small. */
export function quantiseScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  const stepped = Math.round(scale / SCALE_STEP) * SCALE_STEP;
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, stepped));
  // Avoid 0.30000000000000004-style keys.
  return Math.round(clamped * 100) / 100;
}

/** The cache key mandated by contracts/api.md §4. */
export function rasterKey(
  path: string,
  page: number,
  dprScale: number,
  area?: PdfRenderArea,
): string {
  const base = `${path}:${page}:${area ? quantiseLevel(dprScale) : dprScale}`;
  return area ? `${base}:${pdfAreaKey(area)}` : base;
}

/**
 * Rasterises PDF pages on demand and caches the bitmaps.
 *
 * Use from a paint loop is deliberately two-phase: {@link peek} is synchronous
 * and never blocks a frame; when it returns `null` the caller draws a plain page
 * and calls {@link request}, which rasterises in the background and fires
 * {@link onReady} so the caller can repaint. {@link resolve} is the awaiting
 * form, for one-shot draws (export, thumbnails).
 */
interface Cached {
  key: string;
  entry: PdfEntry;
  /** When a paint last drew it (ms, `performance.now()`). */
  lastUsed: number;
  detail: boolean;
  path: string;
  page: number;
  /** `quantiseLevel` of the scale it was asked for, as in its key. */
  level: number;
  area?: PdfRenderArea;
}

/** What is on screen of one PDF page at a detail level (see `setVisibleRegions`). */
export interface PdfShownArea {
  path: string;
  page: number;
  dprScale: number;
  geometry: PageGeometry;
  region: Bounds;
}

function sameDetail(
  item: { path: string; page: number; area?: PdfRenderArea },
  level: number,
  itemLevel: number,
  shown: { path: string; page: number; geometry: PageGeometry },
): boolean {
  const region = item.area?.region;
  return (
    region !== undefined &&
    item.path === shown.path &&
    item.page === shown.page &&
    itemLevel === level &&
    item.area?.geometry.width === shown.geometry.width &&
    item.area?.geometry.height === shown.geometry.height
  );
}

export interface PdfRasterRequest {
  path: string;
  page: number;
  dprScale: number;
  area?: PdfRenderArea;
}
interface RasterWork extends PdfRasterRequest {
  key: string;
  cancelled: boolean;
  background: boolean;
  cancelRender?: () => void;
  finish: (entry: PdfEntry) => void;
}
const MAX_INFLIGHT = 2;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class PdfBackdropCache {
  /**
   * Called after a background rasterisation of `page` of `path` lands
   * (success or miss). Repaint only what shows that page: repainting
   * everything is what kept the eviction loop above going.
   */
  onReady: ((path: string, page: number, area?: PdfRenderArea) => void) | null = null;

  private budget: PdfMemoryBudget;
  private readonly entries: ByteLru<Cached>;
  /** How many times in a row each key was refused a canvas ({@link refusedCanvas}). */
  private readonly refused = new Map<string, number>();
  /** Retries waiting out {@link REFUSED_RETRY_MS}, by key. */
  private readonly retries = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<PdfEntry>>();
  private readonly queue: RasterWork[] = [];
  private readonly running = new Set<RasterWork>();
  private readonly work = new Map<string, RasterWork>();
  private readonly documents = new Map<string, Promise<PdfDocumentLike | null>>();
  /** Requests made while held, started on {@link setHeld}(false). */
  private readonly deferred = new Map<
    string,
    { path: string; page: number; dprScale: number; area?: PdfRenderArea }
  >();
  private held = false;
  /**
   * PDFs drawn without their own annotations (`PdfBackdrop.annotations`):
   * imported ink already stands in for them. Per file, which an imported
   * PDF is to itself, so the cache keys need not change.
   */
  private readonly bare = new Set<string>();
  /** pdf.js in a background worker (`setWorker`); `null` renders on the main thread. */
  private worker: PdfWorker | null = null;
  /** Per path: the page count the worker opened it with, or `null` if missing. */
  private readonly workerDocs = new Map<string, Promise<number | null>>();
  /** Per `path:page`: the page's size at scale 1, from the worker. */
  private readonly workerSizes = new Map<string, Promise<{ width: number; height: number }>>();
  /**
   * The next slices of renders that were already running when the pen came
   * down. Holding only new work let a running render keep landing 15 ms
   * slices mid-stroke; these wait for the lift too.
   */
  private readonly paused: Array<() => void> = [];
  private lib: Promise<PdfJsLike> | null = null;
  private destroyed = false;

  /** `budget`: by default {@link PDF_BUDGET_LOW} on a {@link lowMemoryDevice}, else {@link PDF_BUDGET}. */
  constructor(
    private readonly app: App,
    budget: PdfMemoryBudget = lowMemoryDevice() ? PDF_BUDGET_LOW : PDF_BUDGET,
  ) {
    this.budget = budget;
    this.entries = new ByteLru<Cached>(budget.hard, (cached) => releasePdfEntry(cached.entry));
  }

  /** What the cache keeps now (for tests and diagnostics). */
  get memoryBudget(): PdfMemoryBudget {
    return this.budget;
  }

  /**
   * A canvas was refused: keep at most {@link PDF_BUDGET_LOW} from now on,
   * and free every raster not drawn just now and all detail kept for going
   * back, so what is on screen can be drawn.
   */
  lowMemory(): void {
    const low = {
      soft: Math.min(this.budget.soft, PDF_BUDGET_LOW.soft),
      hard: Math.min(this.budget.hard, PDF_BUDGET_LOW.hard),
      keepDetail: Math.min(this.budget.keepDetail, PDF_BUDGET_LOW.keepDetail),
    };
    this.budget = low;
    this.entries.setBudget(low.hard);
    const cutoff = now() - RECENT_USE_MS;
    this.entries.deleteWhere((cached) => cached.lastUsed <= cutoff);
  }

  /** Synchronous lookup. `null` means "not rasterised yet" — never blocks. */
  peek(path: string, page: number, dprScale: number, area?: PdfRenderArea): PdfEntry | null {
    const hit = this.entries.get(rasterKey(path, page, dprScale, area));
    if (!hit) return null;
    hit.lastUsed = now();
    return hit.entry;
  }

  /**
   * The same page and area at whatever scale is cached, for drawing while the
   * asked-for scale is still being rasterised: the smallest scale at or above
   * `dprScale`, else the largest below it. A zoom changes the scale, and
   * without this the page showed as blank paper until pdf.js caught up — a
   * second or more on an iPad. Misses (`ok: false`) are never returned.
   */
  peekNearest(path: string, page: number, dprScale: number, area?: PdfRenderArea): PdfEntry | null {
    // rasterKey around its scale.
    const prefix = `${path}:${page}:`;
    const suffix = area ? `:${pdfAreaKey(area)}` : "";
    let above: { scale: number; cached: Cached } | null = null;
    let below: { scale: number; cached: Cached } | null = null;
    for (const cached of this.entries.values()) {
      const { key } = cached;
      if (!cached.entry.ok || !key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const middle = key.slice(prefix.length, key.length - suffix.length);
      // Another area's key has more after the scale, and is no number.
      if (!/^\d+(\.\d+)?$/.test(middle)) continue;
      const scale = Number(middle);
      if (scale >= dprScale) {
        if (!above || scale < above.scale) above = { scale, cached };
      } else if (!below || scale > below.scale) below = { scale, cached };
    }
    const best = above ?? below;
    if (!best) return null;
    best.cached.lastUsed = now();
    return best.cached.entry;
  }

  /**
   * Start rasterising if it is not cached or already in flight. While held
   * (the pen is writing), it waits: pdf.js paints on the main thread, and a
   * page landing mid-stroke stalls the ink.
   */
  request(path: string, page: number, dprScale: number, area?: PdfRenderArea): void {
    if (this.destroyed) return;
    if (this.held) {
      const key = rasterKey(path, page, dprScale, area);
      if (!this.entries.has(key) && !this.inflight.has(key)) {
        this.deferred.set(key, { path, page, dprScale, area });
      }
      return;
    }
    void this.resolve(path, page, dprScale, area, true);
  }

  /**
   * Replace viewport detail atomically; stale work never caches or triggers
   * repaints. `shown` is what is on screen: work and patches that still meet
   * it are kept even if not asked for again (a patch's margin may already
   * cover the view), and so is the most recently drawn rest, up to
   * the budget's `keepDetail`.
   */
  setVisibleRegions(requests: PdfRasterRequest[], shown: PdfShownArea[] = []): void {
    if (this.destroyed) return;
    const wanted = new Set(
      requests.map(({ path, page, dprScale, area }) => rasterKey(path, page, dprScale, area)),
    );
    // What is still asked for is in use, drawn this frame or not: the image
    // of a page ahead is not drawn until it arrives, nor a tile once the ink
    // tiles over it are cached. Left to age, the soft budget let them go and
    // the next frame asked for them again: in one pan the same tile was
    // rendered six times and the next page's image five (FineNotes#80).
    const t = now();
    for (const key of wanted) {
      const cached = this.entries.get(key);
      if (cached) cached.lastUsed = t;
    }
    const useful = (
      key: string,
      item: { path: string; page: number; area?: PdfRenderArea },
      level: number,
    ): boolean =>
      wanted.has(key) ||
      shown.some(
        (view) =>
          sameDetail(item, quantiseLevel(view.dprScale), level, view) &&
          boundsMeet(item.area?.region as Bounds, view.region),
      );
    for (const job of [...this.work.values()]) {
      if (job.area?.region && !useful(job.key, job, quantiseLevel(job.dprScale))) this.cancel(job);
    }
    for (const [key, request] of this.deferred) {
      if (request.area?.region && !useful(key, request, quantiseLevel(request.dprScale))) {
        this.deferred.delete(key);
      }
    }
    const spare = new Set<string>();
    let spareBytes = 0;
    for (const cached of [...this.entries.values()]
      .filter((c) => c.detail && !useful(c.key, c, c.level))
      .sort((a, b) => b.lastUsed - a.lastUsed)) {
      const bytes = bytesOf(cached.entry);
      if (spare.size > 0 && spareBytes + bytes > this.budget.keepDetail) break;
      spare.add(cached.key);
      spareBytes += bytes;
    }
    this.entries.deleteWhere(
      (cached) =>
        cached.detail && !useful(cached.key, cached, cached.level) && !spare.has(cached.key),
    );
    // Submit the latest visible regions before starting anything queued by a
    // cancelled job, in the order asked (nearest the middle of the view first).
    for (const request of requests)
      this.request(request.path, request.page, request.dprScale, request.area);
    const rank = new Map(
      requests.map((r, i) => [rasterKey(r.path, r.page, r.dprScale, r.area), i] as const),
    );
    this.queue.sort(
      (a, b) =>
        (rank.get(a.key) ?? Number.POSITIVE_INFINITY) -
        (rank.get(b.key) ?? Number.POSITIVE_INFINITY),
    );
    this.drain();
  }

  /**
   * Cached detail patches of a page at the level of `dprScale`, least
   * recently drawn first (draw them in this order: the newest ends on top).
   * Reading them counts as drawing them.
   */
  detailPatches(
    path: string,
    page: number,
    dprScale: number,
    geometry: PageGeometry,
  ): Array<PdfRaster & { box: NonNullable<PdfRaster["box"]> }> {
    const level = quantiseLevel(dprScale);
    const found = [...this.entries.values()]
      .filter(
        (cached) =>
          cached.entry.ok &&
          cached.entry.box !== undefined &&
          sameDetail(cached, level, cached.level, { path, page, geometry }),
      )
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const t = now();
    for (const cached of found) cached.lastUsed = t;
    return found.map(
      (cached) => cached.entry as PdfRaster & { box: NonNullable<PdfRaster["box"]> },
    );
  }

  /** Whether a cached or in-flight detail patch at this level already covers `region`. */
  detailCovers(
    path: string,
    page: number,
    dprScale: number,
    geometry: PageGeometry,
    region: Bounds,
  ): boolean {
    const level = quantiseLevel(dprScale);
    const shown = { path, page, geometry };
    const covers = (item: { path: string; page: number; area?: PdfRenderArea }, at: number) =>
      sameDetail(item, level, at, shown) && boundsCover(item.area?.region as Bounds, region);
    for (const cached of this.entries.values()) {
      if (cached.entry.ok && covers(cached, cached.level)) return true;
    }
    for (const job of this.work.values()) {
      if (!job.cancelled && covers(job, quantiseLevel(job.dprScale))) return true;
    }
    for (const request of this.deferred.values()) {
      if (covers(request, quantiseLevel(request.dprScale))) return true;
    }
    return false;
  }

  /** Hold background rasterisation (true), or let it go on with what waited (false). */
  /**
   * Render in this background worker from now on (`null`: on the main
   * thread). What is cached stays; a worker that fails is dropped again and
   * its renders done here instead.
   */
  setWorker(worker: PdfWorker | null): void {
    if (this.worker === worker) return;
    this.closeWorkerDocs();
    this.worker = worker;
  }

  /** Whether renders run off the main thread, so they may go on while the view moves. */
  get usesWorker(): boolean {
    return this.worker?.alive === true;
  }

  setHeld(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    if (held) return;
    for (const next of this.paused.splice(0)) next();
    const waiting = [...this.deferred.values()];
    this.deferred.clear();
    for (const { path, page, dprScale, area } of waiting)
      void this.resolve(path, page, dprScale, area, true);
    this.drain();
  }

  /** Cached entry, rasterising first if necessary. Never rejects. */
  resolve(
    path: string,
    page: number,
    dprScale: number,
    area?: PdfRenderArea,
    background = false,
  ): Promise<PdfEntry> {
    const key = rasterKey(path, page, dprScale, area);
    const cached = this.entries.peek(key);
    if (cached) return Promise.resolve(cached.entry);
    if (this.destroyed) return Promise.resolve({ ok: false, reason: "Cache closed" });

    const existing = this.inflight.get(key);
    if (existing) {
      const pending = this.work.get(key);
      if (pending && !background) pending.background = false;
      this.drain();
      return existing;
    }

    let finish!: (entry: PdfEntry) => void;
    const result = new Promise<PdfEntry>((resolve) => {
      finish = resolve;
    });
    const job: RasterWork = {
      key,
      path,
      page,
      dprScale,
      area,
      cancelled: false,
      background,
      finish,
    };
    this.inflight.set(key, result);
    this.work.set(key, job);
    // Screen detail takes priority over queued sidebar thumbnails.
    if (area?.region) this.queue.unshift(job);
    else this.queue.push(job);
    this.drain();
    return result;
  }

  /**
   * One whole page drawn at exactly `deviceScale` device px per page px, for
   * an image export (`PdfRenderArea.exact`): past the queue, never cached,
   * and the caller's to free with {@link releasePdfEntry}. Never rejects.
   */
  async renderExact(
    path: string,
    page: number,
    geometry: PageGeometry,
    deviceScale: number,
  ): Promise<PdfEntry> {
    if (this.destroyed) return { ok: false, reason: "Cache closed" };
    try {
      return await this.rasterise(path, page, deviceScale, { geometry, exact: true });
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
  }

  private cancel(job: RasterWork): void {
    job.cancelled = true;
    const queued = this.queue.indexOf(job);
    if (queued !== -1) this.queue.splice(queued, 1);
    job.cancelRender?.();
    if (this.work.get(job.key) === job) {
      this.work.delete(job.key);
      this.inflight.delete(job.key);
    }
    job.finish({ ok: false, reason: "PDF render superseded" });
  }

  private drain(): void {
    if (this.destroyed) return;
    while (this.running.size < MAX_INFLIGHT && this.queue.length) {
      const index = this.queue.findIndex((job) => !this.held || !job.background);
      if (index === -1) return;
      const [job] = this.queue.splice(index, 1);
      if (job.cancelled) continue;
      this.running.add(job);
      void this.rasterise(job.path, job.page, job.dprScale, job.area, job)
        .catch((error: unknown): PdfEntry => ({ ok: false, reason: errorMessage(error) }))
        .then((entry) => {
          this.running.delete(job);
          const refused = !entry.ok && entry.retry === true;
          if (job.cancelled || this.destroyed) releasePdfEntry(entry);
          else if (refused) this.inflight.delete(job.key);
          else this.store(job.key, entry, job.path, job.page, job.area, job.dprScale);
          if (this.work.get(job.key) === job) this.work.delete(job.key);
          job.finish(entry);
          if (refused && !job.cancelled && !this.destroyed) this.refusedCanvas(job);
          this.drain();
        });
    }
  }

  /**
   * Out of canvas memory for `job`: free memory, then try it again at once
   * (what was freed is likely enough), and refused still, after each of
   * {@link REFUSED_RETRY_MS}: iOS may give freed canvas memory back only a
   * moment later. Waiting for the next paint to ask instead left a page at
   * rest drawn from a stretched stand-in until the view next moved.
   */
  private refusedCanvas(job: RasterWork): void {
    this.lowMemory();
    const count = (this.refused.get(job.key) ?? 0) + 1;
    this.refused.set(job.key, count);
    const again = () => this.request(job.path, job.page, job.dprScale, job.area);
    if (count === 1) {
      again();
      return;
    }
    const wait = REFUSED_RETRY_MS[count - 2];
    if (wait === undefined || this.retries.has(job.key)) return;
    this.retries.set(
      job.key,
      window.setTimeout(() => {
        this.retries.delete(job.key);
        if (!this.destroyed) again();
      }, wait),
    );
  }

  /** Drop every cached bitmap and close every open document. */
  clear(): void {
    for (const job of [...this.work.values()]) this.cancel(job);
    this.queue.length = 0;
    // Cancelled above; a cancelled render ignores its next slice anyway.
    this.paused.length = 0;
    this.entries.clear();
    this.deferred.clear();
    this.refused.clear();
    for (const timer of this.retries.values()) window.clearTimeout(timer);
    this.retries.clear();
    this.closeWorkerDocs();
    for (const promise of this.documents.values()) {
      void promise.then((doc) => doc?.destroy()).catch(() => undefined);
    }
    this.documents.clear();
  }

  /**
   * Draw `path` without its own annotations from now on
   * (`PdfBackdrop.annotations`), dropping any raster drawn with them.
   */
  skipAnnotations(path: string): void {
    if (this.bare.has(path)) return;
    this.bare.add(path);
    this.entries.deleteWhere((cached) => cached.path === path);
  }

  /**
   * The file at `path` changed (created, replaced, deleted, moved away):
   * drop what was read from it, a cached "missing" included, so the next
   * paint reads it afresh. Whether anything was dropped.
   */
  forget(path: string): boolean {
    let dropped = this.entries.deleteWhere((cached) => cached.path === path) > 0;
    const doc = this.documents.get(path);
    if (doc) {
      this.documents.delete(path);
      void doc.then((opened) => opened?.destroy()).catch(() => undefined);
      dropped = true;
    }
    const open = this.workerDocs.get(path);
    if (open) {
      this.workerDocs.delete(path);
      const worker = this.worker;
      void open.then(
        (pages) => {
          if (pages !== null) worker?.close(path);
        },
        () => undefined,
      );
      dropped = true;
    }
    for (const key of [...this.workerSizes.keys()]) {
      if (key.startsWith(`${path}:`)) this.workerSizes.delete(key);
    }
    return dropped;
  }

  destroy(): void {
    this.destroyed = true;
    this.onReady = null;
    this.clear();
  }

  /** Bytes held by rasters (for tests and diagnostics). */
  get bytes(): number {
    return this.entries.bytes;
  }

  /**
   * One line for the diagnostic HUD: raster memory held of the most allowed,
   * detail patches or tiles cached, where pdf.js draws, and `low` while the
   * cache keeps {@link PDF_BUDGET_LOW}'s budget.
   */
  diagnostics(): string {
    let detail = 0;
    for (const cached of this.entries.values()) if (cached.detail) detail++;
    const mb = (bytes: number) => Math.round(bytes / MB);
    return (
      `pdf=${mb(this.entries.bytes)}/${mb(this.budget.hard)}MB detail=${detail} ` +
      `${this.usesWorker ? "worker" : "main"}` +
      `${this.budget.hard <= PDF_BUDGET_LOW.hard ? " low" : ""}`
    );
  }

  private store(
    key: string,
    entry: PdfEntry,
    path: string,
    page: number,
    area: PdfRenderArea | undefined,
    dprScale: number,
  ): void {
    this.inflight.delete(key);
    if (this.destroyed) {
      releasePdfEntry(entry);
      return;
    }
    if (entry.ok) this.refused.delete(key);
    const cached: Cached = {
      key,
      entry,
      lastUsed: now(),
      detail: !!area?.region,
      path,
      page,
      level: quantiseLevel(dprScale),
      ...(area ? { area } : {}),
    };
    this.entries.set(key, cached, bytesOf(entry));
    this.trim();
    if (area) this.onReady?.(path, page, area);
    else this.onReady?.(path, page);
  }

  /**
   * Evict least-recently drawn rasters down to the soft budget, stopping at
   * the first one drawn within {@link RECENT_USE_MS}: the LRU is in order of
   * use, so everything after it is recent too.
   */
  private trim(): void {
    const cutoff = now() - RECENT_USE_MS;
    for (const cached of [...this.entries.values()]) {
      if (this.entries.bytes <= this.budget.soft || cached.lastUsed > cutoff) return;
      this.entries.delete(cached.key);
    }
  }

  private pdfjs(): Promise<PdfJsLike> {
    this.lib ??= loadPdfJs().then((value: unknown) => value as PdfJsLike);
    return this.lib;
  }

  /**
   * Open a PDF read-only and keep the parsed document around: a lecture-deck
   * backdrop means many pages of one file, and re-parsing per page is slow.
   */
  private document(path: string): Promise<PdfDocumentLike | null> {
    let existing = this.documents.get(path);
    if (existing) return existing;
    existing = this.openDocument(path);
    this.documents.set(path, existing);
    return existing;
  }

  private async openDocument(path: string): Promise<PdfDocumentLike | null> {
    const file: TFile | null = this.app.vault.getFileByPath(path);
    if (!file) return null;
    // Read-only. Nothing in this plugin ever writes to the source PDF.
    const bytes = await this.app.vault.readBinary(file);
    const lib = await this.pdfjs();
    // pdf.js may detach the buffer it is handed; give it a private copy so a
    // second read of the same file cannot fail on a neutered ArrayBuffer.
    return await lib.getDocument({ data: new Uint8Array(bytes.slice(0)), ...pdfAssets() }).promise;
  }

  /** As `rasterise`, drawn by pdf.js in the worker. Throws if the worker fails. */
  private async rasteriseInWorker(
    worker: PdfWorker,
    path: string,
    page: number,
    dprScale: number,
    area: PdfRenderArea | undefined,
    job: RasterWork | undefined,
  ): Promise<PdfEntry> {
    const pages = await this.workerDocument(worker, path);
    if (job?.cancelled) return { ok: false, reason: "PDF render superseded" };
    if (pages === null) return { ok: false, reason: `Missing PDF — ${path}` };
    if (!Number.isInteger(page) || page < 0 || page >= pages) {
      return { ok: false, reason: `Page ${page + 1} is outside ${path} (${pages} pages)` };
    }
    const sizeKey = `${path}:${page}`;
    let size = this.workerSizes.get(sizeKey);
    if (!size) {
      size = worker.pageSize(path, page);
      this.workerSizes.set(sizeKey, size);
      size.catch(() => this.workerSizes.delete(sizeKey));
    }
    const base = await size;
    if (job?.cancelled) return { ok: false, reason: "PDF render superseded" };
    const plan = area ? planPdfRaster(base, quantiseLevel(dprScale), area) : null;
    const cap = MAX_RASTER_EDGE / Math.max(1, base.width, base.height);
    const scale = plan?.sourceScale ?? Math.min(Math.max(0.05, dprScale), cap);
    const render = worker.render(path, page, {
      ...(this.bare.has(path) ? { annotations: false as const } : {}),
      sourceScale: scale,
      width: plan?.width ?? Math.max(1, Math.round(base.width * scale)),
      height: plan?.height ?? Math.max(1, Math.round(base.height * scale)),
      ...(plan ? { transform: plan.transform } : {}),
    });
    if (job) job.cancelRender = render.cancel;
    const canvas = await render.promise;
    return { ok: true, canvas, ...(plan ? { box: plan.box } : {}) };
  }

  /** `path` opened in the worker (once): its page count, or `null` if the file is missing. */
  private workerDocument(worker: PdfWorker, path: string): Promise<number | null> {
    let open = this.workerDocs.get(path);
    if (!open) {
      open = (async () => {
        const file: TFile | null = this.app.vault.getFileByPath(path);
        if (!file) return null;
        // Read-only, as on the main thread. The worker gets its own copy.
        const bytes = await this.app.vault.readBinary(file);
        return worker.open(path, bytes.slice(0));
      })();
      this.workerDocs.set(path, open);
      open.catch(() => this.workerDocs.delete(path));
    }
    return open;
  }

  /** Let the worker close what this cache opened in it. */
  private closeWorkerDocs(): void {
    const worker = this.worker;
    for (const [path, open] of this.workerDocs) {
      void open.then(
        (pages) => {
          if (pages !== null) worker?.close(path);
        },
        () => undefined,
      );
    }
    this.workerDocs.clear();
    this.workerSizes.clear();
  }

  private async rasterise(
    path: string,
    page: number,
    dprScale: number,
    area?: PdfRenderArea,
    job?: RasterWork,
  ): Promise<PdfEntry> {
    const worker = this.worker;
    if (worker?.alive) {
      try {
        return await this.rasteriseInWorker(worker, path, page, dprScale, area, job);
      } catch (error) {
        if (error instanceof PdfRenderCancelled || job?.cancelled) {
          return { ok: false, reason: "PDF render superseded" };
        }
        // This thread's canvases come out of the same memory.
        if (error instanceof PdfCanvasUnavailable) return NO_CANVAS;
        // A worker that died is dropped for good; one page it could not draw
        // is tried here, where it may still work.
        if (!worker.alive && this.worker === worker) this.setWorker(null);
      }
    }
    const doc = await this.document(path);
    if (job?.cancelled) return { ok: false, reason: "PDF render superseded" };
    if (!doc) return { ok: false, reason: `Missing PDF — ${path}` };
    if (!Number.isInteger(page) || page < 0 || page >= doc.numPages) {
      return { ok: false, reason: `Page ${page + 1} is outside ${path} (${doc.numPages} pages)` };
    }

    const pdfPage = await doc.getPage(page + 1);
    if (job?.cancelled) return { ok: false, reason: "PDF render superseded" };
    const base = pdfPage.getViewport({ scale: 1 });
    const plan = area ? planPdfRaster(base, quantiseLevel(dprScale), area) : null;
    const cap = MAX_RASTER_EDGE / Math.max(1, base.width, base.height);
    const viewport = pdfPage.getViewport({
      scale: plan?.sourceScale ?? Math.min(Math.max(0.05, dprScale), cap),
    });

    // Obsidian's global createEl, not document.createElement: the
    // plugin-review lint requires it. The global form returns a *detached*
    // element, which is what an offscreen raster target must be — Node's
    // createEl would append the canvas into the DOM.
    const canvas = createEl("canvas");
    canvas.width = plan?.width ?? Math.max(1, Math.round(viewport.width));
    canvas.height = plan?.height ?? Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.width = canvas.height = 0;
      pdfPage.cleanup?.();
      return NO_CANVAS;
    }

    try {
      const render = pdfPage.render({
        canvasContext: ctx,
        viewport,
        ...(this.bare.has(path) ? { annotationMode: 0 } : {}),
        ...(plan ? { transform: plan.transform } : {}),
      });
      if (job) job.cancelRender = render.cancel ? () => render.cancel?.() : undefined;
      render.onContinue = (next) => {
        if (this.held) this.paused.push(next);
        else next();
      };
      await render.promise;
      return { ok: true, canvas, ...(plan ? { box: plan.box } : {}) };
    } catch (error) {
      canvas.width = canvas.height = 0;
      throw error;
    } finally {
      pdfPage.cleanup?.();
    }
  }
}

/** What an entry costs the cache: its raster's pixels, or a token amount for a miss. */
function bytesOf(entry: PdfEntry): number {
  return entry.ok ? Math.max(MISS_BYTES, entry.canvas.width * entry.canvas.height * 4) : MISS_BYTES;
}

/** Give a dropped raster's memory back now; iOS holds canvas memory until then. */
export function releasePdfEntry(entry: PdfEntry): void {
  if (!entry.ok) return;
  const { canvas } = entry;
  if ("close" in canvas) canvas.close();
  else canvas.width = canvas.height = 0;
}
