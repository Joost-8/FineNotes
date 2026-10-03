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
 * 1. **Cache PDF renders, never re-render per frame.** Notebook tiles add
 *    page geometry and region to the source/scale key and use their settled
 *    resolution. Thumbnails use quantised scales and bounded full-page
 *    rasters. Zoomed screen patches retain source detail without allocating
 *    a huge whole-page canvas.
 * 2. **The source PDF is opened read-only and never written.** The only vault
 *    call in this file is `vault.readBinary`.
 * 3. **A failed backdrop never costs the user their ink.** Every failure path
 *    resolves to a `miss` entry; the caller paints the "missing source"
 *    placeholder and draws the strokes on top regardless.
 */

import { type App, type TFile, loadPdfJs } from "obsidian";
import { ByteLru, quantiseLevel } from "../canvas/tile-grid";
import { type PdfRenderArea, pdfAreaKey, planPdfRaster } from "../canvas/pdf-raster";
import { errorMessage } from "../util/errors";

/** Largest raster edge, in device px. A 1024x1448 page at dpr 3 would be 13 Mpx
 *  and ~53 MB per page — several of those will evict an iPad's web view. */
const MAX_RASTER_EDGE = 2400;

/**
 * Rasterised pages kept at once, in bytes. It used to be a count of eight
 * pages, and the page sidebar's dozen thumbnails plus the page in view asked
 * for more than eight: each raster that landed evicted another one still on
 * screen, whose repaint asked for it again, for as long as the sidebar stayed
 * open — 40 renders a second and every tile redrawn each time, on a laptop
 * (2026-10-01, FineNotes#1). A raster drawn within {@link RECENT_USE_MS} is
 * not evicted to meet this; the hard budget holds regardless.
 */
const SOFT_BUDGET = 48 * 1024 * 1024;
const HARD_BUDGET = 96 * 1024 * 1024;
const RECENT_USE_MS = 1500;
/** What a miss is counted as: little, but not nothing, so misses cannot pile up. */
const MISS_BYTES = 1024;

/** Scale quantisation step. Continuous zoom must not mint a bitmap per frame. */
const SCALE_STEP = 0.25;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

/** A successfully rasterised PDF page, ready to `drawImage`. */
export interface PdfRaster {
  ok: true;
  canvas: HTMLCanvasElement;
  /** Page-space destination of a PDF patch; absent on legacy whole-page rasters. */
  box?: { x: number; y: number; w: number; h: number };
}

/** A backdrop that could not be resolved. Cached so a missing file is not
 *  retried on every scroll frame. */
export interface PdfMiss {
  ok: false;
  reason: string;
}

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
  }): {
    promise: Promise<void>;
  };
  cleanup?: () => void;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}

interface PdfJsLike {
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocumentLike> };
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
}

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

  private readonly entries = new ByteLru<Cached>(HARD_BUDGET, (cached) => release(cached.entry));
  private readonly inflight = new Map<string, Promise<PdfEntry>>();
  private readonly documents = new Map<string, Promise<PdfDocumentLike | null>>();
  /** Requests made while held, started on {@link setHeld}(false). */
  private readonly deferred = new Map<
    string,
    { path: string; page: number; dprScale: number; area?: PdfRenderArea }
  >();
  private held = false;
  private lib: Promise<PdfJsLike> | null = null;
  private destroyed = false;

  constructor(private readonly app: App) {}

  /** Synchronous lookup. `null` means "not rasterised yet" — never blocks. */
  peek(path: string, page: number, dprScale: number, area?: PdfRenderArea): PdfEntry | null {
    const hit = this.entries.get(rasterKey(path, page, dprScale, area));
    if (!hit) return null;
    hit.lastUsed = now();
    return hit.entry;
  }

  /**
   * Start rasterising if it is not cached or already in flight. While held
   * (the pen is writing), it waits: pdf.js paints on the main thread, and a
   * page landing mid-stroke stalls the ink.
   */
  request(path: string, page: number, dprScale: number, area?: PdfRenderArea): void {
    if (this.held) {
      const key = rasterKey(path, page, dprScale, area);
      if (!this.entries.has(key) && !this.inflight.has(key)) {
        this.deferred.set(key, { path, page, dprScale, area });
      }
      return;
    }
    void this.resolve(path, page, dprScale, area);
  }

  /** Hold background rasterisation (true), or let it go on with what waited (false). */
  setHeld(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    if (held) return;
    const waiting = [...this.deferred.values()];
    this.deferred.clear();
    for (const { path, page, dprScale, area } of waiting)
      void this.resolve(path, page, dprScale, area);
  }

  /** Cached entry, rasterising first if necessary. Never rejects. */
  resolve(path: string, page: number, dprScale: number, area?: PdfRenderArea): Promise<PdfEntry> {
    const key = rasterKey(path, page, dprScale, area);
    const cached = this.entries.peek(key);
    if (cached) return Promise.resolve(cached.entry);
    if (this.destroyed) return Promise.resolve({ ok: false, reason: "Cache closed" });

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const work = this.rasterise(path, page, dprScale, area)
      .catch((error: unknown): PdfEntry => ({ ok: false, reason: errorMessage(error) }))
      .then((entry) => {
        this.store(key, entry, path, page, area);
        return entry;
      });
    this.inflight.set(key, work);
    return work;
  }

  /** Drop every cached bitmap and close every open document. */
  clear(): void {
    this.entries.clear();
    this.deferred.clear();
    for (const promise of this.documents.values()) {
      void promise.then((doc) => doc?.destroy()).catch(() => undefined);
    }
    this.documents.clear();
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

  private store(
    key: string,
    entry: PdfEntry,
    path: string,
    page: number,
    area?: PdfRenderArea,
  ): void {
    this.inflight.delete(key);
    if (this.destroyed) {
      release(entry);
      return;
    }
    this.entries.set(key, { key, entry, lastUsed: now() }, bytesOf(entry));
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
      if (this.entries.bytes <= SOFT_BUDGET || cached.lastUsed > cutoff) return;
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
    return await lib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  }

  private async rasterise(
    path: string,
    page: number,
    dprScale: number,
    area?: PdfRenderArea,
  ): Promise<PdfEntry> {
    const doc = await this.document(path);
    if (!doc) return { ok: false, reason: `Missing PDF — ${path}` };
    if (!Number.isInteger(page) || page < 0 || page >= doc.numPages) {
      return { ok: false, reason: `Page ${page + 1} is outside ${path} (${doc.numPages} pages)` };
    }

    const pdfPage = await doc.getPage(page + 1);
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
    if (!ctx) return { ok: false, reason: "Canvas unavailable for PDF rasterisation" };

    try {
      await pdfPage.render({
        canvasContext: ctx,
        viewport,
        ...(plan ? { transform: plan.transform } : {}),
      }).promise;
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
function release(entry: PdfEntry): void {
  if (!entry.ok) return;
  entry.canvas.width = 0;
  entry.canvas.height = 0;
}
