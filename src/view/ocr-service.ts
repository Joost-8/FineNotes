/**
 * Reading scanned PDF pages on this device (recognition/ocr), for the
 * notebooks that have them open. One service for the plugin:
 *
 * - **On demand only.** A page is read only when a notebook's text cache
 *   (pdf-text-source.ts) finds it has no, or hardly any, text of its own and
 *   asks for it. The page in view is read first, then its neighbours, then
 *   the rest of that PDF only while idle (recognition/ocr/ocr-queue.ts);
 *   one page at a time, and none starts while the pen writes. A PDF no open
 *   notebook uses any more is dropped from the queue.
 * - **Once per page, ever.** What was read is kept in a sidecar per PDF,
 *   named by the SHA-256 of the PDF's bytes, in the plugin's folder
 *   (recognition/ocr/ocr-cache.ts), so it syncs with the vault and another
 *   device needs neither the model nor a second reading.
 * - **Off the main thread.** The page is drawn by the PDF worker and read in
 *   the OCR worker (recognition/ocr/client.ts). A blank page is not read.
 * - **Nothing downloads without a yes.** The model is offered (the download
 *   card) when the first non-blank page needs it; until it is there the queue
 *   waits, and the page stays as it is today (freehand only).
 * - **Failures are quiet.** A page that cannot be read is logged and left
 *   alone for a while; a notice is shown at most once per session.
 */

import { type App, Notice, normalizePath } from "obsidian";
import type { OcrClient } from "../recognition/ocr/client";
import { isBlank } from "../recognition/ocr/blank";
import {
  type OcrCacheFile,
  cacheFolder,
  cachePath,
  cachedPage,
  emptyCache,
  mergeCaches,
  parseCache,
  serializeCache,
  withPage,
} from "../recognition/ocr/ocr-cache";
import {
  OCR_DICT_FILE,
  OCR_MODEL,
  OCR_REC_FILE,
  OCR_DET_FILE,
  OCR_WASM_FILE,
} from "../recognition/ocr/ocr-model";
import { OcrQueue, type PageRef } from "../recognition/ocr/ocr-queue";
import type { OcrPage } from "../recognition/ocr/ocr-words";
import type { OcrFiles } from "../recognition/ocr/protocol";
import { toHex } from "../downloads/model-manifest";
import type { AssetStore } from "../downloads/model-store";
import { errorMessage } from "../util/errors";
import type { ModelRegistry } from "./model-downloads";
import { OcrRasteriser } from "./ocr-raster";

/** Something that shows PDF pages and wants their OCR text (a notebook's text cache). */
export interface OcrOwner {
  /** A page was read: its text can be taken again. */
  ocrReady(path: string, page: number): void;
  /** Read the page's text to find out whether it needs OCR (the service found nothing else to do). */
  ocrProbe(path: string, page: number): Promise<void>;
}

export interface OcrHost {
  app: App;
  pluginDir(): string;
  models: ModelRegistry;
  /** The setting "Read scanned PDF pages". */
  enabled(): boolean;
}

/** What the progress indicator shows. */
export interface OcrProgress {
  active: boolean;
  /** Pages read in this run, and pages in it (read, being read and waiting). */
  done: number;
  total: number;
}

/** Pages away from the one in view wait until nothing has happened for this long, ms. */
const IDLE_MS = 3000;
/** A page that failed is not tried again for this long, ms. */
const RETRY_MS = 60_000;
/** The sidecar is written this long after the last page was added, ms. */
const SAVE_MS = 2500;
/** Pause between probes of pages' text, ms: they are quick, and the pen may be near. */
const PROBE_PAUSE_MS = 40;
/** The longest side of the copy of a page checked for blankness, px. */
const BLANK_EDGE = 256;
/** Failures in a row after which OCR rests for the session. */
const MAX_FAILURES = 4;

function refKey(path: string, page: number): string {
  return `${path}:${page}`;
}

export class OcrService {
  readonly store: AssetStore;
  private readonly queue = new OcrQueue();
  /** The worker's client, made when the first page is read (its bundle is imported then). */
  private client: OcrClient | null = null;
  private readonly raster: OcrRasteriser;
  private readonly owners = new Map<OcrOwner, Set<string>>();
  private readonly holders = new Set<OcrOwner>();
  private readonly listeners = new Set<(p: OcrProgress) => void>();
  /** Each PDF's sidecar, by the hash of the PDF. */
  private readonly caches = new Map<string, Promise<OcrCacheFile>>();
  private readonly dirty = new Set<string>();
  private readonly hashes = new Map<string, { stamp: string; key: Promise<string> }>();
  private readonly failed = new Map<string, number>();
  private pumping = false;
  private parked = false;
  private lastActivity = 0;
  private running: PageRef | null = null;
  private done = 0;
  private failures = 0;
  private noticed = false;
  private disposed = false;
  private wake = 0;
  private saveTimer = 0;
  private unsubscribe: () => void;

  constructor(private readonly host: OcrHost) {
    this.store = host.models.register(OCR_MODEL);
    this.raster = new OcrRasteriser(host.app);
    // The model arriving (from the card, or the settings) un-parks the queue.
    this.unsubscribe = this.store.subscribe(() => {
      if (this.store.state.kind === "ready" && this.parked) {
        this.parked = false;
        this.pump();
      }
    });
  }

  // --- For the notebooks ------------------------------------------------------

  /** Whether scanned pages are read at all (the setting). */
  get enabled(): boolean {
    return !this.disposed && this.host.enabled() && this.failures < MAX_FAILURES;
  }

  /** Called with the progress whenever it changes; returns the unsubscribe. */
  subscribe(listener: (progress: OcrProgress) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  progress(): OcrProgress {
    const waiting = this.queue.size() + (this.running ? 1 : 0);
    return { active: waiting > 0, done: this.done, total: this.done + waiting };
  }

  private emit(): void {
    const progress = this.progress();
    for (const listener of [...this.listeners]) listener(progress);
  }

  /** `owner` shows PDF `path`: its scanned pages may be read for it. */
  attach(owner: OcrOwner, path: string): void {
    let paths = this.owners.get(owner);
    if (!paths) this.owners.set(owner, (paths = new Set()));
    paths.add(path);
  }

  /** `owner` is gone (its notebook closed): PDFs nobody else shows are dropped. */
  release(owner: OcrOwner): void {
    const paths = this.owners.get(owner);
    this.owners.delete(owner);
    this.holders.delete(owner);
    for (const path of paths ?? []) this.dropIfUnused(path);
    if (this.owners.size === 0) this.client?.dispose();
    this.emit();
    if (this.holders.size === 0) this.pump();
  }

  /** `owner` no longer shows `path`. */
  detach(owner: OcrOwner, path: string): void {
    this.owners.get(owner)?.delete(path);
    this.dropIfUnused(path);
    this.emit();
  }

  private dropIfUnused(path: string): void {
    for (const paths of this.owners.values()) if (paths.has(path)) return;
    this.queue.cancelPath(path);
    this.raster.release(path);
    this.hashes.delete(path);
  }

  /** The pen is down (`held`) or has been up a moment: nothing starts while it writes. */
  hold(owner: OcrOwner, held: boolean): void {
    if (held) {
      this.holders.add(owner);
      return;
    }
    this.holders.delete(owner);
    this.lastActivity = Date.now();
    if (this.holders.size === 0) this.pump();
  }

  /** The user is on page `page` of `path`. */
  focus(path: string, page: number): void {
    this.queue.focus(path, page);
    this.lastActivity = Date.now();
    this.pump();
  }

  /** The page's text read earlier, or null (not read, read by another model, or no way to tell). */
  async cached(path: string, page: number): Promise<OcrPage | null> {
    try {
      return cachedPage(await this.load(await this.hashOf(path)), page);
    } catch (error) {
      console.warn("FineNotes: could not look up scanned-page text", error);
      return null;
    }
  }

  /**
   * Page `page` of `path` (of `pages`) needs reading. It is read when its
   * turn comes (see the queue); `owner` hears when it was.
   */
  want(owner: OcrOwner, path: string, page: number, pages: number): void {
    if (!this.enabled) return;
    this.attach(owner, path);
    const failedAt = this.failed.get(refKey(path, page));
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_MS) return;
    this.queue.startFill(path, pages);
    this.queue.markProbed(path, page);
    if (this.running?.path === path && this.running.page === page) return;
    if (this.queue.add(path, page)) this.emit();
    this.pump();
  }

  /** Page `page` of `path` needs no reading (it has text of its own, or was probed). */
  settled(path: string, page: number): void {
    this.queue.markProbed(path, page);
  }

  /** Forget what was read of `path` (all of it, on disk too); the notebooks ask for it again. */
  async dropCache(path: string): Promise<void> {
    this.queue.cancelPath(path);
    // A fresh start: the pages may have failed for a reason that is gone.
    this.failures = 0;
    for (const key of [...this.failed.keys()])
      if (key.startsWith(`${path}:`)) this.failed.delete(key);
    try {
      const key = await this.hashOf(path);
      this.caches.set(key, Promise.resolve(emptyCache()));
      this.dirty.delete(key);
      const file = normalizePath(cachePath(this.host.pluginDir(), key));
      const adapter = this.host.app.vault.adapter;
      if (await adapter.exists(file)) await adapter.remove(file);
    } catch (error) {
      console.warn("FineNotes: could not drop the scanned-page cache", error);
    }
    this.hashes.delete(path);
    this.emit();
  }

  /** The model's files are being removed or replaced. */
  releaseModel(): void {
    this.client?.dispose();
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.wake);
    window.clearTimeout(this.saveTimer);
    this.unsubscribe();
    this.client?.dispose();
    this.raster.dispose();
    this.listeners.clear();
    void this.persist(true);
  }

  // --- The loop ---------------------------------------------------------------

  private idle(): boolean {
    return this.holders.size === 0 && Date.now() - this.lastActivity > IDLE_MS;
  }

  /** Start (or carry on) the loop; a second call while it runs does nothing. */
  pump(): void {
    if (this.pumping || this.disposed) return;
    void this.loop();
  }

  private async loop(): Promise<void> {
    this.pumping = true;
    window.clearTimeout(this.wake);
    try {
      for (;;) {
        if (!this.enabled || this.owners.size === 0) return;
        if (this.holders.size > 0) return;
        if (this.parked) {
          if (this.store.state.kind !== "ready") return;
          this.parked = false;
        }
        const idle = this.idle();
        const job = this.queue.next(idle);
        if (job) {
          this.running = job;
          this.emit();
          try {
            await this.process(job);
          } catch (error) {
            this.failedPage(job, error);
          } finally {
            this.running = null;
          }
          this.emit();
          continue;
        }
        const probe = this.queue.nextProbe(idle);
        if (probe) {
          const owner = this.ownerOf(probe.path);
          if (owner) await owner.ocrProbe(probe.path, probe.page).catch(() => undefined);
          await new Promise((resolve) => window.setTimeout(resolve, PROBE_PAUSE_MS));
          continue;
        }
        // Waiting for the page in view to rest, or for the pen to lift.
        if (this.queue.size() > 0 || this.queue.nextProbe(true)) {
          this.wake = window.setTimeout(() => this.pump(), 1000);
        } else {
          this.done = 0;
        }
        return;
      }
    } finally {
      this.pumping = false;
      this.emit();
    }
  }

  private ownerOf(path: string): OcrOwner | null {
    for (const [owner, paths] of this.owners) if (paths.has(path)) return owner;
    return null;
  }

  private failedPage(job: PageRef, error: unknown): void {
    this.failures++;
    this.failed.set(refKey(job.path, job.page), Date.now());
    console.warn(
      `FineNotes: could not read scanned page ${job.page + 1} of ${job.path}: ${errorMessage(error)}`,
      error,
    );
    if (!this.noticed) {
      this.noticed = true;
      new Notice(
        "FineNotes: a scanned PDF page could not be read on this device. The page stays as it is; " +
          "details are in the developer console.",
        8000,
      );
    }
  }

  private async process(job: PageRef): Promise<void> {
    const { path, page } = job;
    const key = await this.hashOf(path);
    const file = await this.load(key);
    if (!cachedPage(file, page)) {
      const shot = await this.raster.render(path, page);
      let result: OcrPage;
      try {
        if (await this.looksBlank(shot.bitmap)) {
          // Nothing to read: remembered as read, so it is not drawn again.
          result = {
            imageWidth: shot.bitmap.width,
            imageHeight: shot.bitmap.height,
            pageWidth: shot.pageWidth,
            pageHeight: shot.pageHeight,
            lines: [],
          };
          shot.bitmap.close();
        } else {
          if (!(await this.modelReady())) {
            // Offered; the page waits for the model.
            shot.bitmap.close();
            this.queue.add(path, page);
            this.parked = true;
            return;
          }
          const started = Date.now();
          const client = await this.worker();
          await client.ensureModel(`${OCR_MODEL.id}:${OCR_MODEL.version}`, () => this.readModel());
          // The worker takes the bitmap and closes it.
          const read = await client.read(shot.bitmap, shot.scale, shot.pageWidth, shot.pageHeight);
          result = read.page;
          console.debug(
            `FineNotes: read scanned page ${page + 1} of ${path} in ${Date.now() - started} ms`,
            read.steps,
          );
        }
      } catch (error) {
        shot.bitmap.close();
        throw error;
      }
      this.failures = 0;
      this.caches.set(key, Promise.resolve(withPage(await this.load(key), page, result)));
      this.dirty.add(key);
      this.scheduleSave();
    }
    this.done++;
    for (const [owner, paths] of this.owners) if (paths.has(path)) owner.ocrReady(path, page);
  }

  // --- The model --------------------------------------------------------------

  private async worker(): Promise<OcrClient> {
    if (!this.client) {
      const { OcrClient } = await import("../recognition/ocr/client");
      this.client ??= new OcrClient();
    }
    return this.client;
  }

  /** True when the model is here; otherwise offers the download card and says false. */
  private async modelReady(): Promise<boolean> {
    if ((await this.store.file()) !== null) return true;
    this.host.models.offer(OCR_MODEL.id, "auto");
    return false;
  }

  private async readModel(): Promise<OcrFiles> {
    const get = async (name: string): Promise<ArrayBuffer> => {
      const bytes = await this.store.bytes(name);
      if (!bytes) throw new Error(`the OCR model's ${name} is missing or damaged`);
      return bytes;
    };
    const dict = new TextDecoder("utf-8").decode(await get(OCR_DICT_FILE.name));
    return {
      det: await get(OCR_DET_FILE.name),
      rec: await get(OCR_REC_FILE.name),
      dict,
      wasm: await get(OCR_WASM_FILE.name),
    };
  }

  // --- Blank pages ------------------------------------------------------------

  private async looksBlank(bitmap: ImageBitmap): Promise<boolean> {
    const long = Math.max(bitmap.width, bitmap.height);
    const k = Math.min(1, BLANK_EDGE / long);
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = createEl("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    try {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, w, h);
      context.imageSmoothingEnabled = true;
      context.drawImage(bitmap, 0, 0, w, h);
      return isBlank(context.getImageData(0, 0, w, h).data);
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  // --- The sidecar ------------------------------------------------------------

  /** The SHA-256 of the PDF's bytes, kept while the file is unchanged. */
  private hashOf(path: string): Promise<string> {
    const file = this.host.app.vault.getFileByPath(path);
    if (!file) return Promise.reject(new Error(`missing PDF ${path}`));
    const stamp = `${file.stat.mtime}:${file.stat.size}`;
    const known = this.hashes.get(path);
    if (known && known.stamp === stamp) return known.key;
    const key = (async () => {
      // Read-only. The bytes are dropped as soon as they are hashed.
      const bytes = await this.host.app.vault.readBinary(file);
      return toHex(await crypto.subtle.digest("SHA-256", bytes));
    })();
    this.hashes.set(path, { stamp, key });
    key.catch(() => {
      if (this.hashes.get(path)?.key === key) this.hashes.delete(path);
    });
    return key;
  }

  private load(key: string): Promise<OcrCacheFile> {
    let loaded = this.caches.get(key);
    if (!loaded) {
      loaded = this.readFile(key);
      this.caches.set(key, loaded);
    }
    return loaded;
  }

  private async readFile(key: string): Promise<OcrCacheFile> {
    const adapter = this.host.app.vault.adapter;
    const file = normalizePath(cachePath(this.host.pluginDir(), key));
    try {
      if (!(await adapter.exists(file))) return emptyCache();
      return parseCache(await adapter.read(file));
    } catch (error) {
      console.warn("FineNotes: could not read a scanned-page cache", error);
      return emptyCache();
    }
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.persist(false), SAVE_MS);
  }

  /** Write the changed sidecars, merged with what another device may have added. */
  private async persist(final: boolean): Promise<void> {
    if (!final && this.holders.size > 0) {
      // The pen is writing: a little later.
      this.scheduleSave();
      return;
    }
    const adapter = this.host.app.vault.adapter;
    for (const key of [...this.dirty]) {
      this.dirty.delete(key);
      try {
        const ours = await (this.caches.get(key) ?? Promise.resolve(emptyCache()));
        const folder = normalizePath(cacheFolder(this.host.pluginDir()));
        const file = normalizePath(cachePath(this.host.pluginDir(), key));
        const temp = `${file}.tmp`;
        if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
        const theirs = (await adapter.exists(file))
          ? parseCache(await adapter.read(file))
          : emptyCache();
        const merged = mergeCaches(theirs, ours);
        this.caches.set(key, Promise.resolve(merged));
        // Through a temporary name, then moved into place: a half-written
        // file is never what sync carries off.
        await adapter.write(temp, serializeCache(merged));
        if (await adapter.exists(file)) await adapter.remove(file);
        await adapter.rename(temp, file);
      } catch (error) {
        console.warn("FineNotes: could not save the scanned-page cache", error);
        this.dirty.add(key);
      }
    }
  }
}
