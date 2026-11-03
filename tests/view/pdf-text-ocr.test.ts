/**
 * The PDF text cache with OCR: a page with no text (or hardly any) asks the
 * OCR service, takes what it already read at once, otherwise is queued and
 * read again when the service says it has read it. Pages with text of their
 * own never ask. pdf.js and the service are faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OcrPage } from "../../src/recognition/ocr/ocr-words";

const pdf = {
  pages: 3,
  items: [] as unknown[],
  /** The page's operator list; `null`: the call fails. */
  ops: { fnArray: [] as number[], argsArray: [] as unknown[] } as {
    fnArray: number[];
    argsArray: unknown[];
  } | null,
  operatorCalls: 0,
};
// pdf.js's numbers for the operators the figure finder reads.
const OPS = { save: 10, restore: 11, transform: 12, paintImageXObject: 30 };

vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  loadPdfJs: () =>
    Promise.resolve({
      OPS,
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
              getOperatorList: () => {
                pdf.operatorCalls++;
                return pdf.ops
                  ? Promise.resolve(pdf.ops)
                  : Promise.reject(new Error("no operators"));
              },
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
function fakeOcr(found: OcrPage | null = null, enabled = true, figures = false) {
  const calls = {
    recorded: [] as number[],
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
    get figures() {
      return enabled && figures;
    },
    recordTextOnly: (_path: string, page: number) => {
      calls.recorded.push(page);
      return Promise.resolve();
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
  pdf.ops = { fnArray: [], argsArray: [] };
  pdf.operatorCalls = 0;
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
    expect(calls.natives).toMatchObject([{ items: 0, rects: [] }]);
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

  describe("figures", () => {
    /** 10 lines of text of its own, at the top: a page of a lecture. */
    const text = (): unknown[] =>
      Array.from({ length: 10 }, (_, i) => ({
        str: "The quick brown fox jumps over the lazy dog and runs",
        transform: [10, 0, 0, 10, 20, 520 - i * 12],
        width: 355,
        height: 10,
        fontName: "f1",
      }));
    /** One picture, 200 x 150 pt, lower-left at (100, 300) in a 400 x 560 page (a scaled unit square). */
    const picture = (): { fnArray: number[]; argsArray: unknown[] } => ({
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      argsArray: [[], [200, 0, 0, 150, 100, 300], ["img_1", 800, 600], []],
    });
    const LABELS: OcrPage = {
      imageWidth: 600,
      imageHeight: 450,
      pageWidth: 400,
      pageHeight: 560,
      condition: "TEXT_WITH_FIGURES",
      regions: [{ x0: 94, y0: 104, x1: 306, y1: 266, dpi: 300 }],
      lines: [
        {
          conf: 0.98,
          words: [{ text: "Bladder", box: [150, 340, 200, 352], conf: 0.98, min: 0.9 }],
        },
        // Over the page's own first line of text: dropped.
        { conf: 0.98, words: [{ text: "caption", box: [100, 30, 150, 42], conf: 0.98, min: 0.9 }] },
      ],
    };

    it("looks at the pictures of a page with text of its own and queues the figures, with the area to read", async () => {
      pdf.items = text();
      pdf.ops = picture();
      const { service, calls } = fakeOcr(null, true, true);
      cacheWith(service).request(BACKDROP);
      await settle();
      expect(pdf.operatorCalls).toBe(1);
      expect(calls.wanted).toEqual([["Scan.pdf", 0, 3]]);
      const plan = (calls.natives[0] as { plan?: { condition: string; regions: unknown[] } }).plan;
      expect(plan?.condition).toBe("TEXT_WITH_FIGURES");
      // The picture, y flipped to the page's top-left origin (560 - 450 = 110 .. 260), padded by 6.
      expect(plan?.regions).toEqual([{ x0: 94, y0: 104, x1: 306, y1: 266, dpi: 288 }]);
      expect(calls.recorded).toEqual([]);
      expect(calls.natives[0].items).toBe(10);
    });

    it("records a page with text and no picture as TEXT_ONLY, and asks for nothing", async () => {
      pdf.items = text();
      const { service, calls } = fakeOcr(null, true, true);
      cacheWith(service).request(BACKDROP);
      await settle();
      expect(calls.recorded).toEqual([0]);
      expect(calls.wanted).toEqual([]);
      expect(calls.settled).toEqual([0]);
    });

    it("skips icons and badges, so a page with only those is TEXT_ONLY", async () => {
      pdf.items = text();
      pdf.ops = {
        fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
        argsArray: [[], [14, 0, 0, 14, 300, 500], ["star", 64, 64], []],
      };
      const { service, calls } = fakeOcr(null, true, true);
      cacheWith(service).request(BACKDROP);
      await settle();
      expect(calls.recorded).toEqual([0]);
      expect(calls.wanted).toEqual([]);
    });

    it("does not even look at the operators of a page whose classification is cached", async () => {
      pdf.items = text();
      pdf.ops = picture();
      const { service, calls } = fakeOcr(
        { ...LABELS, condition: "TEXT_ONLY", regions: [], lines: [] },
        true,
        true,
      );
      const cache = cacheWith(service);
      cache.request(BACKDROP);
      await settle();
      expect(pdf.operatorCalls).toBe(0);
      expect(calls.wanted).toEqual([]);
      expect(calls.recorded).toEqual([]);
      expect(cache.peek(BACKDROP, GEOMETRY)?.lines).toHaveLength(10);
    });

    it("adds the figure labels read earlier, but not a word over the page's own text", async () => {
      pdf.items = text();
      const { service, calls } = fakeOcr(LABELS, true, true);
      const cache = cacheWith(service);
      cache.request(BACKDROP);
      await settle();
      const layout = cache.peek(BACKDROP, GEOMETRY);
      const lines = layout && layoutPlainText(layout).split("\n");
      expect(lines).toHaveLength(11);
      expect(lines).toContain("Bladder");
      expect(lines).not.toContain("caption");
      expect(pdf.operatorCalls).toBe(0);
      expect(calls.wanted).toEqual([]);
    });

    it("with the setting off, ignores figure words already read and never looks at pictures", async () => {
      pdf.items = text();
      pdf.ops = picture();
      const { service, calls } = fakeOcr(LABELS, true, false);
      const cache = cacheWith(service);
      cache.request(BACKDROP);
      await settle();
      expect(cache.peek(BACKDROP, GEOMETRY)?.lines).toHaveLength(10);
      const none = fakeOcr(null, true, false);
      const other = cacheWith(none.service);
      other.request(BACKDROP);
      await settle();
      expect(pdf.operatorCalls).toBe(0);
      expect(none.calls.wanted).toEqual([]);
      expect(none.calls.recorded).toEqual([]);
      expect(calls.wanted).toEqual([]);
    });

    it("when the operators cannot be read, a page with text is left as it is and not recorded", async () => {
      pdf.items = text();
      pdf.ops = null;
      const { service, calls } = fakeOcr(null, true, true);
      cacheWith(service).request(BACKDROP);
      await settle();
      expect(calls.recorded).toEqual([]);
      expect(calls.wanted).toEqual([]);
    });

    it("a sparse page with pictures sends its plan too, and a scan with one big picture is SCANNED", async () => {
      pdf.items = [
        { str: "7", transform: [14, 0, 0, 14, 197, 20], width: 7, height: 14, fontName: "f1" },
      ];
      pdf.ops = {
        fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
        argsArray: [[], [390, 0, 0, 550, 5, 5], ["scan", 1600, 2200], []],
      };
      const { service, calls } = fakeOcr(null, true, true);
      cacheWith(service).request(BACKDROP);
      await settle();
      const plan = (calls.natives[0] as { plan?: { condition: string } }).plan;
      expect(plan?.condition).toBe("SCANNED");
    });
  });
});
