/**
 * The writer's worker: onnxruntime-web (WebAssembly, one thread) running a
 * writer model's graphs, one line at a time. Started by client.ts from a
 * Blob URL and bundled on its own (`worker:` imports), as the OCR worker
 * is, for the same reasons: no SharedArrayBuffer on the iPad (one thread,
 * no proxy) and no URL to fetch ORT's own files from (the binary comes as
 * bytes).
 *
 * Only glue: the model's manifest says which graphs to load and which kind
 * of model it is (`kinds.ts`); the kind does the writing.
 */

import * as ort from "onnxruntime-web/wasm";
import { type WriterKind, kindFor } from "./kinds";
import type { WriterManifest } from "./manifest";
import { ortRunner } from "./onnx-graphs";
import { WRITER_TAG, type WriterReply, type WriterRequest, type WriterResult } from "./protocol";

interface WorkerScope {
  onmessage:
    ((event: MessageEvent<{ [WRITER_TAG]: true; id: number } & WriterRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

let sessions = new Map<string, ort.InferenceSession>();
let loaded: { manifest: WriterManifest; kind: WriterKind } | null = null;
let configured = false;

async function load(request: Extract<WriterRequest, { type: "load" }>): Promise<WriterResult> {
  const t0 = performance.now();
  const found = kindFor(request.manifest);
  if ("problem" in found) throw new Error(JSON.stringify(found.problem));
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
  for (const session of sessions.values()) await session.release();
  sessions = new Map();
  loaded = null;
  for (const role of Object.keys(found.kind.graphs)) {
    const bytes = request.files.graphs[role];
    if (!bytes) throw new Error(`no file for the ${role} graph`);
    sessions.set(role, await ort.InferenceSession.create(new Uint8Array(bytes), options));
  }
  loaded = { manifest: request.manifest, kind: found.kind };
  return { type: "load", ms: Math.round(performance.now() - t0) };
}

async function write(request: Extract<WriterRequest, { type: "write" }>): Promise<WriterResult> {
  if (!loaded) throw new Error("no model loaded");
  const t0 = performance.now();
  const run = ortRunner(ort, sessions, loaded.manifest);
  const written = await loaded.kind.write(run, loaded.manifest, request.text, request.ref, {
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
    (error: unknown) =>
      done({ id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
};
