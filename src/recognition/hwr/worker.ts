/**
 * The recogniser's Web Worker: holds the parsed model and reads ink off the
 * main thread (on iPadOS before 18.2 a main-thread stall during a stroke is
 * lost ink; ledger 2026-10-01). esbuild bundles this file into a string
 * (`worker:` imports, esbuild.config.mjs) and client.ts starts it from a
 * Blob URL, as the PDF worker is started.
 *
 * No DOM and no Obsidian: only the worker's own `self`.
 */

import { simdAvailable } from "./blstm";
import { type HwrBundle, parseBundle } from "./bundle";
import { HWR_TAG, type HwrReply, type HwrRequest, type HwrResult } from "./protocol";
import { readLine, readPage } from "./recognizer";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ [HWR_TAG]: true; id: number } & HwrRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
let bundle: HwrBundle | null = null;
const now = (): number => performance.now();

function handle(request: HwrRequest): HwrResult {
  if (request.type === "load") {
    const t0 = now();
    bundle = parseBundle(request.bytes);
    // Lays the weights out in the kernels' memory now, not on the first read.
    const simd = simdAvailable(bundle.net);
    const { meta } = bundle;
    return {
      type: "load",
      info: {
        name: meta.name,
        licence: meta.licence,
        layers: meta.net.layers,
        hidden: meta.net.hidden,
        characters: meta.alphabet.length,
        lmContexts: meta.lm?.nodes ?? 0,
        parseMs: now() - t0,
        simd,
      },
    };
  }
  if (!bundle) throw new Error("no model loaded");
  if (request.type === "page") {
    return {
      type: "page",
      reading: readPage(bundle, request.strokes, { useLm: request.useLm, now }),
    };
  }
  const model = bundle;
  return {
    type: "lines",
    readings: request.lines.map((line) => readLine(model, line, { useLm: request.useLm, now })),
  };
}

scope.onmessage = (event) => {
  const message = event.data;
  if (!message || message[HWR_TAG] !== true) return;
  let reply: HwrReply;
  try {
    reply = { id: message.id, ok: true, result: handle(message) };
  } catch (error) {
    reply = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  scope.postMessage({ [HWR_TAG]: true, ...reply });
};
