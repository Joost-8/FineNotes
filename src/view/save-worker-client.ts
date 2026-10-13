/**
 * The main thread's side of a view's save worker: starts it from the bundled
 * source (a Blob URL, as the recogniser's client does; that is known to run
 * on the iPad) and turns its replies into promises. Every compression is
 * bounded by a timeout, so a worker that never answers cannot hold a save
 * back for good: the caller falls back to saving on the main thread.
 */

import workerSource from "worker:./save-worker";
import type { CompressPort } from "./background-save";
import { SAVE_TAG, type SaveReply, type SaveRequest } from "./save-protocol";

interface Pending {
  resolve: (payload: string) => void;
  reject: (error: Error) => void;
  timer: number;
}

class SaveWorkerClient implements CompressPort {
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private failure: Error | null = null;

  constructor() {
    this.url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    this.worker = new Worker(this.url);
    this.worker.onmessage = (event: MessageEvent<{ [SAVE_TAG]?: true } & SaveReply>) => {
      const reply = event.data;
      if (!reply || reply[SAVE_TAG] !== true) return;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      window.clearTimeout(waiting.timer);
      if (reply.ok) waiting.resolve(reply.payload);
      else waiting.reject(new Error(reply.error));
    };
    this.worker.onerror = (event) => {
      this.fail(new Error(event.message || "the save worker stopped"));
    };
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const waiting of this.pending.values()) {
      window.clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  private post(request: SaveRequest): void {
    this.worker.postMessage({ [SAVE_TAG]: true, ...request });
  }

  put(slots: readonly number[], jsons: readonly string[]): void {
    if (!this.failure) this.post({ type: "put", slots: [...slots], jsons: [...jsons] });
  }

  compress(head: string, slots: readonly number[], timeoutMs: number): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.fail(
          new Error(`the save worker did not answer within ${Math.round(timeoutMs / 1000)} s`),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.post({ type: "compress", id, head, slots: [...slots] });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    this.fail(new Error("the save worker was stopped"));
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}

/** A save worker, or null where workers cannot start (the caller then saves on the main thread). */
export function startSaveWorker(): CompressPort | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined") return null;
  try {
    return new SaveWorkerClient();
  } catch {
    return null;
  }
}
