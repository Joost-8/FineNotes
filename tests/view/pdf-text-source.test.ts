/**
 * The PDF text cache, with pdf.js faked: a page is read once, laid out on
 * the page it backs, never read while the pen writes, and a page that cannot
 * be read is kept as having no text, so the highlighter stays freehand.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdf = {
  opened: 0,
  reads: 0,
  pages: 3,
  fail: false,
  items: [] as unknown[],
  cMapUrl: undefined as string | undefined,
  cMapPacked: undefined as boolean | undefined,
};

vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  loadPdfJs: () =>
    Promise.resolve({
      getDocument: (src: { cMapUrl?: string; cMapPacked?: boolean }) => {
        pdf.opened++;
        pdf.cMapUrl = src.cMapUrl;
        pdf.cMapPacked = src.cMapPacked;
        return {
          promise: Promise.resolve({
            numPages: pdf.pages,
            getPage: () =>
              Promise.resolve({
                getViewport: ({ scale }: { scale: number }) => ({
                  width: 600 * scale,
                  height: 800 * scale,
                  transform: [scale, 0, 0, -scale, 0, 800 * scale],
                }),
                getTextContent: () => {
                  pdf.reads++;
                  if (pdf.fail) return Promise.reject(new Error("broken page"));
                  return Promise.resolve({
                    items: pdf.items,
                    styles: { f1: { ascent: 0.9, descent: -0.3, vertical: false } },
                  });
                },
                cleanup: () => undefined,
              }),
            destroy: () => Promise.resolve(),
          }),
        };
      },
    }),
}));

const { PdfTextCache, readTextItems } = await import("../../src/view/pdf-text-source");

const BACKDROP = { kind: "pdf" as const, path: "Slides.pdf", page: 0 };
const GEOMETRY = { width: 600, height: 800 };

function cache(file: object | null = {}): InstanceType<typeof PdfTextCache> {
  const app = {
    vault: {
      getFileByPath: () => file,
      readBinary: () => Promise.resolve(new ArrayBuffer(8)),
    },
  };
  return new PdfTextCache(app as never);
}

/** Resolve when `c` says a page landed. */
function landed(c: InstanceType<typeof PdfTextCache>): Promise<{ path: string; page: number }> {
  return new Promise((resolve) => {
    c.onReady = (path, page) => resolve({ path, page });
  });
}

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "app://obsidian.md" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  pdf.opened = 0;
  pdf.reads = 0;
  pdf.fail = false;
  pdf.items = [];
});

describe("readTextItems", () => {
  it("keeps well-formed items with their fonts' metrics and skips the rest", () => {
    const items = readTextItems({
      items: [
        { str: "Hello", transform: [20, 0, 0, 20, 10, 700], width: 50, height: 20, fontName: "f1" },
        { str: "odd", transform: [20, 0, 0, "x", 10, 700], width: 30, height: 20 },
        { str: 3, transform: [], width: 1, height: 1 },
        { str: "no width", transform: [1, 0, 0, 1, 0, 0], height: 1 },
        { str: "up", transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1, fontName: "v" },
        { type: "beginMarkedContent" } as never,
      ],
      styles: { f1: { ascent: 0.9, descent: -0.3 }, v: { vertical: true } },
    });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ str: "Hello", ascent: 0.9, descent: -0.3 });
    expect(Number.isNaN(items[1].transform[3])).toBe(true);
    expect(items[2].vertical).toBe(true);
  });
});

describe("PdfTextCache", () => {
  it("reads a page once, in the background, and lays it out on its page", async () => {
    pdf.items = [
      {
        str: "Signals",
        transform: [20, 0, 0, 20, 100, 700],
        width: 70,
        height: 20,
        fontName: "f1",
      },
    ];
    const c = cache();
    expect(c.peek(BACKDROP, GEOMETRY)).toBeNull();
    const ready = landed(c);
    c.request(BACKDROP);
    c.request(BACKDROP);
    expect(await ready).toEqual({ path: "Slides.pdf", page: 0 });
    expect(pdf.reads).toBe(1);
    const layout = c.peek(BACKDROP, GEOMETRY);
    expect(layout?.lines).toHaveLength(1);
    // Baseline 100 pt from the top; the font's ascent of 0.9 sets the top.
    expect(layout?.lines[0].top).toBeCloseTo(82);
    // On a page half the size, the same text at half the size.
    expect(c.peek(BACKDROP, { width: 300, height: 400 })?.lines[0].top).toBeCloseTo(41);
    c.request(BACKDROP);
    expect(pdf.reads).toBe(1);
  });

  it("reads nothing while the pen writes, and what was asked for once it lifts", async () => {
    const c = cache();
    c.setHeld(true);
    c.request(BACKDROP);
    await Promise.resolve();
    expect(pdf.reads).toBe(0);
    const ready = landed(c);
    c.setHeld(false);
    await ready;
    expect(pdf.reads).toBe(1);
    expect(pdf.opened).toBe(1);
  });

  it("opens the PDF with Obsidian's cMaps, so CJK text without /ToUnicode reads (#49)", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    const c = cache();
    const ready = landed(c);
    c.request(BACKDROP);
    await ready;
    expect(pdf.cMapUrl).toBe("app://obsidian.md/lib/pdfjs/cmaps/");
    expect(pdf.cMapPacked).toBe(true);
  });

  it("keeps a page it cannot read as having no text: nothing snaps there", async () => {
    pdf.fail = true;
    const c = cache();
    const ready = landed(c);
    c.request(BACKDROP);
    await ready;
    expect(c.peek(BACKDROP, GEOMETRY)).toEqual({ chars: [], lines: [] });
  });

  it("has no text for a missing file or a page past the end", async () => {
    const missing = cache(null);
    let ready = landed(missing);
    missing.request(BACKDROP);
    await ready;
    expect(missing.peek(BACKDROP, GEOMETRY)?.lines).toEqual([]);

    const c = cache();
    ready = landed(c);
    c.request({ ...BACKDROP, page: 7 });
    await ready;
    expect(c.peek({ ...BACKDROP, page: 7 }, GEOMETRY)?.lines).toEqual([]);
    expect(pdf.reads).toBe(0);
  });

  it("reads a file afresh once it changed, and nothing after it is destroyed", async () => {
    const c = cache();
    let ready = landed(c);
    c.request(BACKDROP);
    await ready;
    c.forget("Slides.pdf");
    expect(c.peek(BACKDROP, GEOMETRY)).toBeNull();
    ready = landed(c);
    c.request(BACKDROP);
    await ready;
    expect(pdf.opened).toBe(2);
    c.destroy();
    c.request({ ...BACKDROP, page: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pdf.reads).toBe(2);
  });

  it("keeps at most 200 pages, dropping the oldest", async () => {
    pdf.pages = 500;
    const c = cache();
    for (let page = 0; page < 201; page++) {
      const ready = landed(c);
      c.request({ ...BACKDROP, page });
      await ready;
      c.peek({ ...BACKDROP, page }, GEOMETRY);
    }
    expect(c.peek(BACKDROP, GEOMETRY)).toBeNull();
    expect(c.peek({ ...BACKDROP, page: 200 }, GEOMETRY)).not.toBeNull();
    pdf.pages = 3;
  });
});
