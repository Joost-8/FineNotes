/**
 * The main thread's side of Home's read worker (read-worker.ts): starts it
 * from the bundled source and turns its replies into promises. A request
 * that gets no answer in time stops the worker, and every later read falls
 * back to the main thread (library-pages.ts), so Home never waits for good.
 */

import workerSource from "worker:./read-worker";
import type { LibraryEntry } from "../model/library";
import type { Page } from "../model/document";
import type { IndexedPage } from "../search/library-search";
import { READ_TAG, type ReadReply, type ReadRequest } from "./read-protocol";

/** How long one read may take before the worker is given up on, ms. */
const READ_TIMEOUT_MS = 30_000;

export interface ReadResult {
  count: number;
  pages: Map<number, Page>;
  entry?: LibraryEntry;
  searchText?: IndexedPage[];
}

interface Pending {
  resolve: (reply: ReadReply) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class ReadWorkerClient {
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /** The key the worker holds, as far as this side knows: its text need not be sent again. */
  private holds: string | null = null;
  failed = false;

  constructor() {
    this.url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    this.worker = new Worker(this.url);
    this.worker.onmessage = (event: MessageEvent<{ [READ_TAG]?: true } & ReadReply>) => {
      const reply = event.data;
      if (!reply || reply[READ_TAG] !== true) return;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      window.clearTimeout(waiting.timer);
      waiting.resolve(reply);
    };
    this.worker.onerror = () => this.stop();
  }

  private ask(request: Omit<ReadRequest, "id">): Promise<ReadReply> {
    if (this.failed) return Promise.reject(new Error("the read worker stopped"));
    const id = this.nextId++;
    return new Promise<ReadReply>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.stop();
        reject(new Error("the read worker did not answer"));
      }, READ_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ [READ_TAG]: true, id, ...request });
    });
  }

  /**
   * The pages `want` of the notebook at `key` (and its Home facts with
   * `facts`). `text` is asked for only when the worker does not hold `key`.
   */
  async read(
    key: string,
    text: () => Promise<string>,
    want: number[],
    facts?: { path: string; edited: number },
    searchText = false,
  ): Promise<ReadResult> {
    const also = searchText ? { searchText: true as const } : {};
    let reply =
      this.holds === key
        ? await this.ask({ key, want, facts, ...also })
        : await this.ask({ key, text: await text(), want, facts, ...also });
    if (!reply.ok && reply.needText === true)
      reply = await this.ask({ key, text: await text(), want, facts, ...also });
    if (!reply.ok) throw new Error(reply.needText === true ? "no text" : reply.error);
    this.holds = key;
    return {
      count: reply.count,
      pages: new Map(reply.pages),
      ...(reply.entry ? { entry: reply.entry } : {}),
      ...(reply.searchText ? { searchText: reply.searchText } : {}),
    };
  }

  stop(): void {
    if (this.failed) return;
    this.failed = true;
    for (const waiting of this.pending.values()) {
      window.clearTimeout(waiting.timer);
      waiting.reject(new Error("the read worker stopped"));
    }
    this.pending.clear();
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}
