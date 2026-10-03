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

/** Tags this module's messages: pdf.js's own worker code posts on the same port. */
const TAG = "fineNotesPdf";
/** Starting the worker and loading pdf.js into it; past this it counts as unavailable. */
const START_TIMEOUT_MS = 15_000;

/** What to draw: pdf.js's viewport scale, the bitmap's size, and an optional offset. */
export interface PdfWorkerPlan {
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

const WORKER_SOURCE = `
self.activeWindow = self;
const TAG = ${JSON.stringify(TAG)};
let lib = null;
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
      reply(id, { ok: true });
    } else if (m.type === "open") {
      let open = docs.get(m.path);
      if (!open) {
        open = { users: 0, promise: lib.getDocument({ data: m.bytes, ownerDocument }).promise };
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
      const task = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        ...(m.transform ? { transform: m.transform } : {}),
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
  error?: string;
  pages?: number;
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
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

export class PdfWorker {
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
      const ready = started.call({ type: "init", base: pdfJsBase() });
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

  /** Render `page` (0-based) of `path` as planned. Cancelling rejects with `PdfRenderCancelled`. */
  render(path: string, page: number, plan: PdfWorkerPlan): PdfWorkerRender {
    const id = this.next;
    let cancelled = false;
    const promise = this.call({ type: "render", path, page, ...plan }).then((reply) => {
      if (reply.ok && reply.bitmap && !cancelled) return reply.bitmap;
      reply.bitmap?.close();
      if (cancelled || reply.cancelled) throw new PdfRenderCancelled();
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
