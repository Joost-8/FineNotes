/**
 * Decoded pictures for placed images — the image counterpart of
 * `PdfBackdropCache`, and the `ImagePainter` the renderer draws them with.
 *
 * Painting is synchronous and never waits: a picture that is not decoded yet
 * paints a faint stand-in and is decoded in the background, and `onReady`
 * fires when it lands so the view can repaint the tiles it covers. A file
 * that is missing or will not decode paints a "missing image" placeholder —
 * the element itself is never dropped.
 *
 * The rules the ledger learned on the PDF cache hold here too:
 *
 * - **Quantised keys.** A picture is decoded at a power-of-two resolution
 *   (`decodeBucket`) that suits how large it is on screen, never at the
 *   continuous `size × devicePixelRatio × zoom` a pinch sweeps through, and
 *   never larger than its own pixels. The same file placed twice shares its
 *   decodes: the key is the path.
 * - **Bounded.** A byte budget with LRU eviction. Evicting a decode never
 *   loses anything: the tiles it was drawn into keep their pixels, and a
 *   later tile simply decodes it again. The budget is soft over a hard cap:
 *   a decode drawn in the last moment is not evicted to make room, because
 *   with several large pictures sharing tiles, strict LRU could evict one to
 *   fit another, re-rasterise, evict the second to fit the first, and never
 *   settle — a decode loop no one could see on an iPad.
 * - **One at a time, mostly.** At most two decodes run at once — a 12 MP
 *   photo briefly needs ~48 MB decoded, and an iPad's web view is killed
 *   rather than slowed when memory runs out — and a request for a size no
 *   larger than one already in flight waits for that one instead.
 */

import type { App } from "obsidian";
import { LIGHT_PAPER } from "../canvas/backdrop";
import { cropSourceRect, pictureLongSide } from "../canvas/image-crop";
import {
  bucketSize,
  chooseCachedBucket,
  decodeBucket,
  drawImagePlaceholder,
  mimeForExtension,
} from "../canvas/image-raster";
import type { ImagePainter } from "../canvas/renderer";
import { ByteLru } from "../canvas/tile-grid";
import type { ImageElement } from "../model/document";
import { decodeToCanvas, releaseCanvas } from "./image-import";
import { errorMessage } from "../util/errors";

/**
 * Decoded pictures kept at once. A 2048 px photo is ~12 MB decoded, a 1024 px
 * one ~3 MB; the tiles hold what is on screen anyway, so this only has to
 * cover the pictures being re-rasterised in the meantime.
 */
const SOFT_BUDGET = 48 * 1024 * 1024;
/** Never exceeded, recent use or not. */
const HARD_BUDGET = 128 * 1024 * 1024;
/** A decode drawn within this long is not evicted to meet {@link SOFT_BUDGET}. */
const RECENT_USE_MS = 1500;
const MAX_CONCURRENT_DECODES = 2;

interface Decoded {
  path: string;
  bucket: number;
  canvas: HTMLCanvasElement;
  /** When a paint last drew it (ms, `performance.now()`). */
  lastUsed: number;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface DecodeJob {
  path: string;
  bucket: number;
  generation: number;
}

function keyOf(path: string, bucket: number): string {
  return `${bucket}|${path}`;
}

export class VaultImageCache implements ImagePainter {
  /** A decode for `path` landed, or turned out missing. The view repaints what shows it. */
  onReady: ((path: string) => void) | null = null;
  /** Placeholder colour: the paper theme's marker. */
  marker = LIGHT_PAPER.marker;

  private readonly bitmaps = new ByteLru<Decoded>(HARD_BUDGET, (entry) => this.evicted(entry));
  /** path -> buckets currently cached, kept in step with the LRU. */
  private readonly buckets = new Map<string, Set<number>>();
  /** path -> why it could not be drawn. Cleared by {@link forget}. */
  private readonly misses = new Map<string, string>();
  /** path -> the largest bucket being decoded for it. */
  private readonly inflight = new Map<string, number>();
  /** path -> bumped by {@link forget}, so a decode of an older file is dropped. */
  private readonly generations = new Map<string, number>();
  private readonly queue: DecodeJob[] = [];
  /** path -> {@link prepare} calls waiting for a decode of it to finish. */
  private readonly waiters = new Map<string, Array<() => void>>();
  private active = 0;
  private destroyed = false;

  constructor(private readonly app: App) {}

  /**
   * Synchronous: draws what is decoded now and asks for anything better. A
   * cropped picture draws only its crop's part of the bitmap, mapped to the
   * decoded size; the file is never touched (`src/canvas/image-crop.ts`).
   */
  paintImage(ctx: CanvasRenderingContext2D, image: ImageElement, deviceScale: number): void {
    const px = deviceScale > 0 ? 1 / deviceScale : 1;
    if (this.misses.has(image.path)) {
      drawImagePlaceholder(ctx, image.w, image.h, true, px, this.marker);
      return;
    }
    // A crop enlarges what is shown of the picture, so the decode must cover
    // the whole picture at that enlargement, not just the element's box.
    const wanted = decodeBucket(pictureLongSide(image) * deviceScale);
    const choice = chooseCachedBucket(this.buckets.get(image.path) ?? [], wanted);
    const entry = choice.use === null ? undefined : this.bitmaps.get(keyOf(image.path, choice.use));
    if (entry) {
      entry.lastUsed = now();
      if (image.crop) {
        const { canvas } = entry;
        const src = cropSourceRect(image.crop, canvas.width, canvas.height);
        if (src.sw > 0 && src.sh > 0) {
          ctx.drawImage(canvas, src.sx, src.sy, src.sw, src.sh, 0, 0, image.w, image.h);
        }
      } else {
        ctx.drawImage(entry.canvas, 0, 0, image.w, image.h);
      }
    } else {
      drawImagePlaceholder(ctx, image.w, image.h, false, px, this.marker);
    }
    if (choice.decode || !entry) this.request(image.path, wanted);
  }

  /**
   * Resolve once every picture in `images` can be painted at `deviceScale`
   * without a stand-in — decoded at that size, or known to be missing. For
   * one-shot renders (PDF export), where a placeholder box would be baked
   * into the file. Never rejects; a decode that fails is simply a miss.
   */
  async prepare(images: readonly ImageElement[], deviceScale: number): Promise<void> {
    for (const image of images) {
      // More than one round: a decode already in flight for a smaller size is waited
      // for first, and only then is the size asked for queued.
      for (let round = 0; round < 3 && !this.destroyed; round++) {
        if (this.misses.has(image.path)) break;
        const wanted = decodeBucket(pictureLongSide(image) * deviceScale);
        const choice = chooseCachedBucket(this.buckets.get(image.path) ?? [], wanted);
        if (choice.use !== null && !choice.decode) break;
        const landed = new Promise<void>((resolve) => {
          const list = this.waiters.get(image.path) ?? [];
          list.push(resolve);
          this.waiters.set(image.path, list);
        });
        this.request(image.path, wanted);
        if (!this.inflight.has(image.path)) this.settle(image.path);
        await landed;
      }
    }
  }

  /**
   * The file at `path` changed (created, modified, deleted, renamed): drop
   * everything decoded from it so the next paint reads it afresh. Returns
   * whether the cache knew the path — only then is a repaint worth it.
   */
  forget(path: string): boolean {
    const known = this.buckets.has(path) || this.misses.has(path) || this.inflight.has(path);
    this.generations.set(path, (this.generations.get(path) ?? 0) + 1);
    this.bitmaps.deleteWhere((entry) => entry.path === path);
    this.buckets.delete(path);
    this.misses.delete(path);
    this.inflight.delete(path);
    // A decode of the old file will be dropped; waiters ask again.
    this.settle(path);
    return known;
  }

  destroy(): void {
    this.destroyed = true;
    this.onReady = null;
    this.queue.length = 0;
    this.bitmaps.clear();
    this.buckets.clear();
    this.misses.clear();
    this.inflight.clear();
    for (const path of [...this.waiters.keys()]) this.settle(path);
  }

  /** Wake every {@link prepare} waiting on `path`; they re-check what is cached. */
  private settle(path: string): void {
    const list = this.waiters.get(path);
    if (!list) return;
    this.waiters.delete(path);
    for (const resolve of list) resolve();
  }

  /**
   * Evict least-recently drawn decodes down to the soft budget, stopping at
   * the first one drawn within {@link RECENT_USE_MS}: the LRU is in order of
   * use, so everything after it is recent too. (The hard budget is the LRU's
   * own, and holds regardless.)
   */
  private trim(): void {
    const cutoff = now() - RECENT_USE_MS;
    for (const entry of [...this.bitmaps.values()]) {
      if (this.bitmaps.bytes <= SOFT_BUDGET || entry.lastUsed > cutoff) return;
      this.bitmaps.delete(keyOf(entry.path, entry.bucket));
    }
  }

  private evicted(entry: Decoded): void {
    releaseCanvas(entry.canvas);
    const set = this.buckets.get(entry.path);
    if (!set) return;
    set.delete(entry.bucket);
    if (set.size === 0) this.buckets.delete(entry.path);
  }

  private request(path: string, bucket: number): void {
    if (this.destroyed) return;
    if ((this.inflight.get(path) ?? 0) >= bucket) return;
    this.inflight.set(path, bucket);
    this.queue.push({ path, bucket, generation: this.generations.get(path) ?? 0 });
    this.pump();
  }

  private pump(): void {
    while (!this.destroyed && this.active < MAX_CONCURRENT_DECODES) {
      const job = this.queue.shift();
      if (!job) return;
      if (job.generation !== (this.generations.get(job.path) ?? 0)) continue;
      this.active++;
      void this.decode(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async decode(job: DecodeJob): Promise<void> {
    let canvas: HTMLCanvasElement | null = null;
    let miss: string | null = null;
    try {
      const file = this.app.vault.getFileByPath(job.path);
      if (!file) {
        miss = `Missing image — ${job.path}`;
      } else {
        const mime = mimeForExtension(file.extension) ?? "";
        const vector = mime === "image/svg+xml";
        const bytes = await this.app.vault.readBinary(file);
        const decoded = await decodeToCanvas(bytes, mime, (w, h) =>
          bucketSize(w, h, job.bucket, vector),
        );
        canvas = decoded.canvas;
      }
    } catch (error) {
      miss = errorMessage(error);
    }

    const stale = this.destroyed || job.generation !== (this.generations.get(job.path) ?? 0);
    if (stale) {
      if (canvas) releaseCanvas(canvas);
      this.settle(job.path);
      return;
    }
    if (this.inflight.get(job.path) === job.bucket) this.inflight.delete(job.path);
    if (canvas) {
      this.bitmaps.set(
        keyOf(job.path, job.bucket),
        { path: job.path, bucket: job.bucket, canvas, lastUsed: now() },
        canvas.width * canvas.height * 4,
      );
      let set = this.buckets.get(job.path);
      if (!set) {
        set = new Set();
        this.buckets.set(job.path, set);
      }
      set.add(job.bucket);
      this.trim();
    } else {
      this.misses.set(job.path, miss ?? "The picture could not be read");
    }
    this.onReady?.(job.path);
    this.settle(job.path);
  }
}
