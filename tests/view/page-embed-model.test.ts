import { describe, expect, it } from "vitest";
import type { PreviewPage } from "../../src/view/page-embed-model";
import {
  EMBED_CANVAS_BUDGET,
  EMBED_WIDTH_STEP,
  MAX_EMBED_DEVICE_WIDTH,
  PRINT_DPR,
  PRINT_FALLBACK_WIDTH,
  SharedNotebooks,
  embedInsertion,
  embedPageLabel,
  embedPageLink,
  embedPageNumbers,
  MAX_PREVIEW_PAGES,
  previewCaption,
  printPaintSize,
  embedPaintSize,
  embedLabel,
  embedTarget,
  embedWidth,
  embeddedPageNumber,
  embedsToRelease,
  pageLinkLabel,
} from "../../src/view/page-embed-model";

describe("embeddedPageNumber", () => {
  it.each([
    ["#page=3", 3],
    ["page=3", 3],
    ["#Page 3", 3],
    ["#p3", 3],
    ["#P12", 12],
    ["  #page = 7 ", 7],
    ["#page=1", 1],
  ])("reads %j as page %i", (subpath, page) => {
    expect(embeddedPageNumber(subpath)).toBe(page);
  });

  it("reads a page past any notebook's end, so the embed can say it is missing", () => {
    expect(embeddedPageNumber("#page=900")).toBe(900);
  });

  it.each([[""], ["#"], ["#Introduction"], ["#^block"], ["#page=0"], ["#page=-2"], ["#page3x"]])(
    "leaves %j to Obsidian",
    (subpath) => {
      expect(embeddedPageNumber(subpath)).toBeNull();
    },
  );
});

describe("embedTarget", () => {
  it("shows page 1 of a notebook embedded whole", () => {
    expect(embedTarget("")).toEqual({ page: 1, whole: true });
    expect(embedTarget("#")).toEqual({ page: 1, whole: true });
    expect(embedTarget("  ")).toEqual({ page: 1, whole: true });
  });

  it("shows the page a subpath names, past the end too", () => {
    expect(embedTarget("#page=1")).toEqual({ page: 1, whole: false });
    expect(embedTarget("#Page 3")).toEqual({ page: 3, whole: false });
    expect(embedTarget("#p40")).toEqual({ page: 40, whole: false });
  });

  it("leaves a heading or a block to Obsidian", () => {
    expect(embedTarget("#Introduction")).toBeNull();
    expect(embedTarget("#^block")).toBeNull();
    expect(embedTarget("#page=0")).toBeNull();
  });
});

describe("embedLabel", () => {
  it("names the whole notebook, or the page", () => {
    expect(embedLabel("Physics.notebook", { page: 1, whole: true })).toBe("Physics");
    expect(embedLabel("Physics.notebook", { page: 3, whole: false })).toBe("Physics, page 3");
  });
});

describe("pageLinkLabel", () => {
  it("names the notebook without its suffix", () => {
    expect(pageLinkLabel("Physics.notebook", 3)).toBe("Physics, page 3");
    expect(pageLinkLabel("Sketch.page", 1)).toBe("Sketch, page 1");
    expect(pageLinkLabel("Plain", 2)).toBe("Plain, page 2");
  });
});

describe("embedWidth", () => {
  it("takes live preview's width attribute first", () => {
    expect(embedWidth("320", "500")).toBe(320);
  });

  it("reads the size syntax from the alt text", () => {
    expect(embedWidth(null, "300")).toBe(300);
    expect(embedWidth(null, "300x200")).toBe(300);
    expect(embedWidth(null, " 250 X 100 ")).toBe(250);
    expect(embedWidth(null, "400x")).toBe(400);
  });

  it("ignores an alias, a zero and nothing", () => {
    expect(embedWidth(null, "Physics, page 3")).toBeNull();
    expect(embedWidth("0", "0")).toBeNull();
    expect(embedWidth(null, null)).toBeNull();
    expect(embedWidth("", "")).toBeNull();
    expect(embedWidth(null, "x200")).toBeNull();
  });
});

describe("embedPaintSize", () => {
  it("rounds the width up to the next step", () => {
    expect(embedPaintSize(700, 1)).toEqual({ cssWidth: 704, dpr: 1 });
    expect(embedPaintSize(EMBED_WIDTH_STEP, 2)).toEqual({ cssWidth: EMBED_WIDTH_STEP, dpr: 2 });
    expect(embedPaintSize(1, 2)).toEqual({ cssWidth: EMBED_WIDTH_STEP, dpr: 2 });
  });

  it("gives the same size for widths within one step, so a resize does not repaint", () => {
    expect(embedPaintSize(641, 2)).toEqual(embedPaintSize(700, 2));
  });

  it("caps the canvas width in device px", () => {
    const size = embedPaintSize(1600, 3);
    expect(size?.cssWidth).toBe(1600);
    expect((size?.cssWidth ?? 0) * (size?.dpr ?? 0)).toBeLessThanOrEqual(MAX_EMBED_DEVICE_WIDTH);
    expect(embedPaintSize(700, 2)).toEqual({ cssWidth: 704, dpr: 2 });
  });

  it("has no size for a box with no width, and a pixel ratio of 1 for a broken one", () => {
    expect(embedPaintSize(0, 2)).toBeNull();
    expect(embedPaintSize(Number.NaN, 2)).toBeNull();
    expect(embedPaintSize(100, 0)).toEqual({ cssWidth: 128, dpr: 1 });
    expect(embedPaintSize(100, Number.POSITIVE_INFINITY)).toEqual({ cssWidth: 128, dpr: 1 });
  });
});

describe("embedsToRelease", () => {
  const mb = 1024 * 1024;

  it("releases nothing under budget", () => {
    const painted = [
      { key: "a", bytes: 10 * mb, visible: false, lastSeen: 1 },
      { key: "b", bytes: 10 * mb, visible: true, lastSeen: 2 },
    ];
    expect(embedsToRelease(painted, EMBED_CANVAS_BUDGET)).toEqual([]);
  });

  it("releases the embeds off screen longest first until the rest fit", () => {
    const painted = [
      { key: "seen-late", bytes: 30 * mb, visible: false, lastSeen: 30 },
      { key: "on-screen", bytes: 30 * mb, visible: true, lastSeen: 40 },
      { key: "seen-early", bytes: 30 * mb, visible: false, lastSeen: 10 },
      { key: "seen-mid", bytes: 30 * mb, visible: false, lastSeen: 20 },
    ];
    expect(embedsToRelease(painted, 64 * mb)).toEqual(["seen-early", "seen-mid"]);
  });

  it("never releases one on screen, even over budget", () => {
    const painted = [
      { key: 1, bytes: 50 * mb, visible: true, lastSeen: 1 },
      { key: 2, bytes: 50 * mb, visible: true, lastSeen: 2 },
      { key: 3, bytes: 5 * mb, visible: false, lastSeen: 3 },
    ];
    expect(embedsToRelease(painted, 64 * mb)).toEqual([3]);
  });
});

describe("SharedNotebooks", () => {
  it("loads a notebook once for every embed of it", async () => {
    const shared = new SharedNotebooks<string>();
    let loads = 0;
    const load = (): Promise<string> => Promise.resolve(`doc${++loads}`);
    const [a, b] = await Promise.all([shared.get("P.md", 1, load), shared.get("P.md", 1, load)]);
    expect(a).toBe("doc1");
    expect(b).toBe("doc1");
    expect(loads).toBe(1);
  });

  it("loads again when the file's version moves, or it was forgotten", async () => {
    const shared = new SharedNotebooks<number>();
    let loads = 0;
    const load = (): Promise<number> => Promise.resolve(++loads);
    expect(await shared.get("P.md", 1, load)).toBe(1);
    expect(await shared.get("P.md", 2, load)).toBe(2);
    expect(await shared.get("P.md", 2, load)).toBe(2);
    expect(shared.forget("P.md")).toBe(true);
    expect(shared.forget("P.md")).toBe(false);
    expect(await shared.get("P.md", 2, load)).toBe(3);
  });

  it("keeps only the most recently asked for", async () => {
    const shared = new SharedNotebooks<string>(2);
    let loads = 0;
    const load = (name: string) => (): Promise<string> => {
      loads++;
      return Promise.resolve(name);
    };
    await shared.get("a", 1, load("a"));
    await shared.get("b", 1, load("b"));
    await shared.get("a", 1, load("a"));
    await shared.get("c", 1, load("c"));
    expect(shared.size).toBe(2);
    expect(loads).toBe(3);
    // "b" was the least recent, so it went; "a" is still held.
    await shared.get("a", 1, load("a"));
    expect(loads).toBe(3);
    await shared.get("b", 1, load("b"));
    expect(loads).toBe(4);
    shared.clear();
    expect(shared.size).toBe(0);
  });

  it("does not keep a load that failed", async () => {
    const shared = new SharedNotebooks<string>();
    await expect(shared.get("P.md", 1, () => Promise.reject(new Error("gone")))).rejects.toThrow(
      "gone",
    );
    // Let the cache's own rejection handler run.
    await Promise.resolve();
    expect(shared.size).toBe(0);
    expect(await shared.get("P.md", 1, () => Promise.resolve("back"))).toBe("back");
  });
});

describe("embedPageNumbers", () => {
  const whole = { page: 1, whole: true };
  /** `n` pages with nothing in the contents. */
  const blank = (n: number): PreviewPage[] => Array.from({ length: n }, () => ({}));
  /** `n` pages with `marks` laid on (index: page fields). */
  const book = (n: number, marks: Record<number, PreviewPage>): PreviewPage[] =>
    blank(n).map((page, i) => marks[i] ?? page);

  it("shows every page of a notebook embedded whole while it has at most the limit", () => {
    expect(embedPageNumbers(whole, blank(3))).toEqual([1, 2, 3]);
    expect(embedPageNumbers(whole, blank(1))).toEqual([1]);
    expect(embedPageNumbers(whole, blank(MAX_PREVIEW_PAGES))).toHaveLength(MAX_PREVIEW_PAGES);
  });

  it("shows nothing of a notebook with no pages", () => {
    expect(embedPageNumbers(whole, [])).toEqual([]);
  });

  it("shows the one page a subpath names, whether or not the notebook has it", () => {
    expect(embedPageNumbers({ page: 4, whole: false }, blank(9))).toEqual([4]);
    expect(embedPageNumbers({ page: 40, whole: false }, blank(2))).toEqual([40]);
  });

  it("shows the first pages of a long notebook with no contents or bookmarks", () => {
    expect(embedPageNumbers(whole, blank(400))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("shows the cover, then the pages the contents and bookmarks point to", () => {
    const pages = book(400, {
      30: { title: "Waves" },
      120: { bookmarked: true },
      250: { sections: [{ title: "Optics" }] },
    });
    expect(embedPageNumbers(whole, pages)).toEqual([1, 31, 121, 251]);
  });

  it("puts chapters before bookmarks, and bookmarks before deeper entries", () => {
    const marks: Record<number, PreviewPage> = {};
    // 6 chapters, 4 bookmarks, 5 sections: 8 places after the cover.
    for (const i of [10, 20, 30, 40, 50, 60]) marks[i] = { title: `Ch ${i}` };
    for (const i of [15, 25, 35, 45]) marks[i] = { bookmarked: true };
    for (const i of [12, 22, 32, 42, 52]) marks[i] = { title: `S ${i}`, titleLevel: 2 };
    const shown = embedPageNumbers(whole, book(100, marks));
    expect(shown).toHaveLength(MAX_PREVIEW_PAGES);
    expect(shown[0]).toBe(1);
    for (const i of [10, 20, 30, 40, 50, 60]) expect(shown).toContain(i + 1);
    expect(shown.filter((n) => [16, 26, 36, 46].includes(n))).toHaveLength(2);
    expect(shown.filter((n) => [13, 23, 33, 43, 53].includes(n))).toHaveLength(0);
  });

  it("keeps two places for bookmarks however many chapters there are", () => {
    const chaptered = (bookmarks: number[]): number[] => {
      const marks: Record<number, PreviewPage> = {};
      for (let i = 10; i < 200; i += 10) marks[i] = { title: `Chapter ${i}` };
      for (const i of bookmarks) marks[i] = { bookmarked: true };
      return embedPageNumbers(whole, book(200, marks));
    };
    const isChapter = (n: number): boolean => (n - 1) % 10 === 0 && n > 1;
    // 19 chapters and 3 bookmarks: 6 chapters, 2 bookmarks.
    const three = chaptered([55, 125, 185]);
    expect(three).toHaveLength(MAX_PREVIEW_PAGES);
    expect(three.filter(isChapter)).toHaveLength(6);
    expect(three.filter((n) => [56, 126, 186].includes(n))).toHaveLength(2);
    // One bookmark keeps one place; the other goes back to the chapters.
    const one = chaptered([55]);
    expect(one).toContain(56);
    expect(one.filter(isChapter)).toHaveLength(7);
    // None: every place is a chapter's.
    expect(chaptered([]).filter(isChapter)).toHaveLength(8);
  });

  it("spreads too many chapters evenly through the notebook, in page order", () => {
    const marks: Record<number, PreviewPage> = {};
    for (let i = 1; i < 400; i += 2) marks[i] = { title: `Chapter ${i}` };
    const shown = embedPageNumbers(whole, book(400, marks));
    expect(shown).toHaveLength(MAX_PREVIEW_PAGES);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
    // The first chapter is kept, and the picks reach the last quarter of the book.
    expect(shown[1]).toBe(2);
    expect(shown[shown.length - 1]).toBeGreaterThan(300);
  });

  it("reads a heading on an untitled page as a chapter, and one under a title as a section", () => {
    const heading = { title: "H" };
    const pages = book(50, {
      10: { sections: [heading] },
      20: { title: "Chapter", sections: [heading] },
      30: { title: "Part", titleLevel: 3 },
      40: { sections: [{ title: "H", level: 2 }] },
    });
    // Two chapters fit; with a limit of 3 the sections are left out.
    expect(embedPageNumbers(whole, pages, 3)).toEqual([1, 11, 21]);
  });

  it("counts the page a name-only chapter stands before as a chapter's", () => {
    const pages = book(50, {
      12: { chapters: [{ title: "Part II" }] },
      30: { chapters: [{ title: "Appendix", after: true }] },
      40: { chapters: [{ title: "Aside", level: 2 }], bookmarked: true },
    });
    // A limit of 3: the chapter, then the bookmark; the `after` chapter starts nothing.
    expect(embedPageNumbers(whole, pages, 3)).toEqual([1, 13, 41]);
    expect(previewCaption(pages[12])).toBe("Part II");
    expect(previewCaption(pages[30])).toBeUndefined();
  });

  it("never shows more than the limit, however many pages are marked", () => {
    const pages = book(1000, {});
    for (let i = 0; i < 1000; i++) pages[i] = { title: `T${i}`, bookmarked: true };
    expect(embedPageNumbers(whole, pages)).toHaveLength(MAX_PREVIEW_PAGES);
  });

  it("holds at most half the smallest iPad canvas ceiling when Export to PDF paints them all", () => {
    // Export to PDF keeps every page it paints: an A4 page at the print size.
    const size = printPaintSize(0);
    const width = Math.round(size.cssWidth * size.dpr);
    const height = Math.round(width * Math.SQRT2);
    const bytes = width * height * 4;
    const IPAD_CANVAS_CEILING = 256 * 1024 * 1024;
    expect(MAX_PREVIEW_PAGES * bytes).toBeLessThanOrEqual(IPAD_CANVAS_CEILING / 2);
    expect((MAX_PREVIEW_PAGES + 3) * bytes).toBeGreaterThan(IPAD_CANVAS_CEILING / 2);
  });
});

describe("previewCaption", () => {
  it("names a page by its highest entry in the contents", () => {
    expect(previewCaption({ title: "Waves" })).toBe("Waves");
    expect(
      previewCaption({
        title: "Part",
        titleLevel: 2,
        sections: [{ title: "Chapter 4", level: 1 }],
      }),
    ).toBe("Chapter 4");
    expect(previewCaption({ sections: [{ title: "A" }, { title: "B" }] })).toBe("A");
  });

  it("has nothing for a page the contents does not list", () => {
    expect(previewCaption({})).toBeUndefined();
    expect(previewCaption({ bookmarked: true })).toBeUndefined();
  });
});

describe("embedPageLink", () => {
  it("opens the page clicked in a notebook embedded whole", () => {
    const whole = { page: 1, whole: true };
    expect(embedPageLink("Physics.notebook", whole, 3)).toBe("Physics.notebook#page=3");
    expect(embedPageLink("Courses/Physics.notebook.md", whole, 1)).toBe(
      "Courses/Physics.notebook.md#page=1",
    );
    expect(embedPageLink("Physics.notebook#", whole, 2)).toBe("Physics.notebook#page=2");
  });

  it("keeps a page embed's own link", () => {
    expect(embedPageLink("Physics.notebook#p3", { page: 3, whole: false }, 3)).toBe(
      "Physics.notebook#p3",
    );
  });
});

describe("embedPageLabel", () => {
  it("names each page of a notebook embedded whole, and the notebook when it has one page", () => {
    const whole = { page: 1, whole: true };
    expect(embedPageLabel("Physics.notebook", whole, 2, 5)).toBe("Physics, page 2");
    expect(embedPageLabel("Physics.notebook", whole, 1, 1)).toBe("Physics");
    expect(embedPageLabel("Physics.notebook", { page: 3, whole: false }, 3, 1)).toBe(
      "Physics, page 3",
    );
  });
});

describe("printPaintSize", () => {
  it("paints at the box's width, sharp for paper", () => {
    expect(printPaintSize(640)).toEqual({ cssWidth: 640, dpr: PRINT_DPR });
  });

  it("falls back to a text column's width when the layout gives none", () => {
    expect(printPaintSize(0).cssWidth).toBeGreaterThanOrEqual(PRINT_FALLBACK_WIDTH);
    expect(printPaintSize(Number.NaN).cssWidth).toBeGreaterThanOrEqual(PRINT_FALLBACK_WIDTH);
  });

  it("stays within the device-px cap", () => {
    const size = printPaintSize(1800);
    expect(size.cssWidth * size.dpr).toBeLessThanOrEqual(MAX_EMBED_DEVICE_WIDTH);
  });
});

describe("embedInsertion", () => {
  it("makes the link an embed", () => {
    expect(embedInsertion("[[Physics.notebook]]", "", "")).toBe("![[Physics.notebook]]");
    expect(embedInsertion("[Physics](Physics.notebook.md)", "", "")).toBe(
      "![Physics](Physics.notebook.md)",
    );
    expect(embedInsertion("![[Physics.notebook]]", "", "")).toBe("![[Physics.notebook]]");
  });

  it("makes it a paragraph of its own when the cursor is inside text", () => {
    expect(embedInsertion("[[A.notebook]]", "Vectors:", "")).toBe("\n\n![[A.notebook]]");
    expect(embedInsertion("[[A.notebook]]", "", " more")).toBe("![[A.notebook]]\n\n");
    expect(embedInsertion("[[A.notebook]]", "a", "b")).toBe("\n\n![[A.notebook]]\n\n");
    expect(embedInsertion("[[A.notebook]]", "   ", "\t")).toBe("![[A.notebook]]");
  });

  it("keeps a blank line from text on the lines around an empty one", () => {
    // An empty line between "Some text" and "### Vectors".
    expect(embedInsertion("[[A.notebook]]", "", "", "Some text", "### Vectors")).toBe(
      "\n![[A.notebook]]\n",
    );
    expect(embedInsertion("[[A.notebook]]", "", "", "", "")).toBe("![[A.notebook]]");
    expect(embedInsertion("[[A.notebook]]", "", "", "Text", "  ")).toBe("\n![[A.notebook]]");
  });
});
