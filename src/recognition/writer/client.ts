/**
 * The main thread's side of the writer's worker: starts it from the bundled
 * source (a Blob URL, as the OCR's and the recogniser's workers are), loads
 * the model's files into it, and turns its replies into promises.
 *
 * - **One line at a time**: the caller awaits each `write`.
 * - **Idle release**: the graphs and onnxruntime's memory (about 48 MB on
 *   the iPad with int8 weights) go with a worker unused for
 *   {@link IDLE_RELEASE_MS}, as the OCR's do.
 * - A worker that stops (out of memory, a crash) or does not answer fails
 *   what was in it and is replaced for the next.
 */

import workerSource from "worker:./worker";
import {
  WRITER_TAG,
  type WriterFiles,
  type WriterReply,
  type WriterRequest,
  type WriterResult,
} from "./protocol";
import type { Reference } from "./rows";
import type { WriterMeta, Written } from "./sampler";

/** A worker left idle this long is let go, with its model (as the OCR's). */
export const IDLE_RELEASE_MS = 2 * 60_000;
const LOAD_TIMEOUT_MS = 120_000;
/** One try of a line on a slow tablet: far past the second it should take. */
const WRITE_TIMEOUT_MS = 60_000;

interface Pending {
  resolve: (result: WriterResult) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class WriterClient {
  private worker: Worker | null = null;
  private url = "";
  private loaded = "";
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private idleTimer = 0;

  /** Whether a worker is running (and holding the model). */
  get running(): boolean {
    return this.worker !== null;
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    this.url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const worker = new Worker(this.url);
    worker.onmessage = (event: MessageEvent<{ [WRITER_TAG]?: true } & WriterReply>) => {
      const reply = event.data;
      if (!reply || reply[WRITER_TAG] !== true) return;
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
      this.stop(new Error(event.message || "the writer's worker stopped (out of memory?)"));
    };
    this.worker = worker;
    return worker;
  }

  private send(
    request: WriterRequest,
    transfer: Transferable[],
    timeoutMs: number,
  ): Promise<WriterResult> {
    window.clearTimeout(this.idleTimer);
    let worker: Worker;
    try {
      worker = this.start();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return new Promise<WriterResult>((resolve, reject) => {
      const id = this.nextId++;
      const timer = window.setTimeout(
        () => this.stop(new Error("the writer's worker did not answer")),
        timeoutMs,
      );
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ ...request, [WRITER_TAG]: true, id }, transfer);
    });
  }

  /** Make sure the worker holds model `key`, reading its files with `read` if not. */
  async ensureModel(
    key: string,
    read: () => Promise<{ files: WriterFiles; meta: WriterMeta }>,
  ): Promise<void> {
    if (this.worker && this.loaded === key) return;
    const { files, meta } = await read();
    this.loaded = "";
    await this.send(
      { type: "load", files, meta },
      [files.encode, files.durations, files.velocity, files.wasm],
      LOAD_TIMEOUT_MS,
    );
    this.loaded = key;
  }

  /** One try of a line. The reference is copied, not handed over: the caller writes it again. */
  async write(
    text: string,
    ref: Reference,
    seed: number,
    id: number,
    low: ReadonlySet<number>,
  ): Promise<Written> {
    const result = await this.send(
      { type: "write", text, ref, seed, line: id, low: [...low] },
      [],
      WRITE_TIMEOUT_MS,
    );
    if (result.type !== "write") throw new Error("unexpected reply");
    return result.written;
  }

  private armIdle(): void {
    window.clearTimeout(this.idleTimer);
    if (this.pending.size > 0) return;
    this.idleTimer = window.setTimeout(() => {
      if (this.pending.size === 0) this.stop(null);
    }, IDLE_RELEASE_MS);
  }

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
      p.reject(error ?? new Error("the writer's worker was released"));
    }
  }

  /** Let the worker go now (the plugin is unloading, or the OCR needs the memory). */
  dispose(): void {
    this.stop(null);
  }
}
