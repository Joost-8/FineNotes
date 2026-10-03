/**
 * The PDF raster cache's bookkeeping, with pdf.js and the canvas faked. The
 * case it exists for (FineNotes#1): with the page sidebar open, a dozen
 * thumbnails and the page in view wanted more rasters than an eight-entry
 * cache held, and every raster that landed repainted everything, which asked
 * again for whatever had just been evicted — a loop that never settled.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeCanvas {
  width: number;
  height: number;
  getContext: () => object;
}

/** Each test's pdf.js: pages of 600 x 800 pt, counting renders. */
const pdf = {
  renders: 0,
  pages: 40,
  calls: [] as Array<{ viewport: { width: number; height: number }; transform?: number[] }>,
};

vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  loadPdfJs: () =>
    Promise.resolve({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: pdf.pages,
          getPage: () =>
            Promise.resolve({
              getViewport: ({ scale }: { scale: number }) => ({
                width: 600 * scale,
                height: 800 * scale,
              }),
              render: (params: {
                viewport: { width: number; height: number };
                transform?: number[];
              }) => {
                pdf.calls.push(params);
                pdf.renders++;
                return { promise: Promise.resolve() };
              },
            }),
          destroy: () => Promise.resolve(),
        }),
      }),
    }),
}));

const { PdfBackdropCache } = await import("../../src/view/pdf-backdrop");

const globals = globalThis as Record<string, unknown>;
let clock = 0;

beforeEach(() => {
  pdf.renders = 0;
  pdf.calls.length = 0;
  clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  globals.createEl = (): FakeCanvas => ({ width: 0, height: 0, getContext: () => ({}) });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globals.createEl;
});

function cache(): InstanceType<typeof PdfBackdropCache> {
  const app = {
    vault: {
      getFileByPath: (path: string) => ({ path, extension: "pdf" }),
      readBinary: () => Promise.resolve(new ArrayBuffer(8)),
    },
  };
  return new PdfBackdropCache(app as never);
}

/** Let every pending rasterisation land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PdfBackdropCache", () => {
  it("renders and caches individual zoomed PDF regions at display resolution", async () => {
    const c = cache();
    const area = {
      geometry: { width: 1200, height: 1600 },
      region: { minX: 256, minY: 128, maxX: 320, maxY: 192 },
    };
    const landed = vi.fn();
    c.onReady = landed;
    const entry = await c.resolve("a.pdf", 0, 8, area);
    expect(entry.ok && [entry.canvas.width, entry.canvas.height]).toEqual([512, 512]);
    expect(entry.ok && entry.box).toEqual({ x: 256, y: 128, w: 64, h: 64 });
    expect(pdf.calls[0].viewport).toEqual({ width: 9600, height: 12800 });
    expect(pdf.calls[0].transform).toEqual([1, 0, 0, 1, -2048, -1024]);
    expect(landed).toHaveBeenCalledWith("a.pdf", 0, area);
    expect(await c.resolve("a.pdf", 0, 8, area)).toBe(entry);
    expect(pdf.renders).toBe(1);
    expect(c.peek("a.pdf", 0, 8, { ...area, region: { ...area.region, minX: 0 } })).toBeNull();
  });

  it("holds PDF region requests while writing and preserves their geometry on release", async () => {
    const c = cache();
    const area = {
      geometry: { width: 1200, height: 1600 },
      region: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
    };
    c.setHeld(true);
    c.request("a.pdf", 0, 8, area);
    await settle();
    expect(pdf.renders).toBe(0);
    c.setHeld(false);
    await settle();
    expect(c.peek("a.pdf", 0, 8, area)?.ok).toBe(true);
    expect(pdf.calls[0].viewport.width).toBe(9600);
  });

  it("says which page landed", async () => {
    const c = cache();
    const landed: Array<[string, number]> = [];
    c.onReady = (path, page) => landed.push([path, page]);
    c.request("a.pdf", 3, 1);
    await settle();
    expect(landed).toEqual([["a.pdf", 3]]);
    expect(c.peek("a.pdf", 3, 1)?.ok).toBe(true);
  });

  it("keeps more than eight thumbnail-sized pages", async () => {
    const c = cache();
    for (let page = 0; page < 14; page++) c.request("a.pdf", page, 0.5);
    await settle();
    for (let page = 0; page < 14; page++) expect(c.peek("a.pdf", page, 0.5)).not.toBeNull();
    expect(pdf.renders).toBe(14);
  });

  it("settles when a sidebar's worth of pages repaints on every landing", async () => {
    // What the view does: each landing repaints what shows that page, and a
    // repaint that finds a page missing asks for it. Twelve thumbnails and
    // the page in view, as in the report.
    const c = cache();
    const visible = [...Array.from({ length: 12 }, (_, page) => ({ page, scale: 0.25 }))];
    visible.push({ page: 0, scale: 1.5 });
    const paint = (only?: number): void => {
      for (const { page, scale } of visible) {
        if (only !== undefined && page !== only) continue;
        if (!c.peek("a.pdf", page, scale)) c.request("a.pdf", page, scale);
      }
    };
    // The cap turns a loop into a failure instead of a hung run.
    c.onReady = (_path, page) => {
      if (pdf.renders < 200) paint(page);
    };
    paint();
    await settle();
    await settle();
    expect(pdf.renders).toBe(visible.length);
    pdf.renders = 0;
    paint();
    await settle();
    expect(pdf.renders).toBe(0);
  });

  it("evicts down to the soft budget, but never a page drawn just now", async () => {
    const c = cache();
    // 2400 pt-edge cap: scale 2 gives 1200 x 1600 px, 7.7 MB a page.
    for (let page = 0; page < 5; page++) c.request("a.pdf", page, 2);
    await settle();
    clock += 5000;
    // Page 0 is on screen: drawn again now.
    expect(c.peek("a.pdf", 0, 2)).not.toBeNull();
    for (let page = 5; page < 9; page++) c.request("a.pdf", page, 2);
    await settle();
    // 9 x 7.7 MB is over the 48 MB soft budget: the old, undrawn pages go
    // and their canvases are given back, the one just drawn stays.
    expect(c.bytes).toBeLessThanOrEqual(48 * 1024 * 1024);
    expect(c.peek("a.pdf", 0, 2)).not.toBeNull();
    expect(c.peek("a.pdf", 1, 2)).toBeNull();
  });

  it("frees a raster's pixels when it is evicted", async () => {
    const c = cache();
    c.request("a.pdf", 0, 2);
    await settle();
    const first = c.peek("a.pdf", 0, 2);
    clock += 5000;
    for (let page = 1; page < 9; page++) c.request("a.pdf", page, 2);
    await settle();
    expect(c.peek("a.pdf", 0, 2)).toBeNull();
    expect(first?.ok && first.canvas.width).toBe(0);
  });

  it("holds new rasterisation while held, and starts it on release", async () => {
    const c = cache();
    c.setHeld(true);
    c.request("a.pdf", 1, 1);
    c.request("a.pdf", 1, 1);
    c.request("a.pdf", 2, 1);
    await settle();
    expect(pdf.renders).toBe(0);
    c.setHeld(false);
    await settle();
    expect(pdf.renders).toBe(2);
    expect(c.peek("a.pdf", 2, 1)).not.toBeNull();
  });

  it("still answers an awaited draw while held", async () => {
    const c = cache();
    c.setHeld(true);
    const entry = await c.resolve("a.pdf", 4, 1);
    expect(entry.ok).toBe(true);
  });

  it("reports a missing file or page as a miss", async () => {
    const c = cache();
    expect(await c.resolve("a.pdf", 99, 1)).toMatchObject({ ok: false });
    const app = { vault: { getFileByPath: () => null, readBinary: () => Promise.reject() } };
    const none = new PdfBackdropCache(app as never);
    expect(await none.resolve("gone.pdf", 0, 1)).toMatchObject({ ok: false });
  });

  it("drops everything on clear, and answers nothing once destroyed", async () => {
    const c = cache();
    c.request("a.pdf", 0, 1);
    c.setHeld(true);
    c.request("a.pdf", 1, 1);
    await settle();
    c.clear();
    expect(c.peek("a.pdf", 0, 1)).toBeNull();
    expect(c.bytes).toBe(0);
    c.setHeld(false);
    await settle();
    expect(pdf.renders).toBe(1);
    c.destroy();
    expect(await c.resolve("a.pdf", 0, 1)).toMatchObject({ ok: false });
  });
});
