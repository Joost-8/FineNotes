/**
 * The writer's worker: onnxruntime-web (WebAssembly, one thread) running
 * the handwriting model's three graphs, one line at a time. Started by
 * client.ts from a Blob URL and bundled on its own (`worker:` imports), as
 * the OCR worker is, for the same reasons: no SharedArrayBuffer on the iPad
 * (one thread, no proxy) and no URL to fetch ORT's own files from (the
 * binary comes as bytes).
 *
 * Only glue: the sampling is sampler.ts, the graphs' inputs onnx-graphs.ts.
 */

import * as ort from "onnxruntime-web/wasm";
import { type OrtEncoded, ortGraphs } from "./onnx-graphs";
import { WRITER_TAG, type WriterReply, type WriterRequest, type WriterResult } from "./protocol";
import { type Graphs, type WriterMeta, writeLine } from "./sampler";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ [WRITER_TAG]: true; id: number } & WriterRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

let sessions: { encode: ort.InferenceSession; durations: ort.InferenceSession; velocity: ort.InferenceSession } | null = null;
let graphs: Graphs<OrtEncoded> | null = null;
let meta: WriterMeta | null = null;
let configured = false;

async function load(request: Extract<WriterRequest, { type: "load" }>): Promise<WriterResult> {
  const t0 = performance.now();
  if (!configured) {
    configured = true;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = new Uint8Array(request.files.wasm);
  }
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    // Lines differ in length: no arena holding the longest one for good.
    enableCpuMemArena: false,
    enableMemPattern: false,
    graphOptimizationLevel: "all",
  };
  if (sessions) {
    await sessions.encode.release();
    await sessions.durations.release();
    await sessions.velocity.release();
  }
  sessions = null;
  graphs = null;
  const encode = await ort.InferenceSession.create(new Uint8Array(request.files.encode), options);
  const durations = await ort.InferenceSession.create(new Uint8Array(request.files.durations), options);
  const velocity = await ort.InferenceSession.create(new Uint8Array(request.files.velocity), options);
  sessions = { encode, durations, velocity };
  graphs = ortGraphs(ort, sessions);
  meta = request.meta;
  return { type: "load", ms: Math.round(performance.now() - t0) };
}

async function write(request: Extract<WriterRequest, { type: "write" }>): Promise<WriterResult> {
  if (!graphs || !meta) throw new Error("no model loaded");
  const t0 = performance.now();
  const written = await writeLine(graphs, meta, request.text, request.ref, {
    seed: request.seed,
    id: request.line,
    low: new Set(request.low),
  });
  return { type: "write", written, ms: Math.round(performance.now() - t0) };
}

scope.onmessage = (event) => {
  const message = event.data;
  if (!message || message[WRITER_TAG] !== true) return;
  const { id } = message;
  const done = (reply: WriterReply, transfer: Transferable[] = []): void =>
    scope.postMessage({ [WRITER_TAG]: true, ...reply }, transfer);
  const run = message.type === "load" ? load(message) : write(message);
  run.then(
    (result) =>
      done(
        { id, ok: true, result },
        result.type === "write" ? [result.written.x.buffer, result.written.char.buffer] : [],
      ),
    (error: unknown) => done({ id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
};
