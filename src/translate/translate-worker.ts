/**
 * The translation Web Worker. view/translator.ts starts it from a Blob
 * holding Mozilla's two Emscripten glue files (src/translate/vendor:
 * `loadBergamot`, `loadFastTextModule`) followed by this file, bundled on
 * its own by esbuild (`worker:` imports, esbuild.config.mjs).
 *
 * - The engines' WebAssembly comes in the `init` message (downloaded,
 *   verified by the plugin); each is started on first use.
 * - It holds up to `MAX_MODELS` language models, by pair, and lets the
 *   oldest go.
 * - Translation runs on this thread and blocks it; the plugin's thread is
 *   free meanwhile. Settings follow Firefox's own worker
 *   (translations-engine.worker.js): greedy search, no quality model.
 *
 * No DOM and no Obsidian: only the worker's own `self`.
 */

import {
  TRANSLATE_TAG,
  type ModelBytes,
  type TranslateReply,
  type TranslateRequest,
  type TranslateResult,
} from "./translate-protocol";

/** How many models stay loaded: a route through English needs two. */
const MAX_MODELS = 3;

/** The byte alignment each model file needs in the engine's memory (Firefox's MODEL_FILE_ALIGNMENTS). */
const ALIGNMENT = { model: 256, lex: 64, vocab: 64, srcvocab: 64, trgvocab: 64 } as const;

/** An object the engine allocated, freed by `delete`. */
interface Native {
  delete(): void;
}
interface AlignedMemory extends Native {
  getByteArrayView(): Uint8Array;
}
interface Vector<T> extends Native {
  push_back(value: T): void;
  size(): number;
  get(i: number): T;
}
interface Response {
  getTranslatedText(): string;
}
interface ResponseOptions {
  qualityScores: boolean;
  alignment: boolean;
  html: boolean;
}
interface BergamotModel extends Native {
  _model: true;
}
interface Bergamot {
  AlignedMemory: new (bytes: number, alignment: number) => AlignedMemory;
  AlignedMemoryList: new () => Vector<AlignedMemory>;
  VectorString: new () => Vector<string>;
  VectorResponseOptions: new () => Vector<ResponseOptions>;
  TranslationModel: new (
    from: string,
    to: string,
    config: string,
    model: AlignedMemory,
    lex: AlignedMemory | null,
    vocabs: Vector<AlignedMemory>,
    quality: null,
  ) => BergamotModel;
  BlockingService: new (options: { cacheSize: number }) => {
    translate(
      model: BergamotModel,
      texts: Vector<string>,
      options: Vector<ResponseOptions>,
    ): Vector<Response>;
    translateViaPivoting(
      first: BergamotModel,
      second: BergamotModel,
      texts: Vector<string>,
      options: Vector<ResponseOptions>,
    ): Vector<Response>;
  };
}
interface FastTextModule {
  FS: { writeFile(name: string, data: Uint8Array): void };
  FastText: new () => {
    loadModel(name: string): void;
    predict(text: string, k: number, threshold: number): Vector<[number, string]>;
  };
}

declare const loadBergamot: (module: {
  INITIAL_MEMORY: number;
  wasmBinary: ArrayBuffer;
  print: (text: string) => void;
  printErr: (text: string) => void;
  onAbort: (what: unknown) => void;
  onRuntimeInitialized: () => void;
}) => Bergamot;
declare const loadFastTextModule: (module: { wasmBinary: ArrayBuffer }) => Promise<FastTextModule>;

interface Loaded {
  model: BergamotModel;
  memory: AlignedMemory[];
  vocabs: Vector<AlignedMemory>;
}

let code: { bergamot: ArrayBuffer; fasttext: ArrayBuffer; lid: ArrayBuffer } | null = null;
let bergamot: Promise<Bergamot> | null = null;
let service: InstanceType<Bergamot["BlockingService"]> | null = null;
let detector: Promise<InstanceType<FastTextModule["FastText"]>> | null = null;
const models = new Map<string, Loaded>();

function engine(): Promise<Bergamot> {
  if (!code) throw new Error("not started");
  const wasmBinary = code.bergamot;
  bergamot ??= new Promise<Bergamot>((resolve, reject) => {
    const module: Bergamot = loadBergamot({
      // Firefox starts at 40 MiB and lets it grow.
      INITIAL_MEMORY: 41_943_040,
      wasmBinary,
      print: () => {},
      printErr: () => {},
      onAbort: (what) => reject(new Error(`engine stopped: ${String(what)}`)),
      onRuntimeInitialized: () => {
        // The module object is complete only after this callback returns.
        void Promise.resolve().then(() => resolve(module));
      },
    });
  });
  return bergamot;
}

function languageDetector(): Promise<InstanceType<FastTextModule["FastText"]>> {
  if (!code) throw new Error("not started");
  const { fasttext, lid } = code;
  detector ??= loadFastTextModule({ wasmBinary: fasttext }).then((module) => {
    module.FS.writeFile("lid.bin", new Uint8Array(lid));
    const ft = new module.FastText();
    ft.loadModel("lid.bin");
    return ft;
  });
  return detector;
}

/** Marian's config, one `key: value` a line, indented as its YAML reader wants. */
function config(entries: Record<string, string>): string {
  const indent = "            ";
  let out = "\n";
  for (const [key, value] of Object.entries(entries)) out += `${indent}${key}: ${value}\n`;
  return out + indent;
}

function aligned(b: Bergamot, bytes: ArrayBuffer, alignment: number): AlignedMemory {
  const memory = new b.AlignedMemory(bytes.byteLength, alignment);
  memory.getByteArrayView().set(new Uint8Array(bytes));
  return memory;
}

function release(key: string): void {
  const loaded = models.get(key);
  if (!loaded) return;
  models.delete(key);
  loaded.model.delete();
  loaded.vocabs.delete();
  for (const m of loaded.memory) m.delete();
}

async function load(list: ModelBytes[]): Promise<string[]> {
  const b = await engine();
  const done: string[] = [];
  for (const bytes of list) {
    if (models.has(bytes.key)) {
      // Most recent last, so the oldest is let go first.
      const keep = models.get(bytes.key);
      models.delete(bytes.key);
      if (keep) models.set(bytes.key, keep);
      continue;
    }
    const memory: AlignedMemory[] = [];
    const vocabs = new b.AlignedMemoryList();
    const model = aligned(b, bytes.model, ALIGNMENT.model);
    memory.push(model);
    const lex = bytes.lex ? aligned(b, bytes.lex, ALIGNMENT.lex) : null;
    if (lex) memory.push(lex);
    const vocabBytes = bytes.vocab ? [bytes.vocab] : [bytes.srcvocab, bytes.trgvocab];
    for (const v of vocabBytes) {
      if (!v) throw new Error("vocabulary missing");
      const m = aligned(b, v, ALIGNMENT.vocab);
      memory.push(m);
      vocabs.push_back(m);
    }
    const translationModel = new b.TranslationModel(
      bytes.from,
      bytes.to,
      config({
        "beam-size": "1",
        normalize: "1.0",
        "word-penalty": "0",
        "max-length-break": "128",
        "mini-batch-words": "1024",
        workspace: "128",
        "max-length-factor": "2.0",
        "skip-cost": "true",
        "cpu-threads": "0",
        quiet: "true",
        "quiet-translation": "true",
        "gemm-precision": bytes.precision,
        alignment: "soft",
      }),
      model,
      lex,
      vocabs,
      null,
    );
    models.set(bytes.key, { model: translationModel, memory, vocabs });
    while (models.size > MAX_MODELS) {
      const oldest = models.keys().next().value;
      if (oldest === undefined) break;
      release(oldest);
    }
    done.push(bytes.key);
  }
  return done;
}

async function translate(keys: string[], texts: string[]): Promise<string[]> {
  const b = await engine();
  service ??= new b.BlockingService({ cacheSize: 0 });
  const route = keys.map((key) => {
    const loaded = models.get(key);
    if (!loaded) throw new Error(`model ${key} not loaded`);
    return loaded.model;
  });
  const messages = new b.VectorString();
  const options = new b.VectorResponseOptions();
  try {
    for (const text of texts) {
      messages.push_back(text);
      options.push_back({ qualityScores: false, alignment: false, html: false });
    }
    const responses =
      route.length === 1
        ? service.translate(route[0], messages, options)
        : service.translateViaPivoting(route[0], route[1], messages, options);
    const out: string[] = [];
    for (let i = 0; i < responses.size(); i++) out.push(responses.get(i).getTranslatedText());
    responses.delete();
    return out;
  } finally {
    messages.delete();
    options.delete();
  }
}

async function detect(text: string): Promise<[string, number][]> {
  const ft = await languageDetector();
  // fastText reads one line; it was trained on text without line breaks.
  const guesses = ft.predict(text.replace(/\s+/g, " ").trim(), 3, 0);
  const out: [string, number][] = [];
  for (let i = 0; i < guesses.size(); i++) {
    const [p, label] = guesses.get(i);
    out.push([label, p]);
  }
  guesses.delete();
  return out;
}

async function handle(request: TranslateRequest): Promise<TranslateResult> {
  switch (request.type) {
    case "init":
      code = { bergamot: request.bergamot, fasttext: request.fasttext, lid: request.lid };
      return { type: "init" };
    case "detect":
      return { type: "detect", guesses: await detect(request.text) };
    case "load":
      return { type: "load", loaded: await load(request.models) };
    case "translate": {
      const start = performance.now();
      const texts = await translate(request.keys, request.texts);
      return { type: "translate", texts, ms: performance.now() - start };
    }
  }
}

self.onmessage = (
  event: MessageEvent<{ [TRANSLATE_TAG]?: true; id: number } & TranslateRequest>,
) => {
  const data = event.data;
  if (!data || data[TRANSLATE_TAG] !== true) return;
  const { id } = data;
  handle(data).then(
    (result) => {
      const reply: TranslateReply = { id, ok: true, result };
      self.postMessage({ [TRANSLATE_TAG]: true, ...reply });
    },
    (error: unknown) => {
      const reply: TranslateReply = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage({ [TRANSLATE_TAG]: true, ...reply });
    },
  );
};
