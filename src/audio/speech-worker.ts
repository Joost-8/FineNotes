/**
 * The on-device speech recognizer's Web Worker. view/speech-client.ts starts
 * it from a Blob holding the downloaded whisper.cpp runtime (which defines
 * `createWhisper`) followed by this file, bundled on its own by esbuild
 * (`worker:` imports, esbuild.config.mjs).
 *
 * It holds one model, cuts each recording into windows (speech-chunks.ts),
 * runs them one after another and merges the answers. Nothing else can run
 * while a window is read, so a cancel is the client terminating the worker.
 *
 * No DOM and no Obsidian: only the worker's own `self`.
 */

import {
  type SpeechSegment,
  type WindowResult,
  SPEECH_RATE,
  cutPoints,
  mergeSegments,
  overallPercent,
  planWindows,
  promptBefore,
} from "./speech-chunks";
import {
  SPEECH_TAG,
  type SpeechReply,
  type SpeechRequest,
  type SpeechResult,
} from "./speech-protocol";

/** What the runtime's module offers (scripts/whisper-runtime/fn_whisper.c). */
interface WhisperModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  onProgress?: (percent: number) => void;
  UTF8ToString(ptr: number): string;
  stringToUTF8(text: string, ptr: number, max: number): void;
  lengthBytesUTF8(text: string): number;
  _fn_configure(flash: number, fallback: number): void;
  _fn_malloc(bytes: number): number;
  _fn_free(ptr: number): void;
  _fn_init(ptr: number, bytes: number): number;
  _fn_release(ctx: number): void;
  _fn_is_multilingual(ctx: number): number;
  _fn_transcribe(
    ctx: number,
    samples: number,
    n: number,
    language: number,
    prompt: number,
    translate: number,
  ): number;
  _fn_language(ctx: number): number;
  _fn_segment_text(ctx: number, i: number): number;
  _fn_segment_t0(ctx: number, i: number): number;
  _fn_segment_t1(ctx: number, i: number): number;
}

declare const createWhisper: (options: {
  onProgress?: (percent: number) => void;
}) => Promise<WhisperModule>;

interface WorkerScope {
  onmessage:
    ((event: MessageEvent<{ [SPEECH_TAG]: true; id: number } & SpeechRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
let runtime: WhisperModule | null = null;
let ctx = 0;
let multilingual = false;
let onWindowProgress: (percent: number) => void = () => {};

async function load(model: ArrayBuffer): Promise<SpeechResult> {
  const t0 = performance.now();
  runtime ??= await createWhisper({ onProgress: (percent) => onWindowProgress(percent) });
  const M = runtime;
  if (ctx) {
    M._fn_release(ctx);
    ctx = 0;
  }
  const bytes = new Uint8Array(model);
  const ptr = M._fn_malloc(bytes.length);
  if (!ptr) throw new Error("not enough memory for the model");
  M.HEAPU8.set(bytes, ptr);
  ctx = M._fn_init(ptr, bytes.length);
  M._fn_free(ptr);
  if (!ctx) throw new Error("the model file could not be read");
  multilingual = M._fn_is_multilingual(ctx) === 1;
  return { type: "load", multilingual, loadMs: Math.round(performance.now() - t0) };
}

/** A string in the module's heap; free it with `_fn_free`. */
function cString(M: WhisperModule, text: string): number {
  const size = M.lengthBytesUTF8(text) + 1;
  const ptr = M._fn_malloc(size);
  M.stringToUTF8(text, ptr, size);
  return ptr;
}

function transcribe(samples: Float32Array, language: string, id: number): SpeechResult {
  const M = runtime;
  if (!M || !ctx) throw new Error("no model loaded");
  const t0 = performance.now();
  const lang = multilingual ? language : "en";
  const windows = planWindows(samples.length, cutPoints(samples));
  const results: WindowResult[] = [];
  const spoken: SpeechSegment[] = [];
  let detected = lang;
  let langPtr = cString(M, lang);
  try {
    for (const [done, window] of windows.entries()) {
      let last = -1;
      onWindowProgress = (percent) => {
        const overall = overallPercent(windows, done, percent);
        if (overall === last) return;
        last = overall;
        scope.postMessage({
          [SPEECH_TAG]: true,
          id,
          progress: { percent: overall, done, windows: windows.length },
        });
      };
      onWindowProgress(0);
      const slice = samples.subarray(window.from, window.to);
      const pcm = M._fn_malloc(slice.length * 4);
      if (!pcm) throw new Error("not enough memory for the audio");
      const promptPtr = cString(M, promptBefore(spoken));
      let n = -1;
      try {
        M.HEAPF32.set(slice, pcm >> 2);
        n = M._fn_transcribe(ctx, pcm, slice.length, langPtr, promptPtr, 0);
      } finally {
        M._fn_free(pcm);
        M._fn_free(promptPtr);
      }
      if (n < 0)
        throw new Error(`the recognizer failed at ${Math.round(window.from / SPEECH_RATE)} s`);
      const segments: SpeechSegment[] = [];
      for (let i = 0; i < n; i++) {
        segments.push({
          // Centiseconds from the window's start.
          start: M._fn_segment_t0(ctx, i) * 10,
          end: M._fn_segment_t1(ctx, i) * 10,
          text: M.UTF8ToString(M._fn_segment_text(ctx, i)),
        });
      }
      if (lang === "auto" && done === 0) {
        // Keep the first window's language: detecting it again per window
        // can switch languages halfway through a recording.
        detected = M.UTF8ToString(M._fn_language(ctx));
        M._fn_free(langPtr);
        langPtr = cString(M, detected);
      }
      const result = { window, segments };
      results.push(result);
      spoken.push(...mergeSegments([result]));
    }
  } finally {
    M._fn_free(langPtr);
    onWindowProgress = () => {};
  }
  return {
    type: "transcribe",
    segments: mergeSegments(results),
    language: detected,
    runMs: Math.round(performance.now() - t0),
  };
}

scope.onmessage = (event) => {
  const message = event.data;
  if (!message || message[SPEECH_TAG] !== true) return;
  const { id } = message;
  const reply = (body: Omit<SpeechReply, "id">): void =>
    scope.postMessage({ [SPEECH_TAG]: true, id, ...body });
  void (async () => {
    try {
      const result =
        message.type === "load"
          ? await load(message.model)
          : transcribe(message.samples, message.language, id);
      reply({ ok: true, result });
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
};
