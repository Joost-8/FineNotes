/**
 * pdf.js in a background worker, so PDF pages render without taking time
 * from the thread that scrolls the page and draws the ink.
 *
 * The worker loads Obsidian's own pdf.js (the files `loadPdfJs` loads, from
 * the app bundle; not a public API, hence the fallback) in "fake worker"
 * mode, so parsing and drawing share its one thread, and draws into an
 * OffscreenCanvas, handing back an ImageBitmap. Measured with the beta's PDF
 * test on an iPad (2026-10-03): it starts, its fonts load, its pages are
 * pixel-identical to the main thread's, and handing a page back costs
 * nothing. research/PDF_RENDERING.md has the recipe and its sources.
 *
 * One worker serves every open notebook (`acquirePdfWorker`); if it cannot
 * start, callers get `null` and render on the main thread as before.
 */

import { loadPdfJs } from "obsidian";
import {
  type TextWorker,
  type WorkerPageText,
  keptOperators,
  shapePageText,
} from "./pdf-worker-text";

/** Tags this module's messages: pdf.js's own worker code posts on the same port. */
const TAG = "fineNotesPdf";
/** Starting the worker and loading pdf.js into it; past this it counts as unavailable. */
const START_TIMEOUT_MS = 15_000;

/** What to draw: pdf.js's viewport scale, the bitmap's size, and an optional offset. */
export interface PdfWorkerPlan {
  /** `false`: draw none of the PDF's own annotations (`PdfBackdrop.annotations`). */
  annotations?: false;
  sourceScale: number;
  width: number;
  height: number;
  transform?: readonly number[];
}

export interface PdfWorkerRender {
  promise: Promise<ImageBitmap>;
  cancel: () => void;
}

/** A render the caller cancelled; not a failure. */
export class PdfRenderCancelled extends Error {
  constructor() {
    super("PDF render cancelled");
    this.name = "PdfRenderCancelled";
  }
}

/** The worker was refused a canvas: out of canvas memory (iOS), not a fault of the PDF. */
export class PdfCanvasUnavailable extends Error {
  constructor() {
    super("No canvas memory for the PDF page");
    this.name = "PdfCanvasUnavailable";
  }
}

const WORKER_SOURCE = `
self.activeWindow = self;
const TAG = ${JSON.stringify(TAG)};
const shapePageText = (${shapePageText.toString()});
const keptOperators = (${keptOperators.toString()});
let lib = null;
let assets = {};
const docs = new Map();
const tasks = new Map();
const cancelled = new Set();
const ownerDocument = {
  fonts: self.fonts,
  createElement: (name) => (name === "canvas" ? new OffscreenCanvas(1, 1) : null),
};
const reply = (id, body, transfer) => self.postMessage({ [TAG]: true, id, ...body }, transfer || []);
const doc = (path) => {
  const open = docs.get(path);
  if (!open) throw new Error("PDF not open: " + path);
  return open.promise;
};
self.addEventListener("message", async (event) => {
  const m = event.data;
  if (!m || m[TAG] !== true) return;
  const id = m.id;
  try {
    if (m.type === "init") {
      if (!lib) {
        lib = await import(m.base + "pdf.min.mjs");
        globalThis.pdfjsWorker = await import(m.base + "pdf.worker.min.mjs");
      }
      // Fetch them from here: left to choose, pdf.js reads document.baseURI,
      // which a worker has not, and no page is open to fetch them for us.
      assets = m.assets ? { ...m.assets, useWorkerFetch: true } : {};
      reply(id, { ok: true });
    } else if (m.type === "open") {
      let open = docs.get(m.path);
      if (!open) {
        open = { users: 0, promise: lib.getDocument({ data: m.bytes, ownerDocument, ...assets }).promise };
        docs.set(m.path, open);
        open.promise.catch(() => docs.get(m.path) === open && docs.delete(m.path));
      }
      open.users++;
      reply(id, { ok: true, pages: (await open.promise).numPages });
    } else if (m.type === "close") {
      const open = docs.get(m.path);
      if (open && --open.users <= 0) {
        docs.delete(m.path);
        open.promise.then((d) => d.destroy()).catch(() => undefined);
      }
    } else if (m.type === "share") {
      // Another use of a PDF already open here (its text, beside its pages): no bytes needed.
      const open = docs.get(m.path);
      if (!open) return reply(id, { ok: true });
      open.users++;
      reply(id, { ok: true, pages: (await open.promise).numPages });
    } else if (m.type === "text") {
      const page = await (await doc(m.path)).getPage(m.page + 1);
      const content = await page.getTextContent();
      const annotations = await page.getAnnotations().catch(() => []);
      reply(id, { ok: true, value: shapePageText(page.getViewport({ scale: 1 }), content, annotations) });
    } else if (m.type === "ops") {
      const page = await (await doc(m.path)).getPage(m.page + 1);
      reply(id, { ok: true, value: keptOperators(await page.getOperatorList(), m.keep) });
    } else if (m.type === "dest") {
      reply(id, { ok: true, value: await (await doc(m.path)).getDestination(m.name) });
    } else if (m.type === "pageIndex") {
      reply(id, { ok: true, value: await (await doc(m.path)).getPageIndex(m.ref) });
    } else if (m.type === "size") {
      const page = await (await doc(m.path)).getPage(m.page + 1);
      const v = page.getViewport({ scale: 1 });
      reply(id, { ok: true, width: v.width, height: v.height });
    } else if (m.type === "render") {
      if (cancelled.delete(id)) return reply(id, { ok: false, cancelled: true });
      const page = await (await doc(m.path)).getPage(m.page + 1);
      if (cancelled.delete(id)) return reply(id, { ok: false, cancelled: true });
      const viewport = page.getViewport({ scale: m.sourceScale });
      const canvas = new OffscreenCanvas(m.width, m.height);
      // iOS answers null once its canvases hold too much memory.
      const context = canvas.getContext("2d");
      if (!context) {
        canvas.width = canvas.height = 0;
        return reply(id, { ok: false, memory: true, error: "No canvas memory" });
      }
      const task = page.render({
        canvasContext: context,
        viewport,
        ...(m.transform ? { transform: m.transform } : {}),
        ...(m.annotations === false ? { annotationMode: 0 } : {}),
      });
      tasks.set(id, task);
      try {
        await task.promise;
      } finally {
        tasks.delete(id);
      }
      const bitmap = canvas.transferToImageBitmap();
      reply(id, { ok: true, bitmap }, [bitmap]);
    } else if (m.type === "cancel") {
      const task = tasks.get(m.target);
      if (task) task.cancel();
      else if (cancelled.size < 4096) cancelled.add(m.target);
    }
  } catch (error) {
    reply(id, {
      ok: false,
      cancelled: cancelled.delete(id) || (error && error.name === "RenderingCancelledException"),
      error: String((error && error.message) || error),
    });
  }
});
`;

interface Reply {
  ok: boolean;
  cancelled?: boolean;
  /** Refused a canvas (`PdfCanvasUnavailable`). */
  memory?: boolean;
  error?: string;
  pages?: number;
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
  /** What a text, operator or destination question was answered with. */
  value?: unknown;
}

interface Pending {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
}

/**
 * Where Obsidian serves its pdf.js from: the URL `loadPdfJs` actually loaded,
 * else its place in the app bundle. Call after `loadPdfJs()` has resolved.
 */
export function pdfJsBase(): string {
  const loaded =
    typeof performance === "undefined" || typeof performance.getEntriesByType !== "function"
      ? undefined
      : performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => /\/pdf(\.min)?\.mjs(\?|$)/.test(name));
  if (loaded) return loaded.slice(0, loaded.lastIndexOf("/") + 1);
  return `${window.location.origin}/lib/pdfjs/`;
}

/** The files pdf.js reads beside itself, which every `getDocument` is given. */
export interface PdfAssets {
  cMapUrl: string;
  cMapPacked: true;
  standardFontDataUrl: string;
  wasmUrl: string;
  iccUrl: string;
}

/**
 * Where pdf.js finds its cMaps, standard fonts, JPEG 2000 decoder and colour
 * profile: the folders Obsidian ships next to its pdf.js and gives its own
 * PDF viewer. Without the cMaps a CJK font with no /ToUnicode draws nothing
 * (FineNotes#49). Call after `loadPdfJs()` has resolved.
 */
export function pdfAssets(base = pdfJsBase()): PdfAssets {
  return {
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  };
}

export class PdfWorker implements TextWorker {
  private readonly pending = new Map<number, Pending>();
  private next = 1;
  private dead = false;

  private constructor(
    private readonly worker: Worker,
    private readonly url: string,
  ) {
    worker.addEventListener("message", (event: MessageEvent<Reply & { id?: number }>) => {
      const data = event.data as (Reply & { id?: number; [TAG]?: boolean }) | null;
      if (!data || data[TAG] !== true || data.id === undefined) return;
      const waiting = this.pending.get(data.id);
      if (!waiting) {
        data.bitmap?.close();
        return;
      }
      this.pending.delete(data.id);
      waiting.resolve(data);
    });
    worker.addEventListener("error", (event) => {
      this.fail(new Error(event.message || "PDF worker failed"));
    });
  }

  /** Start a worker with Obsidian's pdf.js in it, or `null` if that is not possible here. */
  static async start(timeoutMs = START_TIMEOUT_MS): Promise<PdfWorker | null> {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
    let started: PdfWorker | null = null;
    let timer = 0;
    try {
      await loadPdfJs();
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      started = new PdfWorker(new Worker(url, { type: "module" }), url);
      const base = pdfJsBase();
      const ready = started.call({ type: "init", base, assets: pdfAssets(base) });
      const late = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("PDF worker did not start")), timeoutMs);
      });
      const reply = await Promise.race([ready, late]);
      if (!reply.ok) throw new Error(reply.error ?? "PDF worker did not start");
      return started;
    } catch {
      started?.destroy();
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** False once the worker has died; then every call rejects. */
  get alive(): boolean {
    return !this.dead;
  }

  /** Open `bytes` (which are transferred) as `path`; resolves to its page count. */
  async open(path: string, bytes: ArrayBuffer): Promise<number> {
    const reply = await this.call({ type: "open", path, bytes }, [bytes]);
    if (!reply.ok || reply.pages === undefined) throw new Error(reply.error ?? "PDF did not open");
    return reply.pages;
  }

  /**
   * One more use of `path` if it is open here already (its pages are drawn
   * here), with its page count; `null` if it is not: then `open` it.
   */
  async share(path: string): Promise<number | null> {
    const reply = await this.call({ type: "share", path });
    if (!reply.ok) throw new Error(reply.error ?? "PDF did not open");
    return reply.pages ?? null;
  }

  /** A page's size, text and links (`page` is 0-based), from a PDF opened here. */
  async pageText(path: string, page: number): Promise<WorkerPageText> {
    return (await this.ask({ type: "text", path, page })) as WorkerPageText;
  }

  /** A page's operators among `keep`, for finding its pictures. */
  async operators(
    path: string,
    page: number,
    keep: readonly number[],
  ): Promise<{ fnArray: number[]; argsArray: unknown[] }> {
    return (await this.ask({ type: "ops", path, page, keep: [...keep] })) as {
      fnArray: number[];
      argsArray: unknown[];
    };
  }

  /** A named destination of the PDF (a link's target). */
  destination(path: string, name: string): Promise<unknown> {
    return this.ask({ type: "dest", path, name });
  }

  /** The 0-based index of the page a destination's reference names. */
  async pageIndex(path: string, ref: unknown): Promise<number> {
    const index = await this.ask({ type: "pageIndex", path, ref });
    if (typeof index !== "number") throw new Error("PDF page reference unresolved");
    return index;
  }

  /** Drop one `open` of `path`; the document closes when none are left. */
  close(path: string): void {
    this.post({ type: "close", path });
  }

  /** A page's size at scale 1, in PDF points (`page` is 0-based). */
  async pageSize(path: string, page: number): Promise<{ width: number; height: number }> {
    const reply = await this.call({ type: "size", path, page });
    if (!reply.ok || reply.width === undefined || reply.height === undefined) {
      throw new Error(reply.error ?? "PDF page size unavailable");
    }
    return { width: reply.width, height: reply.height };
  }

  /**
   * Render `page` (0-based) of `path` as planned. Cancelling rejects with
   * `PdfRenderCancelled`; out of canvas memory, with `PdfCanvasUnavailable`.
   */
  render(path: string, page: number, plan: PdfWorkerPlan): PdfWorkerRender {
    const id = this.next;
    let cancelled = false;
    const promise = this.call({ type: "render", path, page, ...plan }).then((reply) => {
      if (reply.ok && reply.bitmap && !cancelled) return reply.bitmap;
      reply.bitmap?.close();
      if (cancelled || reply.cancelled) throw new PdfRenderCancelled();
      if (reply.memory) throw new PdfCanvasUnavailable();
      throw new Error(reply.error ?? "PDF render failed");
    });
    return {
      promise,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        this.post({ type: "cancel", target: id });
      },
    };
  }

  destroy(): void {
    if (this.dead) return;
    this.fail(new Error("PDF worker closed"));
  }

  private fail(error: Error): void {
    this.dead = true;
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }

  private async ask(message: object): Promise<unknown> {
    const reply = await this.call(message);
    if (!reply.ok) throw new Error(reply.error ?? "PDF worker could not answer");
    return reply.value;
  }

  private post(message: object, transfer: Transferable[] = []): number {
    const id = this.next++;
    if (!this.dead) this.worker.postMessage({ [TAG]: true, id, ...message }, transfer);
    return id;
  }

  private call(message: object, transfer: Transferable[] = []): Promise<Reply> {
    if (this.dead) return Promise.reject(new Error("PDF worker closed"));
    return new Promise<Reply>((resolve, reject) => {
      const id = this.post(message, transfer);
      this.pending.set(id, { resolve, reject });
    });
  }
}

let shared: { worker: Promise<PdfWorker | null>; users: number } | null = null;

/**
 * The one PDF worker every notebook shares, started on first use; `null` if
 * it cannot run here (render on the main thread then). Pair with
 * `releasePdfWorker`.
 */
export function acquirePdfWorker(): Promise<PdfWorker | null> {
  shared ??= { worker: PdfWorker.start(), users: 0 };
  shared.users++;
  return shared.worker;
}

/** One user is done with the shared worker; the last one stops it. */
export function releasePdfWorker(): void {
  if (!shared || --shared.users > 0) return;
  const { worker } = shared;
  shared = null;
  void worker.then((started) => started?.destroy());
}
