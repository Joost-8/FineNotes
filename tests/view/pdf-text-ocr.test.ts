/**
 * The PDF text cache with OCR: a page with no text (or hardly any) asks the
 * OCR service, takes what it already read at once, otherwise is queued and
 * read again when the service says it has read it. Pages with text of their
 * own never ask. pdf.js and the service are faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OcrPage } from "../../src/recognition/ocr/ocr-words";

const pdf = { pages: 3, items: [] as unknown[] };

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
                width: 400 * scale,
                height: 560 * scale,
                transform: [scale, 0, 0, -scale, 0, 560 * scale],
              }),
              getTextContent: () => Promise.resolve({ items: pdf.items, styles: {} }),
              cleanup: () => undefined,
            }),
          destroy: () => Promise.resolve(),
        }),
      }),
    }),
}));

const { PdfTextCache } = await import("../../src/view/pdf-text-source");
const { layoutPlainText } = await import("../../src/search/pdf-hits");

const BACKDROP = { kind: "pdf" as const, path: "Scan.pdf", page: 0 };
const GEOMETRY = { width: 400, height: 560 };

const SCANNED: OcrPage = {
  imageWidth: 944,
  imageHeight: 1322,
  pageWidth: 400,
  pageHeight: 560,
  lines: [
    {
      conf: 0.98,
      words: [
        { text: "Water", box: [40, 60, 90, 76], conf: 0.98, min: 0.9 },
        { text: "quality", box: [96, 60, 150, 76], conf: 0.98, min: 0.9 },
      ],
    },
    { conf: 0.4, words: [{ text: "scribble", box: [40, 100, 100, 116], conf: 0.99, min: 0.99 }] },
  ],
};

/** An OCR service that remembers what it was asked. */
function fakeOcr(found: OcrPage | null = null, enabled = true) {
  const calls = {
    wanted: [] as [string, number, number][],
    natives: [] as { items: number; rects: unknown[] }[],
    settled: [] as number[],
    attached: [] as string[],
    focused: [] as [string, number][],
    held: [] as boolean[],
    released: 0,
  };
  const service = {
    get enabled() {
      return enabled;
    },
    attach: (_owner: unknown, path: string) => calls.attached.push(path),
    cached: () => Promise.resolve(found),
    want: (
      _owner: unknown,
      path: string,
      page: number,
      pages: number,
      native: { items: number; rects: unknown[] },
    ) => {
      calls.wanted.push([path, page, pages]);
      calls.natives.push(native);
    },
    settled: (_path: string, page: number) => calls.settled.push(page),
    focus: (path: string, page: number) => calls.focused.push([path, page]),
    hold: (_owner: unknown, held: boolean) => calls.held.push(held),
    release: () => calls.released++,
  };
  return { service, calls };
}

function cacheWith(service: unknown) {
  const app = {
    vault: { getFileByPath: () => ({}), readBinary: () => Promise.resolve(new ArrayBuffer(8)) },
  };
  return new PdfTextCache(app as never, service as never);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "app://obsidian.md" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  pdf.items = [];
});

describe("PdfTextCache with OCR", () => {
  it("takes the text OCR read earlier at once, without the words it was unsure of", async () => {
    const { service, calls } = fakeOcr(SCANNED);
    const cache = cacheWith(service);
    cache.request(BACKDROP);
    await settle();
    const layout = cache.peek(BACKDROP, GEOMETRY);
    expect(layout && layoutPlainText(layout)).toBe("Water quality");
    expect(calls.wanted).toEqual([]);
    expect(calls.settled).toEqual([0]);
  });

  it("queues a scan that was not read, stays empty, and reads again when the service says so", async () => {
    const { service, calls } = fakeOcr(null);
    const cache = cacheWith(service);
    cache.request(BACKDROP);
    await settle();
    expect(calls.wanted).toEqual([["Scan.pdf", 0, 3]]);
    expect(cache.peek(BACKDROP, GEOMETRY)?.chars).toEqual([]);

    // The service has read the page: the cache is asked again and fires onReady.
    const landed = new Promise<number>((resolve) => {
      cache.onReady = (_path, page) => resolve(page);
    });
    const read = fakeOcr(SCANNED);
    (service as { cached: unknown }).cached = read.service.cached;
    cache.ocrReady("Scan.pdf", 0);
    expect(await landed).toBe(0);
    const layout = cache.peek(BACKDROP, GEOMETRY);
    expect(layout && layoutPlainText(layout)).toBe("Water quality");
  });

  it("keeps a page's own text and adds only OCR words that are not over it (a page number)", async () => {
    pdf.items = [
      { str: "7", transform: [14, 0, 0, 14, 197, 20], width: 7, height: 14, fontName: "f1" },
    ];
    const withNumber: OcrPage = {
      ...SCANNED,
      lines: [
        ...SCANNED.lines.slice(0, 1),
        {
          conf: 0.99,
          words: [{ text: "7", box: [196.5, 526, 203.5, 540], conf: 0.99, min: 0.99 }],
        },
      ],
    };
    const { service } = fakeOcr(withNumber);
    const cache = cacheWith(service);
    cache.request(BACKDROP);
    await settle();
    const layout = cache.peek(BACKDROP, GEOMETRY);
    expect(layout && layoutPlainText(layout).split("\n").sort()).toEqual(["7", "Water quality"]);
  });

  it("tells the service what text a sparse page has of its own, so it can read only what is missing", async () => {
    pdf.items = [
      { str: "7", transform: [14, 0, 0, 14, 197, 20], width: 7, height: 14, fontName: "f1" },
    ];
    const { service, calls } = fakeOcr(null);
    const cache = cacheWith(service);
    cache.request(BACKDROP);
    await settle();
    expect(calls.wanted).toEqual([["Scan.pdf", 0, 3]]);
    expect(calls.natives[0].items).toBe(1);
    expect(calls.natives[0].rects).toHaveLength(1);
    expect(calls.natives[0].rects[0]).toMatchObject({ x0: 197 });
  });

  it("tells it a page with no text at all has none", async () => {
    const { service, calls } = fakeOcr(null);
    cacheWith(service).request(BACKDROP);
    await settle();
    expect(calls.natives).toEqual([{ items: 0, rects: [] }]);
  });

  it("never asks about a page with text of its own", async () => {
    pdf.items = Array.from({ length: 40 }, (_, i) => ({
      str: "The quick brown fox jumps over the lazy dog and runs",
      transform: [10, 0, 0, 10, 20, 520 - i * 12],
      width: 355,
      height: 10,
      fontName: "f1",
    }));
    const { service, calls } = fakeOcr(null);
    const cache = cacheWith(service);
    cache.request(BACKDROP);
    await settle();
    expect(calls.wanted).toEqual([]);
    expect(calls.settled).toEqual([0]);
  });

  it("does nothing with OCR when it is off", async () => {
    const { service, calls } = fakeOcr(SCANNED, false);
    const cache = cacheWith(service);
    cache.request(BACKDROP);
    await settle();
    expect(calls.wanted).toEqual([]);
    expect(cache.peek(BACKDROP, GEOMETRY)?.chars).toEqual([]);
  });

  it("tells the service where the notebook is, when the pen writes, and when it closes", async () => {
    const { service, calls } = fakeOcr(null);
    const cache = cacheWith(service);
    cache.focus(BACKDROP, [{ ...BACKDROP, page: 1 }]);
    cache.setHeld(true);
    cache.setHeld(false);
    cache.destroy();
    expect(calls.focused).toEqual([["Scan.pdf", 0]]);
    expect(calls.held).toEqual([true, false]);
    expect(calls.released).toBe(1);
  });

  it("answers the service's probe by reading that page", async () => {
    const { service, calls } = fakeOcr(null);
    const cache = cacheWith(service);
    await cache.ocrProbe("Scan.pdf", 2);
    expect(calls.wanted).toEqual([["Scan.pdf", 2, 3]]);
    expect(cache.peek({ ...BACKDROP, page: 2 }, GEOMETRY)).not.toBeNull();
  });
});
