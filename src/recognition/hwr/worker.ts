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
import { type LineLogp, Lexicon, suggest } from "./lexicon";
import { HWR_TAG, type HwrReply, type HwrRequest, type HwrResult } from "./protocol";
import { readLine, readPage } from "./recognizer";
import { writeBundle } from "./bundle-write";
import { tune } from "./tune";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ [HWR_TAG]: true; id: number } & HwrRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
let bundle: HwrBundle | null = null;
const now = (): number => performance.now();
let lexicon: Lexicon | null = null;
/** The log-probabilities of the last pages read with `keep`, by reading id. */
const kept = new Map<number, LineLogp[]>();
/** Pages kept: the one just checked, and the one before (a few MB each). */
const KEEP_PAGES = 2;
let nextReading = 1;

function handle(request: HwrRequest, id: number): HwrResult {
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
  if (request.type === "tune") {
    const base = new Uint8Array(request.bytes);
    // Chromium says how much memory the device has; WebKit does not (tuneRoom).
    const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
    const options = { steps: request.steps, deviceMemory };
    const result = tune(base, request.lines, options, (step, loss) => {
      scope.postMessage({ [HWR_TAG]: true, id, progress: { step, steps: request.steps, loss } });
    });
    if (!result) return { type: "tune", tuned: null };
    const bytes = writeBundle(base, result.net, { name: request.name });
    return {
      type: "tune",
      tuned: {
        bytes: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        before: result.before,
        after: result.after,
        better: result.better,
        trained: result.trained,
        heldOut: result.heldOut,
      },
    };
  }
  if (request.type === "lexicon") {
    lexicon = new Lexicon(request.words);
    return { type: "lexicon", size: lexicon.size };
  }
  if (!bundle) throw new Error("no model loaded");
  if (request.type === "page") {
    if (!request.keep) {
      return {
        type: "page",
        reading: readPage(bundle, request.strokes, { useLm: request.useLm, now }),
      };
    }
    const lines: LineLogp[] = [];
    const reading = readPage(bundle, request.strokes, {
      useLm: request.useLm,
      now,
      logp: (line, logp, frames) => (lines[line] = { logp, frames }),
    });
    const readingId = nextReading++;
    kept.set(readingId, lines);
    for (const old of kept.keys()) if (kept.size > KEEP_PAGES) kept.delete(old);
    return { type: "page", reading: { ...reading, id: readingId } };
  }
  if (request.type === "suggest") {
    const lines = kept.get(request.reading);
    const list = lexicon;
    const model = bundle;
    const alpha = model.meta.decoder.alpha;
    if (!lines) return { type: "suggest", results: null };
    return {
      type: "suggest",
      results: request.items.map((item) => {
        const line = lines[item.line];
        if (!line || !list) return null;
        const t0 = now();
        const found = suggest(line, model.meta.alphabet, model.lm, alpha, item, list);
        return found && { ...found, ms: now() - t0 };
      }),
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
    reply = { id: message.id, ok: true, result: handle(message, message.id) };
  } catch (error) {
    reply = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  scope.postMessage({ [HWR_TAG]: true, ...reply });
};
