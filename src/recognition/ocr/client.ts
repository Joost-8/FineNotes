/**
 * The main thread's side of the OCR worker: starts it from the bundled
 * source (a Blob URL, as the handwriting recogniser's worker is started;
 * that is known to run on the iPad), loads the model's files into it, and
 * turns its replies into promises.
 *
 * - **One page at a time**, in order; the caller queues (view/ocr-service.ts).
 * - **Idle release.** The networks and onnxruntime's memory take a few
 *   hundred MB in the worker, so a worker unused for {@link IDLE_RELEASE_MS}
 *   is terminated; the next page starts a new one and loads the model again.
 * - A worker that stops (out of memory, a crash) or does not answer fails
 *   the page that was in it and is replaced for the next.
 */

import workerSource from "worker:./worker";
import type { OcrPage } from "./ocr-words";
import { OCR_TAG, type OcrFiles, type OcrReply, type OcrRequest, type OcrResult } from "./protocol";

/** A worker left idle this long is let go, with its models. */
export const IDLE_RELEASE_MS = 2 * 60_000;
const LOAD_TIMEOUT_MS = 120_000;
/** A page on a slow phone: far past the seconds it should take. */
const READ_TIMEOUT_MS = 5 * 60_000;

interface Pending {
  resolve: (result: OcrResult) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class OcrClient {
  private worker: Worker | null = null;
  private url = "";
  /** The model the worker holds, by key, or "" for none. */
  private loaded = "";
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private idleTimer = 0;

  /** Whether a worker is running. */
  get running(): boolean {
    return this.worker !== null;
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    this.url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const worker = new Worker(this.url);
    worker.onmessage = (event: MessageEvent<{ [OCR_TAG]?: true } & OcrReply>) => {
      const reply = event.data;
      if (!reply || reply[OCR_TAG] !== true) return;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      window.clearTimeout(waiting.timer);
      if (reply.ok) waiting.resolve(reply.result);
      else waiting.reject(new Error(reply.error));
      this.armIdle();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.stop(new Error(event.message || "the OCR worker stopped (out of memory?)"));
    };
    this.worker = worker;
    return worker;
  }

  private send(
    request: OcrRequest,
    transfer: Transferable[],
    timeoutMs: number,
  ): Promise<OcrResult> {
    window.clearTimeout(this.idleTimer);
    let worker: Worker;
    try {
      worker = this.start();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return new Promise<OcrResult>((resolve, reject) => {
      const id = this.nextId++;
      const timer = window.setTimeout(
        () => this.stop(new Error("the OCR worker did not answer")),
        timeoutMs,
      );
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ [OCR_TAG]: true, id, ...request }, transfer);
    });
  }

  /** Make sure the worker holds model `key`, reading its files with `read` if not. */
  async ensureModel(key: string, read: () => Promise<OcrFiles>): Promise<void> {
    if (this.worker && this.loaded === key) return;
    const files = await read();
    this.loaded = "";
    await this.send({ type: "load", files }, [files.det, files.rec, files.wasm], LOAD_TIMEOUT_MS);
    this.loaded = key;
  }

  /**
   * Read a page image, or one region of a page (`origin`: where its corner
   * lies on the page, points). `bitmap` is handed over (and closed by the
   * worker, or here when the worker cannot take it).
   */
  async read(
    bitmap: ImageBitmap,
    scale: number,
    pageWidth: number,
    pageHeight: number,
    origin?: { x: number; y: number },
  ): Promise<{ page: OcrPage; steps: Record<string, number> }> {
    try {
      const result = await this.send(
        { type: "read", bitmap, scale, pageWidth, pageHeight, origin },
        [bitmap],
        READ_TIMEOUT_MS,
      );
      if (result.type !== "read") throw new Error("unexpected reply");
      return { page: result.page, steps: result.steps };
    } catch (error) {
      // A transferred bitmap is already detached; closing it again is harmless.
      bitmap.close();
      throw error;
    }
  }

  private armIdle(): void {
    window.clearTimeout(this.idleTimer);
    if (this.pending.size > 0) return;
    this.idleTimer = window.setTimeout(() => {
      if (this.pending.size === 0) this.stop(null);
    }, IDLE_RELEASE_MS);
  }

  /** Terminate the worker, failing whatever waits with `error`. */
  private stop(error: Error | null): void {
    window.clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = null;
    this.loaded = "";
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) {
      window.clearTimeout(p.timer);
      p.reject(error ?? new Error("the OCR worker was released"));
    }
  }

  /** Let the worker go now (the plugin is unloading, or the model was removed). */
  dispose(): void {
    this.stop(null);
  }
}
