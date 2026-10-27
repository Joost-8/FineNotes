/**
 * The main thread's side of the recogniser's worker: starts it from the
 * bundled source (a Blob URL, as pdf-worker.ts does; that is known to run on
 * the iPad), and turns its replies into promises. Every request is bounded
 * by a timeout, so a worker that never answers cannot hang the caller.
 */

import workerSource from "worker:./worker";
import type { InkStroke } from "./features";
import type { PageInk } from "./lines";
import {
  HWR_TAG,
  type HwrModelInfo,
  type HwrProgress,
  type HwrReply,
  type HwrRequest,
  type HwrResult,
  type HwrTuned,
  type SuggestItem,
  type SuggestResult,
} from "./protocol";
import type { LabelledLine } from "./tune";
import type { LineReading, PageReading } from "./recognizer";

/** Parsing a file is fast; a page of 30 lines on a slow device is not. */
const LOAD_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 180_000;
/** A tuning run on a slow device: well past the minutes it should take. */
const TUNE_TIMEOUT_MS = 60 * 60_000;

interface Pending {
  resolve: (result: HwrResult) => void;
  reject: (error: Error) => void;
  timer: number;
  onProgress?: (progress: HwrProgress) => void;
}

export class HwrWorkerClient {
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private failure: Error | null = null;

  constructor() {
    this.url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    this.worker = new Worker(this.url);
    this.worker.onmessage = (event: MessageEvent<{ [HWR_TAG]?: true } & HwrReply>) => {
      const reply = event.data;
      if (!reply || reply[HWR_TAG] !== true) return;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      if ("progress" in reply) {
        waiting.onProgress?.(reply.progress);
        return;
      }
      this.pending.delete(reply.id);
      window.clearTimeout(waiting.timer);
      if (reply.ok) waiting.resolve(reply.result);
      else waiting.reject(new Error(reply.error));
    };
    this.worker.onerror = (event) => {
      this.fail(new Error(event.message || "the recogniser's worker stopped"));
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

  private send(
    request: HwrRequest,
    timeoutMs: number,
    transfer: Transferable[] = [],
    onProgress?: (progress: HwrProgress) => void,
  ): Promise<HwrResult> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise<HwrResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the recogniser did not answer within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, onProgress });
      this.worker.postMessage({ [HWR_TAG]: true, id, ...request }, transfer);
    });
  }

  /** Parse a recogniser file in the worker. `bytes` is transferred: do not reuse it. */
  async load(bytes: ArrayBuffer): Promise<HwrModelInfo> {
    const result = await this.send({ type: "load", bytes }, LOAD_TIMEOUT_MS, [bytes]);
    if (result.type !== "load") throw new Error("unexpected reply");
    return result.info;
  }

  /** Find the page's lines and read them; `keep` for `suggest` afterwards. */
  async readPage(strokes: PageInk[], useLm = true, keep = false): Promise<PageReading> {
    const result = await this.send({ type: "page", strokes, useLm, keep }, READ_TIMEOUT_MS);
    if (result.type !== "page") throw new Error("unexpected reply");
    return result.reading;
  }

  /** Give the worker the word list to suggest from. */
  async setLexicon(words: string[]): Promise<number> {
    const result = await this.send({ type: "lexicon", words }, LOAD_TIMEOUT_MS);
    if (result.type !== "lexicon") throw new Error("unexpected reply");
    return result.size;
  }

  /**
   * List words for words of a page read with `keep` (its `PageReading.id`);
   * null when the worker no longer keeps that page.
   */
  async suggest(reading: number, items: SuggestItem[]): Promise<SuggestResult[] | null> {
    const result = await this.send({ type: "suggest", reading, items }, READ_TIMEOUT_MS);
    if (result.type !== "suggest") throw new Error("unexpected reply");
    return result.results;
  }

  /** Read lines given as strokes. */
  async readLines(lines: InkStroke[][], useLm = true): Promise<LineReading[]> {
    const result = await this.send({ type: "lines", lines, useLm }, READ_TIMEOUT_MS);
    if (result.type !== "lines") throw new Error("unexpected reply");
    return result.readings;
  }

  /**
   * Learn a writer's handwriting from `lines`, starting from the model in
   * `bytes` (transferred); `rival`, the learned model in use, must be beaten
   * too. Null when there was nothing to learn from.
   */
  async tune(
    bytes: ArrayBuffer,
    lines: LabelledLine[],
    steps: number,
    name: string,
    onProgress: (progress: HwrProgress) => void,
    rival?: ArrayBuffer,
  ): Promise<HwrTuned | null> {
    const result = await this.send(
      { type: "tune", bytes, lines, steps, name, rival },
      TUNE_TIMEOUT_MS,
      rival ? [bytes, rival] : [bytes],
      onProgress,
    );
    if (result.type !== "tune") throw new Error("unexpected reply");
    return result.tuned;
  }

  terminate(): void {
    this.fail(new Error("the recogniser was stopped"));
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}
