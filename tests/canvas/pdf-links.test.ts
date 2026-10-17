/**
 * `src/canvas/pdf-links.ts` — a PDF's links: read from pdf.js annotations,
 * placed on a notebook page, found under a finger, and sent to the notebook
 * page that shows their destination.
 */

import { describe, expect, it } from "vitest";
import {
  type PdfLink,
  linkAt,
  linksOnPage,
  notebookPageOf,
  readLinks,
  safeUrl,
} from "../../src/canvas/pdf-links";

/** pdf.js's viewport at scale 1 for an A4 page: y flipped, origin at the top. */
const A4 = { width: 595, height: 842 };
const VIEWPORT = [1, 0, 0, -1, 0, 842] as const;

describe("readLinks", () => {
  it("keeps links to a page or a safe address, and drops the rest", async () => {
    const resolve = (dest: unknown): Promise<number | null> =>
      Promise.resolve(dest === "march" ? 2 : Array.isArray(dest) ? 5 : null);
    const links = await readLinks(
      [
        { subtype: "Link", rect: [10, 20, 60, 40], dest: "march" },
        { subtype: "Link", rect: [10, 50, 60, 70], dest: [{ num: 12, gen: 0 }, { name: "XYZ" }] },
        { subtype: "Link", rect: [0, 0, 5, 5], url: "https://example.com/plan" },
        { subtype: "Link", rect: [0, 0, 5, 5], unsafeUrl: "javascript:alert(1)" },
        { subtype: "Link", rect: [0, 0, 5, 5], dest: "nowhere" },
        { subtype: "Widget", rect: [0, 0, 5, 5], dest: "march" },
        { subtype: "Link", rect: [0, "x", 5, 5], dest: "march" },
      ],
      resolve,
    );
    expect(links.map((l) => l.target)).toEqual([
      { page: 2 },
      { page: 5 },
      { url: "https://example.com/plan" },
    ]);
  });

  it("survives a destination that fails to resolve", async () => {
    const links = await readLinks([{ subtype: "Link", rect: [0, 0, 1, 1], dest: "x" }], () =>
      Promise.reject(new Error("broken")),
    );
    expect(links).toEqual([]);
  });

  it("opens only web and mail addresses", () => {
    expect(safeUrl(" https://a.b ")).toBe("https://a.b");
    expect(safeUrl("mailto:x@y.z")).toBe("mailto:x@y.z");
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("javascript:void 0")).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});

describe("links on a page", () => {
  const tab: PdfLink = { rect: [500, 742, 595, 842], target: { page: 3 } };

  it("places a PDF rectangle on a notebook page of the same shape", () => {
    const [link] = linksOnPage([tab], VIEWPORT, A4, { width: 1190, height: 1684 });
    expect(link.minX).toBeCloseTo(1000);
    expect(link.minY).toBeCloseTo(0);
    expect(link.maxX).toBeCloseTo(1190);
    expect(link.maxY).toBeCloseTo(200);
  });

  it("allows for the fit when the page has another shape", () => {
    // A page twice as tall: the PDF is fitted by width and centred down it.
    const [link] = linksOnPage([tab], VIEWPORT, A4, { width: 595, height: 1684 });
    expect(link.minY).toBeCloseTo(421);
    expect(link.maxY).toBeCloseTo(521);
  });

  it("finds the smallest link under a finger, with some room around it", () => {
    const header = { minX: 0, minY: 0, maxX: 600, maxY: 100, target: { page: 0 } };
    const small = { minX: 500, minY: 10, maxX: 580, maxY: 40, target: { page: 7 } };
    expect(linkAt([header, small], { x: 540, y: 20 }, 4)?.target).toEqual({ page: 7 });
    expect(linkAt([header, small], { x: 100, y: 50 }, 4)?.target).toEqual({ page: 0 });
    expect(linkAt([small], { x: 584, y: 44 }, 5)?.target).toEqual({ page: 7 });
    expect(linkAt([small], { x: 590, y: 50 }, 5)).toBeNull();
  });
});

describe("notebookPageOf", () => {
  const pdf = (path: string, page: number) => ({ backdrop: { kind: "pdf", path, page } });
  const pages = [
    { backdrop: { kind: "blank" } },
    pdf("A.pdf", 0),
    pdf("A.pdf", 1),
    pdf("B.pdf", 1),
    pdf("A.pdf", 0),
    pdf("A.pdf", 1),
  ];

  it("finds the page showing that PDF page, nearest the one being read", () => {
    expect(notebookPageOf(pages, "A.pdf", 1, 1)).toBe(2);
    expect(notebookPageOf(pages, "A.pdf", 0, 5)).toBe(4);
    expect(notebookPageOf(pages, "B.pdf", 1, 0)).toBe(3);
  });

  it("is -1 when no page shows it", () => {
    expect(notebookPageOf(pages, "A.pdf", 9, 0)).toBe(-1);
    expect(notebookPageOf(pages, "C.pdf", 0, 0)).toBe(-1);
  });
});
