/**
 * The PDF text read through the PDF worker's own document: what the worker
 * sends of a page, the operators it keeps, and the document `PdfTextCache`
 * reads from it. The two shapers run inside the worker from their source
 * text, so they are also run here from theirs, with nothing around them.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type TextWorker,
  type WorkerPageText,
  keptOperators,
  shapePageText,
  workerTextDocument,
} from "../../src/view/pdf-worker-text";

const VIEWPORT = { width: 612, height: 792, transform: new Float64Array([1, 0, 0, -1, 0, 792]) };
const CONTENT = {
  items: [
    {
      str: "Limits",
      transform: [12, 0, 0, 12, 72, 700],
      width: 40,
      height: 12,
      fontName: "f1",
      dir: "ltr",
    },
    { type: "beginMarkedContent", id: "mc0" },
    { str: "", transform: [12, 0, 0, 12, 72, 680], width: 0, height: 12, fontName: "f1" },
  ],
  styles: { f1: { ascent: 0.9, descent: -0.2, vertical: false, fontFamily: "serif" } },
};
const ANNOTATIONS = [
  { subtype: "Link", rect: [1, 2, 3, 4], url: "https://openstax.org", dest: null, borderStyle: {} },
  { subtype: "Link", rect: [5, 6, 7, 8], dest: [{ num: 12, gen: 0 }, { name: "XYZ" }] },
  { subtype: "Widget", rect: [0, 0, 1, 1], fieldValue: "x" },
];

/** As the worker runs it: its source text, evaluated alone. */
function fromSource<T extends (...args: never[]) => unknown>(fn: T): T {
  return new Function(`return (${fn.toString()});`)() as T;
}

describe("shapePageText", () => {
  it("keeps the text items, their fonts' metrics and the links, as plain data", () => {
    const shaped = shapePageText(VIEWPORT, CONTENT, ANNOTATIONS);
    expect(shaped).toEqual({
      width: 612,
      height: 792,
      transform: [1, 0, 0, -1, 0, 792],
      items: [
        {
          str: "Limits",
          transform: [12, 0, 0, 12, 72, 700],
          width: 40,
          height: 12,
          fontName: "f1",
        },
        { str: "", transform: [12, 0, 0, 12, 72, 680], width: 0, height: 12, fontName: "f1" },
      ],
      styles: { f1: { ascent: 0.9, descent: -0.2, vertical: false } },
      annotations: [
        {
          subtype: "Link",
          rect: [1, 2, 3, 4],
          url: "https://openstax.org",
          unsafeUrl: undefined,
          dest: null,
        },
        {
          subtype: "Link",
          rect: [5, 6, 7, 8],
          url: undefined,
          unsafeUrl: undefined,
          dest: [{ num: 12, gen: 0 }, { name: "XYZ" }],
        },
      ],
    });
    // It crosses to this thread by structured clone.
    expect(structuredClone(shaped)).toEqual(shaped);
  });

  it("does the same from its source alone, as in the worker, and takes no annotations", () => {
    const alone = fromSource(shapePageText);
    expect(alone(VIEWPORT, CONTENT, ANNOTATIONS)).toEqual(
      shapePageText(VIEWPORT, CONTENT, ANNOTATIONS),
    );
    expect(alone(VIEWPORT, { items: [] }, null)).toMatchObject({
      items: [],
      styles: {},
      annotations: [],
    });
  });
});

describe("keptOperators", () => {
  it("keeps only the operators asked for, with their arguments", () => {
    const list = {
      fnArray: [10, 91, 12, 91, 85],
      argsArray: [null, [1, 2], [1, 0, 0, 1, 5, 5], [3], ["img", 9, 9]],
    };
    const kept = { fnArray: [10, 12, 85], argsArray: [null, [1, 0, 0, 1, 5, 5], ["img", 9, 9]] };
    expect(keptOperators(list, [10, 12, 85])).toEqual(kept);
    expect(fromSource(keptOperators)(list, [10, 12, 85])).toEqual(kept);
  });
});

describe("workerTextDocument", () => {
  const page: WorkerPageText = shapePageText(VIEWPORT, CONTENT, ANNOTATIONS);
  function worker() {
    return {
      alive: true,
      share: vi.fn(async () => 600),
      open: vi.fn(async () => 600),
      pageText: vi.fn(async () => page),
      operators: vi.fn(async () => ({ fnArray: [10], argsArray: [null] })),
      destination: vi.fn(async () => [{ num: 3, gen: 0 }]),
      pageIndex: vi.fn(async () => 41),
      close: vi.fn(),
    } satisfies TextWorker;
  }

  it("answers the slice of a pdf.js document the text cache reads, 1-based pages to 0-based", async () => {
    const w = worker();
    const doc = workerTextDocument(w, "Book.pdf", 600, [10, 12]);
    expect(doc.numPages).toBe(600);
    const p = await doc.getPage(42);
    expect(w.pageText).toHaveBeenCalledWith("Book.pdf", 41);
    expect(p.getViewport({ scale: 1 })).toEqual({
      width: 612,
      height: 792,
      transform: [1, 0, 0, -1, 0, 792],
    });
    expect(p.getViewport({ scale: 2 })).toEqual({
      width: 1224,
      height: 1584,
      transform: [2, 0, 0, -2, 0, 1584],
    });
    expect(await p.getTextContent()).toEqual({ items: page.items, styles: page.styles });
    expect(await p.getAnnotations()).toBe(page.annotations);
    expect(await p.getOperatorList()).toEqual({ fnArray: [10], argsArray: [null] });
    expect(w.operators).toHaveBeenCalledWith("Book.pdf", 41, [10, 12]);
    expect(await doc.getDestination("chap2")).toEqual([{ num: 3, gen: 0 }]);
    expect(await doc.getPageIndex({ num: 3, gen: 0 })).toBe(41);
    p.cleanup();
  });

  it("lets go of its use of the worker's document once, however often destroyed", async () => {
    const w = worker();
    const doc = workerTextDocument(w, "Book.pdf", 600, []);
    await doc.destroy();
    await doc.destroy();
    expect(w.close).toHaveBeenCalledTimes(1);
    expect(w.close).toHaveBeenCalledWith("Book.pdf");
  });
});
