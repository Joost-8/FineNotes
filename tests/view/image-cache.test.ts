/**
 * The decode cache's bookkeeping — deduplication, buckets, misses, staleness,
 * concurrency — with the DOM decode step replaced by a controllable fake.
 * `image-cache.ts` only type-imports Obsidian, so it loads under Node.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { ImageElement } from "../../src/model/document";
import { fakeContext, asCanvasContext, type FakeContext } from "../canvas/fake-canvas";

interface FakeCanvas {
  width: number;
  height: number;
}

interface Pending {
  sizeFor: (w: number, h: number) => { width: number; height: number };
  resolve: (canvas: FakeCanvas) => void;
  reject: (error: Error) => void;
}

const pending: Pending[] = [];

vi.mock("../../src/view/image-import", () => ({
  decodeToCanvas: vi.fn(
    (_bytes: ArrayBuffer, _mime: string, sizeFor: Pending["sizeFor"]) =>
      new Promise((resolve, reject) => {
        pending.push({
          sizeFor,
          resolve: (canvas) => resolve({ canvas, naturalWidth: 4000, naturalHeight: 3000 }),
          reject,
        });
      }),
  ),
  releaseCanvas: vi.fn((canvas: FakeCanvas) => {
    canvas.width = 0;
    canvas.height = 0;
  }),
}));

const { VaultImageCache } = await import("../../src/view/image-cache");

function fakeApp(files: Record<string, string>): App {
  return {
    vault: {
      getFileByPath: (path: string) => (path in files ? { path, extension: files[path] } : null),
      readBinary: () => Promise.resolve(new ArrayBuffer(8)),
    },
  } as unknown as App;
}

function image(path: string, w = 600, h = 450): ImageElement {
  return { id: "i1", path, x: 0, y: 0, w, h };
}

/** A fake 2D context that also records `drawImage`. */
function ctxWithDraws(): { ctx: FakeContext; draws: FakeCanvas[] } {
  const ctx = fakeContext();
  const draws: FakeCanvas[] = [];
  Object.assign(ctx, { drawImage: (canvas: FakeCanvas) => draws.push(canvas) });
  return { ctx, draws };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Settle the oldest pending decode at the size it asked for. */
async function land(): Promise<FakeCanvas> {
  await flush();
  const job = pending.shift();
  if (!job) throw new Error("no decode pending");
  const canvas = job.sizeFor(4000, 3000);
  job.resolve(canvas);
  await flush();
  return canvas;
}

beforeEach(() => {
  pending.length = 0;
});

describe("VaultImageCache", () => {
  it("draws a stand-in, decodes once, then draws the picture", async () => {
    const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
    const ready: string[] = [];
    cache.onReady = (path) => ready.push(path);

    const first = ctxWithDraws();
    cache.paintImage(asCanvasContext(first.ctx), image("a.jpg"), 1.5);
    expect(first.draws).toHaveLength(0);
    expect(first.ctx.ops.some((op) => op.op === "fillRect")).toBe(true);

    const canvas = await land();
    // 600 page px at 1.5 device px each wants 900 px: the 1024 bucket.
    expect(canvas).toEqual({ width: 1024, height: 768 });
    expect(ready).toEqual(["a.jpg"]);

    const second = ctxWithDraws();
    cache.paintImage(asCanvasContext(second.ctx), image("a.jpg"), 1.5);
    expect(second.draws).toEqual([canvas]);
    expect(pending).toHaveLength(0);
  });

  it("shares one decode between placements of the same file", async () => {
    const cache = new VaultImageCache(fakeApp({ "a.png": "png" }));
    const { ctx } = ctxWithDraws();
    cache.paintImage(asCanvasContext(ctx), image("a.png"), 1.5);
    cache.paintImage(asCanvasContext(ctx), { ...image("a.png"), id: "i2" }, 1.5);
    cache.paintImage(asCanvasContext(ctx), image("a.png", 300, 225), 1.5);
    await flush();
    expect(pending).toHaveLength(1);
  });

  it("draws a larger decode for a smaller need without decoding again", async () => {
    const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
    const { ctx } = ctxWithDraws();
    cache.paintImage(asCanvasContext(ctx), image("a.jpg"), 3);
    const big = await land();
    const small = ctxWithDraws();
    cache.paintImage(asCanvasContext(small.ctx), image("a.jpg"), 1);
    expect(small.draws).toEqual([big]);
    await flush();
    expect(pending).toHaveLength(0);
  });

  it("marks a missing file once and keeps drawing the placeholder", async () => {
    const cache = new VaultImageCache(fakeApp({}));
    const ready: string[] = [];
    cache.onReady = (path) => ready.push(path);
    const { ctx } = ctxWithDraws();
    cache.paintImage(asCanvasContext(ctx), image("gone.png"), 1);
    await flush();
    expect(ready).toEqual(["gone.png"]);
    const again = ctxWithDraws();
    cache.paintImage(asCanvasContext(again.ctx), image("gone.png"), 1);
    expect(again.ctx.ops.some((op) => op.op === "strokeRect")).toBe(true);
    expect(again.draws).toHaveLength(0);
    await flush();
    expect(pending).toHaveLength(0);
  });

  it("treats a file that will not decode as missing", async () => {
    const cache = new VaultImageCache(fakeApp({ "bad.png": "png" }));
    const ready: string[] = [];
    cache.onReady = (path) => ready.push(path);
    cache.paintImage(asCanvasContext(fakeContext()), image("bad.png"), 1);
    await flush();
    pending.shift()?.reject(new Error("The picture could not be decoded"));
    await flush();
    expect(ready).toEqual(["bad.png"]);
    const again = fakeContext();
    cache.paintImage(asCanvasContext(again), image("bad.png"), 1);
    expect(again.ops.some((op) => op.op === "strokeRect")).toBe(true);
  });

  it("forgets a changed file, dropping a decode of the old one", async () => {
    const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
    const ready: string[] = [];
    cache.onReady = (path) => ready.push(path);
    cache.paintImage(asCanvasContext(fakeContext()), image("a.jpg"), 1);
    await flush();
    expect(cache.forget("a.jpg")).toBe(true);
    expect(cache.forget("never-seen.png")).toBe(false);
    await land();
    expect(ready).toEqual([]);
    // Painted again, it decodes afresh.
    cache.paintImage(asCanvasContext(fakeContext()), image("a.jpg"), 1);
    await land();
    expect(ready).toEqual(["a.jpg"]);
  });

  it("runs at most two decodes at once", async () => {
    const files = { "a.jpg": "jpg", "b.jpg": "jpg", "c.jpg": "jpg" };
    const cache = new VaultImageCache(fakeApp(files));
    for (const path of Object.keys(files)) {
      cache.paintImage(asCanvasContext(fakeContext()), image(path), 1);
    }
    await flush();
    expect(pending).toHaveLength(2);
    await land();
    await flush();
    expect(pending).toHaveLength(2);
  });

  it("draws only a cropped picture's part, decoded for the whole picture", async () => {
    const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
    const cropped: ImageElement = {
      ...image("a.jpg", 300, 225),
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    cache.paintImage(asCanvasContext(fakeContext()), cropped, 1.5);
    // 300 page px is half the picture: 600 x 1.5 = 900 device px, the 1024 bucket.
    const canvas = await land();
    expect(canvas).toEqual({ width: 1024, height: 768 });
    const ctx = fakeContext();
    const calls: unknown[][] = [];
    Object.assign(ctx, { drawImage: (...args: unknown[]) => calls.push(args) });
    cache.paintImage(asCanvasContext(ctx), cropped, 1.5);
    expect(calls).toEqual([[canvas, 512, 0, 512, 768, 0, 0, 300, 225]]);
    // A missing picture still shows its placeholder at the visible box.
    const gone = new VaultImageCache(fakeApp({}));
    gone.paintImage(asCanvasContext(fakeContext()), cropped, 1);
    await flush();
    const again = fakeContext();
    gone.paintImage(asCanvasContext(again), cropped, 1);
    expect(again.ops.find((op) => op.op === "fillRect")).toMatchObject({ w: 300, h: 225 });
  });

  it("stays quiet after it is destroyed", async () => {
    const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
    const ready: string[] = [];
    cache.onReady = (path) => ready.push(path);
    cache.paintImage(asCanvasContext(fakeContext()), image("a.jpg"), 1);
    await flush();
    cache.destroy();
    await land();
    expect(ready).toEqual([]);
  });

  describe("prepare", () => {
    it("resolves only once the picture is decoded at the size asked for", async () => {
      const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
      let done = false;
      const ready = cache.prepare([image("a.jpg")], 2).then(() => (done = true));
      await flush();
      expect(done).toBe(false);
      const canvas = await land();
      await ready;
      // 600 page px at 2 device px each wants 1200 px: the 2048 bucket.
      expect(canvas.width).toBe(2048);

      const { ctx, draws } = ctxWithDraws();
      cache.paintImage(asCanvasContext(ctx), image("a.jpg"), 2);
      expect(draws).toEqual([canvas]);
    });

    it("does not settle for a smaller decode that lands first", async () => {
      const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
      const { ctx } = ctxWithDraws();
      cache.paintImage(asCanvasContext(ctx), image("a.jpg", 300, 225), 1);
      let done = false;
      const ready = cache.prepare([image("a.jpg")], 3).then(() => (done = true));
      await flush();
      expect(pending).toHaveLength(2);
      await land();
      expect(done).toBe(false);
      const big = await land();
      await ready;
      expect(big.width).toBe(2048);
    });

    it("returns at once for a picture already decoded, and for none", async () => {
      const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
      await cache.prepare([], 2);
      const first = cache.prepare([image("a.jpg")], 1);
      await land();
      await first;
      await cache.prepare([image("a.jpg")], 1);
      expect(pending).toHaveLength(0);
    });

    it("resolves for a missing file, which then paints as missing", async () => {
      const cache = new VaultImageCache(fakeApp({}));
      await cache.prepare([image("gone.jpg")], 2);
      expect(pending).toHaveLength(0);
    });

    it("asks again when the file changes mid-decode", async () => {
      const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
      const ready = cache.prepare([image("a.jpg")], 1);
      await flush();
      cache.forget("a.jpg");
      await flush();
      // The old decode lands and is dropped; the fresh one is what counts.
      expect(pending).toHaveLength(2);
      await land();
      const fresh = await land();
      await ready;
      const { ctx, draws } = ctxWithDraws();
      cache.paintImage(asCanvasContext(ctx), image("a.jpg"), 1);
      expect(draws).toEqual([fresh]);
    });

    it("resolves when the cache is destroyed mid-decode", async () => {
      const cache = new VaultImageCache(fakeApp({ "a.jpg": "jpg" }));
      const ready = cache.prepare([image("a.jpg")], 1);
      await flush();
      cache.destroy();
      await expect(ready).resolves.toBeUndefined();
    });
  });
});
