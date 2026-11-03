import { describe, expect, it } from "vitest";
import { hasInkOutside, isBlank } from "../../../src/recognition/ocr/blank";
import {
  OCR_CACHE_FORMAT,
  cacheFolder,
  cachePath,
  cachedPage,
  emptyCache,
  isCacheKey,
  mergeCaches,
  parseCache,
  serializeCache,
  withPage,
} from "../../../src/recognition/ocr/ocr-cache";
import { OCR_MODEL_VERSION } from "../../../src/recognition/ocr/ocr-model";
import { NEAR, OcrQueue } from "../../../src/recognition/ocr/ocr-queue";
import type { OcrPage } from "../../../src/recognition/ocr/ocr-words";

const sample: OcrPage = {
  imageWidth: 1403,
  imageHeight: 1984,
  pageWidth: 594.123,
  pageHeight: 840.456,
  lines: [
    {
      conf: 0.9871,
      words: [
        { text: "Hello", box: [10.123, 20.456, 50.789, 32.01], conf: 0.99, min: 0.95 },
        { text: "world", box: [56, 20, 99.99, 32], conf: 0.97, min: 0.9 },
      ],
    },
  ],
};

describe("the OCR cache file", () => {
  const key = "a".repeat(64);

  it("is named by the PDF's SHA-256, in the plugin's ocr folder", () => {
    expect(isCacheKey(key)).toBe(true);
    expect(isCacheKey("ABC")).toBe(false);
    expect(isCacheKey("A".repeat(64))).toBe(false);
    expect(cachePath("plugins/finenotes", key)).toBe(`plugins/finenotes/ocr/${key}.json`);
    expect(cacheFolder("plugins/finenotes")).toBe("plugins/finenotes/ocr");
  });

  it("round-trips a page, boxes to a tenth of a point", () => {
    const file = withPage(emptyCache(), 3, sample);
    const back = parseCache(serializeCache(file));
    const page = cachedPage(back, 3);
    expect(page).not.toBeNull();
    expect(page?.lines[0].words[0].box).toEqual([10.1, 20.5, 50.8, 32]);
    expect(page?.lines[0].words[1].text).toBe("world");
    expect(page?.imageWidth).toBe(1403);
    expect(cachedPage(back, 4)).toBeNull();
    expect(back.format).toBe(OCR_CACHE_FORMAT);
  });

  it("ignores a page read by another model version, and replaces it when read again", () => {
    const old = withPage(emptyCache(), 0, sample, "ppocrv5-mobile-0");
    expect(cachedPage(old, 0)).toBeNull();
    expect(cachedPage(old, 0, "ppocrv5-mobile-0")).not.toBeNull();
    const fresh = withPage(old, 0, sample);
    expect(cachedPage(fresh, 0)).not.toBeNull();
    expect(fresh.pages["0"].model).toBe(OCR_MODEL_VERSION);
  });

  it("ignores a file of another format, and anything that is not a cache", () => {
    const other = JSON.stringify({
      ...withPage(emptyCache(), 0, sample),
      format: OCR_CACHE_FORMAT + 1,
    });
    expect(parseCache(other).pages).toEqual({});
    for (const text of ["", "not json", "[]", "null", '{"format":1}', '{"format":1,"pages":5}']) {
      expect(parseCache(text).pages).toEqual({});
    }
  });

  it("drops damaged pages and words but keeps the rest", () => {
    const good = withPage(emptyCache(), 1, sample);
    const raw = JSON.parse(serializeCache(good)) as { pages: Record<string, unknown> };
    raw.pages["x"] = good.pages["1"];
    raw.pages["2"] = { model: OCR_MODEL_VERSION, lines: "no" };
    raw.pages["5"] = { ...good.pages["1"], pageWidth: "wide" };
    const lines = (raw.pages["1"] as { lines: { words: unknown[] }[] }).lines;
    lines[0].words.push(
      { text: "", box: [0, 0, 1, 1], conf: 1, min: 1 },
      { text: "x", box: [5, 5, 1, 1], conf: 1, min: 1 },
      7,
    );
    lines.push({ words: [] } as never);
    const back = parseCache(JSON.stringify(raw));
    expect(Object.keys(back.pages)).toEqual(["1"]);
    expect(back.pages["1"].lines).toHaveLength(1);
    expect(back.pages["1"].lines[0].words).toHaveLength(2);
  });

  it("merges what another device added, ours replacing theirs, a current page never by an old one", () => {
    const theirs = withPage(withPage(emptyCache(), 0, sample), 1, sample);
    const ours = withPage(withPage(emptyCache(), 1, { ...sample, imageWidth: 1 }), 2, sample);
    const merged = mergeCaches(theirs, ours);
    expect(Object.keys(merged.pages).sort()).toEqual(["0", "1", "2"]);
    expect(merged.pages["1"].imageWidth).toBe(1);
    const stale = withPage(emptyCache(), 0, { ...sample, imageWidth: 9 }, "ppocrv5-mobile-0");
    expect(mergeCaches(theirs, stale).pages["0"].imageWidth).toBe(1403);
  });
});

describe("blank pages", () => {
  const image = (w: number, h: number, fill = 255): Uint8ClampedArray =>
    new Uint8ClampedArray(w * h * 4).fill(fill);

  it("are white or nearly so; a page with text is not", () => {
    expect(isBlank(image(100, 100))).toBe(true);
    expect(isBlank(new Uint8ClampedArray(0))).toBe(true);
    // Scanner noise on white paper.
    const noisy = image(100, 100);
    for (let i = 0; i < noisy.length; i += 4) noisy.fill(242 + (i % 9), i, i + 3);
    expect(isBlank(noisy)).toBe(true);
    const ink = image(100, 100);
    for (let x = 10; x < 80; x++) ink.fill(60, (50 * 100 + x) * 4, (50 * 100 + x) * 4 + 3);
    expect(isBlank(ink)).toBe(false);
    // Transparent counts as white.
    expect(isBlank(new Uint8ClampedArray(400))).toBe(true);
  });
});

describe("ink beyond a page's own text", () => {
  const W = 100;
  const H = 100;
  const white = (): Uint8ClampedArray => new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (img: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) img.fill(40, (y * W + x) * 4, (y * W + x) * 4 + 3);
  };

  it("is none when everything dark is under the page's own text", () => {
    const img = white();
    ink(img, 40, 90, 50, 96); // a page number
    expect(hasInkOutside(img, W, [])).toBe(true);
    expect(hasInkOutside(img, W, [{ x0: 40, y0: 90, x1: 50, y1: 96 }])).toBe(false);
    // The text's grey edges are masked too.
    ink(img, 39, 89, 40, 97);
    expect(hasInkOutside(img, W, [{ x0: 40, y0: 90, x1: 50, y1: 96 }])).toBe(false);
  });

  it("is there when something else is on the page", () => {
    const img = white();
    ink(img, 40, 90, 50, 96);
    ink(img, 10, 20, 80, 24); // a line of print
    expect(hasInkOutside(img, W, [{ x0: 40, y0: 90, x1: 50, y1: 96 }])).toBe(true);
  });

  it("is none for an empty image or width", () => {
    expect(hasInkOutside(new Uint8ClampedArray(0), W, [])).toBe(false);
    expect(hasInkOutside(white(), 0, [])).toBe(false);
  });
});

describe("which page is read next", () => {
  it("reads the page in view, then its neighbours, then the rest only when idle", () => {
    const q = new OcrQueue();
    q.focus("a.pdf", 10);
    for (const p of [3, 12, 10, 11, 30, 9]) q.add("a.pdf", p);
    expect(q.next(false)).toEqual({ path: "a.pdf", page: 10 });
    // Neighbours: forward first.
    expect(q.next(false)).toEqual({ path: "a.pdf", page: 11 });
    expect(q.next(false)).toEqual({ path: "a.pdf", page: 9 });
    expect(NEAR).toBe(1);
    // The rest wait for idle ...
    expect(q.next(false)).toBeNull();
    // ... and then go nearest first.
    expect(q.next(true)).toEqual({ path: "a.pdf", page: 12 });
    expect(q.next(true)).toEqual({ path: "a.pdf", page: 3 });
    expect(q.next(true)).toEqual({ path: "a.pdf", page: 30 });
    expect(q.next(true)).toBeNull();
  });

  it("follows the user: moving to another page reorders what is left", () => {
    const q = new OcrQueue();
    q.focus("a.pdf", 0);
    for (const p of [1, 2, 20, 21]) q.add("a.pdf", p);
    q.focus("a.pdf", 20);
    expect(q.next(false)).toEqual({ path: "a.pdf", page: 20 });
    expect(q.next(false)).toEqual({ path: "a.pdf", page: 21 });
    expect(q.next(false)).toBeNull();
  });

  it("serves the PDF looked at last first, and pages of a PDF never looked at only when idle", () => {
    const q = new OcrQueue();
    q.focus("a.pdf", 0);
    q.focus("b.pdf", 5);
    q.add("a.pdf", 0);
    q.add("b.pdf", 5);
    q.add("c.pdf", 0);
    expect(q.next(false)).toEqual({ path: "b.pdf", page: 5 });
    expect(q.next(false)).toEqual({ path: "a.pdf", page: 0 });
    expect(q.next(false)).toBeNull();
    expect(q.next(true)).toEqual({ path: "c.pdf", page: 0 });
  });

  it("does not queue a page twice, and counts what is queued", () => {
    const q = new OcrQueue();
    expect(q.add("a.pdf", 1)).toBe(true);
    expect(q.add("a.pdf", 1)).toBe(false);
    expect(q.has("a.pdf", 1)).toBe(true);
    q.add("b.pdf", 1);
    expect(q.size()).toBe(2);
    expect(q.size("a.pdf")).toBe(1);
    expect(q.remove("a.pdf", 1)).toBe(true);
    expect(q.remove("a.pdf", 1)).toBe(false);
  });

  it("cancels a PDF whole when no open notebook uses it", () => {
    const q = new OcrQueue();
    q.focus("a.pdf", 0);
    q.startFill("a.pdf", 5);
    q.add("a.pdf", 0);
    q.add("a.pdf", 1);
    q.add("b.pdf", 0);
    expect(q.cancelPath("a.pdf")).toBe(2);
    expect(q.next(true)).toEqual({ path: "b.pdf", page: 0 });
    expect(q.next(true)).toBeNull();
    expect(q.nextProbe(true)).toBeNull();
  });

  it("probes the rest of a PDF with a scanned page while idle, nearest the page in view, each page once", () => {
    const q = new OcrQueue();
    q.focus("a.pdf", 2);
    q.startFill("a.pdf", 5);
    q.startFill("a.pdf", 99);
    q.markProbed("a.pdf", 2);
    expect(q.nextProbe(false)).toBeNull();
    const order: number[] = [];
    for (let p = q.nextProbe(true); p; p = q.nextProbe(true)) order.push(p.page);
    expect(order).toEqual([3, 1, 4, 0]);
    q.startFill("none.pdf", 0);
    expect(q.nextProbe(true)).toBeNull();
  });

  it("does not probe a page already queued", () => {
    const q = new OcrQueue();
    q.focus("a.pdf", 0);
    q.startFill("a.pdf", 2);
    q.markProbed("a.pdf", 0);
    q.add("a.pdf", 1);
    expect(q.nextProbe(true)).toBeNull();
  });
});

describe("the OCR cache records what kind of page it is", () => {
  const regions = [{ x0: 10.04, y0: 20.06, x1: 200, y1: 180.5, dpi: 349.7 }];

  it("stores the condition, the regions read and their words", () => {
    const file = withPage(emptyCache(), 9, {
      ...sample,
      condition: "TEXT_WITH_FIGURES",
      regions,
    });
    const back = cachedPage(parseCache(serializeCache(file)), 9);
    expect(back?.condition).toBe("TEXT_WITH_FIGURES");
    expect(back?.regions).toEqual([{ x0: 10, y0: 20.1, x1: 200, y1: 180.5, dpi: 350 }]);
    expect(back?.lines[0].words).toHaveLength(2);
  });

  it("records a TEXT_ONLY page with nothing in it, and that costs nothing to find again", () => {
    const file = withPage(emptyCache(), 4, {
      condition: "TEXT_ONLY",
      regions: [],
      imageWidth: 0,
      imageHeight: 0,
      pageWidth: 612,
      pageHeight: 866,
      lines: [],
    });
    const back = parseCache(serializeCache(file));
    expect(cachedPage(back, 4)).toMatchObject({ condition: "TEXT_ONLY", regions: [], lines: [] });
  });

  it("reads a page stored without a condition as a scan of the whole page", () => {
    const stored = cachedPage(withPage(emptyCache(), 0, sample), 0);
    expect(stored?.condition).toBe("SCANNED");
    expect(stored?.regions).toEqual([{ x0: 0, y0: 0, x1: 594.1, y1: 840.5, dpi: null }]);
  });

  it("treats an entry of the old format, or of an unknown condition, as a miss", () => {
    const current = JSON.parse(serializeCache(withPage(emptyCache(), 0, sample))) as {
      format: number;
      pages: Record<string, Record<string, unknown>>;
    };
    expect(parseCache(JSON.stringify({ ...current, format: 1 })).pages).toEqual({});
    current.pages["0"].condition = "SOMETHING_ELSE";
    expect(parseCache(JSON.stringify(current)).pages).toEqual({});
    delete current.pages["0"].condition;
    expect(parseCache(JSON.stringify(current)).pages).toEqual({});
  });

  it("looks again at a TEXT_ONLY page recorded under other classification rules, not at a read one", () => {
    const text = serializeCache(
      withPage(withPage(emptyCache(), 1, { ...sample, condition: "TEXT_ONLY", lines: [] }), 2, {
        ...sample,
        condition: "TEXT_WITH_FIGURES",
        regions,
      }),
    );
    const raw = JSON.parse(text) as { pages: Record<string, { rules: number }> };
    raw.pages["1"].rules = 0;
    raw.pages["2"].rules = 0;
    const back = parseCache(JSON.stringify(raw));
    expect(cachedPage(back, 1)).toBeNull();
    expect(cachedPage(back, 2)).not.toBeNull();
  });

  it("drops damaged regions but keeps the page", () => {
    const raw = JSON.parse(
      serializeCache(
        withPage(emptyCache(), 0, { ...sample, condition: "TEXT_WITH_FIGURES", regions }),
      ),
    ) as { pages: Record<string, { regions: unknown[] }> };
    raw.pages["0"].regions.push({ x0: 5, y0: 5, x1: 1, y1: 1, dpi: null }, "x", null);
    const page = cachedPage(parseCache(JSON.stringify(raw)), 0);
    expect(page?.regions).toHaveLength(1);
  });
});
