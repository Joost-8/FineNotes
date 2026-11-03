/**
 * What the OCR service (ocr-service.ts) runs on in Obsidian: the vault's
 * files, the shared PDF worker's rasteriser, the OCR worker (imported only
 * when the first page is read, as the other workers are), the model's
 * download card, notices and the clock.
 */

import { type App, Notice, normalizePath } from "obsidian";
import { type PixelRect, hasEdgesOutside, hasInkOutside } from "../recognition/ocr/blank";
import { OCR_MODEL } from "../recognition/ocr/ocr-model";
import { toHex } from "../downloads/model-manifest";
import type { AssetStore } from "../downloads/model-store";
import type { ModelRegistry } from "./model-downloads";
import { OcrRasteriser } from "./ocr-raster";
import type { OcrDeps } from "./ocr-service";

/** The longest side of the copy of a page checked for ink, px. */
const INK_EDGE = 256;
/** ... and of a copy checked for edges, which needs the strokes of small print to survive, px. */
const EDGE_EDGE = 640;

export interface ObsidianOcrHost {
  app: App;
  pluginDir(): string;
  models: ModelRegistry;
  enabled(): boolean;
  figures(): boolean;
}

export function obsidianOcrDeps(host: ObsidianOcrHost): { deps: OcrDeps; store: AssetStore } {
  const { app } = host;
  const store = host.models.register(OCR_MODEL);
  const adapter = app.vault.adapter;
  const hashes = new Map<string, { stamp: string; key: Promise<string> }>();
  const deps: OcrDeps = {
    pluginDir: () => host.pluginDir(),
    enabled: () => host.enabled(),
    figures: () => host.figures(),
    store,
    offer: () => host.models.offer(OCR_MODEL.id, "auto"),
    raster: new OcrRasteriser(app),
    client: async () => {
      const { OcrClient } = await import("../recognition/ocr/client");
      return new OcrClient();
    },
    hasInk: async (bitmap: ImageBitmap, masked: PixelRect[], edges = false) => {
      const k = Math.min(1, (edges ? EDGE_EDGE : INK_EDGE) / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * k));
      const h = Math.max(1, Math.round(bitmap.height * k));
      const canvas = createEl("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      // No canvas to look with: read the page.
      if (!context) return true;
      try {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, w, h);
        context.imageSmoothingEnabled = true;
        context.drawImage(bitmap, 0, 0, w, h);
        const scaled = masked.map((r) => ({
          x0: r.x0 * k,
          y0: r.y0 * k,
          x1: r.x1 * k,
          y1: r.y1 * k,
        }));
        const pixels = context.getImageData(0, 0, w, h).data;
        return edges ? hasEdgesOutside(pixels, w, scaled) : hasInkOutside(pixels, w, scaled);
      } finally {
        canvas.width = canvas.height = 0;
      }
    },
    // The SHA-256 of the PDF's bytes, kept while the file is unchanged.
    hashOf: (path) => {
      const file = app.vault.getFileByPath(path);
      if (!file) return Promise.reject(new Error(`missing PDF ${path}`));
      const stamp = `${file.stat.mtime}:${file.stat.size}`;
      const known = hashes.get(path);
      if (known && known.stamp === stamp) return known.key;
      const key = (async () => {
        // Read-only. The bytes are dropped as soon as they are hashed.
        const bytes = await app.vault.readBinary(file);
        return toHex(await crypto.subtle.digest("SHA-256", bytes));
      })();
      hashes.set(path, { stamp, key });
      key.catch(() => {
        if (hashes.get(path)?.key === key) hashes.delete(path);
      });
      return key;
    },
    files: {
      exists: (path) => adapter.exists(normalizePath(path)),
      read: (path) => adapter.read(normalizePath(path)),
      write: (path, data) => adapter.write(normalizePath(path), data),
      remove: (path) => adapter.remove(normalizePath(path)),
      rename: (from, to) => adapter.rename(normalizePath(from), normalizePath(to)),
      mkdir: (path) => adapter.mkdir(normalizePath(path)),
    },
    notice: (text) => {
      new Notice(text, 8000);
    },
    now: () => Date.now(),
    later: (fn, ms) => {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  };
  return { deps, store };
}
