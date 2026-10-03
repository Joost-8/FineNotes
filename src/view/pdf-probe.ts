/**
 * The PDF rendering test (beta only; remove once research/PDF_RENDERING.md's
 * questions are answered). On the PDF behind the page in view it times:
 *
 * 1. Obsidian's pdf.js on the main thread, as FineNotes renders today;
 * 2. the same pdf.js in a worker the plugin starts, drawing into an
 *    OffscreenCanvas and handing back an ImageBitmap;
 * 3. WebKit's own (CoreGraphics) rendering of the PDF as an `<img>`, which
 *    draws page 1 only.
 *
 * For each it records how late a 5 ms main-thread timer fired meanwhile,
 * since that is what the pen and scrolling feel. Nothing is cached or kept;
 * the result is a note in the vault (`pdf-probe-report.ts`).
 */

import { Platform, apiVersion, loadPdfJs } from "obsidian";
import { errorMessage } from "../util/errors";
import { pdfJsBase } from "./pdf-worker";
import {
  type AppleRun,
  type EngineRun,
  type Outcome,
  type ProbeResult,
  lateness,
  meanAbsDiff,
} from "./pdf-probe-report";

/** Long edge each test page is rendered at: about a full-page raster today. */
const EDGE_PX = 2048;
/** Pages rendered by each engine. */
const PAGES = 6;
/** Side of the thumbnails two renders are compared at. */
const COMPARE_PX = 256;
/** Nothing in the test may hang the app: every await on the platform is bounded. */
const STEP_TIMEOUT_MS = 30_000;
const TICK_MS = 5;

interface PdfViewport {
  width: number;
  height: number;
}
interface PdfPage {
  getViewport(params: { scale: number }): PdfViewport;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): {
    promise: Promise<void>;
  };
  cleanup?: () => void;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfJs {
  getDocument(params: { data: Uint8Array }): { promise: Promise<PdfDoc> };
}

function within<T>(promise: Promise<T>, what: string, ms = STEP_TIMEOUT_MS): Promise<T> {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

/** A 5 ms timer whose gaps say how long the main thread was busy. */
function heartbeat(): { stop: () => number[] } {
  const gaps: number[] = [];
  let last = performance.now();
  const id = window.setInterval(() => {
    const t = performance.now();
    gaps.push(t - last);
    last = t;
  }, TICK_MS);
  return {
    stop: () => {
      window.clearInterval(id);
      return gaps;
    },
  };
}

const nextTask = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

function canvas(width: number, height: number): HTMLCanvasElement {
  const el = createEl("canvas");
  el.width = Math.max(1, Math.round(width));
  el.height = Math.max(1, Math.round(height));
  return el;
}

function context(el: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  return ctx;
}

/** A small copy of a page image, for comparing two renders of it. */
function thumbnail(source: CanvasImageSource, width: number, height: number): Uint8ClampedArray {
  const k = COMPARE_PX / Math.max(width, height);
  const el = canvas(width * k, height * k);
  const ctx = context(el);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, el.width, el.height);
  ctx.drawImage(source, 0, 0, el.width, el.height);
  return ctx.getImageData(0, 0, el.width, el.height).data;
}

function release(el: HTMLCanvasElement): void {
  el.width = el.height = 0;
}

async function runMain(
  bytes: ArrayBuffer,
  pages: number[],
  thumbs: Map<number, Uint8ClampedArray>,
): Promise<EngineRun> {
  const lib = (await within(loadPdfJs(), "loadPdfJs")) as PdfJs;
  const doc = await within(
    lib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise,
    "open PDF",
  );
  const pageMs: number[] = [];
  const beat = heartbeat();
  const start = performance.now();
  try {
    for (const n of pages) {
      const t = performance.now();
      const page = await within(doc.getPage(n), `page ${n}`);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: EDGE_PX / Math.max(base.width, base.height) });
      const el = canvas(viewport.width, viewport.height);
      await within(page.render({ canvasContext: context(el), viewport }).promise, `render ${n}`);
      pageMs.push(performance.now() - t);
      thumbs.set(n, thumbnail(el, el.width, el.height));
      release(el);
      page.cleanup?.();
      await nextTask();
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  const totalMs = performance.now() - start;
  return { edgePx: EDGE_PX, pageMs, totalMs, lateness: lateness(beat.stop(), TICK_MS) };
}

/**
 * The worker: Obsidian's own pdf.js, loaded in "fake worker" mode so parsing
 * and drawing share this one thread, drawing into an OffscreenCanvas
 * (research/PDF_RENDERING.md, appendix). Messages without `probe` are pdf.js's
 * own and are ignored on both sides.
 */
const WORKER_SOURCE = `
self.activeWindow = self;
let doc = null;
const reply = (message, transfer) => self.postMessage({ probe: true, ...message }, transfer || []);
self.onmessage = async (event) => {
  const m = event.data;
  if (!m || m.probe !== true) return;
  try {
    if (m.type === "open") {
      const lib = await import(m.base + "pdf.min.mjs");
      globalThis.pdfjsWorker = await import(m.base + "pdf.worker.min.mjs");
      const ownerDocument = {
        fonts: self.fonts,
        createElement: (name) => (name === "canvas" ? new OffscreenCanvas(1, 1) : null),
      };
      doc = await lib.getDocument({ data: m.bytes, ownerDocument }).promise;
      reply({ type: "opened", pages: doc.numPages, fonts: !!self.fonts });
    } else if (m.type === "render") {
      const t = performance.now();
      const page = await doc.getPage(m.page);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: m.edge / Math.max(base.width, base.height) });
      const off = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvasContext: off.getContext("2d"), viewport }).promise;
      page.cleanup();
      const bitmap = off.transferToImageBitmap();
      reply({ type: "rendered", page: m.page, ms: performance.now() - t, bitmap }, [bitmap]);
    }
  } catch (error) {
    reply({ type: "error", message: String((error && error.stack) || error) });
  }
};
`;

interface WorkerReply {
  probe: true;
  type: "opened" | "rendered" | "error";
  pages?: number;
  fonts?: boolean;
  page?: number;
  ms?: number;
  bitmap?: ImageBitmap;
  message?: string;
}

async function runWorker(
  bytes: ArrayBuffer,
  pages: number[],
  thumbs: Map<number, Uint8ClampedArray>,
): Promise<EngineRun & { fonts: boolean; base: string }> {
  const base = pdfJsBase();
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url, { type: "module" });
  let waiting: ((reply: WorkerReply) => void) | null = null;
  let failed: ((error: Error) => void) | null = null;
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    if (event.data?.probe !== true) return;
    if (event.data.type === "error") failed?.(new Error(event.data.message ?? "worker error"));
    else waiting?.(event.data);
  };
  worker.onerror = (event) => failed?.(new Error(event.message || "worker failed to start"));
  const ask = (message: object, transfer: Transferable[] = [], what = "worker") =>
    within(
      new Promise<WorkerReply>((resolve, reject) => {
        waiting = resolve;
        failed = reject;
        worker.postMessage({ probe: true, ...message }, transfer);
      }),
      what,
    );
  try {
    const copy = bytes.slice(0);
    const opened = await ask({ type: "open", base, bytes: copy }, [copy], "worker open");
    const pageMs: number[] = [];
    const blitMs: number[] = [];
    const diffVsMain: number[] = [];
    const beat = heartbeat();
    const start = performance.now();
    for (const n of pages) {
      const reply = await ask({ type: "render", page: n, edge: EDGE_PX }, [], `worker page ${n}`);
      if (!reply.bitmap) throw new Error(`worker page ${n}: no image`);
      pageMs.push(reply.ms ?? Number.NaN);
      const { bitmap } = reply;
      const target = canvas(bitmap.width, bitmap.height);
      const t = performance.now();
      context(target).drawImage(bitmap, 0, 0);
      blitMs.push(performance.now() - t);
      const main = thumbs.get(n);
      if (main) diffVsMain.push(meanAbsDiff(main, thumbnail(bitmap, bitmap.width, bitmap.height)));
      bitmap.close();
      release(target);
    }
    const totalMs = performance.now() - start;
    return {
      edgePx: EDGE_PX,
      pageMs,
      totalMs,
      lateness: lateness(beat.stop(), TICK_MS),
      blitMs,
      diffVsMain,
      fonts: opened.fonts === true,
      base,
    };
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

async function runApple(
  bytes: ArrayBuffer,
  page1: Uint8ClampedArray | undefined,
): Promise<AppleRun> {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const img = createEl("img");
  try {
    const loaded = await within(
      new Promise<boolean>((resolve) => {
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = url;
      }),
      "PDF image",
    );
    if (!loaded) return { supported: false };
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const run: AppleRun = { supported: true, naturalSize: `${w}x${h}` };
    const k = EDGE_PX / Math.max(w, h);
    const beat = heartbeat();
    // Drawn, then one pixel read back: a draw may be deferred until then.
    const page = canvas(w * k, h * k);
    const pageCtx = context(page);
    let t = performance.now();
    pageCtx.drawImage(img, 0, 0, page.width, page.height);
    try {
      pageCtx.getImageData(0, 0, 1, 1);
      run.tainted = false;
    } catch {
      run.tainted = true;
    }
    run.pageMs = performance.now() - t;
    if (!run.tainted && page1) {
      run.diffVsPdfjs = meanAbsDiff(page1, thumbnail(page, page.width, page.height));
    }
    release(page);
    await nextTask();
    // Four 512 px tiles of the page drawn at 4x that size (a deep zoom).
    const tile = canvas(512, 512);
    const tileCtx = context(tile);
    const side = 512 / (4 * k);
    run.tileMs = [];
    for (const [fx, fy] of [
      [0.1, 0.1],
      [0.5, 0.2],
      [0.3, 0.6],
      [0.7, 0.7],
    ]) {
      t = performance.now();
      tileCtx.drawImage(img, fx * w, fy * h, side, side, 0, 0, 512, 512);
      if (!run.tainted) tileCtx.getImageData(0, 0, 1, 1);
      run.tileMs.push(performance.now() - t);
      await nextTask();
    }
    release(tile);
    try {
      t = performance.now();
      const bitmap = await within(
        createImageBitmap(img, { resizeWidth: Math.round(w * k) }),
        "createImageBitmap",
      );
      run.bitmapMs = performance.now() - t;
      bitmap.close();
    } catch (error) {
      run.bitmapMs = errorMessage(error);
    }
    run.lateness = lateness(beat.stop(), TICK_MS);
    return run;
  } finally {
    img.src = "";
    URL.revokeObjectURL(url);
  }
}

async function outcome<T>(work: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function environment(workerExtras: Record<string, string | boolean>): ProbeResult["environment"] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const capacitor = (window as unknown as { Capacitor?: { Plugins?: object } }).Capacitor;
  return {
    obsidian: apiVersion,
    platform: Platform.isIosApp
      ? "iOS app"
      : Platform.isAndroidApp
        ? "Android app"
        : Platform.isDesktopApp
          ? "desktop app"
          : "other",
    tablet: Platform.isTablet,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${window.screen.width}x${window.screen.height}`,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGB: nav.deviceMemory ?? null,
    crossOriginIsolated: window.crossOriginIsolated === true,
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    origin: window.location.origin,
    capacitorPlugins: capacitor?.Plugins ? Object.keys(capacitor.Plugins).join(", ") : null,
    ...workerExtras,
  };
}

/**
 * Run the whole test on `bytes` (a PDF called `name`). `progress` hears each
 * phase starting. Never rejects: each engine's failure is part of the result.
 */
export async function runPdfProbe(
  bytes: ArrayBuffer,
  name: string,
  progress: (phase: string) => void,
): Promise<ProbeResult> {
  const thumbs = new Map<number, Uint8ClampedArray>();
  let numPages = 0;
  progress("Obsidian's engine on the main thread");
  const main = await outcome(async () => {
    const lib = (await within(loadPdfJs(), "loadPdfJs")) as PdfJs;
    const doc = await within(
      lib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise,
      "open PDF",
    );
    numPages = doc.numPages;
    await doc.destroy().catch(() => undefined);
    const pages = Array.from({ length: Math.min(PAGES, numPages) }, (_, i) => i + 1);
    return runMain(bytes, pages, thumbs);
  });
  const pages = Array.from({ length: Math.min(PAGES, numPages || PAGES) }, (_, i) => i + 1);
  progress("Obsidian's engine in a background worker");
  let extras: Record<string, string | boolean> = {};
  const worker = await outcome(async () => {
    const run = await runWorker(bytes, pages, thumbs);
    extras = { workerFonts: run.fonts, pdfJsBase: run.base };
    const { fonts: _fonts, base: _base, ...engine } = run;
    return engine;
  });
  if (!worker.ok) extras = { pdfJsBase: pdfJsBase() };
  progress("Apple's engine");
  const apple = await outcome(() => runApple(bytes, thumbs.get(1)));
  return {
    when: new Date().toISOString(),
    file: { name, pages: numPages, megabytes: Math.round((bytes.byteLength / 1e6) * 10) / 10 },
    environment: environment(extras),
    main,
    worker,
    apple,
  };
}
