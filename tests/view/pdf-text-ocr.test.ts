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
  /** Text of a page (1-based) that differs from `items`. */
  itemsByPage: {} as Record<number, unknown[]>,
  /** How many times a page's text was asked for; past `allowCalls` the answer waits for `gate`. */
  textCalls: 0,
  allowCalls: Number.POSITIVE_INFINITY,
  gate: null as Promise<void> | null,
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
          getPage: (n: number) =>
            Promise.resolve({
              getViewport: ({ scale }: { scale: number }) => ({
                width: 400 * scale,
                height: 560 * scale,
                transform: [scale, 0, 0, -scale, 0, 560 * scale],
              }),
              getTextContent: async () => {
                pdf.textCalls++;
                if (pdf.textCalls > pdf.allowCalls && pdf.gate) await pdf.gate;
                return { items: pdf.itemsByPage[n] ?? pdf.items, styles: {} };
              },
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
  const flags = { figures };
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
      return enabled && flags.figures;
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
  return { service, calls, flags };
}

function cacheWith(
  service: unknown,
  // No English list unless a test brings one (the real one is a lazy import).
  words: () => Promise<ReadonlySet<string> | null> = () => Promise.resolve(null),
) {
  const app = {
    vault: { getFileByPath: () => ({}), readBinary: () => Promise.resolve(new ArrayBuffer(8)) },
  };
  return new PdfTextCache(app as never, service as never, words);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { origin: "app://obsidian.md" },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  pdf.items = [];
  pdf.ops = { fnArray: [], argsArray: [] };
  pdf.operatorCalls = 0;
  pdf.itemsByPage = {};
  pdf.textCalls = 0;
  pdf.allowCalls = Number.POSITIVE_INFINITY;
  pdf.gate = null;
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

    it("corrects a misread figure word to a word of the PDF's own text, when the English list is there", async () => {
      // Page text mentions "external" (in a line of its own text); the figure's label was read "Extemal".
      pdf.items = [
        ...text(),
        {
          str: "the external sphincter and the bladder",
          transform: [10, 0, 0, 10, 20, 400],
          width: 190,
          height: 10,
          fontName: "f1",
        },
      ];
      const misread: OcrPage = {
        ...LABELS,
        lines: [
          {
            conf: 0.98,
            words: [{ text: "Extemal", box: [150, 340, 200, 352], conf: 0.98, min: 0.9 }],
          },
        ],
      };
      const lexicon = new Set(
        Array.from({ length: 1200 }, (_, i) => `word${"abcdefghij"[i % 10]}${i}`),
      );
      const withList = cacheWith(fakeOcr(misread, true, true).service, () =>
        Promise.resolve(lexicon),
      );
      withList.request(BACKDROP);
      // The PDF's whole vocabulary is read in the background first; the page is merged again after.
      for (let i = 0; i < 200; i++) {
        await settle();
        const now = withList.peek(BACKDROP, GEOMETRY);
        if (now && layoutPlainText(now).includes("External")) break;
      }
      const layoutWith = withList.peek(BACKDROP, GEOMETRY);
      expect(layoutWith && layoutPlainText(layoutWith).split("\n")).toContain("External");

      // Without the list nothing is corrected: the guard against real words cannot be made.
      const without = cacheWith(fakeOcr(misread, true, true).service, () => Promise.resolve(null));
      without.request(BACKDROP);
      await settle();
      const layoutWithout = without.peek(BACKDROP, GEOMETRY);
      expect(layoutWithout && layoutPlainText(layoutWithout).split("\n")).toContain("Extemal");
    });

    it("takes the setting at once: turned on, the pages shown are looked at; turned off, figure words are hidden", async () => {
      pdf.items = text();
      pdf.ops = picture();
      const off = fakeOcr(null, true, false);
      const cache = cacheWith(off.service);
      cache.request(BACKDROP);
      await settle();
      expect(pdf.operatorCalls).toBe(0);
      expect(off.calls.wanted).toEqual([]);
      off.flags.figures = true;
      cache.ocrSettingsChanged();
      await settle();
      expect(pdf.operatorCalls).toBe(1);
      expect(off.calls.wanted).toEqual([["Scan.pdf", 0, 3]]);

      const on = fakeOcr(LABELS, true, true);
      const other = cacheWith(on.service);
      other.request(BACKDROP);
      await settle();
      expect(other.peek(BACKDROP, GEOMETRY)?.lines).toHaveLength(11);
      on.flags.figures = false;
      other.ocrSettingsChanged();
      await settle();
      // Hidden, not deleted: the cache still has them, and turning it on shows them again.
      expect(other.peek(BACKDROP, GEOMETRY)?.lines).toHaveLength(10);
      on.flags.figures = true;
      other.ocrSettingsChanged();
      await settle();
      expect(other.peek(BACKDROP, GEOMETRY)?.lines).toHaveLength(11);
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

  describe("the PDF's vocabulary", () => {
    const line = (str: string, yUp: number): unknown => ({
      str,
      transform: [10, 0, 0, 10, 20, yUp],
      width: str.length * 5.5,
      height: 10,
      fontName: "f1",
    });
    /** Three pages; only the third (index 2) has the word "external" in its own text. */
    const setup = (): void => {
      pdf.itemsByPage = {
        1: [line("the anatomy of the bladder is shown", 500)],
        2: [line("a page about the sling procedure", 500)],
        3: [line("the external sphincter closes the urethra", 500)],
      };
    };
    const misread: OcrPage = {
      imageWidth: 600,
      imageHeight: 450,
      pageWidth: 400,
      pageHeight: 560,
      condition: "TEXT_WITH_FIGURES",
      regions: [{ x0: 94, y0: 104, x1: 306, y1: 266, dpi: 300 }],
      lines: [
        {
          conf: 0.98,
          words: [{ text: "Extemal", box: [150, 340, 200, 352], conf: 0.98, min: 0.9 }],
        },
      ],
    };
    const lexicon = new Set(
      Array.from({ length: 1200 }, (_, i) => `word${"abcdefghij"[i % 10]}${i}`),
    );
    const backdrop = (page: number) => ({ kind: "pdf" as const, path: "Scan.pdf", page });
    const lines = (cache: InstanceType<typeof PdfTextCache>, page: number): string[] => {
      const layout = cache.peek(backdrop(page), GEOMETRY);
      return layout ? layoutPlainText(layout).split("\n") : [];
    };
    /** Wait, a tick at a time, until `done` holds (or give up). */
    const until = async (done: () => boolean): Promise<void> => {
      for (let i = 0; i < 200 && !done(); i++) await settle();
    };
    const open = () =>
      cacheWith(fakeOcr(misread, true, true).service, () => Promise.resolve(lexicon));

    it("gives the same text whichever page was read first", async () => {
      setup();
      const finals: string[][][] = [];
      for (const order of [
        [0, 1, 2],
        [2, 1, 0],
      ]) {
        const cache = open();
        for (const page of order) {
          cache.request(backdrop(page));
          await until(() => cache.peek(backdrop(page), GEOMETRY) !== null);
        }
        await until(() => [0, 1, 2].every((p) => lines(cache, p).includes("External")));
        finals.push([0, 1, 2].map((p) => lines(cache, p)));
        cache.destroy();
      }
      expect(finals[0]).toEqual(finals[1]);
      expect(finals[0][0]).toContain("External");
      expect(finals[0][0]).not.toContain("Extemal");
    });

    it("shows the words as read until the vocabulary is complete, then reads the page again", async () => {
      setup();
      // The first answer is the page's own (call 1); the vocabulary's pages wait for the gate.
      pdf.allowCalls = 1;
      let release = (): void => undefined;
      pdf.gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const cache = open();
      const landed: number[] = [];
      cache.onReady = (_path, page) => landed.push(page);
      cache.request(backdrop(0));
      await until(() => cache.peek(backdrop(0), GEOMETRY) !== null);
      expect(lines(cache, 0)).toContain("Extemal");
      expect(lines(cache, 0)).not.toContain("External");
      const before = landed.length;
      release();
      await until(() => lines(cache, 0).includes("External"));
      expect(lines(cache, 0)).not.toContain("Extemal");
      // The page was announced again, as when OCR text arrives.
      expect(landed.length).toBeGreaterThan(before);
      cache.destroy();
    });

    it("reads the vocabulary's pages only while the pen is up", async () => {
      setup();
      pdf.allowCalls = 1;
      let release = (): void => undefined;
      pdf.gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const cache = open();
      cache.request(backdrop(0));
      await until(() => cache.peek(backdrop(0), GEOMETRY) !== null);
      // Down on the pen: the page being read finishes, the next waits.
      cache.setHeld(true);
      release();
      await until(() => pdf.textCalls >= 2);
      for (let i = 0; i < 20; i++) await settle();
      expect(pdf.textCalls).toBe(2);
      expect(lines(cache, 0)).toContain("Extemal");
      cache.setHeld(false);
      await until(() => lines(cache, 0).includes("External"));
      // Three pages of vocabulary, and the page that carries the words read again.
      expect(pdf.textCalls).toBe(5);
      cache.destroy();
    });

    it("stops reading when the PDF is let go or the cache closes", async () => {
      for (const stop of ["forget", "destroy"] as const) {
        pdf.textCalls = 0;
        setup();
        pdf.allowCalls = 1;
        let release = (): void => undefined;
        pdf.gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const cache = open();
        cache.request(backdrop(0));
        await until(() => cache.peek(backdrop(0), GEOMETRY) !== null);
        if (stop === "forget") cache.forget("Scan.pdf");
        else cache.destroy();
        release();
        for (let i = 0; i < 20; i++) await settle();
        // The page in hand was finished; no page after it was asked for.
        expect(pdf.textCalls).toBe(2);
        cache.destroy();
      }
    });
  });
});
