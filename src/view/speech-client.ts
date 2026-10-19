/**
 * The main thread's side of the on-device speech recognizer: starts its
 * worker from the downloaded whisper.cpp runtime plus the bundled worker
 * code (one Blob, as the handwriting recognizer's worker is started), and
 * turns replies into promises.
 *
 * - **Cancel** terminates the worker: a window being read cannot be
 *   interrupted any other way. The next job starts a new one.
 * - **Idle release.** The model takes a few hundred MB in the worker, so a
 *   worker unused for `IDLE_RELEASE_MS` is terminated; the next job loads
 *   the model again (a second or so).
 */

import workerSource from "worker:../audio/speech-worker";
import {
  SpeechCancelled,
  SPEECH_TAG,
  type SpeechProgress,
  type SpeechReply,
  type SpeechRequest,
  type SpeechResult,
} from "../audio/speech-protocol";
import type { SpeechSegment } from "../audio/speech-chunks";

/** A worker left idle this long is let go, with its model. */
export const IDLE_RELEASE_MS = 2 * 60_000;
const LOAD_TIMEOUT_MS = 120_000;

interface Pending {
  resolve: (result: SpeechResult) => void;
  reject: (error: Error) => void;
  timer: number;
  onProgress?: (progress: SpeechProgress) => void;
}

export class SpeechClient {
  private worker: Worker | null = null;
  private url = "";
  /** The model the worker holds, by key (model id), or "" for none. */
  private loaded = "";
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private idleTimer = 0;

  /** `runtime` gives the whisper.cpp runtime's source (read from the model's folder). */
  constructor(private readonly runtime: () => Promise<string>) {}

  /** Whether a worker is running (with a model loaded or loading). */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  private async start(): Promise<Worker> {
    if (this.worker) return this.worker;
    const source = await this.runtime();
    this.url = URL.createObjectURL(
      new Blob([source, "\n;\n", workerSource], { type: "text/javascript" }),
    );
    const worker = new Worker(this.url);
    worker.onmessage = (event: MessageEvent<{ [SPEECH_TAG]?: true } & SpeechReply>) => {
      const reply = event.data;
      if (!reply || reply[SPEECH_TAG] !== true) return;
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
      this.armIdle();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.stop(new Error(event.message || "the speech recognizer stopped (out of memory?)"));
    };
    this.worker = worker;
    return worker;
  }

  private send(
    request: SpeechRequest,
    transfer: Transferable[],
    timeoutMs: number,
    onProgress?: (progress: SpeechProgress) => void,
  ): Promise<SpeechResult> {
    window.clearTimeout(this.idleTimer);
    return this.start().then(
      (worker) =>
        new Promise<SpeechResult>((resolve, reject) => {
          const id = this.nextId++;
          const timer =
            timeoutMs > 0
              ? window.setTimeout(
                  () => this.stop(new Error("the speech recognizer did not answer")),
                  timeoutMs,
                )
              : 0;
          this.pending.set(id, { resolve, reject, timer, onProgress });
          worker.postMessage({ [SPEECH_TAG]: true, id, ...request }, transfer);
        }),
    );
  }

  /** Make sure the worker holds model `key`, loading its bytes with `read` if not. */
  async ensureModel(key: string, read: () => Promise<ArrayBuffer>): Promise<void> {
    if (this.worker && this.loaded === key) return;
    const model = await read();
    this.loaded = "";
    await this.send({ type: "load", model }, [model], LOAD_TIMEOUT_MS);
    this.loaded = key;
  }

  /** Transcribe 16 kHz mono samples (they are handed over to the worker). */
  async transcribe(
    samples: Float32Array,
    language: string,
    onProgress: (progress: SpeechProgress) => void,
  ): Promise<{ segments: SpeechSegment[]; language: string }> {
    const result = await this.send(
      { type: "transcribe", samples, language },
      [samples.buffer],
      0,
      onProgress,
    );
    if (result.type !== "transcribe") throw new Error("unexpected reply");
    return { segments: result.segments, language: result.language };
  }

  /** Stop what runs now; its promise rejects with {@link SpeechCancelled}. */
  cancel(): void {
    this.stop(new SpeechCancelled());
  }

  private armIdle(): void {
    window.clearTimeout(this.idleTimer);
    if (this.pending.size > 0) return;
    this.idleTimer = window.setTimeout(() => {
      if (this.pending.size === 0) this.stop(null);
    }, IDLE_RELEASE_MS);
  }

  /** Terminate the worker, rejecting whatever waits with `error`. */
  private stop(error: Error | null): void {
    window.clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = null;
    this.loaded = "";
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiting) {
      window.clearTimeout(w.timer);
      w.reject(error ?? new SpeechCancelled());
    }
  }

  dispose(): void {
    this.stop(null);
  }
}
