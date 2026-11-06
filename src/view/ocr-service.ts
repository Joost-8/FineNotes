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
 *   the OCR worker (recognition/ocr/client.ts). A page with no ink, or none
 *   beyond its own text, is not read: it is cached as read, with no words.
 * - **Nothing downloads without a yes.** The model is offered (the download
 *   card) only for a page with no text of its own at all and some ink; until
 *   it is there the queue waits, and the page stays as it is today (freehand
 *   only). A page with some text of its own (a scan with a page number, a
 *   digital title page) is read only when the model is already here, and
 *   never makes it be offered.
 * - **Testable.** Everything it runs on comes in as `OcrDeps` (ocr-deps.ts
 *   makes the real ones), so the tests fake the files, the worker and the clock.
 * - **Failures are quiet.** A page that cannot be read is logged and left
 *   alone for a while; a notice is shown at most once per session.
 */

import { t } from "../i18n/translate";
import type { PixelRect } from "../recognition/ocr/blank";
import { type PagePlan, type Region, settledCondition } from "../recognition/ocr/figures";
import {
  type OcrCacheFile,
  cacheFolder,
  cachePath,
  cachedPage,
  emptyCache,
  mergeCaches,
  parseCache,
  type StoredPage,
  serializeCache,
  staleCachedPage,
  withPage,
} from "../recognition/ocr/ocr-cache";
import {
  OCR_DET_FILE,
  OCR_TIERS,
  OCR_WASM_FILE,
  type OcrConfidence,
  ocrTuningFor,
} from "../recognition/ocr/ocr-model";
import { OcrQueue, type PageRef } from "../recognition/ocr/ocr-queue";
import type { OcrLine, OcrPage, OcrTuning } from "../recognition/ocr/ocr-words";
import type { OcrFiles } from "../recognition/ocr/protocol";
import { errorMessage } from "../util/errors";

/** Something that shows PDF pages and wants their OCR text (a notebook's text cache). */
export interface OcrOwner {
  /** A page was read: its text can be taken again. */
  ocrReady(path: string, page: number): void;
  /** Read the page's text to find out whether it needs OCR (the service found nothing else to do). */
  ocrProbe(path: string, page: number): Promise<void>;
  /** A setting that decides what is read changed: read the pages shown again, with it. */
  ocrSettingsChanged?(): void;
}

/**
 * The OCR model in use now (the setting "OCR model"): what the cache calls
 * the model that read a page, the worker's key for it, which of its files
 * are the recogniser and its dictionary, and the thresholds that decide
 * which of its words are trusted.
 */
export interface ActiveOcrModel {
  /** Recorded with every page read, in the sidecar (ocr-cache.ts). */
  version: string;
  /** The worker's key for the model it holds. */
  key: string;
  rec: string;
  dict: string;
  confidence: OcrConfidence;
}

/** The Fast model, which is also what a service without a choice uses. */
const FAST_MODEL: ActiveOcrModel = (() => {
  const tier = OCR_TIERS[0];
  return {
    version: tier.version,
    key: `${tier.asset.id}:${tier.asset.version}`,
    rec: tier.rec,
    dict: tier.dict,
    confidence: tier.confidence,
  };
})();

/** What the service needs of the model's store (an `AssetStore`). */
export interface ModelStoreLike {
  readonly state: { kind: string };
  file(): Promise<string | null>;
  bytes(name?: string): Promise<ArrayBuffer | null>;
  subscribe(listener: () => void): () => void;
  /** Look at the model's folder again (after the setting chose it, or a sync). */
  check?(again?: boolean): Promise<unknown>;
}

/** A page drawn for OCR (`ocr-raster.ts`). */
export interface RasterShot {
  bitmap: ImageBitmap;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  /** For a region of the page: where its corner lies on the page, points. */
  origin?: { x: number; y: number };
}

export interface RasterLike {
  /** The page, or only `region` of it (points) at the resolution its picture has. */
  render(path: string, page: number, region?: Region): Promise<RasterShot>;
  release(path: string): void;
  dispose(): void;
}

/** The OCR worker's client (`recognition/ocr/client.ts`). */
export interface ClientLike {
  ensureModel(
    key: string,
    read: () => Promise<OcrFiles>,
    confidence?: OcrConfidence,
  ): Promise<void>;
  read(
    bitmap: ImageBitmap,
    scale: number,
    pageWidth: number,
    pageHeight: number,
    origin?: { x: number; y: number },
  ): Promise<{ page: OcrPage; steps: Record<string, number> }>;
  dispose(): void;
}

/** The files the sidecars live in (the vault adapter). */
export interface FilesLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

/** What the page's own text covers, in the page's points (a page with no text of its own: none). */
export interface NativeInfo {
  /** How many text items the page has of its own. */
  items: number;
  rects: PixelRect[];
  /**
   * What the page is and which areas are to be read (figures.ts). Absent: a
   * page read whole, as pages were before pictures were looked at.
   */
  plan?: PagePlan;
}

/**
 * Everything outside the pure logic, so that logic runs without Obsidian,
 * a worker or a clock (ocr-deps.ts makes the real ones).
 */
export interface OcrDeps {
  pluginDir(): string;
  /** The setting "Read scanned PDF pages". */
  enabled(): boolean;
  /** The setting "Also read text inside figures" (only in effect while `enabled`). */
  figures(): boolean;
  /** The store of the model in use now (it follows the setting "OCR model"). */
  store: ModelStoreLike;
  /** Show the model's download card (unless declined); `ask`: the user just asked for it. */
  offer(ask?: boolean): void;
  /** The model in use now; absent: the Fast model. */
  model?(): ActiveOcrModel;
  raster: RasterLike;
  /** The worker's client, made when first needed. */
  client(): Promise<ClientLike>;
  /**
   * Whether the raster has ink outside `masked` (rectangles in the raster's
   * pixels); with `edges`, whether it has content (strokes, not a smooth
   * fill, however dark) outside them.
   */
  hasInk(bitmap: ImageBitmap, masked: PixelRect[], edges?: boolean): Promise<boolean>;
  /** The SHA-256 of the PDF's bytes. */
  hashOf(path: string): Promise<string>;
  files: FilesLike;
  /** A notice for the user. */
  notice(text: string): void;
  now(): number;
  /** Run `fn` after `ms`; returns the cancel. */
  later(fn: () => void, ms: number): () => void;
  sleep(ms: number): Promise<void>;
}

/** What the progress indicator shows. */
export interface OcrProgress {
  active: boolean;
  /** Pages read in this run, and pages in it (read, being read and waiting). */
  done: number;
  total: number;
}

/** Pages away from the one in view wait until nothing has happened for this long, ms. */
export const IDLE_MS = 3000;
/** A page that failed is not tried again for this long, ms. */
export const RETRY_MS = 60_000;
/** The sidecar is written this long after the last page was added, ms. */
export const SAVE_MS = 2500;
/** Pause between probes of pages' text, ms: they are quick, and the pen may be near. */
const PROBE_PAUSE_MS = 40;
/** Failures in a row after which OCR rests for the session. */
export const MAX_FAILURES = 4;

/** Whether the centre of `box` lies inside `r`. */
function inside(box: readonly number[], r: PixelRect): boolean {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
}

function refKey(path: string, page: number): string {
  return `${path}:${page}`;
}

export class OcrService {
  private readonly queue = new OcrQueue();
  private readonly owners = new Map<OcrOwner, Set<string>>();
  private readonly holders = new Set<OcrOwner>();
  private readonly listeners = new Set<(p: OcrProgress) => void>();
  /** Each PDF's sidecar, by the hash of the PDF. */
  private readonly caches = new Map<string, Promise<OcrCacheFile>>();
  private readonly dirty = new Set<string>();
  private readonly failed = new Map<string, number>();
  /** What the queued pages have of their own text. */
  private readonly natives = new Map<string, NativeInfo>();
  /** Pages with text of their own that were left because the model was not here: read once it is. */
  private readonly waitingForModel = new Map<string, PageRef & { native: NativeInfo }>();
  private pumping = false;
  private parked = false;
  private lastActivity = Number.NEGATIVE_INFINITY;
  private running: PageRef | null = null;
  private done = 0;
  private failures = 0;
  private noticed = false;
  private disposed = false;
  private cancelWake: (() => void) | null = null;
  private cancelSave: (() => void) | null = null;
  private readonly unsubscribe: () => void;

  /** The model in use now. */
  private model(): ActiveOcrModel {
    return this.deps.model?.() ?? FAST_MODEL;
  }

  /**
   * The thresholds of the model that read a page (its `model` version; default:
   * the model in use), with every other number of OCR_TUNING. A page read by
   * another model is judged by that model's own confidences.
   */
  tuning(model?: string): OcrTuning {
    const tier = model === undefined ? undefined : OCR_TIERS.find((t) => t.version === model);
    return ocrTuningFor(tier ?? this.model());
  }

  constructor(private readonly deps: OcrDeps) {
    // The model arriving (from the card, or the settings) un-parks the queue.
    this.unsubscribe = deps.store.subscribe(() => {
      if (deps.store.state.kind !== "ready") return;
      this.parked = false;
      this.requeueWaiting();
      this.pump();
    });
  }

  // --- For the notebooks ------------------------------------------------------

  /** Whether scanned pages are read at all (the setting, and no run of failures). */
  get enabled(): boolean {
    return !this.disposed && this.deps.enabled() && this.failures < MAX_FAILURES;
  }

  /** Whether the text inside pictures is read too (the setting, on top of {@link enabled}). */
  get figures(): boolean {
    return this.enabled && this.deps.figures();
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

  /**
   * The model arrived: the pages left for want of it are queued again, in the
   * queue's usual order, if some open notebook still shows their PDF.
   */
  private requeueWaiting(): void {
    for (const [key, waiting] of [...this.waitingForModel]) {
      this.waitingForModel.delete(key);
      if (!this.ownerOf(waiting.path)) continue;
      this.natives.set(key, waiting.native);
      this.queue.add(waiting.path, waiting.page);
    }
    this.emit();
  }

  /**
   * "Read scanned PDF pages" or "Also read text inside figures" changed.
   * Open notebooks read their pages' text again (a page not looked at under
   * the new setting is classified now; what was read is kept, and shown only
   * while the setting allows), and what was queued for a setting that is now
   * off is left.
   */
  settingsChanged(): void {
    if (this.disposed) return;
    if (!this.figures) {
      for (const [key, waiting] of [...this.waitingForModel]) {
        if (waiting.native.plan?.condition === "TEXT_WITH_FIGURES")
          this.waitingForModel.delete(key);
      }
    }
    for (const owner of [...this.owners.keys()]) owner.ocrSettingsChanged?.();
    this.pump();
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
    for (const key of [...this.natives.keys()])
      if (key.startsWith(`${path}:`)) this.natives.delete(key);
    this.deps.raster.release(path);
  }

  /** The pen is down (`held`) or has been up a moment: nothing starts while it writes. */
  hold(owner: OcrOwner, held: boolean): void {
    if (held) {
      this.holders.add(owner);
      return;
    }
    this.holders.delete(owner);
    this.lastActivity = this.deps.now();
    if (this.holders.size === 0) this.pump();
  }

  /** The user is on page `page` of `path`. */
  focus(path: string, page: number): void {
    this.queue.focus(path, page);
    this.lastActivity = this.deps.now();
    this.pump();
  }

  /** The page's text read earlier, or null (not read, read by another model, or no way to tell). */
  async cached(path: string, page: number): Promise<StoredPage | null> {
    try {
      return cachedPage(await this.load(await this.deps.hashOf(path)), page, this.model().version);
    } catch (error) {
      console.warn("FineNotes: could not look up scanned-page text", error);
      return null;
    }
  }

  /**
   * What another model of this build read of the page, while the model in
   * use has not read it yet (after a switch): still shown, judged by its own
   * model's thresholds (`tuning(page.model)`), until the new reading replaces
   * it. Null when there is none.
   */
  async cachedStale(path: string, page: number): Promise<StoredPage | null> {
    try {
      const file = await this.load(await this.deps.hashOf(path));
      return staleCachedPage(
        file,
        page,
        this.model().version,
        OCR_TIERS.map((t) => t.version),
      );
    } catch (error) {
      console.warn("FineNotes: could not look up scanned-page text", error);
      return null;
    }
  }

  /**
   * Page `page` of `path` (of `pages`) needs reading. It is read when its
   * turn comes (see the queue); `owner` hears when it was. `native` says what
   * text the page has of its own: a page with none may make the model be
   * offered; one with some is read only if the model is already here.
   */
  want(owner: OcrOwner, path: string, page: number, pages: number, native: NativeInfo): void {
    if (!this.enabled) return;
    this.attach(owner, path);
    const key = refKey(path, page);
    const failedAt = this.failed.get(key);
    if (failedAt !== undefined && this.deps.now() - failedAt < RETRY_MS) return;
    this.natives.set(key, native);
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

  /**
   * Page `page` of `path` was looked at and has nothing to read (`TEXT_ONLY`:
   * text of its own, no figure). It is recorded, so that opening the PDF
   * again costs nothing: no operators, no raster, no model.
   */
  async recordTextOnly(
    path: string,
    page: number,
    size: { width: number; height: number },
  ): Promise<void> {
    this.queue.markProbed(path, page);
    try {
      const key = await this.deps.hashOf(path);
      const file = await this.load(key);
      const model = this.model().version;
      if (cachedPage(file, page, model)) return;
      this.caches.set(
        key,
        Promise.resolve(
          withPage(
            file,
            page,
            {
              condition: "TEXT_ONLY",
              regions: [],
              imageWidth: 0,
              imageHeight: 0,
              pageWidth: size.width,
              pageHeight: size.height,
              lines: [],
            },
            model,
          ),
        ),
      );
      this.dirty.add(key);
      this.scheduleSave();
    } catch (error) {
      console.warn("FineNotes: could not record a page that needs no reading", error);
    }
  }

  /** Forget what was read of `path` (all of it, on disk too); the notebooks ask for it again. */
  async dropCache(path: string): Promise<void> {
    this.queue.cancelPath(path);
    // A fresh start: the pages may have failed for a reason that is gone.
    this.failures = 0;
    for (const key of [...this.failed.keys()]) {
      if (key.startsWith(`${path}:`)) this.failed.delete(key);
    }
    try {
      const key = await this.deps.hashOf(path);
      this.caches.set(key, Promise.resolve(emptyCache()));
      this.dirty.delete(key);
      const file = cachePath(this.deps.pluginDir(), key);
      if (await this.deps.files.exists(file)) await this.deps.files.remove(file);
    } catch (error) {
      console.warn("FineNotes: could not drop the scanned-page cache", error);
    }
    this.emit();
    this.pump();
  }

  /**
   * The setting "OCR model" changed (or the model in use was removed): the
   * worker lets the old model go and loads the new one when next needed; what
   * was read by another model counts as not read (the cache records which
   * model read a page), so the notebooks ask for their pages again, and the
   * new model is offered if it is not on this device. The old model's files
   * stay.
   */
  modelChanged(): void {
    if (this.disposed) return;
    this.releaseModel();
    this.parked = false;
    this.failures = 0;
    this.failed.clear();
    const { store } = this.deps;
    void store.check?.(true).then(() => {
      if (this.disposed) return;
      if (store.state.kind === "ready") this.requeueWaiting();
      else if (this.enabled) this.deps.offer(true);
      this.pump();
    });
    // The notebooks read their pages' text again: with the new model's cache entries.
    for (const owner of [...this.owners.keys()]) owner.ocrSettingsChanged?.();
    this.pump();
  }

  /** The model's files are being removed or replaced. */
  releaseModel(): void {
    this.client?.dispose();
    this.client = null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelWake?.();
    this.cancelSave?.();
    this.unsubscribe();
    this.client?.dispose();
    this.deps.raster.dispose();
    this.listeners.clear();
    void this.persist(true);
  }

  // --- The loop ---------------------------------------------------------------

  private client: ClientLike | null = null;

  private idle(): boolean {
    return this.holders.size === 0 && this.deps.now() - this.lastActivity > IDLE_MS;
  }

  /** Start (or carry on) the loop; a second call while it runs does nothing. */
  pump(): void {
    if (this.pumping || this.disposed) return;
    void this.loop();
  }

  /** Resolves when the loop has nothing more to do right now (for tests). */
  async settledLoop(): Promise<void> {
    while (this.pumping) await this.deps.sleep(0);
  }

  private async loop(): Promise<void> {
    this.pumping = true;
    this.cancelWake?.();
    this.cancelWake = null;
    try {
      for (;;) {
        if (!this.enabled || this.owners.size === 0) return;
        if (this.holders.size > 0) return;
        if (this.parked) {
          if (this.deps.store.state.kind !== "ready") return;
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
          await this.deps.sleep(PROBE_PAUSE_MS);
          continue;
        }
        // Waiting for the page in view to rest, or for the pen to lift.
        if (this.queue.size() > 0 || this.queue.nextProbe(true)) {
          this.cancelWake = this.deps.later(() => this.pump(), 1000);
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
    this.failed.set(refKey(job.path, job.page), this.deps.now());
    console.warn(
      `FineNotes: could not read scanned page ${job.page + 1} of ${job.path}: ${errorMessage(error)}`,
      error,
    );
    if (!this.noticed) {
      this.noticed = true;
      this.deps.notice(t("ai.ocr.pageFailed"));
    }
  }

  private emptyPage(shot: RasterShot, condition: PagePlan["condition"]): OcrPage {
    return {
      imageWidth: shot.bitmap.width,
      imageHeight: shot.bitmap.height,
      pageWidth: shot.pageWidth,
      pageHeight: shot.pageHeight,
      lines: [],
      condition,
      regions: [],
    };
  }

  /** What to do with a page asked for without a plan: read it whole, as before pictures were looked at. */
  private planOf(native: NativeInfo): PagePlan {
    return (
      native.plan ?? {
        condition: native.items > 0 ? "SCANNED" : "NO_TEXT_NO_IMAGE_NOT_BLANK",
        regions: [],
        checkRest: false,
        known: false,
      }
    );
  }

  /** Whether the work on a page should stop now: the pen is down, or nobody shows its PDF. */
  private interrupted(path: string): boolean {
    return this.disposed || !this.enabled || this.holders.size > 0 || !this.ownerOf(path);
  }

  private async process(job: PageRef): Promise<void> {
    const { path, page } = job;
    const key = await this.deps.hashOf(path);
    const file = await this.load(key);
    const ref = refKey(path, page);
    const model = this.model();
    const native = this.natives.get(ref) ?? { items: 0, rects: [] };
    this.natives.delete(ref);
    // Queued while "Also read text inside figures" was on, and it is off now: left alone.
    if (native.plan?.condition === "TEXT_WITH_FIGURES" && !this.figures) return;
    if (!cachedPage(file, page, model.version)) {
      // A page with text of its own is read only if the model is here already;
      // only a page with none at all may make it be offered.
      if (native.items > 0 && (await this.deps.store.file()) === null) {
        this.waitingForModel.set(ref, { path, page, native });
        return;
      }
      const plan = this.planOf(native);
      const result =
        plan.condition === "TEXT_WITH_FIGURES" && !plan.checkRest
          ? await this.readRegions(job, native, plan, model)
          : await this.readWhole(job, native, plan, model);
      if (!result) return;
      this.failures = 0;
      // The setting changed while the page was read: it was read by a model no longer in use.
      if (this.model().version !== model.version) return;
      this.caches.set(
        key,
        Promise.resolve(withPage(await this.load(key), page, result, model.version)),
      );
      this.dirty.add(key);
      this.scheduleSave();
    }
    this.done++;
    for (const [owner, paths] of this.owners) if (paths.has(path)) owner.ocrReady(path, page);
  }

  /** The page was left (to be read when the model is here, or the pen lifts): queued again. */
  private requeue(job: PageRef, native: NativeInfo, parked: boolean): void {
    if (!this.ownerOf(job.path)) return;
    this.natives.set(refKey(job.path, job.page), native);
    this.queue.add(job.path, job.page);
    if (parked) this.parked = true;
  }

  /**
   * The whole page: drawn, checked for ink beyond its own text (and beyond
   * its figures, for a page that has some but little text), read if it has
   * any. Null when it was left for later (the model is not here, or the pen
   * went down).
   */
  private async readWhole(
    job: PageRef,
    native: NativeInfo,
    plan: PagePlan,
    model: ActiveOcrModel,
  ): Promise<OcrPage | null> {
    const { path, page } = job;
    const shot = await this.deps.raster.render(path, page);
    try {
      const masks: PixelRect[] = native.rects;
      // A sparse page with figures: its figures are not "the rest".
      const covered = plan.checkRest ? [...masks, ...plan.regions] : masks;
      const masked = covered.map((r) => ({
        x0: r.x0 * shot.scale,
        y0: r.y0 * shot.scale,
        x1: r.x1 * shot.scale,
        y1: r.y1 * shot.scale,
      }));
      if (!(await this.deps.hasInk(shot.bitmap, masked))) {
        // Nothing to read, or nothing beyond the page's own text: remembered
        // as read, so it is not drawn again.
        const empty = this.emptyPage(shot, settledCondition(plan, native.items > 0, false));
        shot.bitmap.close();
        if (plan.checkRest) return await this.readRegions(job, native, plan, model);
        return empty;
      }
      if (!(await this.modelReady())) {
        // Offered; the page waits for the model.
        shot.bitmap.close();
        this.requeue(job, native, true);
        return null;
      }
      const started = this.deps.now();
      const client = await this.worker();
      await client.ensureModel(model.key, () => this.readModel(model), model.confidence);
      // The worker takes the bitmap and closes it.
      const read = await client.read(shot.bitmap, shot.scale, shot.pageWidth, shot.pageHeight);
      console.debug(
        `FineNotes: read scanned page ${page + 1} of ${path} in ${this.deps.now() - started} ms`,
        read.steps,
      );
      return {
        ...read.page,
        condition: settledCondition(plan, native.items > 0, true),
        regions: [{ x0: 0, y0: 0, x1: shot.pageWidth, y1: shot.pageHeight, dpi: null }],
      };
    } catch (error) {
      shot.bitmap.close();
      throw error;
    }
  }

  /**
   * Only the plan's regions (the figures), one at a time: each drawn at its
   * own resolution, checked for ink beyond the page's own text, read, its
   * words put back on the page. Null when it was left for later.
   */
  private async readRegions(
    job: PageRef,
    native: NativeInfo,
    plan: PagePlan,
    model: ActiveOcrModel,
  ): Promise<OcrPage | null> {
    const { path, page } = job;
    if (!(await this.modelReady(native.items === 0))) {
      // Only a page with no text at all may make the model be offered; the others wait for it.
      if (native.items > 0) this.waitingForModel.set(refKey(path, page), { path, page, native });
      else this.requeue(job, native, true);
      return null;
    }
    const started = this.deps.now();
    const lines: OcrLine[] = [];
    const size = { imageWidth: 0, imageHeight: 0, pageWidth: 0, pageHeight: 0 };
    let loaded = false;
    // The figures first, then a backdrop (whose ink check leaves them out).
    const figures = plan.regions.filter((r) => !r.backdrop);
    const ordered = [...figures, ...plan.regions.filter((r) => r.backdrop)];
    for (const region of ordered) {
      if (this.interrupted(path)) {
        this.requeue(job, native, false);
        return null;
      }
      const shot = await this.deps.raster.render(path, page, region);
      try {
        size.imageWidth = Math.max(size.imageWidth, shot.bitmap.width);
        size.imageHeight = Math.max(size.imageHeight, shot.bitmap.height);
        size.pageWidth = shot.pageWidth;
        size.pageHeight = shot.pageHeight;
        const ox = shot.origin?.x ?? 0;
        const oy = shot.origin?.y ?? 0;
        // The page's own text is not read again; nor are the figures on a backdrop.
        const covered: PixelRect[] = region.backdrop ? [...native.rects, ...figures] : native.rects;
        const masked = covered.map((r) => ({
          x0: (r.x0 - ox) * shot.scale,
          y0: (r.y0 - oy) * shot.scale,
          x1: (r.x1 - ox) * shot.scale,
          y1: (r.y1 - oy) * shot.scale,
        }));
        // Content, not ink: a plain, gradient or textured fill under the text is not a figure.
        if (!(await this.deps.hasInk(shot.bitmap, masked, true))) {
          shot.bitmap.close();
          continue;
        }
        const client = await this.worker();
        if (!loaded) {
          await client.ensureModel(model.key, () => this.readModel(model), model.confidence);
          loaded = true;
        }
        const read = await client.read(
          shot.bitmap,
          shot.scale,
          shot.pageWidth,
          shot.pageHeight,
          shot.origin,
        );
        for (const line of read.page.lines) {
          // What a backdrop's reading found inside a figure was read there, at its own resolution.
          const words = region.backdrop
            ? line.words.filter((w) => !figures.some((f) => inside(w.box, f)))
            : line.words;
          if (words.length > 0) lines.push({ ...line, words });
        }
      } catch (error) {
        shot.bitmap.close();
        throw error;
      }
    }
    console.debug(
      `FineNotes: read ${plan.regions.length} figure area(s) of page ${page + 1} of ${path} in ${this.deps.now() - started} ms`,
    );
    return { ...size, lines, condition: "TEXT_WITH_FIGURES", regions: plan.regions };
  }

  // --- The model --------------------------------------------------------------

  private async worker(): Promise<ClientLike> {
    this.client ??= await this.deps.client();
    return this.client;
  }

  /**
   * True when the model is here; otherwise says false, after offering the
   * download card unless `offer` is false.
   */
  private async modelReady(offer = true): Promise<boolean> {
    if ((await this.deps.store.file()) !== null) return true;
    if (offer) this.deps.offer();
    return false;
  }

  private async readModel(model: ActiveOcrModel): Promise<OcrFiles> {
    const get = async (name: string): Promise<ArrayBuffer> => {
      const bytes = await this.deps.store.bytes(name);
      if (!bytes) throw new Error(`the OCR model's ${name} is missing or damaged`);
      return bytes;
    };
    const dict = new TextDecoder("utf-8").decode(await get(model.dict));
    return {
      det: await get(OCR_DET_FILE.name),
      rec: await get(model.rec),
      dict,
      wasm: await get(OCR_WASM_FILE.name),
    };
  }

  // --- The sidecar ------------------------------------------------------------

  private load(key: string): Promise<OcrCacheFile> {
    let loaded = this.caches.get(key);
    if (!loaded) {
      loaded = this.readFile(key);
      this.caches.set(key, loaded);
    }
    return loaded;
  }

  private async readFile(key: string): Promise<OcrCacheFile> {
    const file = cachePath(this.deps.pluginDir(), key);
    try {
      if (!(await this.deps.files.exists(file))) return emptyCache();
      return parseCache(await this.deps.files.read(file));
    } catch (error) {
      console.warn("FineNotes: could not read a scanned-page cache", error);
      return emptyCache();
    }
  }

  private scheduleSave(): void {
    this.cancelSave?.();
    this.cancelSave = this.deps.later(() => void this.persist(false), SAVE_MS);
  }

  /** Write the changed sidecars, merged with what another device may have added. */
  async persist(final: boolean): Promise<void> {
    if (!final && this.holders.size > 0) {
      // The pen is writing: a little later.
      this.scheduleSave();
      return;
    }
    const { files } = this.deps;
    for (const key of [...this.dirty]) {
      this.dirty.delete(key);
      try {
        const ours = await (this.caches.get(key) ?? Promise.resolve(emptyCache()));
        const folder = cacheFolder(this.deps.pluginDir());
        const file = cachePath(this.deps.pluginDir(), key);
        const temp = `${file}.tmp`;
        if (!(await files.exists(folder))) await files.mkdir(folder);
        const theirs = (await files.exists(file))
          ? parseCache(await files.read(file))
          : emptyCache();
        const merged = mergeCaches(theirs, ours, this.model().version);
        this.caches.set(key, Promise.resolve(merged));
        // Through a temporary name, then moved into place: a half-written
        // file is never what sync carries off.
        await files.write(temp, serializeCache(merged));
        if (await files.exists(file)) await files.remove(file);
        await files.rename(temp, file);
      } catch (error) {
        console.warn("FineNotes: could not save the scanned-page cache", error);
        this.dirty.add(key);
      }
    }
  }
}
