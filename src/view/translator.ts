/**
 * Translating selected text on this device, with Mozilla's Bergamot (the
 * engine Firefox translates pages with) and fastText to tell the language.
 *
 * - **Files.** The engine (about 7 MB) and one model per direction (17 to
 *   40 MB) are `ModelAsset`s in the shared model registry, so they are
 *   downloaded, verified and listed (with Remove) like every other model.
 *   A model is registered when a translation needs it or when its folder
 *   is already in the vault (`registerStored`), never all 109 up front.
 * - **Worker.** One Web Worker runs both engines, started from Mozilla's
 *   glue (src/translate/vendor) plus translate-worker.ts. It is let go
 *   after `IDLE_RELEASE_MS` unused, with the models it holds.
 * - Nothing is sent anywhere: the only network use is the download.
 */

import { type App, normalizePath } from "obsidian";
import type { AssetStore } from "../downloads/model-store";
import { isBusy, totalBytes } from "../downloads/model-manifest";
import { t, localeTag } from "../i18n/translate";
import type { TranslationPair } from "../translate/catalog-types";
import {
  type LanguageGuess,
  ENGINE_ID,
  engineAsset,
  joinPieces,
  pairAsset,
  pairId,
  pairOfFolder,
  pickSource,
  roughGuess,
  routeOf,
  sourceLanguages,
  textPieces,
  withContext,
  withoutPrivateUse,
} from "../translate/languages";
import {
  TRANSLATE_TAG,
  type ModelBytes,
  type TranslateReply,
  type TranslateRequest,
  type TranslateResult,
} from "../translate/translate-protocol";
import type { ModelRegistry } from "./model-downloads";

/** A worker left idle this long is let go, with its models (a few hundred MB). */
export const IDLE_RELEASE_MS = 2 * 60_000;
/** Loading a model or translating a long text: at most this long before the worker counts as stuck. */
const ANSWER_TIMEOUT_MS = 120_000;
/** The text around a selection read for its language: a page's worth. */
const CONTEXT_CHARS = 3000;

export interface TranslatorHost {
  app: App;
  models: ModelRegistry;
  pluginDir(): string;
}

/** A language's name in the interface language ("Nederlands" → "Dutch" in English). */
export function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames([localeTag()], { type: "language" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

interface Pending {
  resolve: (result: TranslateResult) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class Translator {
  private worker: Worker | null = null;
  private url = "";
  private started: Promise<void> | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private idleTimer = 0;
  /** Models the worker holds, by key. */
  private readonly held = new Set<string>();

  constructor(private readonly host: TranslatorHost) {}

  /** The engine's store (registered on first use). */
  engine(): AssetStore {
    return this.host.models.register(
      engineAsset(t("ai.translate.engineLabel"), t("ai.translate.enginePurpose")),
    );
  }

  /** A model's store (registered on first use). */
  pairStore(pair: TranslationPair): AssetStore {
    const from = languageName(pair.from);
    const to = languageName(pair.to);
    return this.host.models.register(
      pairAsset(
        pair,
        t("ai.translate.pairLabel", { from, to }),
        t("ai.translate.pairPurpose", { from, to }),
      ),
    );
  }

  /**
   * Register the engine and every model already in the vault, so Settings ›
   * Models on this device lists them (with Remove).
   */
  async registerStored(): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    const root = normalizePath(`${this.host.pluginDir()}/translation`);
    let listed: { folders: string[] };
    try {
      if (!(await adapter.exists(root))) return;
      listed = await adapter.list(root);
    } catch {
      // No folder to look in (yet): nothing is downloaded.
      return;
    }
    for (const folder of listed.folders) {
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      if (name === "engine") this.engine();
      const pair = pairOfFolder(name);
      if (pair) this.pairStore(pair);
    }
  }

  /** The stores a translation from `from` to `to` needs, engine first; null when it cannot be done. */
  storesFor(from: string, to: string): AssetStore[] | null {
    const route = routeOf(from, to);
    if (!route) return null;
    return [this.engine(), ...route.map((pair) => this.pairStore(pair))];
  }

  /** Of `stores`, those not on this device yet (each looked at once). */
  async missing(stores: readonly AssetStore[]): Promise<AssetStore[]> {
    const states = await Promise.all(stores.map((store) => store.check()));
    return stores.filter((_, i) => states[i].kind !== "ready");
  }

  /** Download every store, one after another; progress is the share of all their bytes. */
  async download(
    stores: readonly AssetStore[],
    onProgress: (fraction: number) => void,
  ): Promise<boolean> {
    const total = stores.reduce((sum, s) => sum + totalBytes(s.asset), 0) || 1;
    let before = 0;
    for (const store of stores) {
      const size = totalBytes(store.asset);
      const report = () => {
        const state = store.state;
        const got = state.kind === "downloading" ? state.received : isBusy(state) ? size : 0;
        onProgress((before + got) / total);
      };
      const unsubscribe = store.subscribe(report);
      const ok = await store.download().finally(unsubscribe);
      if (!ok) return false;
      before += size;
      onProgress(before / total);
    }
    return true;
  }

  /**
   * The text's language: fastText's when the engine is here, else a rough
   * guess from its script and common words. `fallback` is the language
   * last translated from; `context` the text around the selection (its
   * page), whose language wins unless the text's own is sure
   * (`withContext`).
   */
  async detect(
    text: string,
    fallback: string | null,
    context?: string,
  ): Promise<LanguageGuess | null> {
    const own = await this.detectOne(text, fallback);
    const around = context?.trim() ? context.slice(0, CONTEXT_CHARS) : "";
    if (!around || around === text) return own;
    return withContext(text, own, await this.detectOne(around, null));
  }

  private async detectOne(text: string, fallback: string | null): Promise<LanguageGuess | null> {
    const known = sourceLanguages();
    const rough = roughGuess(text, known);
    const engine = this.engine();
    if ((await engine.check()).kind === "ready") {
      try {
        const result = await this.send({ type: "detect", text }, []);
        if (result.type === "detect")
          return pickSource(text, result.guesses, known, fallback, rough);
      } catch (error) {
        console.warn("FineNotes: language detection failed", error);
      }
    }
    if (rough) return { lang: rough, p: 0 };
    return fallback && known.includes(fallback) ? { lang: fallback, p: 0 } : null;
  }

  /** Translate `text` (every model it needs on this device). Line breaks are kept. */
  async translate(text: string, from: string, to: string): Promise<string> {
    const route = routeOf(from, to);
    if (!route) throw new Error(t("ai.translate.unsupported", { from, to }));
    if (route.length === 0) return text;
    const cut = textPieces(withoutPrivateUse(text));
    if (cut.pieces.length === 0) return text;
    const toLoad: ModelBytes[] = [];
    const transfer: ArrayBuffer[] = [];
    for (const pair of route) {
      const key = pairId(pair);
      if (this.held.has(key)) continue;
      const store = this.pairStore(pair);
      const bytes: Partial<Record<string, ArrayBuffer>> = {};
      for (const file of pair.files) {
        const data = await verified(store, file.name);
        bytes[file.name.replace(/\.(bin|spm)$/, "")] = data;
        transfer.push(data);
      }
      const model = bytes.model;
      if (!model) throw new Error("model missing");
      toLoad.push({
        key,
        from: pair.from,
        to: pair.to,
        precision: pair.precision,
        model,
        vocab: bytes.vocab,
        srcvocab: bytes.srcvocab,
        trgvocab: bytes.trgvocab,
        lex: bytes.lex,
      });
    }
    if (toLoad.length > 0) {
      const loaded = await this.send({ type: "load", models: toLoad }, transfer);
      if (loaded.type === "load") for (const key of loaded.loaded) this.held.add(key);
    }
    const result = await this.send(
      { type: "translate", keys: route.map(pairId), texts: cut.pieces },
      [],
    );
    if (result.type !== "translate") throw new Error("unexpected reply");
    return joinPieces(cut, result.texts);
  }

  private start(): Promise<void> {
    if (this.started) return this.started;
    this.started = (async () => {
      const engine = this.engine();
      const [bergamot, fasttext, lid] = await Promise.all(
        engine.asset.files.map((file) => verified(engine, file.name)),
      );
      const { startTranslateWorker } = await import("./translate-worker-start");
      const { worker, url } = startTranslateWorker();
      this.url = url;
      worker.onmessage = (event: MessageEvent<{ [TRANSLATE_TAG]?: true } & TranslateReply>) => {
        const reply = event.data;
        if (!reply || reply[TRANSLATE_TAG] !== true) return;
        const waiting = this.pending.get(reply.id);
        if (!waiting) return;
        this.pending.delete(reply.id);
        window.clearTimeout(waiting.timer);
        if (reply.ok) waiting.resolve(reply.result);
        else waiting.reject(new Error(reply.error));
        this.armIdle();
      };
      worker.onerror = (event) => {
        event.preventDefault();
        this.stop(new Error(event.message || t("ai.translate.noAnswer")));
      };
      this.worker = worker;
      await this.post({ type: "init", bergamot, fasttext, lid }, [bergamot, fasttext, lid]);
    })();
    this.started.catch(() => this.stop(null));
    return this.started;
  }

  private post(request: TranslateRequest, transfer: Transferable[]): Promise<TranslateResult> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error(t("ai.translate.noAnswer")));
    return new Promise<TranslateResult>((resolve, reject) => {
      const id = this.nextId++;
      const timer = window.setTimeout(
        () => this.stop(new Error(t("ai.translate.noAnswer"))),
        ANSWER_TIMEOUT_MS,
      );
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ [TRANSLATE_TAG]: true, id, ...request }, transfer);
    });
  }

  private async send(
    request: TranslateRequest,
    transfer: Transferable[],
  ): Promise<TranslateResult> {
    window.clearTimeout(this.idleTimer);
    await this.start();
    return this.post(request, transfer);
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
    this.started = null;
    this.held.clear();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiting) {
      window.clearTimeout(w.timer);
      w.reject(error ?? new Error(t("ai.translate.noAnswer")));
    }
  }

  /** Whether `id` is one of this feature's models (the engine or a language). */
  static owns(id: string): boolean {
    return id === ENGINE_ID || id.startsWith("translate-");
  }

  dispose(): void {
    this.stop(null);
  }
}

/** A file of a model, checked as it is read; downloaded again once if it changed. */
async function verified(store: AssetStore, name: string): Promise<ArrayBuffer> {
  const isMain = name === store.asset.files[0]?.name;
  const read = () => store.bytes(isMain ? undefined : name);
  const bytes = (await read()) ?? ((await store.download()) ? await read() : null);
  if (!bytes) throw new Error(`${store.asset.label}: ${name}`);
  return bytes;
}
