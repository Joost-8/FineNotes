/**
 * The OCR worker: onnxruntime-web (WebAssembly, one thread) running
 * PaddleOCR's detector and recogniser on page images. Started by client.ts
 * from a Blob URL, bundled on its own by esbuild (`worker:` imports).
 *
 * It must run where Obsidian's iPad runs it: no SharedArrayBuffer (so no
 * threads and no proxy worker) and a worker made from a Blob (so
 * onnxruntime-web cannot load its own files from a URL). It is therefore
 * handed the WebAssembly binary's bytes (`env.wasm.wasmBinary`) and the
 * JavaScript that goes with it is bundled in (`onnxruntime-web/wasm`).
 *
 * This file only glues ORT to the pure pipeline (pipeline.ts). No DOM and no
 * Obsidian: only the worker's own `self`.
 */

import * as ort from "onnxruntime-web/wasm";
import { type OcrBackend, readPage } from "./pipeline";
import { OCR_TAG, type OcrReply, type OcrRequest, type OcrResult } from "./protocol";
import { REC_HEIGHT, alphabetFrom } from "./rec";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ [OCR_TAG]: true; id: number } & OcrRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

let det: ort.InferenceSession | null = null;
let rec: ort.InferenceSession | null = null;
let alphabet: string[] = [];
let configured = false;
let confidence: { wordMean: number; lineMean: number; wordMin: number } | undefined;

const backend: OcrBackend = {
  async detect(tensor, width, height) {
    if (!det) throw new Error("no model loaded");
    const input = new ort.Tensor("float32", tensor, [1, 3, height, width]);
    const out = await det.run({ [det.inputNames[0]]: input });
    const result = out[det.outputNames[0]];
    // Copied out so the session's buffer can go.
    const prob = Float32Array.from(result.data as Float32Array);
    result.dispose();
    return prob;
  },
  async recognize(data, n, width) {
    if (!rec) throw new Error("no model loaded");
    const input = new ort.Tensor("float32", data, [n, 3, REC_HEIGHT, width]);
    const out = await rec.run({ [rec.inputNames[0]]: input });
    const result = out[rec.outputNames[0]];
    const [, steps, classes] = result.dims;
    const probs = Float32Array.from(result.data as Float32Array);
    result.dispose();
    return { probs, steps, classes };
  },
};

async function load(request: Extract<OcrRequest, { type: "load" }>): Promise<OcrResult> {
  const { files } = request;
  confidence = request.confidence;
  const t0 = performance.now();
  if (!configured) {
    configured = true;
    // One thread and no proxy worker (neither works here), and the binary
    // from the downloaded file: ORT is never left to fetch anything.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = new Uint8Array(files.wasm);
  }
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    // Pages differ in size: no arena holding the largest one for good.
    enableCpuMemArena: false,
    enableMemPattern: false,
    graphOptimizationLevel: "all",
  };
  await det?.release();
  await rec?.release();
  det = null;
  rec = null;
  det = await ort.InferenceSession.create(new Uint8Array(files.det), options);
  rec = await ort.InferenceSession.create(new Uint8Array(files.rec), options);
  alphabet = alphabetFrom(files.dict);
  return { type: "load", ms: Math.round(performance.now() - t0) };
}

/** The bitmap's pixels (it is closed): an OffscreenCanvas is the one way to get them here. */
function pixels(bitmap: ImageBitmap): { data: Uint8ClampedArray; width: number; height: number } {
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("no canvas memory");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = context.getImageData(0, 0, width, height).data;
  canvas.width = canvas.height = 0;
  return { data, width, height };
}

async function read(request: Extract<OcrRequest, { type: "read" }>): Promise<OcrResult> {
  if (!det || !rec) {
    request.bitmap.close();
    throw new Error("no model loaded");
  }
  const image = pixels(request.bitmap);
  const steps: Record<string, number> = {};
  const page = await readPage(image, backend, {
    scale: request.scale,
    pageWidth: request.pageWidth,
    pageHeight: request.pageHeight,
    origin: request.origin,
    alphabet,
    confidence,
    onStep: (step, ms) => {
      steps[step] = ms;
    },
  });
  return { type: "read", page, steps };
}

scope.onmessage = (event) => {
  const message = event.data;
  if (!message || message[OCR_TAG] !== true) return;
  const { id } = message;
  const done = (reply: OcrReply): void => scope.postMessage({ [OCR_TAG]: true, ...reply });
  const run = message.type === "load" ? load(message) : read(message);
  run.then(
    (result) => done({ id, ok: true, result }),
    (error: unknown) =>
      done({ id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
};
