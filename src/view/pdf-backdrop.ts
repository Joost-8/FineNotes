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
 * 1. **Rasterise once per `(path, page, scale)` and cache.** Re-rasterising per
 *    frame destroys iPad scroll performance. The cache key is
 *    `` `${path}:${page}:${dpr * scale}` ``, with the scale quantised (see
 *    {@link quantiseScale}) so a pinch-zoom cannot mint a new bitmap per frame.
 * 2. **The source PDF is opened read-only and never written.** The only vault
 *    call in this file is `vault.readBinary`.
 * 3. **A failed backdrop never costs the user their ink.** Every failure path
 *    resolves to a `miss` entry; the caller paints the "missing source"
 *    placeholder and draws the strokes on top regardless.
 */

import { type App, type TFile, loadPdfJs } from "obsidian";
import { errorMessage } from "../util/errors";

/** Largest raster edge, in device px. A 1024x1448 page at dpr 3 would be 13 Mpx
 *  and ~53 MB per page — several of those will evict an iPad's web view. */
const MAX_RASTER_EDGE = 2400;

/** How many rasterised pages to keep. Small: pages are large bitmaps. */
const MAX_CACHE_ENTRIES = 8;

/** Scale quantisation step. Continuous zoom must not mint a bitmap per frame. */
const SCALE_STEP = 0.25;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

/** A successfully rasterised PDF page, ready to `drawImage`. */
export interface PdfRaster {
  ok: true;
  canvas: HTMLCanvasElement;
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
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewportLike }): {
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
export function rasterKey(path: string, page: number, dprScale: number): string {
  return `${path}:${page}:${dprScale}`;
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
export class PdfBackdropCache {
  /** Called after a background rasterisation lands (success or miss). */
  onReady: (() => void) | null = null;

  private readonly entries = new Map<string, PdfEntry>();
  private readonly inflight = new Map<string, Promise<PdfEntry>>();
  private readonly documents = new Map<string, Promise<PdfDocumentLike | null>>();
  private lib: Promise<PdfJsLike> | null = null;
  private destroyed = false;

  constructor(private readonly app: App) {}

  /** Synchronous lookup. `null` means "not rasterised yet" — never blocks. */
  peek(path: string, page: number, dprScale: number): PdfEntry | null {
    const key = rasterKey(path, page, dprScale);
    const hit = this.entries.get(key);
    if (!hit) return null;
    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  /** Start rasterising if it is not cached or already in flight. */
  request(path: string, page: number, dprScale: number): void {
    void this.resolve(path, page, dprScale);
  }

  /** Cached entry, rasterising first if necessary. Never rejects. */
  resolve(path: string, page: number, dprScale: number): Promise<PdfEntry> {
    const key = rasterKey(path, page, dprScale);
    const cached = this.entries.get(key);
    if (cached) return Promise.resolve(cached);
    if (this.destroyed) return Promise.resolve({ ok: false, reason: "Cache closed" });

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const work = this.rasterise(path, page, dprScale)
      .catch((error: unknown): PdfEntry => ({ ok: false, reason: errorMessage(error) }))
      .then((entry) => {
        this.store(key, entry);
        return entry;
      });
    this.inflight.set(key, work);
    return work;
  }

  /** Drop every cached bitmap and close every open document. */
  clear(): void {
    this.entries.clear();
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

  private store(key: string, entry: PdfEntry): void {
    this.inflight.delete(key);
    if (this.destroyed) return;
    this.entries.set(key, entry);
    while (this.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.onReady?.();
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

  private async rasterise(path: string, page: number, dprScale: number): Promise<PdfEntry> {
    const doc = await this.document(path);
    if (!doc) return { ok: false, reason: `Missing PDF — ${path}` };
    if (!Number.isInteger(page) || page < 0 || page >= doc.numPages) {
      return { ok: false, reason: `Page ${page + 1} is outside ${path} (${doc.numPages} pages)` };
    }

    const pdfPage = await doc.getPage(page + 1);
    const base = pdfPage.getViewport({ scale: 1 });
    const cap = MAX_RASTER_EDGE / Math.max(1, base.width, base.height);
    const viewport = pdfPage.getViewport({ scale: Math.min(Math.max(0.05, dprScale), cap) });

    // Obsidian's global createEl, not document.createElement: the
    // plugin-review lint requires it. The global form returns a *detached*
    // element, which is what an offscreen raster target must be — Node's
    // createEl would append the canvas into the DOM.
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "Canvas unavailable for PDF rasterisation" };

    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    pdfPage.cleanup?.();
    return { ok: true, canvas };
  }
}
