/**
 * The OCR service's decisions, with everything it runs on faked: the
 * rasteriser, the worker, the model store, the files, the clock and the
 * pen. Pins when a page is read, in which order, what is offered, what is
 * cached and written, and what a failure does.
 */

import { describe, expect, it } from "vitest";
import {
  emptyCache,
  parseCache,
  serializeCache,
  withPage,
} from "../../src/recognition/ocr/ocr-cache";
import { OCR_MODEL } from "../../src/recognition/ocr/ocr-model";
import type { OcrPage } from "../../src/recognition/ocr/ocr-words";
import {
  IDLE_MS,
  MAX_FAILURES,
  type NativeInfo,
  type OcrDeps,
  type OcrOwner,
  OcrService,
  RETRY_MS,
  SAVE_MS,
} from "../../src/view/ocr-service";

const PLUGIN = "plugins/finenotes";
const hashOf = (path: string): string =>
  path.charCodeAt(0).toString(16).padStart(2, "0").repeat(32);
const sidecar = (path: string): string => `${PLUGIN}/ocr/${hashOf(path)}.json`;

const PAGE: OcrPage = {
  imageWidth: 600,
  imageHeight: 800,
  pageWidth: 300,
  pageHeight: 400,
  lines: [{ conf: 0.99, words: [{ text: "Hello", box: [10, 10, 60, 24], conf: 0.99, min: 0.9 }] }],
};
const NONE: NativeInfo = { items: 0, rects: [] };

function rig(options: { ready?: boolean; ink?: boolean } = {}) {
  const log = {
    rendered: [] as string[],
    closed: 0,
    read: [] as string[],
    ensured: 0,
    offers: 0,
    notices: [] as string[],
    released: [] as string[],
    masked: [] as unknown[],
    writes: [] as string[],
  };
  const state = { ready: options.ready ?? true, ink: options.ink ?? true, failRender: false };
  let t = 1_000_000;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const files = new Map<string, string>();
  const listeners = new Set<() => void>();
  const store = {
    get state() {
      return { kind: state.ready ? "ready" : "missing" };
    },
    file: () => Promise.resolve(state.ready ? "x" : null),
    bytes: () => Promise.resolve(new ArrayBuffer(1)),
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const deps: OcrDeps = {
    pluginDir: () => PLUGIN,
    enabled: () => true,
    store,
    offer: () => {
      log.offers++;
    },
    raster: {
      render: (path, page) => {
        log.rendered.push(`${path}#${page}`);
        if (state.failRender) return Promise.reject(new Error("no canvas"));
        const bitmap = {
          width: 600,
          height: 800,
          close: () => log.closed++,
        } as unknown as ImageBitmap;
        return Promise.resolve({ bitmap, scale: 2, pageWidth: 300, pageHeight: 400 });
      },
      release: (path) => {
        log.released.push(path);
      },
      dispose: () => undefined,
    },
    client: () =>
      Promise.resolve({
        ensureModel: () => {
          log.ensured++;
          return Promise.resolve();
        },
        read: (bitmap) => {
          log.read.push(String(bitmap.width));
          return Promise.resolve({ page: PAGE, steps: {} });
        },
        dispose: () => undefined,
      }),
    hasInk: (_bitmap, masked) => {
      log.masked.push(masked);
      return Promise.resolve(state.ink);
    },
    hashOf: (path) => Promise.resolve(hashOf(path)),
    files: {
      exists: (p) => Promise.resolve(files.has(p) || p === `${PLUGIN}/ocr`),
      read: (p) => Promise.resolve(files.get(p) ?? ""),
      write: (p, d) => {
        log.writes.push(p);
        files.set(p, d);
        return Promise.resolve();
      },
      remove: (p) => {
        files.delete(p);
        return Promise.resolve();
      },
      rename: (a, b) => {
        files.set(b, files.get(a) ?? "");
        files.delete(a);
        return Promise.resolve();
      },
      mkdir: () => Promise.resolve(),
    },
    notice: (text) => {
      log.notices.push(text);
    },
    now: () => t,
    later: (fn, ms) => {
      const timer = { at: t + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
  const service = new OcrService(deps);
  const owner = {
    ready: [] as string[],
    ocrReady(path: string, page: number) {
      this.ready.push(`${path}#${page}`);
    },
    ocrProbe: () => Promise.resolve(),
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.settledLoop();
    }
  };
  /** Move the clock on, firing the timers that fall due. */
  const advance = async (ms: number): Promise<void> => {
    const target = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.live && x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      t = due.at;
      due.fn();
      await settle();
    }
    t = target;
    await settle();
  };
  const makeReady = (): void => {
    state.ready = true;
    for (const l of [...listeners]) l();
  };
  return {
    service,
    owner: owner as OcrOwner & typeof owner,
    log,
    state,
    files,
    settle,
    advance,
    makeReady,
  };
}

describe("OcrService", () => {
  it("takes a page already in the cache without the model, a worker or a raster", async () => {
    const r = rig({ ready: false });
    r.files.set(sidecar("a.pdf"), serializeCache(withPage(emptyCache(), 0, PAGE)));
    expect(await r.service.cached("a.pdf", 0)).not.toBeNull();
    expect(await r.service.cached("a.pdf", 1)).toBeNull();
    r.service.want(r.owner, "a.pdf", 0, 3, NONE);
    await r.settle();
    expect(r.log.rendered).toEqual([]);
    expect(r.log.ensured).toBe(0);
    expect(r.log.offers).toBe(0);
    expect(r.owner.ready).toEqual(["a.pdf#0"]);
  });

  it("reads the page in view, then its neighbours, then the rest of the PDF once idle", async () => {
    const r = rig();
    // Asked for together (the pen is down meanwhile), so the order is the queue's.
    r.service.hold(r.owner, true);
    r.service.focus("a.pdf", 5);
    for (const p of [0, 9, 4, 5, 6]) r.service.want(r.owner, "a.pdf", p, 20, NONE);
    r.service.hold(r.owner, false);
    await r.settle();
    expect(r.log.rendered).toEqual(["a.pdf#5", "a.pdf#6", "a.pdf#4"]);
    await r.advance(IDLE_MS + 1500);
    expect(r.log.rendered).toEqual(["a.pdf#5", "a.pdf#6", "a.pdf#4", "a.pdf#9", "a.pdf#0"]);
    expect(r.owner.ready).toHaveLength(5);
  });

  it("starts nothing while the pen is held and carries on when it lifts", async () => {
    const r = rig();
    r.service.hold(r.owner, true);
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, NONE);
    await r.settle();
    expect(r.log.rendered).toEqual([]);
    await r.advance(10_000);
    expect(r.log.rendered).toEqual([]);
    r.service.hold(r.owner, false);
    await r.settle();
    expect(r.log.rendered).toEqual(["a.pdf#0"]);
  });

  it("drops a PDF's queue when the last notebook using it closes, but not while another does", async () => {
    const r = rig();
    const other = {
      ready: [] as string[],
      ocrReady: () => undefined,
      ocrProbe: () => Promise.resolve(),
    };
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 30, 40, NONE);
    r.service.want(other, "a.pdf", 31, 40, NONE);
    r.service.release(r.owner);
    expect(r.log.released).toEqual([]);
    await r.advance(IDLE_MS + 2000);
    expect(r.log.rendered).toEqual(["a.pdf#30", "a.pdf#31"]);

    const r2 = rig();
    r2.service.focus("b.pdf", 0);
    r2.service.want(r2.owner, "b.pdf", 30, 40, NONE);
    r2.service.release(r2.owner);
    expect(r2.log.released).toEqual(["b.pdf"]);
    await r2.advance(IDLE_MS + 5000);
    expect(r2.log.rendered).toEqual([]);
    expect(r2.service.progress().active).toBe(false);
  });

  it("retries a failed page after 60 s, rests after 4 failures in a row, and the re-read resets that", async () => {
    const r = rig();
    r.state.failRender = true;
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 9, NONE);
    await r.settle();
    expect(r.log.rendered).toEqual(["a.pdf#0"]);
    // Within the minute: not tried again.
    r.service.want(r.owner, "a.pdf", 0, 9, NONE);
    await r.settle();
    expect(r.log.rendered).toHaveLength(1);
    await r.advance(RETRY_MS + 1);
    r.service.want(r.owner, "a.pdf", 0, 9, NONE);
    await r.settle();
    expect(r.log.rendered).toHaveLength(2);
    // Two more distinct pages: four failures in a row.
    r.service.want(r.owner, "a.pdf", 1, 9, NONE);
    await r.settle();
    r.service.want(r.owner, "a.pdf", 2, 9, NONE);
    await r.settle();
    expect(r.log.rendered).toHaveLength(4);
    expect(r.service.enabled).toBe(false);
    r.service.want(r.owner, "a.pdf", 3, 9, NONE);
    await r.settle();
    expect(r.log.rendered).toHaveLength(4);
    // At most one notice for all of it.
    expect(r.log.notices).toHaveLength(1);
    expect(MAX_FAILURES).toBe(4);

    r.state.failRender = false;
    await r.service.dropCache("a.pdf");
    expect(r.service.enabled).toBe(true);
    r.service.want(r.owner, "a.pdf", 3, 9, NONE);
    await r.settle();
    expect(r.log.read).toHaveLength(1);
    expect(r.log.notices).toHaveLength(1);
  });

  it("forgets the failures of a success: only runs of failures count", async () => {
    const r = rig();
    r.service.focus("a.pdf", 0);
    r.state.failRender = true;
    r.service.want(r.owner, "a.pdf", 0, 9, NONE);
    await r.settle();
    r.state.failRender = false;
    r.service.want(r.owner, "a.pdf", 1, 9, NONE);
    await r.settle();
    r.state.failRender = true;
    for (const p of [2, 3]) {
      r.service.want(r.owner, "a.pdf", p, 9, NONE);
      await r.settle();
    }
    expect(r.service.enabled).toBe(true);
  });

  it("offers the model only for a page with no text of its own and some ink, then reads it once it is here", async () => {
    const r = rig({ ready: false });
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, NONE);
    await r.settle();
    expect(r.log.offers).toBe(1);
    expect(r.log.read).toEqual([]);
    expect(r.owner.ready).toEqual([]);
    r.makeReady();
    await r.settle();
    expect(r.log.read).toEqual(["600"]);
    expect(r.owner.ready).toEqual(["a.pdf#0"]);
    expect(OCR_MODEL.id).toBe("ocr-ppocrv5");
  });

  it("never offers the model for a blank page, which is cached as read", async () => {
    const r = rig({ ready: false, ink: false });
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, NONE);
    await r.settle();
    expect(r.log.offers).toBe(0);
    expect(r.log.ensured).toBe(0);
    expect(r.log.closed).toBe(1);
    expect(await r.service.cached("a.pdf", 0)).toMatchObject({ lines: [] });
    expect(r.owner.ready).toEqual(["a.pdf#0"]);
  });

  it("never offers the model for a page with text of its own, and does not even draw it without the model", async () => {
    const r = rig({ ready: false });
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, { items: 3, rects: [{ x0: 1, y0: 1, x1: 5, y1: 5 }] });
    await r.settle();
    expect(r.log.offers).toBe(0);
    expect(r.log.rendered).toEqual([]);
    expect(r.log.read).toEqual([]);
  });

  it("reads a page with text of its own, when the model is here, only if there is ink beyond that text", async () => {
    const native = { items: 2, rects: [{ x0: 10, y0: 20, x1: 30, y1: 40 }] };
    const r = rig({ ink: false });
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, native);
    await r.settle();
    // The page's own text is masked out of the raster, in the raster's pixels (scale 2).
    expect(r.log.masked).toEqual([[{ x0: 20, y0: 40, x1: 60, y1: 80 }]]);
    expect(r.log.read).toEqual([]);
    expect(await r.service.cached("a.pdf", 0)).toMatchObject({ lines: [] });

    const withInk = rig({ ink: true });
    withInk.service.focus("a.pdf", 0);
    withInk.service.want(withInk.owner, "a.pdf", 0, 3, native);
    await withInk.settle();
    expect(withInk.log.read).toEqual(["600"]);
    expect(withInk.log.offers).toBe(0);
  });

  it("writes the cache after a pause, not while the pen is held, merged with the file on disk", async () => {
    const r = rig();
    // The file as another device left it: its page 7 (this model), and a page 3 read by an older model.
    const theirs = withPage(withPage(emptyCache(), 7, PAGE), 3, PAGE, "ppocrv5-mobile-0");
    r.files.set(sidecar("a.pdf"), serializeCache(theirs));
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 9, NONE);
    await r.settle();
    r.service.hold(r.owner, true);
    await r.advance(SAVE_MS * 3);
    expect(r.log.writes).toEqual([]);
    r.service.hold(r.owner, false);
    await r.advance(SAVE_MS + 10);
    expect(r.log.writes).toEqual([`${sidecar("a.pdf")}.tmp`]);
    const saved = parseCache(r.files.get(sidecar("a.pdf")) ?? "");
    expect(Object.keys(saved.pages).sort()).toEqual(["0", "3", "7"]);
    expect(saved.pages["3"].model).toBe("ppocrv5-mobile-0");
    expect(r.files.has(`${sidecar("a.pdf")}.tmp`)).toBe(false);
  });

  it("treats a page read by another model version as not read, and reads it again", async () => {
    const r = rig();
    r.files.set(
      sidecar("a.pdf"),
      serializeCache(withPage(emptyCache(), 0, PAGE, "ppocrv5-mobile-0")),
    );
    expect(await r.service.cached("a.pdf", 0)).toBeNull();
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, NONE);
    await r.settle();
    expect(r.log.read).toEqual(["600"]);
    expect(await r.service.cached("a.pdf", 0)).not.toBeNull();
  });

  it("reports progress while it works and goes quiet after", async () => {
    const r = rig();
    const seen: string[] = [];
    r.service.subscribe((p) => seen.push(`${p.done}/${p.total}${p.active ? "*" : ""}`));
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, NONE);
    await r.settle();
    expect(seen).toContain("0/1*");
    expect(r.service.progress().active).toBe(false);
  });
});
