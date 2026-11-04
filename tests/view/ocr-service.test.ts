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
import { OCR_MODEL, OCR_TIERS } from "../../src/recognition/ocr/ocr-model";
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
  type ActiveOcrModel,
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

const region = (x0: number, y0: number, x1: number, y1: number, dpi: number | null = 300) => ({
  x0,
  y0,
  x1,
  y1,
  dpi,
});
/** A page with 40 words of its own and two pictures to read (a lecture slide). */
const FIGURES: NativeInfo = {
  items: 40,
  rects: [{ x0: 20, y0: 30, x1: 120, y1: 50 }],
  plan: {
    condition: "TEXT_WITH_FIGURES",
    regions: [region(10, 100, 150, 200), region(160, 100, 290, 380)],
    checkRest: false,
    known: true,
  },
};
/** A page with no text at all and a picture covering part of it. */
const FIGURE_ONLY: NativeInfo = {
  items: 0,
  rects: [],
  plan: {
    condition: "TEXT_WITH_FIGURES",
    regions: [region(10, 100, 150, 200)],
    checkRest: true,
    known: true,
  },
};

/** The model of tier `i` of OCR_TIERS, as the service is told about it. */
function tierModel(i: number): ActiveOcrModel {
  const tier = OCR_TIERS[i];
  return {
    version: tier.version,
    key: `${tier.asset.id}:${tier.asset.version}`,
    rec: tier.rec,
    dict: tier.dict,
    confidence: tier.confidence,
  };
}

function rig(options: { ready?: boolean; ink?: boolean } = {}) {
  const log = {
    rendered: [] as string[],
    closed: 0,
    read: [] as string[],
    ensured: 0,
    keys: [] as string[],
    thresholds: [] as unknown[],
    bytesAsked: [] as (string | undefined)[],
    checks: 0,
    offers: 0,
    asked: 0,
    notices: [] as string[],
    released: [] as string[],
    masked: [] as unknown[],
    writes: [] as string[],
    origins: [] as unknown[],
    edges: [] as boolean[],
  };
  const state = {
    ready: options.ready ?? true,
    ink: options.ink ?? true,
    failRender: false,
    /** Decides whether a raster has ink, when set (called in order); else `ink`. */
    inkOf: null as null | ((call: number) => boolean),
    inkCalls: 0,
    figures: true,
    /** Runs after each region is read (the pen may go down, say). */
    afterRead: null as null | (() => void),
    /** The model the setting chooses (the service's default, Fast, when null). */
    model: null as null | ActiveOcrModel,
  };
  let t = 1_000_000;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const files = new Map<string, string>();
  const listeners = new Set<() => void>();
  const store = {
    get state() {
      return { kind: state.ready ? "ready" : "missing" };
    },
    file: () => Promise.resolve(state.ready ? "x" : null),
    bytes: (name?: string) => {
      log.bytesAsked.push(name);
      return Promise.resolve(new ArrayBuffer(1));
    },
    check: () => {
      log.checks++;
      return Promise.resolve();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const deps: OcrDeps = {
    pluginDir: () => PLUGIN,
    enabled: () => true,
    figures: () => state.figures,
    store,
    offer: (ask) => {
      log.offers++;
      if (ask) log.asked++;
    },
    model: () => state.model ?? tierModel(0),
    raster: {
      render: (path, page, region) => {
        log.rendered.push(
          region
            ? `${path}#${page}@${region.x0},${region.y0},${region.x1},${region.y1}`
            : `${path}#${page}`,
        );
        if (state.failRender) return Promise.reject(new Error("no canvas"));
        const bitmap = {
          width: region ? 300 : 600,
          height: 800,
          close: () => log.closed++,
        } as unknown as ImageBitmap;
        return Promise.resolve({
          bitmap,
          scale: 2,
          pageWidth: 300,
          pageHeight: 400,
          ...(region ? { origin: { x: region.x0, y: region.y0 } } : {}),
        });
      },
      release: (path) => {
        log.released.push(path);
      },
      dispose: () => undefined,
    },
    client: () =>
      Promise.resolve({
        ensureModel: async (key, read, confidence) => {
          log.ensured++;
          log.keys.push(key);
          log.thresholds.push(confidence);
          await read();
        },
        read: (bitmap, _scale, _w, _h, origin) => {
          log.read.push(String(bitmap.width));
          log.origins.push(origin ?? null);
          state.afterRead?.();
          return Promise.resolve({ page: PAGE, steps: {} });
        },
        dispose: () => undefined,
      }),
    hasInk: (_bitmap, masked, edges) => {
      log.masked.push(masked);
      log.edges.push(edges === true);
      return Promise.resolve(state.inkOf ? state.inkOf(state.inkCalls++) : state.ink);
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
    changed: 0,
    ocrSettingsChanged() {
      this.changed++;
    },
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

  it("reads a page once: a switch off and on, a closed notebook and a reopened one read nothing again", async () => {
    const r = rig();
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, NONE);
    await r.settle();
    expect(r.log.rendered).toEqual(["a.pdf#0"]);
    // The AI menu's switch: off, then on (both end in settingsChanged).
    r.service.settingsChanged();
    r.service.settingsChanged();
    // The notebook closes and opens again.
    r.service.release(r.owner);
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, NONE);
    await r.advance(IDLE_MS + 2000);
    expect(r.log.rendered).toEqual(["a.pdf#0"]);
    expect(r.owner.ready).toContain("a.pdf#0");
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
    expect(OCR_MODEL.id).toBe("ocr-ppocrv6");
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

  it("reads a page left for want of the model once the model arrives, without a reopen", async () => {
    const native = { items: 2, rects: [{ x0: 10, y0: 20, x1: 30, y1: 40 }] };
    const r = rig({ ready: false });
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, native);
    r.service.want(r.owner, "a.pdf", 1, 3, NONE);
    await r.settle();
    // The mixed page waits; the scanned one is offered and parked.
    expect(r.log.rendered).toEqual(["a.pdf#1"]);
    expect(r.log.offers).toBe(1);
    expect(r.log.read).toEqual([]);
    r.makeReady();
    await r.settle();
    // Both, in the queue's order (the page in view first), the mixed one only because it has ink beyond its text.
    expect(r.log.rendered).toEqual(["a.pdf#1", "a.pdf#0", "a.pdf#1"]);
    expect(r.log.read).toHaveLength(2);
    expect(r.owner.ready.sort()).toEqual(["a.pdf#0", "a.pdf#1"]);
    expect(r.log.offers).toBe(1);
  });

  it("does not read a page left for the model if no open notebook uses its PDF any more", async () => {
    const native = { items: 2, rects: [] };
    const r = rig({ ready: false });
    r.service.focus("a.pdf", 0);
    r.service.want(r.owner, "a.pdf", 0, 3, native);
    await r.settle();
    r.service.release(r.owner);
    r.makeReady();
    await r.settle();
    expect(r.log.rendered).toEqual([]);
    expect(r.log.read).toEqual([]);
    expect(r.service.progress().active).toBe(false);
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

  describe("pages with text of their own", () => {
    it("a TEXT_ONLY page is recorded and never drawn, read or offered, and costs nothing on reopen", async () => {
      const r = rig({ ready: false });
      await r.service.recordTextOnly("a.pdf", 2, { width: 612, height: 866 });
      await r.advance(SAVE_MS + 10);
      expect(r.log.rendered).toEqual([]);
      expect(r.log.read).toEqual([]);
      expect(r.log.ensured).toBe(0);
      expect(r.log.offers).toBe(0);
      expect(await r.service.cached("a.pdf", 2)).toMatchObject({
        condition: "TEXT_ONLY",
        regions: [],
        lines: [],
        pageWidth: 612,
      });
      // The sidecar carries the classification.
      const saved = parseCache(r.files.get(sidecar("a.pdf")) ?? "");
      expect(saved.pages["2"]).toMatchObject({ condition: "TEXT_ONLY", regions: [] });
      // A second look at the same page changes nothing and writes nothing.
      r.log.writes.length = 0;
      await r.service.recordTextOnly("a.pdf", 2, { width: 612, height: 866 });
      await r.advance(SAVE_MS + 10);
      expect(r.log.writes).toEqual([]);
    });

    it("a TEXT_WITH_FIGURES page draws exactly its regions, one at a time, and reads each there", async () => {
      const r = rig();
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      // No whole-page raster; the regions, in order, at their own origins.
      expect(r.log.rendered).toEqual(["a.pdf#0@10,100,150,200", "a.pdf#0@160,100,290,380"]);
      expect(r.log.read).toEqual(["300", "300"]);
      expect(r.log.origins).toEqual([
        { x: 10, y: 100 },
        { x: 160, y: 100 },
      ]);
      // The page's own text is masked out of each region's raster, in that raster's pixels.
      expect(r.log.masked).toEqual([
        [{ x0: 20, y0: -140, x1: 220, y1: -100 }],
        [{ x0: -280, y0: -140, x1: -80, y1: -100 }],
      ]);
      expect(r.owner.ready).toEqual(["a.pdf#0"]);
      const stored = await r.service.cached("a.pdf", 0);
      expect(stored).toMatchObject({ condition: "TEXT_WITH_FIGURES" });
      expect(stored?.regions).toHaveLength(2);
      expect(stored?.lines).toHaveLength(2);
      expect(r.log.offers).toBe(0);
    });

    it("never offers the model, nor draws anything, until it is here; then reads the figures", async () => {
      const r = rig({ ready: false });
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      expect(r.log.offers).toBe(0);
      expect(r.log.rendered).toEqual([]);
      expect(r.service.progress().active).toBe(false);
      r.makeReady();
      await r.settle();
      expect(r.log.rendered).toEqual(["a.pdf#0@10,100,150,200", "a.pdf#0@160,100,290,380"]);
      expect(r.log.offers).toBe(0);
      expect(r.owner.ready).toEqual(["a.pdf#0"]);
    });

    it("the waiting-for-model re-queue covers figure pages along with the others", async () => {
      const r = rig({ ready: false });
      r.service.focus("a.pdf", 1);
      r.service.want(r.owner, "a.pdf", 0, 4, FIGURES);
      r.service.want(r.owner, "a.pdf", 1, 4, {
        ...FIGURES,
        plan: { ...FIGURES.plan!, regions: [region(1, 2, 80, 90)] },
      });
      r.service.want(r.owner, "a.pdf", 2, 4, { items: 3, rects: [] });
      await r.settle();
      expect(r.log.rendered).toEqual([]);
      r.makeReady();
      await r.advance(IDLE_MS + 2000);
      expect(r.log.rendered.sort()).toEqual(
        [
          "a.pdf#0@10,100,150,200",
          "a.pdf#0@160,100,290,380",
          "a.pdf#1@1,2,80,90",
          "a.pdf#2",
        ].sort(),
      );
      expect(r.owner.ready.sort()).toEqual(["a.pdf#0", "a.pdf#1", "a.pdf#2"]);
      expect(r.log.offers).toBe(0);
    });

    it("a figure area with no ink beyond the page's own text is not sent to the reader", async () => {
      const r = rig();
      r.state.inkOf = (call) => call === 1;
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      expect(r.log.rendered).toHaveLength(2);
      expect(r.log.read).toEqual(["300"]);
      expect(r.log.closed).toBe(1);
      expect((await r.service.cached("a.pdf", 0))?.regions).toHaveLength(2);
    });

    it("leaves the page when the pen goes down between two areas, and finishes it when it lifts", async () => {
      const r = rig();
      r.service.focus("a.pdf", 0);
      r.state.afterRead = () => {
        r.state.afterRead = null;
        r.service.hold(r.owner, true);
      };
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      expect(r.log.rendered).toEqual(["a.pdf#0@10,100,150,200"]);
      expect(await r.service.cached("a.pdf", 0)).toBeNull();
      expect(r.owner.ready).toEqual([]);
      r.service.hold(r.owner, false);
      await r.settle();
      expect(r.log.rendered).toEqual([
        "a.pdf#0@10,100,150,200",
        "a.pdf#0@10,100,150,200",
        "a.pdf#0@160,100,290,380",
      ]);
      expect(r.owner.ready).toEqual(["a.pdf#0"]);
      expect((await r.service.cached("a.pdf", 0))?.lines).toHaveLength(2);
    });

    it("stops a page's regions when no notebook shows its PDF any more", async () => {
      const r = rig();
      r.service.focus("a.pdf", 0);
      r.state.afterRead = () => {
        r.state.afterRead = null;
        r.service.release(r.owner);
      };
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      await r.advance(IDLE_MS + 2000);
      expect(r.log.rendered).toEqual(["a.pdf#0@10,100,150,200"]);
      expect(r.service.progress().active).toBe(false);
    });

    it("a failed region fails the page like any other: logged, retried after a minute", async () => {
      const r = rig();
      r.state.failRender = true;
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      expect(r.log.rendered).toHaveLength(1);
      expect(r.log.notices).toHaveLength(1);
      r.state.failRender = false;
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      expect(r.log.rendered).toHaveLength(1);
      await r.advance(RETRY_MS + 1);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      expect(r.log.read).toHaveLength(2);
    });

    it("a page with no text at all and a picture checks the rest of it first, offers the model, and reads the picture alone when nothing else has ink", async () => {
      const r = rig({ ready: false });
      // Ink only inside the picture: the page, picture masked, has none.
      // (the page is checked again once the model is here.)
      r.state.inkOf = (call) => call >= 2;
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURE_ONLY);
      await r.settle();
      // The page, its picture masked out (the region, in the raster's pixels at scale 2).
      expect(r.log.rendered).toEqual(["a.pdf#0"]);
      expect(r.log.masked[0]).toEqual([{ x0: 20, y0: 200, x1: 300, y1: 400 }]);
      expect(r.log.offers).toBe(1);
      r.makeReady();
      await r.settle();
      expect(r.log.rendered).toEqual(["a.pdf#0", "a.pdf#0", "a.pdf#0@10,100,150,200"]);
      expect(r.log.read).toEqual(["300"]);
      expect((await r.service.cached("a.pdf", 0))?.condition).toBe("TEXT_WITH_FIGURES");
    });

    it("a page of figures and other ink is read whole, as a scan", async () => {
      const r = rig();
      r.state.ink = true;
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURE_ONLY);
      await r.settle();
      expect(r.log.rendered).toEqual(["a.pdf#0"]);
      expect(r.log.read).toEqual(["600"]);
      expect((await r.service.cached("a.pdf", 0))?.condition).toBe("TEXT_WITH_FIGURES");
    });

    it("keeps the condition a page was classified as when it is read whole", async () => {
      const r = rig();
      const scanned: NativeInfo = {
        items: 0,
        rects: [],
        plan: {
          condition: "SCANNED",
          regions: [region(0, 0, 300, 400, null)],
          checkRest: false,
          known: true,
        },
      };
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, scanned);
      await r.settle();
      expect(await r.service.cached("a.pdf", 0)).toMatchObject({
        condition: "SCANNED",
        regions: [{ x0: 0, y0: 0, x1: 300, y1: 400 }],
      });
      // And a blank one is BLANK.
      const b = rig({ ink: false });
      b.service.focus("a.pdf", 0);
      b.service.want(b.owner, "a.pdf", 0, 3, scanned);
      await b.settle();
      expect(await b.service.cached("a.pdf", 0)).toMatchObject({ condition: "BLANK", regions: [] });
    });

    it("a plain background under dense text is looked at for content, found empty, and never read", async () => {
      const r = rig();
      r.state.ink = false;
      const page: NativeInfo = {
        items: 400,
        rects: [{ x0: 20, y0: 30, x1: 280, y1: 380 }],
        plan: {
          condition: "TEXT_WITH_FIGURES",
          regions: [{ ...region(0, 0, 300, 400, null), backdrop: true }],
          checkRest: false,
          known: true,
        },
      };
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, page);
      await r.settle();
      expect(r.log.rendered).toEqual(["a.pdf#0@0,0,300,400"]);
      expect(r.log.edges).toEqual([true]);
      expect(r.log.read).toEqual([]);
      expect(r.log.offers).toBe(0);
      // Recorded as read, with nothing found, so it is not drawn again.
      expect(await r.service.cached("a.pdf", 0)).toMatchObject({
        condition: "TEXT_WITH_FIGURES",
        lines: [],
      });
      expect(r.owner.ready).toEqual(["a.pdf#0"]);
    });

    it("a background, dense text and one real figure: the figure is read, the background only for what is not the figure", async () => {
      const figure = region(100, 150, 200, 250, 300);
      const backdrop = { ...region(0, 0, 300, 400, null), backdrop: true as const };
      const page: NativeInfo = {
        items: 400,
        rects: [{ x0: 20, y0: 30, x1: 280, y1: 100 }],
        plan: {
          condition: "TEXT_WITH_FIGURES",
          // The backdrop is listed first, but the figure is read first.
          regions: [backdrop, figure],
          checkRest: false,
          known: true,
        },
      };
      const r = rig();
      // Content in the figure; none on the backdrop beyond the text and the figure.
      r.state.inkOf = (call) => call === 0;
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, page);
      await r.settle();
      expect(r.log.rendered).toEqual(["a.pdf#0@100,150,200,250", "a.pdf#0@0,0,300,400"]);
      expect(r.log.read).toEqual(["300"]);
      // The backdrop's check leaves out the page's text and the figure (in its raster's pixels, scale 2).
      expect(r.log.masked[1]).toEqual([
        { x0: 40, y0: 60, x1: 560, y1: 200 },
        { x0: 200, y0: 300, x1: 400, y1: 500 },
      ]);
      expect((await r.service.cached("a.pdf", 0))?.lines).toHaveLength(1);
    });

    it("what a backdrop's reading finds inside a figure is not kept twice", async () => {
      // The reader's one word lies at (10..60, 10..24) in whatever it reads: inside this figure.
      const figure = region(0, 0, 80, 50, 300);
      const backdrop = { ...region(0, 0, 300, 400, null), backdrop: true as const };
      const page: NativeInfo = {
        items: 400,
        rects: [],
        plan: {
          condition: "TEXT_WITH_FIGURES",
          regions: [figure, backdrop],
          checkRest: false,
          known: true,
        },
      };
      const r = rig();
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, page);
      await r.settle();
      expect(r.log.read).toEqual(["300", "300"]);
      expect((await r.service.cached("a.pdf", 0))?.lines).toHaveLength(1);
    });

    it("tells the notebooks when a setting changed, so they read their pages again", async () => {
      const r = rig();
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, NONE);
      await r.settle();
      r.service.settingsChanged();
      expect(r.owner.changed).toBe(1);
    });

    it("leaves a figure page queued under the setting once it is off, and drops those waiting for the model", async () => {
      const r = rig();
      r.service.hold(r.owner, true);
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      r.state.figures = false;
      r.service.settingsChanged();
      r.service.hold(r.owner, false);
      await r.settle();
      expect(r.log.rendered).toEqual([]);
      expect(r.service.figures).toBe(false);

      const w = rig({ ready: false });
      w.service.focus("a.pdf", 0);
      w.service.want(w.owner, "a.pdf", 0, 3, FIGURES);
      w.service.want(w.owner, "a.pdf", 1, 3, { items: 3, rects: [] });
      await w.settle();
      w.state.figures = false;
      w.service.settingsChanged();
      w.makeReady();
      await w.settle();
      // The page with text and no figure plan is still read; the figure page is not.
      expect(w.log.rendered).toEqual(["a.pdf#1"]);
    });

    it("reads figure pages again once the setting is back on", async () => {
      const r = rig();
      r.state.figures = false;
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      expect(r.log.rendered).toEqual([]);
      r.state.figures = true;
      r.service.settingsChanged();
      // The notebook reads the page's text again and asks again.
      r.service.want(r.owner, "a.pdf", 0, 3, FIGURES);
      await r.settle();
      expect(r.log.rendered).toHaveLength(2);
    });

    it("reports the setting: figures need the OCR on as well", () => {
      const r = rig();
      expect(r.service.figures).toBe(true);
    });
  });

  describe("the choice of model", () => {
    it("reads with the files and thresholds of the model the setting chose", async () => {
      const r = rig();
      r.state.model = tierModel(1);
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, NONE);
      await r.settle();
      expect(r.log.keys).toEqual(["ocr-ppocrv6-small:1"]);
      expect(r.log.bytesAsked).toEqual([
        OCR_TIERS[1].dict,
        "PP-OCRv5_mobile_det_infer.ort",
        OCR_TIERS[1].rec,
        "ort-wasm-simd-threaded.wasm",
      ]);
      expect(r.log.thresholds).toEqual([OCR_TIERS[1].confidence]);
      expect(r.service.tuning()).toMatchObject(OCR_TIERS[1].confidence);
    });

    it("gives every model its own cache version and its own thresholds", () => {
      const versions = OCR_TIERS.map((t) => t.version);
      expect(new Set(versions).size).toBe(OCR_TIERS.length);
      // An existing install's pages (read by the tiny model) stay valid for Fast.
      expect(versions[0]).toBe("ppocrv6-tiny-1");
      expect(new Set(OCR_TIERS.map((t) => `${t.asset.id}:${t.asset.version}`)).size).toBe(3);
    });

    it("counts pages another model read as not read, and records its own under its version", async () => {
      const r = rig();
      r.files.set(sidecar("a.pdf"), serializeCache(withPage(emptyCache(), 0, PAGE)));
      // Fast read it; Fast still takes it.
      expect(await r.service.cached("a.pdf", 0)).not.toBeNull();
      r.state.model = tierModel(1);
      expect(await r.service.cached("a.pdf", 0)).toBeNull();
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, NONE);
      await r.settle();
      expect(r.log.rendered).toEqual(["a.pdf#0"]);
      await r.advance(SAVE_MS + 1);
      const saved = parseCache(r.files.get(sidecar("a.pdf")) ?? "");
      expect(saved.pages["0"]?.model).toBe("ppocrv6-small-1");
      expect(await r.service.cached("a.pdf", 0)).not.toBeNull();
      // Back to Fast: that page is Accurate's, so Fast reads it again.
      r.state.model = tierModel(0);
      expect(await r.service.cached("a.pdf", 0)).toBeNull();
    });

    it("offers the new model's download when it is not here, tells the notebooks, and deletes nothing", async () => {
      const r = rig({ ready: false });
      r.files.set(sidecar("a.pdf"), serializeCache(withPage(emptyCache(), 0, PAGE)));
      r.state.model = tierModel(1);
      r.service.modelChanged();
      await r.settle();
      expect(r.log.checks).toBe(1);
      expect(r.log.asked).toBe(1);
      expect(r.owner.changed).toBe(0);
      r.service.attach(r.owner, "a.pdf");
      r.service.modelChanged();
      await r.settle();
      expect(r.owner.changed).toBe(1);
      // The sidecar is as it was: nothing was thrown away on the switch.
      expect(parseCache(r.files.get(sidecar("a.pdf")) ?? "").pages["0"]?.model).toBe(
        "ppocrv6-tiny-1",
      );
    });

    it("does not offer a download when the new model is already here, and reads pages that waited", async () => {
      const r = rig();
      r.state.model = tierModel(2);
      r.service.modelChanged();
      await r.settle();
      expect(r.log.asked).toBe(0);
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, NONE);
      await r.settle();
      expect(r.log.keys).toEqual(["ocr-ppocrv6-medium:1"]);
    });

    it("applies at once: a failed run is forgiven and the next page loads the new model", async () => {
      const r = rig();
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 9, NONE);
      await r.settle();
      expect(r.log.keys).toEqual(["ocr-ppocrv6:2"]);
      r.state.model = tierModel(1);
      r.service.modelChanged();
      r.service.want(r.owner, "a.pdf", 1, 9, NONE);
      await r.settle();
      expect(r.log.keys).toEqual(["ocr-ppocrv6:2", "ocr-ppocrv6-small:1"]);
    });

    it("after a switch, the old model's words are still offered (with that model's thresholds) until the new reading is stored", async () => {
      const r = rig();
      r.files.set(sidecar("a.pdf"), serializeCache(withPage(emptyCache(), 0, PAGE)));
      r.state.model = tierModel(2);
      // Not the new model's page, but still shown; judged by Fast's own thresholds.
      expect(await r.service.cached("a.pdf", 0)).toBeNull();
      const stale = await r.service.cachedStale("a.pdf", 0);
      expect(stale?.model).toBe(OCR_TIERS[0].version);
      expect(r.service.tuning(stale?.model)).toMatchObject(OCR_TIERS[0].confidence);
      expect(r.service.tuning()).toMatchObject(OCR_TIERS[2].confidence);
      // The page is queued for the new model all the same.
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, NONE);
      await r.settle();
      expect(r.log.keys).toEqual(["ocr-ppocrv6-medium:1"]);
      // Its reading replaces the old one.
      expect((await r.service.cached("a.pdf", 0))?.model).toBe(OCR_TIERS[2].version);
      expect(await r.service.cachedStale("a.pdf", 0)).toBeNull();
      await r.advance(SAVE_MS + 1);
      expect(parseCache(r.files.get(sidecar("a.pdf")) ?? "").pages["0"]?.model).toBe(
        OCR_TIERS[2].version,
      );
    });

    it("a declined download keeps the old words, and the page waits for the model", async () => {
      const r = rig({ ready: false });
      r.files.set(sidecar("a.pdf"), serializeCache(withPage(emptyCache(), 0, PAGE)));
      r.state.model = tierModel(1);
      r.service.modelChanged();
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, NONE);
      await r.settle();
      await r.advance(SAVE_MS + 1);
      // Nothing was read, and the old words are still there to show.
      expect(r.log.read).toEqual([]);
      expect((await r.service.cachedStale("a.pdf", 0))?.model).toBe(OCR_TIERS[0].version);
      expect(parseCache(r.files.get(sidecar("a.pdf")) ?? "").pages["0"]?.model).toBe(
        OCR_TIERS[0].version,
      );
      // Later the model arrives: the page is read and replaces them.
      r.makeReady();
      await r.settle();
      expect((await r.service.cached("a.pdf", 0))?.model).toBe(OCR_TIERS[1].version);
    });

    it("never offers a page of an unknown model version or a page without words as old words", async () => {
      const r = rig();
      const file = withPage(emptyCache(), 0, PAGE);
      file.pages["1"] = { ...file.pages["0"], model: OCR_TIERS[0].version, condition: "BLANK" };
      file.pages["0"] = { ...file.pages["0"], model: "ppocrv9-future" };
      r.files.set(sidecar("a.pdf"), serializeCache(file));
      r.state.model = tierModel(1);
      expect(await r.service.cachedStale("a.pdf", 0)).toBeNull();
      expect(await r.service.cachedStale("a.pdf", 1)).toBeNull();
    });

    it("does not store a page that was read while the setting changed", async () => {
      const r = rig();
      r.state.afterRead = () => {
        r.state.model = tierModel(1);
      };
      r.service.focus("a.pdf", 0);
      r.service.want(r.owner, "a.pdf", 0, 3, NONE);
      await r.settle();
      await r.advance(SAVE_MS + 1);
      expect(r.files.has(sidecar("a.pdf"))).toBe(false);
      expect(r.owner.ready).toEqual([]);
    });
  });
});
